"""User profile: me, avatar upload (logged-in only)."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth_utils import get_current_user_or_temp
from ..config import get_settings, PROJECT_ROOT
from ..db import get_db
from ..models import User
from ..schemas import UserMeResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["user"])

AVATAR_MAX_BYTES = 500 * 1024
AVATAR_DIR = PROJECT_ROOT / "tmp" / "avatars"
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _require_logged_in(user: User) -> None:
    if user.is_temporary:
        raise HTTPException(status_code=401, detail="login_required")


@router.get("/user/me", response_model=UserMeResponse)
def get_me(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> UserMeResponse:
    _require_logged_in(user)
    base = request.base_url
    avatar_url = None
    if getattr(user, "avatar_url", None):
        avatar_url = f"{base.rstrip('/')}{get_settings().api_base_prefix}/user/avatar"
    return UserMeResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        avatar_url=avatar_url,
    )


@router.get("/user/avatar")
def get_avatar(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
):
    _require_logged_in(user)
    filename = getattr(user, "avatar_url", None)
    if not filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=404, detail="No avatar")
    full_path = AVATAR_DIR / filename
    if not full_path.is_file():
        raise HTTPException(status_code=404, detail="Avatar file not found")
    return FileResponse(full_path, media_type="image/jpeg")


@router.post("/user/avatar")
def upload_avatar(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
    file: UploadFile = File(...),
):
    _require_logged_in(user)
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid image type")
    content = file.file.read()
    if len(content) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image must be under 500KB")
    ext = "jpg"
    if file.content_type == "image/png":
        ext = "png"
    elif file.content_type == "image/gif":
        ext = "gif"
    elif file.content_type == "image/webp":
        ext = "webp"
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{user.id}.{ext}"
    dest = AVATAR_DIR / filename
    dest.write_bytes(content)
    user.avatar_url = filename
    db.add(user)
    db.commit()
    return {"avatar_url": filename}
