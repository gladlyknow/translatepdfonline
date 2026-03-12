from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, Response
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .fp_store import bind_fingerprint_to_user, get_user_id_by_fingerprint
from .models import User


def _decode_access_token(token: str) -> Optional[dict]:
    settings = get_settings()
    for secret in (settings.jwt_secret, settings.auth_secret):
        try:
            return jwt.decode(token, secret, algorithms=["HS256"])
        except JWTError:
            continue
    return None


def get_current_user_or_temp(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> User:
    """
    从 Authorization Bearer 或 guest_id Cookie 中解析当前用户；
    若均不存在，则创建一个临时用户（匿名访客）。
    """
    # 1）优先尝试解析登录用户（Bearer JWT：后端 Google 回调或 NextAuth 前端传入）
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        payload = _decode_access_token(token)
        if payload and payload.get("sub"):
            user_id = payload["sub"]
            user = db.query(User).get(user_id)
            if user:
                return user

    # 1b）NextAuth 会话 Cookie（前端代理请求时可能只带 Cookie 不带 Authorization）
    for cookie_name in ("authjs.session-token", "next-auth.session-token", "__Secure-authjs.session-token"):
        token = request.cookies.get(cookie_name)
        if token:
            payload = _decode_access_token(token)
            if payload and payload.get("sub"):
                user = db.query(User).get(payload["sub"])
                if user:
                    return user
            break

    # 2）尝试从 Cookie 中恢复临时用户
    guest_id = request.cookies.get("guest_id")
    if guest_id:
        user = db.query(User).get(guest_id)
        if user and user.is_temporary:
            return user

    # 3）尝试从浏览器指纹恢复临时用户（防清 Cookie 白嫖）
    fp_hash = request.headers.get("X-Client-Fingerprint") or request.cookies.get("fp")
    if fp_hash:
        fp_hash = fp_hash.strip()
        bound_user_id = get_user_id_by_fingerprint(fp_hash)
        if bound_user_id:
            user = db.query(User).get(bound_user_id)
            if user and user.is_temporary:
                expires = datetime.now(timezone.utc) + timedelta(days=7)
                response.set_cookie(
                    key="guest_id",
                    value=str(user.id),
                    httponly=False,
                    samesite="Lax",
                    expires=int(expires.timestamp()),
                )
                # 回写 fp Cookie，提高同会话内识别成功率
                response.set_cookie(
                    key="fp",
                    value=fp_hash,
                    httponly=False,
                    samesite="Lax",
                    max_age=90 * 24 * 3600,
                )
                return user

    # 4）创建新的临时用户，Cookie + 指纹绑定
    # 必须携带指纹，否则清 Cookie 后可绕过配额限制
    if not fp_hash or not fp_hash.strip():
        raise HTTPException(
            status_code=403,
            detail="fingerprint_required",
        )
    user = User(
        is_temporary=True,
        quota_pages_total=5,
        quota_pages_used=0,
        preferred_locale="zh",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    expires = datetime.now(timezone.utc) + timedelta(days=7)
    response.set_cookie(
        key="guest_id",
        value=str(user.id),
        httponly=False,
        samesite="Lax",
        expires=int(expires.timestamp()),
    )
    bind_fingerprint_to_user(fp_hash, str(user.id))
    response.set_cookie(
        key="fp",
        value=fp_hash,
        httponly=False,
        samesite="Lax",
        max_age=90 * 24 * 3600,
    )

    return user

