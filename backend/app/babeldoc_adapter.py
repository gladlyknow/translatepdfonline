"""
BabelDOC 适配层：将本地 BabelDOC 项目接入 Celery 翻译流水线。

- 从 tmp/BabelDOC 加载 BabelDOC，调用 high_level.translate
- 使用 DeepSeek（OpenAI 兼容接口）作为翻译后端
- 输入：本地 PDF 路径；输出：翻译后的 PDF 写入 output_dir
"""
from __future__ import annotations

import logging
import os
import sys
import threading
from pathlib import Path
from collections.abc import Callable
from typing import Any

from .config import get_settings, PROJECT_ROOT as CONFIG_PROJECT_ROOT

logger = logging.getLogger(__name__)

# 与 config 保持一致，避免 API 与 Worker 工作目录不同导致路径不一致
PROJECT_ROOT = CONFIG_PROJECT_ROOT
# 仅使用 tmp/BabelDOC；可通过环境变量 BABELDOC_PATH 覆盖（绝对路径或相对项目根）
_raw_babeldoc = (os.getenv("BABELDOC_PATH") or "").strip()
if _raw_babeldoc:
    _babeldoc_path = Path(_raw_babeldoc)
    BABELDOC_PATH = _babeldoc_path.resolve() if _babeldoc_path.is_absolute() else (PROJECT_ROOT / _babeldoc_path).resolve()
else:
    BABELDOC_PATH = (PROJECT_ROOT / "tmp" / "BabelDOC").resolve()


def _ensure_babeldoc_on_path() -> None:
    if str(BABELDOC_PATH) not in sys.path:
        sys.path.insert(0, str(BABELDOC_PATH))


def _normalize_lang_for_babeldoc(lang: str) -> str:
    """
    将前端/API 的语种代码规范为 BabelDOC 字体与翻译所需的格式。
    例如 "zh" -> "zh_cn"，否则 get_font_family("ZH") 会回退到英文字体，导致中文乱码。
    """
    if not lang or not isinstance(lang, str):
        return lang or "en"
    lang = lang.strip().lower()
    if lang in ("zh", "zh-cn", "zh_cn", "zhcn"):
        return "zh_cn"
    if lang in ("zh-tw", "zh_tw", "zhtw", "hant"):
        return "zh_tw"
    if lang in ("zh-hk", "zh_hk", "zhhk"):
        return "zh_hk"
    if lang in ("ja", "jp", "japanese"):
        return "ja"
    if lang in ("ko", "kr", "korean"):
        return "ko"
    return lang


def _target_lang_only_instruction(target_lang_norm: str) -> str:
    """
    根据前端传入的 target_lang 生成「只输出目标语言」的系统提示。
    强调 JSON 中每个 "output" 字段必须仅为目标语（BabelDOC 使用 JSON 模式）。
    不写死语种，英/中/西等均按参数生成。
    """
    if not target_lang_norm:
        return ""
    t = target_lang_norm.strip().lower()
    # 统一强调：回复为 JSON，且每个 output 字段仅为「当前目标语」译文
    base_json_rule = (
        "Your response must be valid JSON. In that JSON, every \"output\" field MUST contain "
        "ONLY the translation in the TARGET language. Do NOT put source language or mixed languages in \"output\"."
    )
    if t in ("en", "eng", "english"):
        return (
            "CRITICAL: You are translating INTO English only (target_lang=English). "
            "The example in the task shows output in English; follow it. "
            + base_json_rule.replace("TARGET language", "English")
        )
    if t in ("zh_cn", "zh_tw", "zh_hk"):
        return (
            "CRITICAL: You are translating INTO Chinese only (target_lang=Chinese). "
            + base_json_rule.replace("TARGET language", "Chinese")
        )
    if t in ("ja", "japanese"):
        return (
            "CRITICAL: You are translating INTO Japanese only (target_lang=Japanese). "
            + base_json_rule.replace("TARGET language", "Japanese")
        )
    if t in ("ko", "korean"):
        return (
            "CRITICAL: You are translating INTO Korean only (target_lang=Korean). "
            + base_json_rule.replace("TARGET language", "Korean")
        )
    # 西语等其它语种：用参数值明确写出目标语
    return (
        f"CRITICAL: You are translating INTO the target language only (target_lang={target_lang_norm}). "
        + base_json_rule.replace("TARGET language", f"target language ({target_lang_norm})")
    )


