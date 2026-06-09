import asyncio
import logging
import os
import subprocess
import sys
import tempfile
import threading
from datetime import datetime
from pathlib import Path

import pymupdf
from sqlalchemy.orm import Session

from .config import get_settings
from .storage_r2 import (
    create_presigned_get as r2_create_presigned_get,
    download_to_path as r2_download_to_path,
    upload_file as r2_upload_file,
)
from .babeldoc_adapter import get_task_output_dir, resolve_staging_path, run_translate
from . import babeldoc_client
from .pdf_health import check_pdf_health
from .celery_app import celery_app
from .db import SessionLocal
from .models import Document, TranslationTask
from .task_progress import clear_progress, set_progress
from .task_cancel import check_cancel_requested, clear_cancel_request

logger = logging.getLogger(__name__)


def _parse_page_range(page_range: str | None) -> list[int] | None:
    """
    解析 page_range 为 0-based 页索引列表。如 "1" -> [0], "1-3" -> [0,1,2]。
    None 或空返回 None（表示不切片）。
    """
    if not page_range or not page_range.strip():
        return None
    s = page_range.strip()
    if "-" in s:
        parts = s.split("-", 1)
        try:
            start = int(parts[0].strip())
            end = int(parts[1].strip())
            if start < 1 or end < start:
                return None
            return list(range(start - 1, end))
        except ValueError:
            return None
    try:
        p = int(s)
        if p < 1:
            return None
        return [p - 1]
    except ValueError:
        return None


def _extract_source_pages_pdf(source_pdf_path: Path, page_indices: list[int], out_path: Path) -> None:
    """使用 PyMuPDF 从源 PDF 提取指定页（0-based）并保存为 out_path。"""
    import fitz
    doc = fitz.open(str(source_pdf_path))
    try:
        out_doc = fitz.open()
        for i in page_indices:
            if 0 <= i < len(doc):
                out_doc.insert_pdf(doc, from_page=i, to_page=i)
        out_doc.save(str(out_path), deflate=False)
        out_doc.close()
    finally:
        doc.close()


def _compress_pdf(path: Path) -> Path:
    """
    使用 PyMuPDF 压缩 PDF（deflate + 清理），减小体积后返回压缩文件路径。
    若压缩失败或体积未减小则返回原路径。
    """
    import fitz
    try:
        doc = fitz.open(str(path))
        if doc.page_count == 0:
            doc.close()
            return path
        orig_size = path.stat().st_size
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        tmp_path = Path(tmp.name)
        tmp.close()
        try:
            doc.save(
                str(tmp_path),
                deflate=True,
                garbage=4,
                clean=True,
            )
            doc.close()
            new_size = tmp_path.stat().st_size
            if new_size < orig_size and new_size > 0:
                return tmp_path
        except Exception:
            if not getattr(doc, "is_closed", True):
                doc.close()
            raise
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
    except Exception as e:
        logger.warning("_compress_pdf failed path=%s err=%s", path, e)
    return path


def _source_lang_to_tesseract(source_lang: str) -> str:
    """将 source_lang 映射为 Tesseract -l 参数（如 zh -> chi_sim+eng）。"""
    lang = (source_lang or "").strip().lower()
    if lang in ("zh", "zh-cn", "zh_cn", "chinese"):
        return "chi_sim+eng"
    if lang in ("zh-tw", "zh_tw"):
        return "chi_tra+eng"
    if lang in ("ja", "japanese"):
        return "jpn+eng"
    if lang in ("ko", "korean"):
        return "kor+eng"
    if lang in ("es", "spa", "spanish"):
        return "spa"
    if lang in ("fr", "french"):
        return "fra"
    if lang in ("de", "german"):
        return "deu"
    if lang in ("en", "english"):
        return "eng"
    return "eng"


