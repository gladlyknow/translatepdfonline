import asyncio
import errno
import json
import logging
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import quote, unquote, urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db, SessionLocal
from ..models import Document, TranslationTask, User
from ..auth_utils import get_current_user_or_temp
from ..schemas import (
    TranslateRequest,
    TranslateResponse,
    TaskDetail,
    TaskSummary,
    TaskView,
    TaskOutputFile,
)
from ..tasks_translate import run_translation_task
from ..babeldoc_adapter import get_task_output_dir
from ..config import get_settings, PROJECT_ROOT as CONFIG_PROJECT_ROOT
from ..task_progress import clear_progress, get_progress
from ..task_cancel import request_cancel, clear_cancel_request
from ..storage_r2 import (
    get_object_stream as r2_get_object_stream,
    get_object_stream_range as r2_get_object_stream_range,
    create_presigned_get as r2_create_presigned_get,
    is_r2_configured as r2_is_configured,
)
from ..babeldoc_adapter import resolve_staging_path

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tasks"])


def _content_disposition_inline(filename: str, ascii_fallback: str = "source.pdf") -> str:
    """Build Content-Disposition for inline PDF; safe for HTTP headers (latin-1). Use RFC 5987 for non-ASCII filenames."""
    try:
        filename.encode("latin-1")
        return f'inline; filename="{filename}"'
    except UnicodeEncodeError:
        return f'inline; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(filename, safe="")}'


def _normalize_page_range(page_range: str | None) -> str | None:
    """规范化 page_range 便于比较：'7' 与 '7-7' 等价，空与 None 等价。"""
    if page_range is None or not page_range.strip():
        return None
    s = page_range.strip()
    if "-" in s:
        return s
    try:
        n = int(s)
        if n < 1:
            return None
        return f"{n}-{n}"
    except ValueError:
        return s


def _estimate_pages_to_translate(doc: Document, page_range: str | None) -> int:
    """
    根据 page_range 估算本次翻译会消耗的页数。
    目前支持:
      - None 或 "" -> 使用文档总页数
      - "N"        -> 单页
      - "A-B"      -> 区间（含端点）
    """
    if page_range:
        text = page_range.strip()
        if "-" in text:
            try:
                start_s, end_s = text.split("-", 1)
                start = int(start_s)
                end = int(end_s)
                if start <= 0 or end < start:
                    raise ValueError
                return end - start + 1
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid page_range format")
        else:
            try:
                page = int(text)
                if page <= 0:
                    raise ValueError
                return 1
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid page_range format")

    # 未提供 page_range 时，使用文档总页数；未知则视为 1 页占位
    return int(doc.page_count or 1)


