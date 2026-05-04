"""
BabelDOC FC HTTP 入口：POST /translate 接收源 PDF URL 与参数，执行翻译后上传 R2，返回 output_object_key。
部署到阿里云函数计算时使用此 app 作为 HTTP 触发器入口。
"""
from __future__ import annotations

import logging
import tempfile
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .config import (
    get_fc_auth_header,
    get_fc_auth_scheme,
    get_fc_secret,
    get_r2_config,
)
from .run_translate import run_translate_local

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="BabelDOC FC", description="PDF translation via BabelDOC for translatepdfonline")


class TranslateRequest(BaseModel):
    source_pdf_url: str = Field(..., description="Presigned GET URL for the source PDF")
    source_lang: str = Field(
        ...,
        description="Source language code (UI: en, zh, es, fr, it, el, ja, ko, de, ru; FC may normalize e.g. zh→zh_cn).",
    )
    target_lang: str = Field(
        ...,
        description="Target language code (same set incl. de, ru). Smoke-test new pairs with a 1-page PDF before production.",
    )
    page_range: str | None = Field(None, description="Page range, e.g. 1-10")
    task_id: str | None = Field(None, description="Task ID for logging and callback")
    output_object_key: str = Field(..., description="R2 object key where the result PDF will be uploaded")
    callback_url: str | None = Field(None, description="Next callback URL to notify on completion or failure")


class TranslateResponse(BaseModel):
    output_object_key: str = Field(..., description="R2 key of the uploaded result PDF")


def _download_pdf(url: str, dest: Path) -> None:
    with httpx.Client(timeout=300.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)


def _upload_to_r2(local_path: Path, object_key: str) -> None:
    cfg = get_r2_config()
    if not cfg["bucket"] or not cfg["endpoint_url"] or not cfg["access_key"] or not cfg["secret_key"]:
        raise RuntimeError("R2 not configured: set R2_BUCKET_NAME, R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY")
    import boto3
    from botocore.client import Config
    session = boto3.session.Session()
    client = session.client(
        "s3",
        endpoint_url=cfg["endpoint_url"],
        aws_access_key_id=cfg["access_key"],
        aws_secret_access_key=cfg["secret_key"],
        config=Config(signature_version="s3v4"),
    )
    client.upload_file(
        str(local_path),
        cfg["bucket"],
        object_key,
        ExtraArgs={"ContentType": "application/pdf"},
    )


def _parse_page_range(s: str | None) -> tuple[int, int] | None:
    """与 Next parseTranslatePageRange 一致：单页或 start-end。"""
    if not s or not str(s).strip():
        return None
    t = str(s).strip()
    if "-" not in t:
        try:
            n = int(t)
            if n >= 1:
                return (n, n)
        except ValueError:
            return None
        return None
    a, b = t.split("-", 1)
    try:
        start = int(a.strip())
        end = int(b.strip())
    except ValueError:
        return None
    if start < 1 or end < start:
        return None
    return (start, end)


def _estimate_translated_pages(page_range: str | None, document_page_count: int) -> int:
    """与 Next estimateTranslatedPages 对齐（document_page_count 为输入 PDF 总页数）。"""
    pr = _parse_page_range(page_range)
    if pr:
        start, end = pr
        span = end - start + 1
        if document_page_count > 0:
            capped_start = min(max(start, 1), document_page_count)
            capped_end = min(max(end, capped_start), document_page_count)
            return max(1, capped_end - capped_start + 1)
        return max(1, span)
    if document_page_count > 0:
        return document_page_count
    return 1


def _pdf_num_pages(path: Path) -> int:
    try:
        from pypdf import PdfReader

        r = PdfReader(str(path))
        n = len(r.pages)
        return n if n >= 1 else 1
    except Exception as e:
        logger.warning("pypdf page count failed path=%s err=%s", path, e)
        return 1