def _get_ocrmypdf_cmd_and_env() -> tuple[list[str], dict[str, str]]:
    """
    返回 (argv, env) 用于 subprocess 调用 OCRmyPDF。
    优先使用本地 tmp/OCRmyPDF/src（python -m ocrmypdf + PYTHONPATH），
    若本地路径不存在则回退到系统/venv 的 ocrmypdf 命令。
    """
    project_root = Path(__file__).resolve().parents[2]
    local_ocrmypdf_src = project_root / "tmp" / "OCRmyPDF" / "src"
    if local_ocrmypdf_src.is_dir():
        env = os.environ.copy()
        prepend = str(local_ocrmypdf_src)
        env["PYTHONPATH"] = prepend if not env.get("PYTHONPATH") else f"{prepend}{os.pathsep}{env['PYTHONPATH']}"
        return [sys.executable, "-m", "ocrmypdf"], env
    return ["ocrmypdf"], os.environ.copy()


def _run_ocr_preprocess(input_path: Path, output_path: Path, source_lang: str) -> str | None:
    """
    使用 OCRmyPDF 对 PDF 做 OCR，生成带文本层的 output_path。
    优先使用本地 tmp/OCRmyPDF/src（python -m ocrmypdf），否则调用系统 ocrmypdf CLI。
    """
    tesseract_lang = _source_lang_to_tesseract(source_lang)
    argv_base, run_env = _get_ocrmypdf_cmd_and_env()
    argv = argv_base + [
        str(input_path),
        str(output_path),
        "-l",
        tesseract_lang,
        "--optimize",
        "0",
    ]
    logger.info(
        "OCR preprocess start: input=%s output=%s source_lang=%s tesseract_lang=%s argv=%s",
        input_path,
        output_path,
        source_lang,
        tesseract_lang,
        argv,
    )
    try:
        subprocess.run(
            argv,
            check=True,
            capture_output=True,
            text=True,
            timeout=600,
            env=run_env,
        )
        out_size = output_path.stat().st_size if output_path.exists() else 0
        logger.info(
            "OCR preprocess success: output=%s size_bytes=%s",
            output_path,
            out_size,
        )
        return None
    except FileNotFoundError:
        return "OCRmyPDF 未安装。启用 OCR 前置需安装 OCRmyPDF 与 Tesseract，或确保项目内存在 tmp/OCRmyPDF/src 并安装其依赖。"
    except subprocess.CalledProcessError as e:
        out = (e.stdout or "") + (e.stderr or "")
        return f"OCR 预处理失败: {out[:400]}" if out else "OCR 预处理失败，请检查 Tesseract 与 OCRmyPDF 配置。"
    except subprocess.TimeoutExpired:
        return "OCR 预处理超时，请重试或缩小页码范围。"
    except Exception as e:
        return f"OCR 预处理异常: {e!s}"


def _update_task_status(db: Session, task: TranslationTask, status: str) -> None:
    task.status = status
    task.updated_at = datetime.utcnow()
    if status == "failed":
        # 兜底：避免失败任务在前端只显示 Failed 但无任何原因
        if not getattr(task, "error_code", None):
            task.error_code = "internal_error"
        if not getattr(task, "error_message", None):
            task.error_message = "Task failed. Check worker logs and configuration."
        logger.info(
            "run_translation_task failed task_id=%s error_code=%s error_message=%s",
            task.id,
            getattr(task, "error_code", None),
            (getattr(task, "error_message", None) or "")[:200],
        )
    db.add(task)
    db.commit()


