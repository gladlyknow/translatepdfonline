"""
Post-BabelDOC gate: reject "successful" runs with almost no extractable text / poor LLM coverage.
Maps to scan_detected_use_ocr via InsufficientTextLayerForTranslationError in main.py.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any


class InsufficientTextLayerForTranslationError(RuntimeError):
    """Stable marker: babeldoc_insufficient_text_layer (FC / callback maps to OCR)."""


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    return default


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int((os.getenv(name) or "").strip()))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float((os.getenv(name) or "").strip())
    except ValueError:
        return default


def _parse_page_range(s: str | None) -> tuple[int, int] | None:
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


def _pdf_num_pages(path: Path) -> int:
    try:
        from pypdf import PdfReader

        r = PdfReader(str(path))
        n = len(r.pages)
        return n if n >= 1 else 1
    except Exception:
        return 1


def effective_pages_for_gate(input_pdf: Path, page_range: str | None) -> int:
    """Pages in scope for thresholds (whole doc or capped page_range span)."""
    total = _pdf_num_pages(input_pdf)
    pr = _parse_page_range(page_range)
    if not pr:
        return max(1, total)
    start, end = pr
    if total > 0:
        capped_start = min(max(start, 1), total)
        capped_end = min(max(end, capped_start), total)
        return max(1, capped_end - capped_start + 1)
    return max(1, end - start + 1)


def enforce_text_layer_after_translate(
    result: Any,
    input_pdf: Path,
    page_range: str | None,
) -> None:
    """
    Raise InsufficientTextLayerForTranslationError if output should not be treated as success.
    """
    if not _env_bool("BABELDOC_INSUFFICIENT_TEXT_CHECK", True):
        return
    if result is None:
        raise InsufficientTextLayerForTranslationError(
            "babeldoc_insufficient_text_layer: translate returned no result"
        )

    pages = effective_pages_for_gate(input_pdf, page_range)

    valid_chars = getattr(result, "total_valid_character_count", None)
    if valid_chars is None:
        valid_chars = 0
    try:
        valid_chars = int(valid_chars)
    except (TypeError, ValueError):
        valid_chars = 0

    ext = getattr(result, "paragraph_extractable_total", None)
    llm_total_raw = getattr(result, "paragraph_llm_total", None)
    llm_ok_raw = getattr(result, "paragraph_llm_ok", None)
    stats_ready = llm_total_raw is not None and ext is not None

    try:
        ext_i = int(ext) if ext is not None else 0
    except (TypeError, ValueError):
        ext_i = 0

    try:
        lt = int(llm_total_raw) if llm_total_raw is not None else 0
        lo = int(llm_ok_raw) if llm_ok_raw is not None else 0
    except (TypeError, ValueError):
        lt, lo = 0, 0

    min_chars_total = _env_int("BABELDOC_MIN_VALID_CHARS_TOTAL", 8)
    min_chars_per_page = _env_int("BABELDOC_MIN_VALID_CHARS_PER_PAGE", 85)
    min_extractable_per_page = _env_float(
        "BABELDOC_MIN_EXTRACTABLE_PARAS_PER_PAGE", 0.2
    )
    min_llm_total_for_ratio = _env_int("BABELDOC_MIN_LLM_TOTAL_FOR_RATIO", 3)
    min_llm_ok_ratio = _env_float("BABELDOC_MIN_LLM_OK_RATIO", 0.34)

    cpp = valid_chars / max(pages, 1)
    para_signal = lt > 0 or ext_i > 0

    reasons: list[str] = []

    if valid_chars <= 0:
        reasons.append(f"valid_chars={valid_chars}")
    elif pages == 1 and valid_chars < min_chars_total:
        reasons.append(f"single_page valid_chars={valid_chars} < {min_chars_total}")
    elif pages >= 2 and cpp < min_chars_per_page:
        reasons.append(
            f"chars_per_page={cpp:.1f} < {min_chars_per_page} (pages={pages}, valid_chars={valid_chars})"
        )

    if (
        stats_ready
        and para_signal
        and pages >= 2
        and ext_i < max(1.0, pages * min_extractable_per_page)
    ):
        reasons.append(
            f"extractable_paras={ext_i} < pages*{min_extractable_per_page:.2f} ({pages * min_extractable_per_page:.1f})"
        )

    if (
        stats_ready
        and para_signal
        and lt >= min_llm_total_for_ratio
        and lo < lt * min_llm_ok_ratio
    ):
        reasons.append(
            f"llm_ok_ratio={lo}/{lt} < {min_llm_ok_ratio} (min_total={min_llm_total_for_ratio})"
        )

    if reasons:
        raise InsufficientTextLayerForTranslationError(
            "babeldoc_insufficient_text_layer: " + "; ".join(reasons)
        )