def run_translate(
    local_pdf_path: str | Path,
    output_dir: str | Path,
    source_lang: str,
    target_lang: str,
    page_range: str | None = None,
    progress_callback: Callable[..., None] | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    """
    调用 BabelDOC 完成 PDF 翻译。

    Args:
        local_pdf_path: 本地 PDF 文件路径
        output_dir: 输出目录，翻译后的 PDF 将写入此处
        source_lang: 源语言，如 zh/en/es
        target_lang: 目标语言，如 zh/en/es
        page_range: 页码范围，如 "1-10"，None 表示全文

    Returns:
        包含 output_paths、total_seconds 等信息的字典

    Raises:
        FileNotFoundError: 输入 PDF 不存在
        RuntimeError: BabelDOC 调用失败
    """
    local_pdf_path = Path(local_pdf_path)
    output_dir = Path(output_dir)
    if not local_pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {local_pdf_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    _ensure_babeldoc_on_path()

    # 规范语种代码，避免 "zh" 被 BabelDOC 当成英文而使用英文字体导致中文乱码
    source_lang_norm = _normalize_lang_for_babeldoc(source_lang)
    target_lang_norm = _normalize_lang_for_babeldoc(target_lang)
    logger.info(
        "run_translate input: pdf=%s output_dir=%s source_lang=%s -> target_lang=%s page_range=%s",
        local_pdf_path,
        output_dir,
        source_lang_norm,
        target_lang_norm,
        page_range,
    )

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise RuntimeError("DEEPSEEK_API_KEY not set, cannot run BabelDOC translation")

    try:
        from babeldoc.format.pdf.high_level import translate
        from babeldoc.format.pdf.translation_config import TranslationConfig, WatermarkOutputMode
        from babeldoc.translator.translator import OpenAITranslator
        from babeldoc.babeldoc_exception.BabelDOCException import ContentFilterError
        import openai
        from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential, before_sleep_log
    except ImportError as e:
        raise RuntimeError(
            "BabelDOC not installed. Run: pip install -e tmp/BabelDOC"
        ) from e

    # 子类：do_llm_translate 时先发 system 消息强制只输出目标语，再发 user（BabelDOC 原版仅 user，易被忽略）
    class _TranslatorWithSystem(OpenAITranslator):
        def __init__(self, system_prompt: str | None = None, **kwargs):
            super().__init__(**kwargs)
            self._system_prompt = (system_prompt or "").strip()

        @retry(
            retry=retry_if_exception_type(openai.RateLimitError),
            stop=stop_after_attempt(100),
            wait=wait_exponential(multiplier=1, min=1, max=15),
            before_sleep=before_sleep_log(logger, logging.WARNING),
        )
        def do_llm_translate(self, text, rate_limit_params: dict | None = None):
            if text is None:
                return None
            rate_limit_params = rate_limit_params or {}
            options = {}
            if self.send_temperature:
                options.update(self.options)
            if self.enable_json_mode_if_requested and rate_limit_params.get("request_json_mode", False):
                options["response_format"] = {"type": "json_object"}
            extra_headers = {}
            if self.send_dashscope_header:
                extra_headers["X-DashScope-DataInspection"] = '{"input": "disable", "output": "disable"}'
            messages = []
            if self._system_prompt:
                messages.append({"role": "system", "content": self._system_prompt})
                logger.info(
                    "do_llm_translate: sending system prompt len=%s preview=%s",
                    len(self._system_prompt),
                    (self._system_prompt[:180] + "…") if len(self._system_prompt) > 180 else self._system_prompt,
                )
            # 按本次任务的目标语（来自前端 target_lang）在 user 开头再强调一次
            if self._system_prompt:
                text = (
                    f"REMINDER: Reply with valid JSON only. Every \"output\" field must contain "
                    f"ONLY the translation in the target language (lang_out={self.lang_out}). Do not put source language in \"output\".\n\n"
                    + text
                )
            messages.append({"role": "user", "content": text})
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    **options,
                    max_tokens=2048,
                    messages=messages,
                    extra_headers=extra_headers,
                    extra_body=self.extra_body,
                )
                self.update_token_count(response)
                return response.choices[0].message.content.strip()
            except openai.BadRequestError as e:
                if "系统检测到输入或生成内容可能包含不安全或敏感内容" in (e.message or ""):
                    raise ContentFilterError(e.message) from e
                raise

    target_only_system = _target_lang_only_instruction(target_lang_norm)
    translator = _TranslatorWithSystem(
        lang_in=source_lang_norm,
        lang_out=target_lang_norm,
        model=settings.deepseek_model,
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        ignore_cache=True,
        send_temperature=False,
        system_prompt=target_only_system,
    )

    # 列表结构 + 技术文档：保留代码块、SQL/CLI 与命令说明，只翻译自然语言
    list_preserve_prompt = (
        "保留列表结构：每条列表项单独翻译，条数与原文一致，不要合并或遗漏任何一条。"
        "对于技术文档：保持代码块、SQL 命令、命令行提示符（如 test=#）、语法行（Command:, Description:, Syntax:）及程序输出（如 ERROR:, BEGIN, ROLLBACK）原文不变；仅翻译说明性自然语言。"
    )
    # 强制只输出目标语言，放在最前以优先被模型看到（BabelDOC 将 role 作为 user 消息一部分）
    target_only = _target_lang_only_instruction(target_lang_norm)
    custom_prompt = (
        f"{target_only}\n\n{list_preserve_prompt}" if target_only else list_preserve_prompt
    )
    config = TranslationConfig(
        translator=translator,
        input_file=str(local_pdf_path),
        lang_in=source_lang_norm,
        lang_out=target_lang_norm,
        doc_layout_model=None,
        output_dir=str(output_dir),
        pages=page_range,
        skip_scanned_detection=True,
        use_rich_pbar=False,
        only_include_translated_page=True,
        no_dual=True,
        custom_system_prompt=custom_prompt,
        split_short_lines=True,
        watermark_output_mode=WatermarkOutputMode.NoWatermark,
        # 避免译文中出现原文没有的段落底框/调试矩形；不关 skip_form_render，否则会连正常插图一起丢掉
        ocr_workaround=False,
        auto_enable_ocr_workaround=False,
        debug=False,
    )
    if cancel_event is not None:
        config.cancel_event = cancel_event

    # tmp/BabelDOC 的 translate() 仅接受 config，不支持 progress_callback
    result = translate(config)

    return {
        "output_paths": getattr(result, "output_paths", []),
        "total_seconds": getattr(result, "total_seconds", 0),
    }


def get_task_output_dir(task_id: str) -> Path:
    """为翻译任务生成输出目录（始终返回绝对路径）。"""
    settings = get_settings()
    raw = (settings.babeldoc_output_dir or "").strip()
    if raw:
        base = Path(raw)
        if not base.is_absolute():
            base = (CONFIG_PROJECT_ROOT / base).resolve()
        else:
            base = base.resolve()
    else:
        base = (CONFIG_PROJECT_ROOT / "tmp" / "babeldoc_output").resolve()
    return base / task_id


def resolve_staging_path(object_key: str, filename: str) -> Path | None:
    """
    根据 object_key 解析本地暂存路径（用于开发/测试，无 R2 时）。

    约定：BABELDOC_STAGING_DIR 下按 object_key 组织，如
    staging/multipart/xxx/paper.pdf
    """
    settings = get_settings()
    base = Path(settings.babeldoc_staging_dir) if settings.babeldoc_staging_dir else PROJECT_ROOT / "tmp" / "staging"
    candidate = base / object_key
    if candidate.exists():
        return candidate
    candidate = base / filename
    if candidate.exists():
        return candidate
    return None
