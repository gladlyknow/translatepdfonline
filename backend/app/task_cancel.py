"""
翻译任务取消请求：Redis 标记，Worker 轮询后设置 cancel_event。
Key: translation:cancel:{task_id}, TTL 300s。
"""
from __future__ import annotations

import logging

from .config import get_settings

logger = logging.getLogger(__name__)

CANCEL_KEY_PREFIX = "translation:cancel:"
TTL_SECONDS = 300


def _redis():
    import redis
    return redis.from_url(str(get_settings().redis_url), decode_responses=True)


def request_cancel(task_id: str) -> None:
    """请求取消任务：设置 Redis 键，Worker 轮询到后会使 BabelDOC 抛出取消。"""
    try:
        r = _redis()
        key = f"{CANCEL_KEY_PREFIX}{task_id}"
        r.setex(key, TTL_SECONDS, "1")
    except Exception as e:
        logger.warning("request_cancel failed task_id=%s: %s", task_id, e)


def check_cancel_requested(task_id: str) -> bool:
    """是否已请求取消（供 Worker 轮询）。"""
    try:
        r = _redis()
        return r.get(f"{CANCEL_KEY_PREFIX}{task_id}") is not None
    except Exception as e:
        logger.debug("check_cancel_requested failed task_id=%s: %s", task_id, e)
        return False


def clear_cancel_request(task_id: str) -> None:
    """清除取消请求（任务结束后可选调用）。"""
    try:
        r = _redis()
        r.delete(f"{CANCEL_KEY_PREFIX}{task_id}")
    except Exception as e:
        logger.debug("clear_cancel_request failed task_id=%s: %s", task_id, e)
