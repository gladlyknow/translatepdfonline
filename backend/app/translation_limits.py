"""
翻译任务并发与限流：Redis 计数，防止 ECS 被并发翻译打满。
"""
from __future__ import annotations

import logging
from typing import Optional

from .config import get_settings

logger = logging.getLogger(__name__)

REDIS_KEY_RUNNING = "translation:running_count"


def _redis():
    import redis
    settings = get_settings()
    return redis.from_url(str(settings.redis_url), decode_responses=True)


def get_running_count() -> int:
    """当前正在执行的翻译任务数（含 queued 后已入队未完成的）。"""
    try:
        r = _redis()
        raw = r.get(REDIS_KEY_RUNNING)
        return int(raw) if raw is not None else 0
    except Exception as e:  # noqa: BLE001
        logger.debug("get_running_count failed: %s", e)
        return 0


def inc_running() -> int:
    """入队时 +1，返回递增后的值。"""
    try:
        r = _redis()
        return r.incr(REDIS_KEY_RUNNING)
    except Exception as e:  # noqa: BLE001
        logger.debug("inc_running failed: %s", e)
        return 0


def dec_running() -> None:
    """任务结束时 -1（worker 内调用）。"""
    try:
        r = _redis()
        n = r.decr(REDIS_KEY_RUNNING)
        if n < 0:
            r.set(REDIS_KEY_RUNNING, 0)
    except Exception as e:  # noqa: BLE001
        logger.debug("dec_running failed: %s", e)


def check_can_start() -> tuple[bool, Optional[str]]:
    """
    检查是否允许新建翻译任务（未超并发上限）。
    返回 (allowed, error_detail)。
    """
    settings = get_settings()
    max_concurrent = settings.translation_max_concurrent
    current = get_running_count()
    if current >= max_concurrent:
        return False, "translation_busy_try_later"
    return True, None
