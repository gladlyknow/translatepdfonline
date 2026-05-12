import { PDFDocument } from 'pdf-lib';

import { parseTranslatePageRange } from '@/shared/lib/translate-billing-estimate';

/**
 * Build a PDF containing only pages in [start,end] (1-based inclusive), clamped to source page count.
 */
export async function buildPdfSliceBytes(
  sourcePdfBytes: ArrayBuffer,
  pageRange: string
): Promise<Uint8Array<ArrayBuffer>> {
  const pr = parseTranslatePageRange(pageRange);
  if (!pr) {
    throw new Error('invalid_page_range');
  }
  const src = await PDFDocument.load(sourcePdfBytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total < 1) {
    throw new Error('pdf_has_no_pages');
  }
  const start0 = Math.min(Math.max(pr[0] - 1, 0), total - 1);
  const end0 = Math.min(Math.max(pr[1] - 1, start0), total - 1);
  const out = await PDFDocument.create();
  const indices: number[] = [];
  for (let i = start0; i <= end0; i += 1) indices.push(i);
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  const saved = await out.save({ useObjectStreams: false });
  const buf = new ArrayBuffer(saved.byteLength);
  new Uint8Array(buf).set(saved);
  return new Uint8Array(buf);
}
