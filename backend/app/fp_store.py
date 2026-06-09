"""
浏览器指纹与临时用户绑定：Redis 存储 fp_hash -> user_id，防止清 Cookie 白嫖。
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from .config import get_settings

logger = logging.getLogger(__name__)

FP_KEY_PREFIX = "fp:"
FP_TTL_DAYS = 90
# 指纹哈希：字母数字 + 连字符，长度 16–64（FingerprintJS 等常见格式）
FP_HASH_PATTERN = re.compile(r"^[a-zA-Z0-9\-]{16,64}$")


def _redis():
    import redis
    settings = get_settings()
    return redis.from_url(str(settings.redis_url), decode_responses=True)


def _valid_hash(fp_hash: Optional[str]) -> bool:
    if not fp_hash or not isinstance(fp_hash, str):
        return False
    return bool(FP_HASH_PATTERN.fullmatch(fp_hash.strip()))


def get_user_id_by_fingerprint(fp_hash: str) -> Optional[str]:
    """根据指纹哈希获取绑定的 user_id，不存在返回 None。"""
    if not _valid_hash(fp_hash):
        return None
    try:
        r = _redis()
        key = f"{FP_KEY_PREFIX}{fp_hash.strip()}"
        return r.get(key)
    except Exception as e:  # noqa: BLE001
        logger.debug("get_user_id_by_fingerprint failed: %s", e)
        return None


def bind_fingerprint_to_user(fp_hash: str, user_id: str) -> None:
    """将指纹绑定到 user_id，TTL 90 天。"""
    if not _valid_hash(fp_hash) or not user_id:
        return
    try:
        r = _redis()
        key = f"{FP_KEY_PREFIX}{fp_hash.strip()}"
        r.setex(key, FP_TTL_DAYS * 86400, user_id)
    except Exception as e:  # noqa: BLE001
        logger.debug("bind_fingerprint_to_user failed: %s", e)
