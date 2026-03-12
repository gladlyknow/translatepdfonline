"""
注册验证码与尝试次数：Redis 存储。
- 验证码 60s 有效
- 校验失败最多 5 次，超过需重新获取验证码
"""
from __future__ import annotations

import logging
import random
import string
from typing import Optional

from .config import get_settings

logger = logging.getLogger(__name__)

CODE_KEY_PREFIX = "verify_code:register:"
ATTEMPTS_KEY_PREFIX = "verify_attempts:register:"
CODE_TTL_SECONDS = 60
ATTEMPTS_TTL_SECONDS = 300
MAX_ATTEMPTS = 5
CODE_LENGTH = 6


def _redis():
    import redis
    return redis.from_url(str(get_settings().redis_url), decode_responses=True)


def generate_code() -> str:
    return "".join(random.choices(string.digits, k=CODE_LENGTH))


def set_code(email: str, code: str) -> None:
    try:
        r = _redis()
        key = f"{CODE_KEY_PREFIX}{email.strip().lower()}"
        r.setex(key, CODE_TTL_SECONDS, code)
    except Exception as e:
        logger.warning("verify_store set_code failed: %s", e)


def get_code(email: str) -> Optional[str]:
    try:
        r = _redis()
        key = f"{CODE_KEY_PREFIX}{email.strip().lower()}"
        return r.get(key)
    except Exception as e:
        logger.debug("verify_store get_code failed: %s", e)
        return None


def delete_code(email: str) -> None:
    try:
        r = _redis()
        key = f"{CODE_KEY_PREFIX}{email.strip().lower()}"
        r.delete(key)
    except Exception as e:
        logger.debug("verify_store delete_code failed: %s", e)


def get_attempts(email: str) -> int:
    try:
        r = _redis()
        key = f"{ATTEMPTS_KEY_PREFIX}{email.strip().lower()}"
        val = r.get(key)
        return int(val) if val else 0
    except Exception as e:
        logger.debug("verify_store get_attempts failed: %s", e)
        return 0


def incr_attempts(email: str) -> int:
    try:
        r = _redis()
        key = f"{ATTEMPTS_KEY_PREFIX}{email.strip().lower()}"
        n = r.incr(key)
        if n == 1:
            r.expire(key, ATTEMPTS_TTL_SECONDS)
        return n
    except Exception as e:
        logger.debug("verify_store incr_attempts failed: %s", e)
        return 0


def reset_attempts(email: str) -> None:
    try:
        r = _redis()
        key = f"{ATTEMPTS_KEY_PREFIX}{email.strip().lower()}"
        r.delete(key)
    except Exception as e:
        logger.debug("verify_store reset_attempts failed: %s", e)