@router.post("/translate", response_model=TranslateResponse)
def create_translation_task(
    req: TranslateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> TranslateResponse:
    """
    创建翻译任务，并加入 Celery 队列异步处理。

    - 临时访客：受限于 quota_pages_total / quota_pages_used
    - 登录用户：后续会接入钱包与计费逻辑
    - 不拒绝请求：始终入队，并发由 worker 数量与 .env 配置控制，前端展示排队提示即可
    """
    doc: Optional[Document] = db.query(Document).get(req.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    source_slice_object_key: Optional[str] = None
    if req.source_slice_object_key:
        sk = req.source_slice_object_key.strip()
        expected_prefix = f"slices/{user.id}/{req.document_id}/"
        if not sk.startswith(expected_prefix) or ".." in sk:
            raise HTTPException(status_code=400, detail="Invalid source_slice_object_key for this document")
        source_slice_object_key = sk

    # 去重：同一用户、同一文档、同一语言对、同一页范围，若已有 completed 任务且存在输出，直接复用
    norm_range = _normalize_page_range(req.page_range)
    existing = (
        db.query(TranslationTask)
        .filter(
            TranslationTask.user_id == user.id,
            TranslationTask.document_id == req.document_id,
            TranslationTask.source_lang == req.source_lang,
            TranslationTask.target_lang == req.target_lang,
            TranslationTask.status == "completed",
        )
        .order_by(TranslationTask.updated_at.desc())
        .all()
    )
    for t in existing:
        if _normalize_page_range(t.page_range) == norm_range:
            out_dir = get_task_output_dir(str(t.id))
            if out_dir.exists() and out_dir.is_dir() and any(out_dir.glob("*.pdf")):
                return TranslateResponse(task_id=str(t.id))

    pages = _estimate_pages_to_translate(doc, req.page_range)
    if user.is_temporary:
        remaining = int(user.quota_pages_total) - int(user.quota_pages_used)
        if pages > remaining:
            raise HTTPException(
                status_code=403,
                detail="free_quota_exceeded_login_required",
            )
        user.quota_pages_used = int(user.quota_pages_used) + pages
        db.add(user)

    task = TranslationTask(
        user_id=user.id,
        document_id=req.document_id,
        source_lang=req.source_lang,
        target_lang=req.target_lang,
        page_range=req.page_range,
        status="queued",
        source_slice_object_key=source_slice_object_key,
        preprocess_with_ocr=bool(req.preprocess_with_ocr or False),
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    run_translation_task.delay(str(task.id))

    return TranslateResponse(task_id=str(task.id))


@router.post("/tasks/{task_id}/cancel")
def cancel_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> dict:
    """
    请求取消翻译任务。仅 pending/processing 可取消；已取消或已完成/失败则返回 400。
    设置 Redis 取消标记，Worker 轮询到后会安全退出并将任务标为 cancelled。
    """
    task: Optional[TranslationTask] = db.query(TranslationTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if str(task.user_id) != str(user.id):
        raise HTTPException(status_code=403, detail="Not your task")
    if task.status not in ("pending", "processing"):
        raise HTTPException(
            status_code=400,
            detail=f"Task cannot be cancelled (status={task.status})",
        )
    request_cancel(task_id)
    task.status = "cancelled"
    task.updated_at = datetime.utcnow()
    db.add(task)
    db.commit()
    return {"ok": True, "status": "cancelled"}


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> None:
    """
    删除翻译任务记录，仅限任务所属用户。删除后可从历史中移除，便于对同一文档重新翻译。
    仅允许删除 completed / failed / cancelled 状态；pending/processing 请先取消。
    """
    task: Optional[TranslationTask] = db.query(TranslationTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if str(task.user_id) != str(user.id):
        raise HTTPException(status_code=403, detail="Not your task")
    if task.status in ("pending", "processing"):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a running task; cancel it first",
        )
    clear_progress(task_id)
    clear_cancel_request(task_id)
    db.delete(task)
    db.commit()
    return None


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def get_task_detail(
    task_id: str,
    db: Session = Depends(get_db),
) -> TaskDetail:
    task: Optional[TranslationTask] = db.query(TranslationTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    progress = get_progress(task_id)
    return TaskDetail(
        id=str(task.id),
        document_id=str(task.document_id),
        source_lang=task.source_lang,
        target_lang=task.target_lang,
        page_range=task.page_range,
        status=task.status,
        created_at=task.created_at,
        updated_at=task.updated_at,
        error_code=task.error_code,
        error_message=task.error_message,
        progress_percent=progress.get("overall_progress") if progress else None,
        progress_stage=progress.get("stage") if progress else None,
        progress_current=progress.get("stage_current") if progress else None,
        progress_total=progress.get("stage_total") if progress else None,
    )


@router.get("/tasks", response_model=list[TaskSummary])
def list_tasks(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> list[TaskSummary]:
    """
    任务列表接口，仅返回当前用户的任务。
    不包含失效任务：状态为 failed/cancelled，或关联文档已过期（expires_at < now）的不会出现在列表中。
    """
    now = datetime.utcnow()
    tasks = (
        db.query(TranslationTask)
        .join(Document, TranslationTask.document_id == Document.id)
        .filter(TranslationTask.user_id == user.id)
        .filter(TranslationTask.status.notin_(["failed", "cancelled"]))
        .filter(
            (Document.expires_at.is_(None)) | (Document.expires_at > now)
        )
        .order_by(TranslationTask.created_at.desc())
        .limit(100)
        .all()
    )
    result = []
    for t in tasks:
        doc = db.query(Document).get(t.document_id)
        result.append(
            TaskSummary(
                id=str(t.id),
                document_id=str(t.document_id),
                status=t.status,
                source_lang=t.source_lang,
                target_lang=t.target_lang,
                created_at=t.created_at,
                document_filename=doc.filename if doc else None,
                page_range=t.page_range,
                updated_at=t.updated_at,
            )
        )
    return result


@router.get("/tasks/{task_id}/view", response_model=TaskView)
def get_task_view(
    task_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> TaskView:
    """
    返回任务的基础信息以及可下载的输出文件列表。

    生产环境中，这些输出文件应存储在对象存储（如 R2）中并通过预签名 URL 暴露；
    当前实现基于本地 BabelDOC 输出目录，并通过后端下载接口进行代理。
    can_download 为 False 时表示当前为临时用户，仅可预览不可下载。
    """
    task: Optional[TranslationTask] = db.query(TranslationTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    doc: Optional[Document] = db.query(Document).get(task.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found for task")

    output_dir = get_task_output_dir(task_id)
    files: list[TaskOutputFile] = []
    if output_dir.exists() and output_dir.is_dir():
        for p in sorted(output_dir.glob("*.pdf")):
            files.append(
                TaskOutputFile(
                    filename=p.name,
                    download_url=f"/api/tasks/{task_id}/files/{p.name}",
                )
            )
        if files and task.status == "completed" and not getattr(task, "output_primary_path", None):
            mono = [p for p in files if p.filename.lower().endswith(".mono.pdf")]
            primary = (output_dir / (mono[0].filename if mono else files[0].filename)).resolve()
            if primary.exists() and primary.is_file():
                task.output_primary_path = str(primary)
                db.add(task)
                db.commit()

    detail = TaskDetail(
        id=str(task.id),
        document_id=str(task.document_id),
        source_lang=task.source_lang,
        target_lang=task.target_lang,
        page_range=task.page_range,
        status=task.status,
        created_at=task.created_at,
        updated_at=task.updated_at,
        error_code=getattr(task, "error_code", None),
        error_message=getattr(task, "error_message", None),
    )

    # 仅任务创建者可见源文件/译文 URL；R2 已配置时返回 presigned GET 直连，否则回退到后端代理
    is_owner = str(task.user_id) == str(user.id)
    source_slice_key = getattr(task, "source_slice_object_key", None)
    output_key = getattr(task, "output_object_key", None)
    use_r2_presigned = is_owner and r2_is_configured()

    if is_owner and (source_slice_key or (doc and getattr(doc, "object_key", None))):
        if use_r2_presigned and source_slice_key:
            try:
                source_url = r2_create_presigned_get(source_slice_key)
            except Exception as e:
                logger.warning("get_task_view presigned source failed task_id=%s err=%s", task_id, e)
                source_url = f"/api/tasks/{task_id}/source-file"
        else:
            source_url = f"/api/tasks/{task_id}/source-file"
    else:
        source_url = None

    if is_owner and (files or output_key):
        if use_r2_presigned and output_key:
            try:
                primary_file_url = r2_create_presigned_get(output_key)
            except Exception as e:
                logger.warning("get_task_view presigned primary failed task_id=%s err=%s", task_id, e)
                primary_file_url = f"/api/tasks/{task_id}/file"
        else:
            primary_file_url = f"/api/tasks/{task_id}/file"
    else:
        primary_file_url = None

    outputs_for_view = files if is_owner else []

    can_download = (
        not user.is_temporary and is_owner
    )
    return TaskView(
        task=detail,
        document_filename=doc.filename,
        document_size_bytes=int(doc.size_bytes),
        outputs=outputs_for_view,
        primary_file_url=primary_file_url,
        source_pdf_url=source_url,
        can_download=can_download,
    )


@router.get("/tasks/{task_id}/source-file")
def get_task_source_file(
    task_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
):
    """
    返回该任务的源 PDF：有 source_slice 时返回切片（仅涉及页），无 slice 时返回整份 doc.object_key。
    支持 Range 分片加载，统一走同源避免前端直连 R2。仅任务创建者可访问。
    """
    task: Optional[TranslationTask] = db.query(TranslationTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if str(task.user_id) != str(user.id):
        raise HTTPException(status_code=404, detail="Task not found")

    source_slice_key = getattr(task, "source_slice_object_key", None)
    if source_slice_key:
        object_key = source_slice_key
        disposition_filename = "source_pages.pdf"
    else:
        doc: Optional[Document] = db.query(Document).get(task.document_id)
        if not doc or not doc.object_key:
            raise HTTPException(status_code=404, detail="Source file not available for this task")
        object_key = doc.object_key
        disposition_filename = doc.filename or "source.pdf"

    range_header = (request.headers.get("range") or request.headers.get("Range") or "").strip()
    use_range = range_header.startswith("bytes=") and len(range_header) > 6

    # 无切片时优先使用本地 staging，避免 R2 不可用或超时导致预览等 60s+
    if not source_slice_key:
        doc_for_local: Optional[Document] = db.query(Document).get(task.document_id)
        if doc_for_local:
            local_path = resolve_staging_path(doc_for_local.object_key, doc_for_local.filename or "")
            if local_path and Path(local_path).exists():
                return FileResponse(
                    path=str(local_path),
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": _content_disposition_inline(
                            disposition_filename,
                            "source_pages.pdf" if source_slice_key else "source.pdf",
                        ),
                        "Accept-Ranges": "bytes",
                    },
                )

    try:
        if use_range:
            content_type, chunk_iter, content_length, content_range = r2_get_object_stream_range(
                object_key, range_header
            )

            def safe_iter():
                try:
                    for chunk in chunk_iter:
                        yield chunk
                except Exception as e:
                    logger.warning("get_task_source_file R2 range stream read error task_id=%s err=%s", task_id, e)

            resp_headers = {
                "Content-Disposition": _content_disposition_inline(
                    disposition_filename,
                    "source_pages.pdf" if source_slice_key else "source.pdf",
                ),
                "Accept-Ranges": "bytes",
            }
            if content_length is not None:
                resp_headers["Content-Length"] = str(content_length)
            if content_range:
                resp_headers["Content-Range"] = content_range
            return StreamingResponse(
                safe_iter(),
                media_type=content_type,
                status_code=206,
                headers=resp_headers,
            )
        content_type, chunk_iter = r2_get_object_stream(object_key)

        def safe_iter():
            try:
                for chunk in chunk_iter:
                    yield chunk
            except Exception as e:
                logger.warning("get_task_source_file R2 stream read error task_id=%s err=%s", task_id, e)

        return StreamingResponse(
            safe_iter(),
            media_type=content_type,
            headers={
                "Content-Disposition": _content_disposition_inline(
                    disposition_filename,
                    "source_pages.pdf" if source_slice_key else "source.pdf",
                ),
                "Accept-Ranges": "bytes",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("get_task_source_file R2 failed task_id=%s key=%s err=%s", task_id, object_key, e)

        # R2 不可用时回退到本地 staging（开发环境常见：公司网络/代理导致 R2 endpoint 超时）
        if source_slice_key:
            # 切片仅存在 R2 时无法可靠回退，退化为返回整份源文件（若 staging 可用）
            doc: Optional[Document] = db.query(Document).get(task.document_id)
            object_key_for_local = doc.object_key if doc else None
            filename_for_local = doc.filename if doc else "source.pdf"
        else:
            object_key_for_local = object_key
            filename_for_local = disposition_filename

        if object_key_for_local:
            doc2: Optional[Document] = db.query(Document).get(task.document_id)
            local = None
            if doc2:
                local = resolve_staging_path(doc2.object_key, doc2.filename)
            if local and Path(local).exists():
                # FileResponse(Starlette) 支持 Range，PDF.js 可按需拉取
                return FileResponse(
                    path=str(local),
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": _content_disposition_inline(
                            filename_for_local,
                            "source_pages.pdf" if source_slice_key else "source.pdf",
                        ),
                        "Accept-Ranges": "bytes",
                    },
                )

        raise HTTPException(status_code=404, detail="Source file not found") from e


@router.get("/tasks/{task_id}/file")
def get_task_primary_file(
    task_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
):
    """
    返回该任务的主输出 PDF（不依赖文件名，避免 URL 编码导致 404）。
    有 R2 object_key 时从 R2 流式返回（同源，无 CORS）；否则从本地路径或 fallback 目录返回。
    预览(inline)不校验用户，避免 PDF 请求未带 cookie 时误判 404；下载(attachment)仍校验归属。
    """
    try:
        return _get_task_primary_file_impl(task_id, request, db, user)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_task_primary_file unhandled task_id=%s err=%s", task_id, e)
        raise HTTPException(status_code=500, detail="Internal error serving file") from e


def _get_task_primary_file_impl(
    task_id: str,
    request: Request,
    db: Session,
    user: User,
):
    task: Optional[TranslationTask] = db.query(TranslationTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    disposition = (request.query_params.get("disposition") or "inline").strip().lower()
    if disposition not in ("inline", "attachment"):
        disposition = "inline"

    # 隐私：仅任务创建者可预览/下载译文
    if str(task.user_id) != str(user.id):
        raise HTTPException(status_code=404, detail="task_not_found")
    if disposition == "attachment" and user.is_temporary:
        raise HTTPException(
            status_code=403,
            detail="login_required_to_download",
        )

    def _attachment_auth_ok() -> None:
        pass  # 已在上面统一校验

    settings = get_settings()
    range_header = (request.headers.get("range") or request.headers.get("Range") or "").strip()
    use_range = range_header.startswith("bytes=") and len(range_header) > 6

    # 优先使用本地 output_primary_path，使预览与下载与磁盘上的译文 PDF 一致，且下载不 302 避免保存成 HTML
    file_path: Optional[Path] = None
    stored_path = getattr(task, "output_primary_path", None)
    if stored_path:
        try:
            # 优先直接使用 stored_path（completed 时信任 DB 路径，避免 allowed_base 等导致 404）
            direct = Path(stored_path)
            if task.status == "completed" and direct.exists() and direct.is_file():
                file_path = direct
            if file_path is None:
                primary_path = Path(stored_path).resolve()
                if primary_path.exists() and primary_path.is_file():
                    allowed_base = get_task_output_dir(task_id).parent.resolve()
                    try:
                        primary_path.relative_to(allowed_base)
                        file_path = primary_path
                    except (ValueError, TypeError):
                        if task.status == "completed":
                            file_path = primary_path
            if file_path is None and task.status == "completed":
                try:
                    parent_dir = Path(stored_path).parent.resolve()
                    if parent_dir.exists() and parent_dir.is_dir():
                        pdfs = list(parent_dir.glob("*.pdf"))
                        mono = [f for f in pdfs if f.name.lower().endswith(".mono.pdf")]
                        file_path = mono[0] if mono else (pdfs[0] if pdfs else None)
                except (OSError, RuntimeError):
                    pass
            if file_path is None:
                logger.warning(
                    "get_task_primary_file output_primary_path not used task_id=%s path=%s exists=%s status=%s",
                    task_id, stored_path, primary_path.exists() if primary_path.exists() else False, task.status,
                )
        except (OSError, RuntimeError, ValueError) as path_err:
            logger.warning(
                "get_task_primary_file path resolution failed task_id=%s path=%s err=%s",
                task_id, stored_path, path_err,
            )
    if file_path is not None:
        # 本地文件：预览与下载均直接返回，不校验用户（与预览一致；避免代理导致 session 不一致）
        safe_name = file_path.name
        filename_ascii = quote(safe_name, safe="")
        content_disp = f'{disposition}; filename="translation.pdf"; filename*=UTF-8\'\'{filename_ascii}'
        try:
            return FileResponse(
                path=str(file_path),
                media_type="application/pdf",
                headers={
                    "Content-Disposition": content_disp,
                    "Accept-Ranges": "bytes",
                },
            )
        except OSError as e:
            logger.warning("get_task_primary_file FileResponse failed task_id=%s path=%s err=%s", task_id, file_path, e)
            if getattr(e, "errno", None) == errno.ENOENT:
                raise HTTPException(status_code=404, detail="file_not_found") from e
            file_path = None

    # 若任务已完成但无 output_primary_path（如 worker 先写盘后未提交），从 output_dir 发现主文件并写回 DB
    if file_path is None and task.status == "completed":
        output_dir = get_task_output_dir(task_id)
        if output_dir.exists() and output_dir.is_dir():
            pdfs = list(output_dir.glob("*.pdf"))
            if pdfs:
                mono = [f for f in pdfs if f.name.lower().endswith(".mono.pdf")]
                primary = (mono[0] if mono else pdfs[0]).resolve()
                if primary.exists() and primary.is_file():
                    try:
                        task.output_primary_path = str(primary)
                        db.add(task)
                        db.commit()
                        file_path = primary
                    except Exception as e:
                        logger.warning("get_task_primary_file lazy-set output_primary_path failed task_id=%s err=%s", task_id, e)

    if file_path is not None:
        safe_name = file_path.name
        filename_ascii = quote(safe_name, safe="")
        content_disp = f'{disposition}; filename="translation.pdf"; filename*=UTF-8\'\'{filename_ascii}'
        try:
            return FileResponse(
                path=str(file_path),
                media_type="application/pdf",
                headers={
                    "Content-Disposition": content_disp,
                    "Accept-Ranges": "bytes",
                },
            )
        except OSError as e:
            logger.warning("get_task_primary_file FileResponse failed task_id=%s path=%s err=%s", task_id, file_path, e)
            if getattr(e, "errno", None) == errno.ENOENT:
                raise HTTPException(status_code=404, detail="File not found") from e
            file_path = None

    # 在尝试 R2 之前先用候选目录扫描本地文件，确保预览与下载都使用磁盘上的译文（与本地打开一致）
    if file_path is None:
        _routes_file = Path(__file__).resolve()
        _project_root_from_routes = _routes_file.parents[3]
        cwd = Path.cwd().resolve()
        candidates = [
            get_task_output_dir(task_id),
            (CONFIG_PROJECT_ROOT / "tmp" / "babeldoc_output" / task_id).resolve(),
            (_project_root_from_routes / "tmp" / "babeldoc_output" / task_id).resolve(),
            (cwd / "tmp" / "babeldoc_output" / task_id).resolve(),
            (cwd.parent / "tmp" / "babeldoc_output" / task_id).resolve(),
        ]
        if stored_path:
            try:
                parent_cand = Path(stored_path).parent.resolve()
                if parent_cand not in candidates and parent_cand.exists() and parent_cand.is_dir():
                    candidates.append(parent_cand)
            except (OSError, RuntimeError):
                pass
        output_dir = None
        for cand in candidates:
            if cand.exists() and cand.is_dir():
                pdfs = list(cand.glob("*.pdf"))
                if pdfs:
                    output_dir = cand
                    break
        if output_dir is not None:
            pdfs = list(output_dir.glob("*.pdf"))
            mono = [f for f in pdfs if f.name.lower().endswith(".mono.pdf")]
            if len(pdfs) == 1:
                file_path = pdfs[0]
            elif mono:
                file_path = mono[0]
            else:
                file_path = pdfs[0]
            if file_path is not None and task.status == "completed":
                try:
                    task.output_primary_path = str(file_path.resolve())
                    db.add(task)
                    db.commit()
                except Exception as e:
                    logger.warning("get_task_primary_file persist output_primary_path failed task_id=%s err=%s", task_id, e)
        elif stored_path:
            last_try = Path(stored_path)
            if last_try.exists() and last_try.is_file():
                file_path = last_try

    if file_path is not None:
        # 本地文件：直接返回，不校验用户
        safe_name = file_path.name
        filename_ascii = quote(safe_name, safe="")
        content_disp = f'{disposition}; filename="translation.pdf"; filename*=UTF-8\'\'{filename_ascii}'
        try:
            return FileResponse(
                path=str(file_path),
                media_type="application/pdf",
                headers={"Content-Disposition": content_disp, "Accept-Ranges": "bytes"},
            )
        except OSError as e:
            logger.warning("get_task_primary_file FileResponse failed task_id=%s path=%s err=%s", task_id, file_path, e)
            if getattr(e, "errno", None) == errno.ENOENT:
                raise HTTPException(status_code=404, detail="file_not_found") from e
            file_path = None

    if getattr(task, "output_object_key", None):
        # R2 流：下载时校验用户归属
        _attachment_auth_ok()
        try:
            if use_range:
                content_type, chunk_iter, content_length, content_range = r2_get_object_stream_range(
                    task.output_object_key, range_header
                )

                def safe_iter():
                    try:
                        for chunk in chunk_iter:
                            yield chunk
                    except Exception as e:
                        logger.warning("get_task_primary_file R2 range stream read error task_id=%s err=%s", task_id, e)

                content_disp = f'{disposition}; filename="translation.pdf"'
                resp_headers = {
                    "Content-Disposition": content_disp,
                    "Accept-Ranges": "bytes",
                }
                if content_length is not None:
                    resp_headers["Content-Length"] = str(content_length)
                if content_range:
                    resp_headers["Content-Range"] = content_range
                return StreamingResponse(
                    safe_iter(),
                    media_type=content_type,
                    status_code=206,
                    headers=resp_headers,
                )
            content_type, chunk_iter = r2_get_object_stream(task.output_object_key)

            def safe_iter():
                try:
                    for chunk in chunk_iter:
                        yield chunk
                except Exception as e:
                    logger.warning("get_task_primary_file R2 stream read error task_id=%s err=%s", task_id, e)

            content_disp = f'{disposition}; filename="translation.pdf"'
            return StreamingResponse(
                safe_iter(),
                media_type=content_type,
                headers={"Content-Disposition": content_disp, "Accept-Ranges": "bytes"},
            )
        except Exception as e:
            logger.warning("get_task_primary_file R2 stream failed task_id=%s key=%s err=%s", task_id, task.output_object_key, e)
            pass

    if file_path is None:
        _routes_file = Path(__file__).resolve()
        _project_root_from_routes = _routes_file.parents[3]
        cwd = Path.cwd().resolve()
        candidates = [
            get_task_output_dir(task_id),
            (CONFIG_PROJECT_ROOT / "tmp" / "babeldoc_output" / task_id).resolve(),
            (_project_root_from_routes / "tmp" / "babeldoc_output" / task_id).resolve(),
            (cwd / "tmp" / "babeldoc_output" / task_id).resolve(),
            (cwd.parent / "tmp" / "babeldoc_output" / task_id).resolve(),
        ]
        if stored_path:
            try:
                parent_cand = Path(stored_path).parent.resolve()
                if parent_cand not in candidates and parent_cand.exists() and parent_cand.is_dir():
                    candidates.append(parent_cand)
            except (OSError, RuntimeError):
                pass
        tried = [(str(p), p.exists(), p.is_dir() if p.exists() else None) for p in candidates]
        logger.warning(
            "get_task_primary_file 404 task_id=%s stored_path=%s disposition=%s task_user_id=%s user_id=%s tried=%s",
            task_id,
            stored_path,
            disposition,
            str(task.user_id),
            str(user.id),
            tried,
        )
        raise HTTPException(status_code=404, detail="file_not_found")

    # 最终 fallback 的本地文件：直接返回，不校验用户
    safe_name = file_path.name
    filename_ascii = quote(safe_name, safe="")
    content_disp = f'{disposition}; filename="translation.pdf"; filename*=UTF-8\'\'{filename_ascii}'
    try:
        return FileResponse(
            path=str(file_path),
            media_type="application/pdf",
            headers={"Content-Disposition": content_disp},
        )
    except OSError as e:
        logger.warning("get_task_primary_file FileResponse failed task_id=%s path=%s err=%s", task_id, file_path, e)
        # 文件已被删除或路径不可访问时返回 404，避免 500
        if getattr(e, "errno", None) == errno.ENOENT:
            raise HTTPException(status_code=404, detail="file_not_found") from e
        raise HTTPException(status_code=500, detail="File could not be read") from e


@router.get("/tasks/{task_id}/files/{filename}")
def download_task_file(
    request: Request,
    task_id: str,
    filename: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> FileResponse:
    """
    返回任务生成的输出文件（预览或下载）。
    disposition=inline 为预览，attachment 为下载；临时用户仅允许 inline，下载需登录。
    """
    task: Optional[TranslationTask] = db.query(TranslationTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if str(task.user_id) != str(user.id):
        raise HTTPException(status_code=404, detail="Task not found")

    disposition = (request.query_params.get("disposition") or "inline").strip().lower()
    if disposition not in ("inline", "attachment"):
        disposition = "inline"
    if disposition == "attachment" and user.is_temporary:
        raise HTTPException(
            status_code=403,
            detail="login_required_to_download",
        )

    output_dir = get_task_output_dir(task_id)
    # 前端/代理可能对中文文件名做 URL 编码，需解码后再与磁盘路径匹配
    decoded = unquote(filename, encoding="utf-8")
    safe_name = Path(decoded).name
    file_path = output_dir / safe_name
    if not file_path.exists() or not file_path.is_file():
        pdfs = list(output_dir.glob("*.pdf")) if output_dir.exists() else []
        norm_safe = unicodedata.normalize("NFC", safe_name)
        for f in pdfs:
            if f.name == safe_name or unicodedata.normalize("NFC", f.name) == norm_safe:
                file_path = f
                safe_name = f.name
                break
        else:
            # 单 PDF 直接返回；多 PDF 时按请求的后缀匹配 .mono.pdf / .dual.pdf（解决编码或命名不一致）
            if len(pdfs) == 1:
                file_path = pdfs[0]
                safe_name = file_path.name
            else:
                decoded_lower = decoded.strip().lower()
                if decoded_lower.endswith(".mono.pdf"):
                    mono_pdfs = [f for f in pdfs if f.name.lower().endswith(".mono.pdf")]
                    if len(mono_pdfs) == 1:
                        file_path = mono_pdfs[0]
                        safe_name = file_path.name
                    else:
                        file_path = None
                elif decoded_lower.endswith(".dual.pdf"):
                    dual_pdfs = [f for f in pdfs if f.name.lower().endswith(".dual.pdf")]
                    if len(dual_pdfs) == 1:
                        file_path = dual_pdfs[0]
                        safe_name = file_path.name
                    else:
                        file_path = None
                else:
                    file_path = None
            if file_path is None or not file_path.exists():
                logger.warning(
                    "download_task_file 404 task_id=%s filename=%s output_dir=%s exists=%s pdf_count=%s",
                    task_id, filename, output_dir, output_dir.exists(), len(pdfs) if output_dir.exists() else 0,
                )
                if output_dir.exists():
                    logger.warning("output_dir contents: %s", [p.name for p in output_dir.iterdir()])
                raise HTTPException(status_code=404, detail="File not found")

    # RFC 5987: filename* must be ASCII (UTF-8 percent-encoded). Latin-1 headers cannot contain Chinese etc.
    filename_ascii = quote(safe_name, safe="")
    content_disp = f'{disposition}; filename="translation.pdf"; filename*=UTF-8\'\'{filename_ascii}'
    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        headers={"Content-Disposition": content_disp},
    )


@router.get("/tasks/{task_id}/events")
def task_events(
    task_id: str,
    db: Session = Depends(get_db),
):
    """
    SSE 事件流：轮询 DB 与 Redis 进度，推送 status/progress；
    当任务 completed/failed 时推送最终事件并结束流。
    """
    task: Optional[TranslationTask] = db.query(TranslationTask).get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_stream():
        poll_interval = 1.5
        while True:
            db_session = SessionLocal()
            try:
                t: Optional[TranslationTask] = db_session.query(TranslationTask).get(task_id)
                if not t:
                    break
                progress = get_progress(task_id)
                percent = progress.get("overall_progress") if progress else None
                stage = progress.get("stage") if progress else None
                stage_current = progress.get("stage_current") if progress else None
                stage_total = progress.get("stage_total") if progress else None
                payload = {
                    "status": t.status,
                    "progress": percent,
                    "stage": stage,
                    "stage_current": stage_current,
                    "stage_total": stage_total,
                    "error_code": getattr(t, "error_code", None),
                    "error_message": getattr(t, "error_message", None),
                }
                data = json.dumps(payload, ensure_ascii=False)
                yield f"data: {data}\n\n"
                if t.status in ("completed", "failed"):
                    break
            finally:
                db_session.close()
            await asyncio.sleep(poll_interval)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

