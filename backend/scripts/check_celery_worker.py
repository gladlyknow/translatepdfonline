"""
Celery Worker 健康检测脚本：发现长时间 queued 无进展或队列有积压且无活跃 worker 时退出码 1。
供 Windows 任务计划程序 / Linux cron 等根据退出码决定是否重启 worker。本脚本内不杀进程。
运行方式（在 backend 目录下）：python -m scripts.check_celery_worker
"""
import os
import sys
from datetime import datetime, timedelta, timezone

# 确保 backend 为当前工作目录时能导入 app
if __name__ == "__main__":
    _backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _backend not in sys.path:
        sys.path.insert(0, _backend)

from sqlalchemy import and_

from app.config import get_settings
from app.db import SessionLocal
from app.models import TranslationTask
from app.celery_app import celery_app


def _stuck_minutes() -> int:
    return int(os.environ.get("WORKER_STUCK_MINUTES", "5"))


def has_stuck_queued_tasks() -> bool:
    """是否存在 status=queued 且 updated_at 早于「当前 - N 分钟」的任务。"""
    threshold = datetime.now(timezone.utc) - timedelta(minutes=_stuck_minutes())
    db = SessionLocal()
    try:
        first = (
            db.query(TranslationTask)
            .filter(
                and_(
                    TranslationTask.status == "queued",
                    TranslationTask.updated_at < threshold,
                )
            )
            .first()
        )
        return first is not None
    finally:
        db.close()


def worker_responds() -> bool:
    """Celery inspect ping 是否有至少一个 worker 响应。"""
    try:
        reply = celery_app.control.inspect().ping()
        return bool(reply)
    except Exception:
        return False


def redis_queue_length() -> int:
    """Celery 默认队列（celery）在 Redis 中的 list 长度。不可用时返回 -1。"""
    try:
        import redis
        settings = get_settings()
        url = str(settings.redis_url)
        # redis://... 解析
        r = redis.from_url(url)
        return r.llen("celery")
    except Exception:
        return -1


def main() -> int:
    stuck = has_stuck_queued_tasks()
    backlog_redis = redis_queue_length()
    has_backlog = backlog_redis > 0
    workers_up = worker_responds()

    if (stuck or has_backlog) and not workers_up:
        print(
            "[check_celery_worker] ALERT: stuck queued tasks or queue backlog present, and no worker responded to ping. Exit 1."
        )
        if stuck:
            print("[check_celery_worker] There are tasks in DB stuck in 'queued' longer than {} minutes.".format(_stuck_minutes()))
        if has_backlog:
            print("[check_celery_worker] Redis queue 'celery' length = {}.".format(backlog_redis))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
