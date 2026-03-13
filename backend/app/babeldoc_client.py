"""
调用远程 BabelDOC FC 服务执行翻译。当 BABELDOC_USE_FC=True 时，Worker 使用本模块而非本地 run_translate。
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)


def run_translate_remote(
    source_pdf_url: str,
    output_object_key: str,
    source_lang: str,
    target_lang: str,
    page_range: str | None = None,
    task_id: str | None = None,
) -> str:
    """
    向 FC 发送 POST /translate，同步等待完成后返回 output_object_key。

    Args:
        source_pdf_url: 源 PDF 的 presigned GET URL
        output_object_key: 结果 PDF 在 R2 上的 key（FC 会写入该 key）
        source_lang: 源语言，如 zh, en, es
        target_lang: 目标语言
        page_range: 页码范围，如 "1-10"，None 表示全文
        task_id: 任务 ID，用于 FC 日志

    Returns:
        FC 返回的 output_object_key（与传入的 output_object_key 一致）

    Raises:
        RuntimeError: FC 未配置或请求失败
    """
    settings = get_settings()
    url = (settings.babeldoc_fc_url or "").strip()
    if not url:
        raise RuntimeError("BABELDOC_FC_URL is not set; cannot call remote BabelDOC")
    url = url.rstrip("/")
    if not url.endswith("/translate"):
        url = f"{url}/translate"

    payload: dict[str, Any] = {
        "source_pdf_url": source_pdf_url,
        "source_lang": source_lang,
        "target_lang": target_lang,
        "output_object_key": output_object_key,
    }
    if page_range is not None:
        payload["page_range"] = page_range
    if task_id is not None:
        payload["task_id"] = task_id

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.babeldoc_fc_secret:
        headers["X-Babeldoc-Secret"] = settings.babeldoc_fc_secret

    logger.info(
        "run_translate_remote: task_id=%s url=%s output_key=%s",
        task_id, url, output_object_key,
    )
    with httpx.Client(timeout=600.0) as client:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    out_key = data.get("output_object_key") or output_object_key
    logger.info("run_translate_remote done task_id=%s output_object_key=%s", task_id, out_key)
    return out_key
