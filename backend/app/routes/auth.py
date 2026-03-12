from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import httpx
import resend
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from jose import jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Document, TranslationTask, User
from ..password_utils import truncate_for_bcrypt, validate_password
from ..schemas import (
    EnsureUserRequest,
    LoginRequest,
    SendCodeRequest,
    SendCodeResponse,
    VerifyRegisterRequest,
)
from ..verify_store import (
    delete_code,
    generate_code,
    get_attempts,
    get_code,
    incr_attempts,
    reset_attempts,
    set_code,
)

logger = logging.getLogger(__name__)
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
router = APIRouter(tags=["auth"])


def _get_google_oauth_urls() -> Dict[str, str]:
    settings = get_settings()
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth"
    token_url = "https://oauth2.googleapis.com/token"
    return {
        "auth_url": auth_url,
        "token_url": token_url,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri,
    }


@router.get("/auth/google/login")
def google_login(request: Request) -> RedirectResponse:
    """
    启动 Google OAuth 登录流程。

    生产环境中需要在 Google Cloud Console 中将 redirect_uri 配置为
    本应用的 /api/auth/google/callback。
    """
    settings = get_settings()
    cfg = _get_google_oauth_urls()
    state = secrets.token_urlsafe(16)
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    from urllib.parse import urlencode

    url = f'{cfg["auth_url"]}?{urlencode(params)}'
    return RedirectResponse(url)


@router.get("/auth/google/callback")
async def google_callback(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Google OAuth 回调：

    - 使用授权码交换 ID token
    - 解析 Google 账户信息
    - 创建或查找本地 User
    - 签发应用自己的 JWT，返回给前端（简单起见，先放在查询参数或 JSON 中）
    """
    settings = get_settings()
    cfg = _get_google_oauth_urls()
    code = request.query_params.get("code")
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")

    async with httpx.AsyncClient(timeout=10) as client:
        token_res = await client.post(
            cfg["token_url"],
            data={
                "code": code,
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "redirect_uri": cfg["redirect_uri"],
                "grant_type": "authorization_code",
            },
        )
    if token_res.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange token")

    token_data = token_res.json()
    id_token = token_data.get("id_token")
    if not id_token:
        raise HTTPException(status_code=400, detail="No id_token in response")

    # 为简化实现，这里不对 ID token 做完整签名验证，仅解析 payload。
    # 生产环境应使用 google-auth 库校验签名与 aud/iss。
    from jose import jwt as jose_jwt

    unverified = jose_jwt.get_unverified_claims(id_token)
    sub = unverified.get("sub")
    email = unverified.get("email")
    name = unverified.get("name")

    if not sub:
        raise HTTPException(status_code=400, detail="Invalid Google token")

    user: User | None = db.query(User).filter_by(email=email).first()
    if not user:
        user = User(
            email=email,
            display_name=name or email,
            preferred_locale="en",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # 若回调时带上了临时用户 guest_id Cookie，将其文档与任务迁移到当前正式用户
    guest_id = request.cookies.get("guest_id")
    if guest_id and str(guest_id) != str(user.id):
        guest_user = db.query(User).get(guest_id)
        if guest_user and guest_user.is_temporary:
            db.query(Document).filter(Document.user_id == guest_id).update(
                {Document.user_id: user.id}
            )
            db.query(TranslationTask).filter(TranslationTask.user_id == guest_id).update(
                {TranslationTask.user_id: user.id}
            )
            db.commit()

    # 签发应用自己的 JWT
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.display_name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=7)).timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    # 简化起见，先以 JSON 形式返回，前端可存于 cookie/localStorage
    return {"access_token": token, "token_type": "bearer"}


def _send_verification_email(to_email: str, code: str) -> None:
    """通过 Resend 发送验证码邮件。未配置 RESEND_API_KEY 时仅打日志不发信。"""
    settings = get_settings()
    if not settings.resend_api_key:
        logger.info("send_code email=%s code=%s (RESEND_API_KEY not set, log only)", to_email, code)
        return
    # 本地未配置 RESEND_FROM 时使用 Resend 沙箱发件人，无需验证自有域名
    from_addr = settings.resend_from or (
        "onboarding@resend.dev" if settings.environment == "local" else "noreply@translatepdfonline.com"
    )
    try:
        resend.api_key = settings.resend_api_key
        resend.Emails.send({
            "from": from_addr,
            "to": [to_email.strip()],
            "subject": "Your verification code - TranslatePDFOnline",
            "html": f"<p>Your verification code is: <strong>{code}</strong></p><p>It is valid for 60 seconds.</p>",
        })
        logger.info("send_code email=%s sent via Resend", to_email)
    except Exception as e:
        logger.exception("send_code Resend failed for %s: %s", to_email, e)
        raise HTTPException(status_code=503, detail="Failed to send verification email. Please try again later.")


@router.post("/auth/send-code", response_model=SendCodeResponse)
def send_code(
    req: SendCodeRequest,
) -> SendCodeResponse:
    """
    发送注册验证码到邮箱。验证码 60 秒有效。
    配置 RESEND_API_KEY 与 RESEND_FROM 后通过 Resend 发信；未配置则仅记录日志。
    """
    code = generate_code()
    set_code(req.email, code)
    _send_verification_email(req.email, code)
    return SendCodeResponse(ok=True)


@router.post("/auth/verify-register")
def verify_register(
    req: VerifyRegisterRequest,
    db: Session = Depends(get_db),
):
    """
    校验验证码并注册：创建用户，写入 password_hash。
    验证码最多 5 次错误，超过需重新获取。
    """
    email_lower = req.email.strip().lower()
    attempts = get_attempts(email_lower)
    if attempts >= 5:
        delete_code(email_lower)
        raise HTTPException(
            status_code=400,
            detail="Too many failed attempts. Please request a new code.",
        )
    stored = get_code(email_lower)
    if not stored or stored != req.code.strip():
        incr_attempts(email_lower)
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    ok, err = validate_password(req.password)
    if not ok:
        raise HTTPException(status_code=400, detail=err)

    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    password_hash = pwd_ctx.hash(truncate_for_bcrypt(req.password))
    user = User(
        email=req.email,
        password_hash=password_hash,
        is_temporary=False,
        preferred_locale="zh",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    delete_code(email_lower)
    reset_attempts(email_lower)
    return {"id": str(user.id), "email": user.email}


@router.post("/auth/ensure-user")
def ensure_user(
    body: EnsureUserRequest,
    db: Session = Depends(get_db),
):
    """
    根据邮箱获取或创建用户，返回 backend user id 与 access_token。
    供 NextAuth Google 登录后同步 session.sub 与后端 API 鉴权（前端用 access_token 作为 Bearer）。
    """
    email = body.email.strip()
    name = (body.name or "").strip() or email
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            email=email,
            display_name=name,
            is_temporary=False,
            preferred_locale="zh",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.display_name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=7)).timestamp()),
    }
    access_token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return {"id": str(user.id), "access_token": access_token}


@router.post("/auth/login")
def login(
    req: LoginRequest,
    db: Session = Depends(get_db),
):
    """
    邮箱+密码登录，校验通过后返回 JWT。供 NextAuth Credentials 等调用。
    """
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not pwd_ctx.verify(truncate_for_bcrypt(req.password), user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.display_name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=7)).timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer", "user": {"id": str(user.id), "email": user.email}}


