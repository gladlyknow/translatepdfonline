"""
在 FC 内调用 BabelDOC 完成 PDF 翻译。依赖环境中已安装 BabelDOC（如镜像内 pip install -e tmp/BabelDOC）。
通过 BABELDOC_PATH 指定 BabelDOC 根目录，否则尝试相对路径 ../tmp/BabelDOC 或 ./BabelDOC。
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from .config import get_deepseek_api_key, get_deepseek_base_url, get_deepseek_model

logger = logging.getLogger(__name__)


def _babeldoc_path() -> Path:
    raw = (os.getenv("BABELDOC_PATH") or "").strip()
    if raw:
        p = Path(raw)
        repo = Path(__file__).resolve().parents[1]
        return p.resolve() if p.is_absolute() else (repo / raw).resolve()
    # 仓库布局：babeldoc_fc 与 tmp 同级，repo_root = 项目根
    repo_root = Path(__file__).resolve().parents[1]
    candidate = repo_root / "tmp" / "BabelDOC"
    if candidate.exists():
        return candidate.resolve()
    # FC 镜像内可能为 babeldoc_fc/BabelDOC
    candidate = Path(__file__).resolve().parent / "BabelDOC"
    if candidate.exists():
        return candidate.resolve()
    return (repo_root / "tmp" / "BabelDOC").resolve()


def _ensure_babeldoc_on_path() -> None:
    path = _babeldoc_path()
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


def _normalize_lang(lang: str) -> str:
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
    if not target_lang_norm:
        return ""
    t = target_lang_norm.strip().lower()
    base = (
        "Your response must be valid JSON. In that JSON, every \"output\" field MUST contain "
        "ONLY the translation in the TARGET language. Do NOT put source language or mixed languages in \"output\"."
    )
    if t in ("en", "eng", "english"):
        return "CRITICAL: You are translating INTO English only. " + base.replace("TARGET language", "English")
    if t in ("zh_cn", "zh_tw", "zh_hk"):
        return "CRITICAL: You are translating INTO Chinese only. " + base.replace("TARGET language", "Chinese")
    if t in ("ja", "japanese"):
        return "CRITICAL: You are translating INTO Japanese only. " + base.replace("TARGET language", "Japanese")
    if t in ("ko", "korean"):
        return "CRITICAL: You are translating INTO Korean only. " + base.replace("TARGET language", "Korean")
    return f"CRITICAL: You are translating INTO the target language only (target_lang={target_lang_norm}). " + base.replace("TARGET language", f"target language ({target_lang_norm})")


def run_translate_local(
    local_pdf_path: str | Path,
    output_dir: str | Path,
    source_lang: str,
    target_lang: str,
    page_range: str | None = None,
) -> list[str]:
    """
    在 FC 内执行 BabelDOC 翻译，将结果写入 output_dir。
    返回输出 PDF 路径列表（主文件一般为 *.mono.pdf 或第一个 pdf）。
    """
    from pathlib import Path

    local_pdf_path = Path(local_pdf_path)
    output_dir = Path(output_dir)
    if not local_pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {local_pdf_path}")

    output_dir.mkdir(parents=True, exist_ok=True)
    _ensure_babeldoc_on_path()

    api_key = get_deepseek_api_key()
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY not set, cannot run BabelDOC translation")

    source_lang_norm = _normalize_lang(source_lang)
    target_lang_norm = _normalize_lang(target_lang)
    logger.info(
        "run_translate_local: pdf=%s output_dir=%s source=%s target=%s page_range=%s",
        local_pdf_path, output_dir, source_lang_norm, target_lang_norm, page_range,
    )

    try:
        from babeldoc.format.pdf.high_level import translate
        from babeldoc.format.pdf.translation_config import TranslationConfig, WatermarkOutputMode
        from babeldoc.translator.translator import OpenAITranslator
        from babeldoc.babeldoc_exception.BabelDOCException import ContentFilterError
        import openai
        from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential, before_sleep_log
    except ImportError as e:
        raise RuntimeError("BabelDOC not installed. Install in image: pip install -e tmp/BabelDOC") from e

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
            if self._system_prompt:
                text = (
                    "REMINDER: Reply with valid JSON only. Every \"output\" field must contain "
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
                if "系统检测到输入或生成内容可能包含不安全或敏感内容" in (getattr(e, "message", "") or ""):
                    raise ContentFilterError(getattr(e, "message", "")) from e
                raise

    target_only_system = _target_lang_only_instruction(target_lang_norm)
    translator = _TranslatorWithSystem(
        lang_in=source_lang_norm,
        lang_out=target_lang_norm,
        model=get_deepseek_model(),
        base_url=get_deepseek_base_url(),
        api_key=api_key,
        ignore_cache=True,
        send_temperature=False,
        system_prompt=target_only_system,
    )

    list_preserve_prompt = (
        "保留列表结构：每条列表项单独翻译，条数与原文一致，不要合并或遗漏任何一条。"
        "对于技术文档：保持代码块、SQL 命令、命令行提示符及程序输出原文不变；仅翻译说明性自然语言。"
    )
    target_only = _target_lang_only_instruction(target_lang_norm)
    custom_prompt = f"{target_only}\n\n{list_preserve_prompt}" if target_only else list_preserve_prompt

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
        ocr_workaround=False,
        auto_enable_ocr_workaround=False,
        debug=False,
    )

    result = translate(config)
    # BabelDOC 返回 TranslateResult（mono_pdf_path / dual_pdf_path），无 output_paths；优先从 result 取路径
    out_list: list[str] = []
    if result is not None:
        mono = getattr(result, "mono_pdf_path", None)
        dual = getattr(result, "dual_pdf_path", None)
        no_wm_mono = getattr(result, "no_watermark_mono_pdf_path", None)
        no_wm_dual = getattr(result, "no_watermark_dual_pdf_path", None)
        seen: set[Path] = set()
        for p in (mono, no_wm_mono, dual, no_wm_dual):
            if p is None:
                continue
            path = p if isinstance(p, Path) else Path(str(p))
            if path not in seen and path.exists() and path.suffix.lower() == ".pdf":
                seen.add(path)
                out_list.append(str(path))
        # 保持 mono 在前，便于 main 里优先选 .mono.pdf
        if out_list:
            return out_list
    # 回退：output_dir 下 rglob 查找 PDF（含子目录），排除 glossary
    out_path = Path(output_dir)
    if out_path.exists():
        pdfs = sorted(out_path.rglob("*.pdf"))
        pdfs = [p for p in pdfs if "gloss" not in p.name.lower()]
        if pdfs:
            logger.info("run_translate_local: using rglob fallback %s", [str(p) for p in pdfs])
            return [str(p) for p in pdfs]
    return []
