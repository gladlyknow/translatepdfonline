import { PDFDocument } from "pdf-lib";

/**
 * 将 page_range 字符串解析为 0-based 页索引列表。
 * "1" -> [0], "1-5" -> [0,1,2,3,4]
 */
export function parsePageRangeToIndices(pageRange: string): number[] {
  const s = pageRange.trim();
  if (!s) return [];
  if (s.includes("-")) {
    const [a, b] = s.split("-", 2).map((x) => parseInt(x.trim(), 10));
    if (Number.isNaN(a) || Number.isNaN(b) || a < 1 || b < a) return [];
    return Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
  }
  const p = parseInt(s, 10);
  if (Number.isNaN(p) || p < 1) return [];
  return [p - 1];
}

/**
 * 从完整 PDF 文件中按 page_range 切出所选页，返回新 PDF 的 Blob。
 */
export async function slicePdfByPageRange(file: File, pageRange: string): Promise<Blob> {
  const indices = parsePageRangeToIndices(pageRange);
  if (indices.length === 0) throw new Error("Invalid page range");
  const buf = await file.arrayBuffer();
  const src = await PDFDocument.load(buf);
  const pageCount = src.getPageCount();
  const validIndices = indices.filter((i) => i >= 0 && i < pageCount);
  if (validIndices.length === 0) throw new Error("No valid pages in range");
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, validIndices);
  copied.forEach((p) => out.addPage(p));
  const outBytes = await out.save();
  return new Blob([outBytes], { type: "application/pdf" });
}