def _resolve_translated_page_count_for_callback(
    babeldoc_hint: int | None,
    page_range: str | None,
    input_pdf: Path,
) -> int:
    total = _pdf_num_pages(input_pdf)
    if babeldoc_hint is not None and babeldoc_hint >= 1:
        n = babeldoc_hint
    else:
        n = _estimate_translated_pages(page_range, total)
    if total > 0:
        return min(n, total)
    return max(1, n)


def _error_code_for_babeldoc_failure(exc: BaseException) -> str | None:
    """与 Next translate/errors 对齐的稳定 error_code。"""
    low = str(exc).lower()
    if (
        "no paragraphs" in low
        or "contains no paragraphs" in low
        or "no pages match" in low
        or "no extractable" in low
        or "no translation parts to merge" in low
        or "translation produced no output" in low
    ):
        return "no_paragraphs"
    return None


def _notify_callback(
    callback_url: str,
    task_id: str,
    status: str,
    output_object_key: str | None = None,
    error_message: str | None = None,
    translated_page_count: int | None = None,
    error_code: str | None = None,
) -> bool:
    """POST 到 Next 的 callback_url，通知任务完成或失败。返回 True 表示跳过（无 URL）或 HTTP 200。"""
    if not callback_url or not task_id:
        return True
    payload: dict = {"task_id": task_id, "status": status}
    if output_object_key:
        payload["output_object_key"] = output_object_key
    if error_message:
        payload["error_message"] = error_message[:2000]
    if error_code:
        payload["error_code"] = error_code
    if status == "completed" and translated_page_count is not None and translated_page_count >= 1:
        payload["translated_page_count"] = int(translated_page_count)
    headers: dict[str, str] = {}
    secret = get_fc_secret()
    if secret:
        headers[get_fc_auth_header()] = get_fc_auth_scheme() + secret
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(callback_url, json=payload, headers=headers or None)
            if r.status_code != 200:
                logger.warning("callback POST %s status=%s body=%s", callback_url, r.status_code, r.text[:200])
                return False
            return True
    except Exception as e:
        logger.warning("callback POST failed url=%s err=%s", callback_url, e)
        return False


def _notify_completed_callback_with_retry(
    callback_url: str,
    task_id: str,
    output_object_key: str,
    translated_page_count: int,
) -> None:
    """成功路径：回调必须送达，否则抛 422（Next 侧非可重试，避免任务永久 queued）。"""
    backoff_seconds = (1, 2, 4, 8)
    last_ok = False
    for attempt in range(5):
        if attempt > 0:
            time.sleep(backoff_seconds[attempt - 1])
        if _notify_callback(
            callback_url,
            task_id,
            "completed",
            output_object_key=output_object_key,
            translated_page_count=translated_page_count,
        ):
            last_ok = True
            break
    if not last_ok:
        raise HTTPException(
            status_code=422,
            detail=(
                "Callback to Next failed after retries (translation may be on R2); "
                "caller should surface failed task so user can retry."
            )[:500],
        )


