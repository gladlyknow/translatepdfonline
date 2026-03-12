import logging
import os
import sys
from datetime import datetime, timezone

from celery import Celery
from celery.signals import worker_ready

from .config import get_settings


settings = get_settings()

# 开发环境下先只用 Redis 做 broker，不启用 result backend，
# 避免 Redis 鉴权问题导致整个请求报错。后续需要持久化任务结果时，
# 可以单独引入 CELERY_RESULT_BACKEND_URL 再打开。
celery_app = Celery(
    "translatepdfonline",
    broker=str(settings.redis_url),
    backend=None,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    worker_prefetch_multiplier=1,
    broker_transport_options={"visibility_timeout": 3600},
)


# Worker 进程入口统一配置日志，确保终端可见任务阶段与 DeepSeek 请求
def _configure_worker_logging() -> None:
    root = logging.getLogger()
    if not any(h for h in root.handlers if isinstance(h, logging.StreamHandler)):
        h = logging.StreamHandler(sys.stdout)
        h.setLevel(logging.INFO)
        root.addHandler(h)
    if root.level > logging.INFO:
        root.setLevel(logging.INFO)
    for name in ("app.tasks_translate", "httpx", "httpcore", "openai"):
        log = logging.getLogger(name)
        log.setLevel(logging.INFO)
    if os.environ.get("DEEPSEEK_LOG_REQUESTS") == "1":
        for name in ("httpx", "httpcore"):
            logging.getLogger(name).setLevel(logging.DEBUG)


_configure_worker_logging()


# 显式导入任务模块，确保 worker 能注册任务
# 注意放在 celery_app 定义之后，避免循环导入问题
from . import tasks_pdf as _tasks_pdf  # noqa: F401
from . import tasks_translate as _tasks_translate  # noqa: F401


@worker_ready.connect
def _mark_stale_processing_tasks_failed(**kwargs) -> None:
    """
    Worker 启动时把上次异常退出遗留的 processing 任务标为失败，
    避免重启后前端一直显示 Translating。
    """
    try:
        from .db import SessionLocal
        from .models import TranslationTask

        db = SessionLocal()
        try:
            stale = (
                db.query(TranslationTask)
                .filter(TranslationTask.status == "processing")
                .all()
            )
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            for t in stale:
                t.status = "failed"
                t.error_code = "worker_restart"
                t.error_message = "Translation was interrupted (e.g. server or worker restarted). Please try again."
                t.updated_at = now
            if stale:
                db.commit()
                logging.getLogger(__name__).info(
                    "worker_ready: marked %d stale processing task(s) as failed (worker_restart)",
                    len(stale),
                )
        finally:
            db.close()
    except Exception as e:  # noqa: BLE001
        logging.getLogger(__name__).warning(
            "worker_ready: failed to mark stale processing tasks: %s", e
        )

