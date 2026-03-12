import logging
from pathlib import Path

from .celery_app import celery_app
from .config import get_settings
from .storage_r2 import download_to_path
from .pdf_utils import get_pdf_page_count
from .db import SessionLocal
from .models import Document

logger = logging.getLogger(__name__)


@celery_app.task(name="pdf.preprocess_pdf")
def preprocess_pdf(document_id: str, object_key: str) -> None:
    """
    PDF 预处理 Celery 任务：

    - 从 R2 下载原始 PDF 至本地 BABELDOC_STAGING_DIR
    - 计算页数（如尚未写入）
    - 为后续 BabelDOC / MinerU 预处理与翻译任务准备本地文件
    """
    settings = get_settings()
    logger.info("preprocess_pdf started document_id=%s object_key=%s", document_id, object_key)

    project_root = Path(__file__).resolve().parents[2]
    staging_base = Path(settings.babeldoc_staging_dir) if settings.babeldoc_staging_dir else project_root / "tmp" / "staging"
    local_path = staging_base / object_key

    try:
        # 下载到本地 staging 路径
        download_to_path(object_key, local_path)
    except Exception as exc:  # noqa: BLE001
        logger.exception("failed to download PDF from R2 document_id=%s object_key=%s exc=%s", document_id, object_key, exc)
        raise

    # 更新文档页数信息
    db = SessionLocal()
    try:
        doc = db.query(Document).get(document_id)
        if doc:
            try:
                page_count = get_pdf_page_count(local_path)
            except Exception:  # noqa: BLE001
                page_count = None

            if page_count is not None and not doc.page_count:
                doc.page_count = page_count
                db.add(doc)
                db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("failed to update page_count for document_id=%s", document_id)
    finally:
        db.close()

    logger.info("preprocess_pdf finished document_id=%s local_path=%s", document_id, local_path)

