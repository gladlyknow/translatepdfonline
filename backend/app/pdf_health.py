"""
PDF 健康检查：在翻译前检测 ToUnicode 映射缺失、字体子集损坏等，
避免进入 BabelDOC 后报 "no paragraphs" / "too many CID" 或 MuPDF 报错。
仅依赖 pymupdf，不依赖 BabelDOC。
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Tuple

logger = logging.getLogger(__name__)

# 健康检查失败时的错误码，供 tasks_translate 设置 task.error_code
HEALTH_OK = None
TOUNICODE_MISSING = "tounicode_missing"
FONT_SUBSET_CORRUPT = "font_subset_corrupt"
UNKNOWN = "unknown"


def _parse_page_range(page_range: str | None) -> list[int] | None:
    """解析 page_range 为 0-based 页索引列表。None 表示全部页。"""
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
            # 用户 "1-3" 表示第 1 到第 3 页，0-based 为 [0,1,2]，即 range(start-1, end)
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


def check_pdf_health(path: Path, page_range: str | None = None) -> Tuple[bool, str | None]:
    """
    对即将参与翻译的 PDF 做轻量健康检查。

    Returns:
        (True, None) 表示健康，可继续翻译。
        (False, error_code) 表示不健康，error_code 为 tounicode_missing | font_subset_corrupt | unknown。
    """
    path = Path(path)
    if not path.exists() or not path.is_file():
        logger.warning("pdf_health: path not found or not file path=%s", path)
        return False, UNKNOWN

    try:
        import pymupdf
    except ImportError:
        logger.warning("pdf_health: pymupdf not available, skip check")
        return True, HEALTH_OK

    try:
        doc = pymupdf.open(path)
    except Exception as e:
        logger.warning("pdf_health: failed to open PDF path=%s err=%s", path, e)
        return False, FONT_SUBSET_CORRUPT

    try:
        page_indices = _parse_page_range(page_range)
        if page_indices is None:
            page_indices = list(range(len(doc)))
        else:
            page_indices = [i for i in page_indices if 0 <= i < len(doc)]
        if not page_indices:
            return True, HEALTH_OK

        seen_font_xrefs: set[int] = set()
        for i in page_indices:
            try:
                page = doc[i]
            except Exception as e:
                logger.warning("pdf_health: failed to load page i=%s path=%s err=%s", i, path, e)
                return False, FONT_SUBSET_CORRUPT

            # 尝试提取文本，若 MuPDF 报 corrupt charset 等会在这里暴露
            try:
                _ = page.get_text()
            except Exception as e:
                err_str = str(e).lower()
                if "charset" in err_str or "corrupt" in err_str or "format error" in err_str:
                    logger.info("pdf_health: text extraction failed (charset/corrupt) path=%s page=%s err=%s", path, i, e)
                    return False, TOUNICODE_MISSING
                logger.warning("pdf_health: get_text failed path=%s page=%s err=%s", path, i, e)
                return False, FONT_SUBSET_CORRUPT

            # 收集本页字体 xref，用于后续检查 ToUnicode
            try:
                fonts = page.get_fonts()
            except Exception as e:
                logger.warning("pdf_health: get_fonts failed path=%s page=%s err=%s", path, i, e)
                return False, FONT_SUBSET_CORRUPT

            for item in fonts:
                if isinstance(item, (list, tuple)) and len(item) >= 1:
                    xref = item[0]
                    if isinstance(xref, int) and xref not in seen_font_xrefs:
                        seen_font_xrefs.add(xref)

        # 检查收集到的字体是否有 ToUnicode（CID/Identity 字体必须有 ToUnicode 才能正确提取）
        for xref in seen_font_xrefs:
            try:
                obj_str = doc.xref_object(xref)
            except Exception as e:
                logger.warning("pdf_health: xref_object failed xref=%s path=%s err=%s", xref, path, e)
                return False, FONT_SUBSET_CORRUPT

            if not obj_str:
                continue
            has_tounicode = "/ToUnicode" in obj_str
            # CID / Identity 编码通常需要 ToUnicode 才能正确映射到 Unicode
            is_cid_or_identity = (
                "Identity" in obj_str
                or "Identity-H" in obj_str
                or "Identity-V" in obj_str
                or "CIDFontType" in obj_str
                or "/CIDToGIDMap" in obj_str
            )
            if is_cid_or_identity and not has_tounicode:
                logger.info(
                    "pdf_health: font xref=%s has CID/Identity but no ToUnicode path=%s",
                    xref, path,
                )
                return False, TOUNICODE_MISSING

        return True, HEALTH_OK
    finally:
        try:
            doc.close()
        except Exception:
            pass
