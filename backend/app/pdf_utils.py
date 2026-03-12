from __future__ import annotations

from pathlib import Path

from PyPDF2 import PdfReader


def get_pdf_page_count(path: str | Path) -> int:
  """
  读取 PDF 页数。

  在生产环境中，这里可以替换为调用 BabelDOC/MinerU 的
  统一预处理管线；当前实现基于 PyPDF2，确保轻量稳定。
  """
  pdf_path = Path(path)
  if not pdf_path.exists():
    raise FileNotFoundError(f"PDF not found: {pdf_path}")

  with pdf_path.open("rb") as f:
    reader = PdfReader(f)
    return len(reader.pages)