@celery_app.task(name="translate.run_translation_task")
def run_translation_task(task_id: str) -> None:
    """
    翻译任务 Celery 入口，已接入 BabelDOC 适配层：

    - queued -> processing -> completed/failed
    - 当 DEEPSEEK_API_KEY 与 BABELDOC_STAGING_DIR 配置正确且存在对应 PDF 时，
      调用 BabelDOC + DeepSeek 完成实际翻译；否则跳过翻译逻辑，仅更新状态。
    """
    db = SessionLocal()
    try:
        task: TranslationTask | None = db.query(TranslationTask).get(task_id)
        if not task:
            logger.warning("TranslationTask not found task_id=%s", task_id)
            return

        logger.info("run_translation_task started task_id=%s", task_id)
        _update_task_status(db, task, "processing")
        set_progress(
            task_id,
            {"stage": "started", "stage_current": 0, "stage_total": 1, "overall_progress": 0},
        )

        doc: Document | None = db.query(Document).get(task.document_id)
        if not doc:
            logger.warning("Document not found for task_id=%s document_id=%s", task_id, task.document_id)
            task.error_code = "document_not_found"
            task.error_message = "Document not found for this task."
            _update_task_status(db, task, "failed")
            return

        settings = get_settings()
        r2_configured = bool(
            settings.r2_bucket_name and settings.r2_endpoint_url
            and settings.r2_access_key_id and settings.r2_secret_access_key
        )
        source_slice_key = getattr(task, "source_slice_object_key", None)
        page_range_for_translate: str | None = task.page_range

        # 有 page_range 时一律用「完整文档 + 页码」做翻译，不使用前端 pdf-lib 切片，避免 MuPDF 报 Identity#2dH 导致预览/翻译异常
        if task.page_range and (r2_configured or resolve_staging_path(doc.object_key, doc.filename or "")):
            # 使用完整文档 + page_range，不下载前端切片
            use_frontend_slice = False
        else:
            use_frontend_slice = bool(source_slice_key and r2_configured)

        r2_source_key: str | None = None
        if use_frontend_slice:
            staging_base = Path(settings.babeldoc_staging_dir) if settings.babeldoc_staging_dir else Path(__file__).resolve().parents[2] / "tmp" / "staging"
            candidate = Path(staging_base) / source_slice_key
            candidate.parent.mkdir(parents=True, exist_ok=True)
            try:
                r2_download_to_path(source_slice_key, candidate)
                local_path = str(candidate)
                r2_source_key = source_slice_key
                page_range_for_translate = None
                logger.info("Using frontend-uploaded slice from R2 for task_id=%s key=%s", task_id, source_slice_key)
            except Exception as dl_exc:  # noqa: BLE001
                logger.exception(
                    "Failed to download source slice from R2 task_id=%s key=%s exc=%s",
                    task_id, source_slice_key, dl_exc,
                )
                task.error_code = "source_download_failed"
                task.error_message = "Failed to fetch source PDF slice for translation. Please retry."
                _update_task_status(db, task, "failed")
                return
        else:
            local_path = resolve_staging_path(doc.object_key, doc.filename)
            if not local_path:
                if not r2_configured:
                    logger.warning(
                        "No local PDF and R2 not configured task_id=%s object_key=%s",
                        task_id, doc.object_key,
                    )
                    task.error_code = "staging_not_configured"
                    task.error_message = "PDF file not available locally and R2 storage is not configured."
                    _update_task_status(db, task, "failed")
                    return
                try:
                    staging_base = Path(settings.babeldoc_staging_dir) if settings.babeldoc_staging_dir else Path(__file__).resolve().parents[2] / "tmp" / "staging"
                    candidate = staging_base / doc.object_key
                    r2_download_to_path(doc.object_key, candidate)
                    local_path = str(candidate)
                    r2_source_key = doc.object_key
                    logger.info("Downloaded source PDF from R2 for task_id=%s local_path=%s", task_id, local_path)
                except Exception as dl_exc:  # noqa: BLE001
                    logger.exception(
                        "Failed to download source PDF from R2 task_id=%s object_key=%s exc=%s",
                        task_id, doc.object_key, dl_exc,
                    )
                    task.error_code = "source_download_failed"
                    task.error_message = "Failed to fetch source PDF for translation. Please retry."
                    _update_task_status(db, task, "failed")
                    return
            else:
                r2_source_key = None

        # PDF 健康检查：ToUnicode/字体子集等，不通过则直接失败，不进入 BabelDOC
        ok, health_code = check_pdf_health(Path(local_path), page_range_for_translate)
        if not ok and health_code:
            task.error_code = health_code
            task.error_message = (
                "该 PDF 缺少 ToUnicode 映射或字体损坏，无法可靠提取文字。"
                "建议使用带文本层的 PDF 或先进行 OCR 预处理。"
            )
            _update_task_status(db, task, "failed")
            return

        # 可选 OCR 前置：用户勾选时先对 PDF 做 OCR 再翻译
        ocr_temp_to_remove: Path | None = None
        if getattr(task, "preprocess_with_ocr", False):
            logger.info(
                "run_translation_task OCR enabled task_id=%s preprocess_with_ocr=True input_path=%s source_lang=%s target_lang=%s",
                task_id,
                local_path,
                task.source_lang,
                task.target_lang,
            )
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            ocr_output_path = Path(tmp.name)
            tmp.close()
            ocr_temp_to_remove = ocr_output_path
            err_msg = _run_ocr_preprocess(Path(local_path), ocr_output_path, task.source_lang)
            if err_msg:
                logger.warning(
                    "run_translation_task OCR preprocess failed task_id=%s err=%s",
                    task_id,
                    err_msg[:300],
                )
                task.error_code = "ocr_preprocess_failed"
                task.error_message = err_msg
                _update_task_status(db, task, "failed")
                if ocr_output_path.exists():
                    ocr_output_path.unlink(missing_ok=True)
                return
            local_path = str(ocr_output_path)
            r2_source_key = None  # OCR 输出不在 R2，FC 模式下需先上传
            page_range_for_translate = None  # OCR 输出已是待译内容，全文翻译
            logger.info(
                "run_translation_task OCR preprocess done task_id=%s local_path_switched_to=%s page_range=full",
                task_id,
                local_path,
            )

        output_dir = get_task_output_dir(task_id)
        use_fc = get_settings().babeldoc_use_fc

        def _progress_callback(**kwargs):
            if kwargs.get("type") == "progress_update":
                set_progress(
                    task_id,
                    {
                        "stage": kwargs.get("stage", ""),
                        "stage_current": kwargs.get("stage_current", 0),
                        "stage_total": kwargs.get("stage_total", 0),
                        "overall_progress": kwargs.get("overall_progress", 0),
                    },
                )

        set_progress(
            task_id,
            {"stage": "translating", "stage_current": 0, "stage_total": 1, "overall_progress": 5},
        )
        logger.info(
            "run_translation_task progress: task_id=%s stage=translating (BabelDOC + DeepSeek API calls start)",
            task_id,
        )

        fc_output_object_key: str | None = None
        if use_fc:
            # BabelDOC 隔离到 FC：生成 presigned URL，调用 FC，FC 将结果上传 R2
            if not r2_configured:
                task.error_code = "staging_not_configured"
                task.error_message = "BabelDOC FC mode requires R2 to be configured for source PDF URL."
                _update_task_status(db, task, "failed")
                return
            if r2_source_key is None:
                temp_key = f"temp/{task_id}/source.pdf"
                try:
                    r2_upload_file(Path(local_path), temp_key)
                    r2_source_key = temp_key
                    logger.info("run_translation_task uploaded local source to R2 for FC task_id=%s key=%s", task_id, temp_key)
                except Exception as up_exc:
                    logger.exception("run_translation_task failed to upload source for FC task_id=%s", task_id)
                    task.error_code = "source_download_failed"
                    task.error_message = "Failed to prepare source PDF for FC. Please retry."
                    _update_task_status(db, task, "failed")
                    return
            presigned_url = r2_create_presigned_get(r2_source_key, expires_in_seconds=3600)
            output_key = f"translations/{task_id}/output.pdf"
            try:
                babeldoc_client.run_translate_remote(
                    source_pdf_url=presigned_url,
                    output_object_key=output_key,
                    source_lang=task.source_lang,
                    target_lang=task.target_lang,
                    page_range=page_range_for_translate,
                    task_id=task_id,
                )
                fc_output_object_key = output_key
            except Exception as fc_exc:
                logger.exception("run_translation_task FC translate failed task_id=%s", task_id)
                raise
        else:
            # 本地 BabelDOC
            for _name in ("httpx", "httpcore", "openai"):
                _log = logging.getLogger(_name)
                if _log.level > logging.INFO:
                    _log.setLevel(logging.INFO)
            cancel_event = threading.Event()
            stop_polling = threading.Event()

            def _poll_cancel():
                while not stop_polling.wait(1.0):
                    if check_cancel_requested(task_id):
                        cancel_event.set()
                        break

            poll_thread = threading.Thread(target=_poll_cancel, daemon=True)
            poll_thread.start()
            try:
                run_translate(
                    local_pdf_path=local_path,
                    output_dir=output_dir,
                    source_lang=task.source_lang,
                    target_lang=task.target_lang,
                    page_range=page_range_for_translate,
                    progress_callback=_progress_callback,
                    cancel_event=cancel_event,
                )
                logger.info(
                    "run_translation_task BabelDOC translate finished task_id=%s (DeepSeek API calls done)",
                    task_id,
                )
            except asyncio.CancelledError:
                stop_polling.set()
                logger.info("run_translation_task cancelled by user task_id=%s", task_id)
                clear_progress(task_id)
                clear_cancel_request(task_id)
                _update_task_status(db, task, "cancelled")
                db.commit()
                return
            except Exception as exc:
                stop_polling.set()
                raise
            finally:
                stop_polling.set()

        if ocr_temp_to_remove and ocr_temp_to_remove.exists():
            try:
                ocr_temp_to_remove.unlink(missing_ok=True)
            except Exception:
                pass
        set_progress(
            task_id,
            {"stage": "uploading", "stage_current": 0, "stage_total": 1, "overall_progress": 85},
        )
        logger.info("run_translation_task progress: task_id=%s stage=uploading (R2/source_pages)", task_id)
        task.error_code = None
        task.error_message = None
        if fc_output_object_key:
            task.output_object_key = fc_output_object_key
            task.output_primary_path = ""
            db.add(task)
            db.commit()
            logger.info("run_translation_task FC result written task_id=%s output_object_key=%s", task_id, fc_output_object_key)
        else:
            output_dir_path = Path(output_dir)
            if output_dir_path.exists():
                pdfs = list(output_dir_path.glob("*.pdf"))
                if pdfs:
                    mono = [f for f in pdfs if f.name.lower().endswith(".mono.pdf")]
                    primary = mono[0] if mono else pdfs[0]
                    try:
                        doc = pymupdf.open(primary)
                        if hasattr(doc, "rewrite_images"):
                            doc.rewrite_images(
                                dpi_threshold=200,
                                dpi_target=150,
                                quality=82,
                                lossy=True,
                                lossless=True,
                                bitonal=True,
                                color=True,
                                gray=True,
                            )
                        doc.save(
                            str(primary),
                            garbage=4,
                            deflate=True,
                            deflate_images=True,
                            clean=True,
                            deflate_fonts=True,
                        )
                        doc.close()
                        logger.info("run_translation_task image compression applied task_id=%s path=%s", task_id, primary)
                    except Exception as comp_exc:
                        logger.warning("run_translation_task lossless compression skipped task_id=%s err=%s", task_id, comp_exc)
                    task.output_primary_path = str(primary.resolve())
                    logger.info("run_translation_task set output_primary_path task_id=%s path=%s", task_id, task.output_primary_path)
                    db.add(task)
                    db.commit()
                    settings = get_settings()
                    if settings.r2_bucket_name and settings.r2_endpoint_url and settings.r2_access_key_id and settings.r2_secret_access_key:
                        try:
                            object_key = f"translations/{task_id}/output.pdf"
                            r2_upload_file(primary, object_key)
                            task.output_object_key = object_key
                            db.add(task)
                            db.commit()
                            logger.info("run_translation_task uploaded to R2 task_id=%s key=%s", task_id, object_key)
                        except Exception as up_exc:
                            logger.warning("run_translation_task R2 upload failed task_id=%s exc=%s", task_id, up_exc)

        # 有 page_range 时用 PyMuPDF 提取源页并上传为 source_pages.pdf，供预览使用（避免前端 pdf-lib 切片导致 Identity#2dH）
        if task.page_range and local_path:
            page_indices = _parse_page_range(task.page_range)
            if page_indices and get_settings().r2_bucket_name and get_settings().r2_access_key_id:
                try:
                    source_path = Path(local_path)
                    if source_path.exists() and source_path.is_file():
                        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                            tmp_path = Path(tmp.name)
                        to_upload = tmp_path
                        try:
                            _extract_source_pages_pdf(source_path, page_indices, tmp_path)
                            to_upload = _compress_pdf(tmp_path)
                            slice_key = f"translations/{task_id}/source_pages.pdf"
                            r2_upload_file(to_upload, slice_key)
                            task.source_slice_object_key = slice_key
                            db.add(task)
                            db.commit()
                            logger.info(
                                "run_translation_task uploaded source_pages to R2 task_id=%s key=%s size=%s",
                                task_id, slice_key, to_upload.stat().st_size if to_upload.exists() else None,
                            )
                        finally:
                            if tmp_path.exists():
                                tmp_path.unlink(missing_ok=True)
                            if to_upload.exists() and to_upload != tmp_path:
                                to_upload.unlink(missing_ok=True)
                except Exception as slice_exc:
                    logger.warning("run_translation_task source_pages extract/upload failed task_id=%s exc=%s", task_id, slice_exc)

        _update_task_status(db, task, "completed")
        logger.info("run_translation_task completed task_id=%s", task_id)
        # 保留一条进度日志，便于在 dev:all 终端里确认 worker 有输出
        set_progress(
            task_id,
            {"stage": "completed", "stage_current": 1, "stage_total": 1, "overall_progress": 100},
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("run_translation_task failed task_id=%s exc=%s", task_id, exc)
        try:
            task = db.query(TranslationTask).get(task_id)
            if task:
                # 简单归类错误类型，便于前端展示
                msg = str(exc).strip() or type(exc).__name__
                if "BabelDOC not installed" in msg:
                    task.error_code = "babeldoc_not_installed"
                    task.error_message = msg[:500]
                elif "no paragraphs" in msg.lower():
                    task.error_code = "no_paragraphs"
                    task.error_message = (
                        "文档中未检测到可翻译段落，可能为扫描页或图片页。"
                        "建议勾选「先对 PDF 进行 OCR」后重试。"
                    )
                elif "too many CID" in msg or "CID chars" in msg:
                    task.error_code = "pdf_cid_unsupported"
                    task.error_message = (
                        "This PDF uses fonts (CID) that are not fully supported for translation. "
                        "Try a different PDF, a smaller page range, or a file with standard text fonts."
                    )
                elif "DEEPSEEK_API_KEY not set" in msg:
                    task.error_code = "deepseek_not_configured"
                    task.error_message = "DEEPSEEK_API_KEY is not set. Add it to the project root .env file."
                elif "401" in msg or ("invalid" in msg.lower() and "api" in msg.lower() and "key" in msg.lower()):
                    task.error_code = "deepseek_not_configured"
                    task.error_message = "API key invalid or expired. Check DEEPSEEK_API_KEY in the project root .env."
                elif "BABELDOC_FC_URL" in msg or "Failed to download source PDF" in msg or "Failed to upload result" in msg:
                    task.error_code = "fc_error"
                    task.error_message = msg[:500]
                else:
                    task.error_code = "internal_error"
                    task.error_message = msg[:500]
                _update_task_status(db, task, "failed")
        except Exception:  # noqa: BLE001
            logger.exception("failed to mark task as failed task_id=%s", task_id)
    finally:
        clear_progress(task_id)
        db.close()

