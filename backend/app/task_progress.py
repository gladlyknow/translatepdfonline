"""
任务细粒度进度：存于 Redis，供 GET /tasks/:id 返回，Worker 在 BabelDOC 回调中写入。
Key: task_progress:{task_id}, TTL 1 天。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from .config import get_settings

logger = logging.getLogger(__name__)

PROGRESS_KEY_PREFIX = "task_progress:"
TTL_SECONDS = 86400  # 1 day


def _redis():
    import redis
    settings = get_settings()
    return redis.from_url(str(settings.redis_url), decode_responses=True)


def set_progress(task_id: str, data: dict[str, Any]) -> None:
    """写入进度（仅 progress_update 时写入 stage/current/total/percent）。"""
    try:
        r = _redis()
        key = f"{PROGRESS_KEY_PREFIX}{task_id}"
        r.setex(key, TTL_SECONDS, json.dumps(data))
    except Exception as e:  # noqa: BLE001
        logger.debug("set_progress failed task_id=%s: %s", task_id, e)


def get_progress(task_id: str) -> dict[str, Any] | None:
    """读取进度，不存在返回 None。"""
    try:
        r = _redis()
        key = f"{PROGRESS_KEY_PREFIX}{task_id}"
        raw = r.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as e:  # noqa: BLE001
        logger.debug("get_progress failed task_id=%s: %s", task_id, e)
        return None


def clear_progress(task_id: str) -> None:
    """任务结束或失败时删除进度 key。"""
    try:
        r = _redis()
        r.delete(f"{PROGRESS_KEY_PREFIX}{task_id}")
    except Exception as e:  # noqa: BLE001
        logger.debug("clear_progress failed task_id=%s: %s", task_id, e)