@app.post("/translate", response_model=TranslateResponse)
async def translate(
    body: TranslateRequest,
    request: Request,
    x_babeldoc_secret: str | None = Header(None, alias="X-Babeldoc-Secret"),
):
    """
    执行 PDF 翻译：从 source_pdf_url 下载 PDF，调用 BabelDOC，将结果上传到 R2 的 output_object_key。
    """
    secret = get_fc_secret()
    expected_header = get_fc_auth_scheme() + secret if secret else ""
    if secret and (x_babeldoc_secret or "") != expected_header:
        raise HTTPException(status_code=403, detail="Invalid or missing X-Babeldoc-Secret")
    try:
        with tempfile.TemporaryDirectory(prefix="babeldoc_fc_") as tmp:
            tmp_path = Path(tmp)
            input_pdf = tmp_path / "input.pdf"
            output_dir = tmp_path / "output"
            try:
                _download_pdf(body.source_pdf_url, input_pdf)
            except Exception as e:
                logger.exception("download failed url=%s", body.source_pdf_url[:80])
                if body.callback_url and body.task_id:
                    _notify_callback(body.callback_url, body.task_id, "failed", error_message=f"Failed to download source PDF: {e}")
                raise HTTPException(status_code=502, detail=f"Failed to download source PDF: {e}") from e
            try:
                output_paths, babeldoc_page_hint = run_translate_local(
                    local_pdf_path=input_pdf,
                    output_dir=output_dir,
                    source_lang=body.source_lang,
                    target_lang=body.target_lang,
                    page_range=body.page_range,
                )
            except Exception as e:
                logger.exception("BabelDOC translate failed task_id=%s", body.task_id)
                if body.callback_url and body.task_id:
                    ec = _error_code_for_babeldoc_failure(e)
                    _notify_callback(
                        body.callback_url,
                        body.task_id,
                        "failed",
                        error_message=str(e)[:2000],
                        error_code=ec,
                    )
                raise HTTPException(status_code=500, detail=str(e)[:500]) from e
            if not output_paths:
                logger.error("BabelDOC produced no output PDF; output_paths=%s", output_paths)
                if body.callback_url and body.task_id:
                    _notify_callback(body.callback_url, body.task_id, "failed", error_message="BabelDOC produced no output PDF")
                raise HTTPException(status_code=500, detail="BabelDOC produced no output PDF")
            # 主文件：优先 .mono.pdf，否则第一个 pdf（排除 glossary 等非主 PDF）
            pdfs = sorted(
                Path(p) for p in output_paths
                if str(p).lower().endswith(".pdf") and "gloss" not in str(p).lower()
            )
            if not pdfs:
                logger.error("No output PDF found in output_paths=%s", output_paths)
                if body.callback_url and body.task_id:
                    _notify_callback(body.callback_url, body.task_id, "failed", error_message="No output PDF in BabelDOC result")
                raise HTTPException(status_code=500, detail="No output PDF in BabelDOC result")
            mono = [p for p in pdfs if p.name.lower().endswith(".mono.pdf")]
            primary = mono[0] if mono else pdfs[0]
            if not primary.exists():
                logger.error("Primary PDF does not exist: %s", primary)
                if body.callback_url and body.task_id:
                    _notify_callback(body.callback_url, body.task_id, "failed", error_message=f"Output PDF not found: {primary}")
                raise HTTPException(status_code=500, detail=f"Output PDF not found: {primary}")
            try:
                primary_size = primary.stat().st_size
            except OSError as e:
                logger.error("Primary PDF stat failed path=%s err=%s", primary, e)
                if body.callback_url and body.task_id:
                    _notify_callback(body.callback_url, body.task_id, "failed", error_message=f"Output PDF not accessible: {e}")
                raise HTTPException(status_code=500, detail=f"Output PDF not accessible: {e}") from e
            logger.info("Uploading to R2 key=%s path=%s size=%s", body.output_object_key, primary, primary_size)
            try:
                _upload_to_r2(primary, body.output_object_key)
            except Exception as e:
                logger.exception("R2 upload failed key=%s err=%s", body.output_object_key, e)
                if body.callback_url and body.task_id:
                    _notify_callback(
                        body.callback_url, body.task_id, "failed",
                        error_message=f"Failed to upload result to R2: {e}",
                    )
                raise HTTPException(status_code=500, detail=f"Failed to upload result to R2: {e}") from e
            page_count_for_callback = _resolve_translated_page_count_for_callback(
                babeldoc_page_hint, body.page_range, input_pdf
            )
        if body.callback_url and body.task_id:
            _notify_completed_callback_with_retry(
                body.callback_url,
                body.task_id,
                body.output_object_key,
                page_count_for_callback,
            )
        return TranslateResponse(output_object_key=body.output_object_key)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("translate failed task_id=%s", body.task_id)
        if body.callback_url and body.task_id:
            _notify_callback(
                body.callback_url,
                body.task_id,
                "failed",
                error_message=str(e)[:2000],
                error_code=_error_code_for_babeldoc_failure(e),
            )
        raise HTTPException(status_code=500, detail=str(e)[:500]) from e


@app.get("/health")
def health():
    return {"status": "ok"}
