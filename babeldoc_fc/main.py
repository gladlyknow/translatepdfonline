"""
BabelDOC FC HTTP 入口：POST /translate 接收源 PDF URL 与参数，执行翻译后上传 R2，返回 output_object_key。
部署到阿里云函数计算时使用此 app 作为 HTTP 触发器入口。
"""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .config import get_fc_secret, get_r2_config
from .run_translate import run_translate_local

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="BabelDOC FC", description="PDF translation via BabelDOC for translatepdfonline")


class TranslateRequest(BaseModel):
    source_pdf_url: str = Field(..., description="Presigned GET URL for the source PDF")
    source_lang: str = Field(..., description="Source language code, e.g. zh, en, es")
    target_lang: str = Field(..., description="Target language code")
    page_range: str | None = Field(None, description="Page range, e.g. 1-10")
    task_id: str | None = Field(None, description="Task ID for logging")
    output_object_key: str = Field(..., description="R2 object key where the result PDF will be uploaded")


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
    if secret and x_babeldoc_secret != secret:
        raise HTTPException(status_code=403, detail="Invalid or missing X-Babeldoc-Secret")
    with tempfile.TemporaryDirectory(prefix="babeldoc_fc_") as tmp:
        tmp_path = Path(tmp)
        input_pdf = tmp_path / "input.pdf"
        output_dir = tmp_path / "output"
        try:
            _download_pdf(body.source_pdf_url, input_pdf)
        except Exception as e:
            logger.exception("download failed url=%s", body.source_pdf_url[:80])
            raise HTTPException(status_code=502, detail=f"Failed to download source PDF: {e}") from e
        try:
            output_paths = run_translate_local(
                local_pdf_path=input_pdf,
                output_dir=output_dir,
                source_lang=body.source_lang,
                target_lang=body.target_lang,
                page_range=body.page_range,
            )
        except Exception as e:
            logger.exception("BabelDOC translate failed task_id=%s", body.task_id)
            raise HTTPException(status_code=500, detail=str(e)[:500]) from e
        if not output_paths:
            logger.error("BabelDOC produced no output PDF; output_paths=%s", output_paths)
            raise HTTPException(status_code=500, detail="BabelDOC produced no output PDF")
        # 主文件：优先 .mono.pdf，否则第一个 pdf（排除 glossary 等非主 PDF）
        pdfs = sorted(
            Path(p) for p in output_paths
            if str(p).lower().endswith(".pdf") and "gloss" not in str(p).lower()
        )
        if not pdfs:
            logger.error("No output PDF found in output_paths=%s", output_paths)
            raise HTTPException(status_code=500, detail="No output PDF in BabelDOC result")
        mono = [p for p in pdfs if p.name.lower().endswith(".mono.pdf")]
        primary = mono[0] if mono else pdfs[0]
        if not primary.exists():
            logger.error("Primary PDF does not exist: %s", primary)
            raise HTTPException(status_code=500, detail=f"Output PDF not found: {primary}")
        logger.info("Uploading to R2 key=%s path=%s size=%s", body.output_object_key, primary, primary.stat().st_size)
        try:
            _upload_to_r2(primary, body.output_object_key)
        except Exception as e:
            logger.exception("R2 upload failed key=%s err=%s", body.output_object_key, e)
            raise HTTPException(status_code=500, detail=f"Failed to upload result to R2: {e}") from e
    return TranslateResponse(output_object_key=body.output_object_key)


@app.get("/health")
def health():
    return {"status": "ok"}
