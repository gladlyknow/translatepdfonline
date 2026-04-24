import {
  findImageForLayout,
  findTableForLayout,
  sortLayoutsByReadingOrder,
} from '@/shared/ocr-workbench/parse-result-document';
import {
  dataUrlToBytes,
  extFromDataUrl,
  resolveImageDataUrl,
} from '@/shared/ocr-workbench/parse-result-image-data';
import { stripUrlsFromText } from '@/shared/ocr-workbench/strip-urls';
import type { ParseResult } from '@/shared/ocr-workbench/translator-parse-result';

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

/** Logical markdown: no http(s) URLs; images as placeholders only. */
export function buildMarkdownExport(doc: ParseResult): string {
  const parts: string[] = [];
  if (doc.file_name) {
    parts.push(`# ${stripUrlsFromText(doc.file_name)}`, '');
  }
  for (const page of doc.pages) {
    parts.push(`## Page ${page.page_num}`, '');
    for (const ly of sortLayoutsByReadingOrder(page.layouts)) {
      if (ly.type === 'table') {
        const tb = findTableForLayout(page, ly.layout_id);
        parts.push(stripUrlsFromText(tb?.markdown ?? ''), '');
      } else if (ly.type === 'image') {
        parts.push(`![image:${ly.layout_id}]`, '');
      } else {
        const raw = ly.text || '';
        const t = stripHtmlTags(stripUrlsFromText(raw)).trim();
        if (t) parts.push(t, '');
      }
    }
  }
  return parts.join('\n').trim() + '\n';
}

export async function buildMarkdownExportWithAssets(
  doc: ParseResult,
  baseName: string
): Promise<{
  markdown: string;
  assets: Array<{ name: string; bytes: Uint8Array }>;
  imageWarnings: number;
}> {
  const cache = new Map<string, string>();
  const assets: Array<{ name: string; bytes: Uint8Array }> = [];
  let imageWarnings = 0;
  const parts: string[] = [];
  if (doc.file_name) {
    parts.push(`# ${stripUrlsFromText(doc.file_name)}`, '');
  }
  for (const page of doc.pages) {
    parts.push(`## Page ${page.page_num}`, '');
    for (const ly of sortLayoutsByReadingOrder(page.layouts)) {
      if (ly.type === 'table') {
        const tb = findTableForLayout(page, ly.layout_id);
        parts.push(stripUrlsFromText(tb?.markdown ?? ''), '');
      } else if (ly.type === 'image') {
        const im = findImageForLayout(page, ly.layout_id);
        const raw = im?.data_url?.trim() ?? '';
        const dataUrl = raw ? await resolveImageDataUrl(raw, cache) : '';
        const bytes = dataUrl ? dataUrlToBytes(dataUrl) : null;
        if (!bytes) {
          imageWarnings += 1;
          parts.push(`![image:${ly.layout_id}]`, '');
          continue;
        }
        const ext = extFromDataUrl(dataUrl);
        const name = `${baseName}_assets/p${page.page_num}_${ly.layout_id}.${ext}`;
        assets.push({ name, bytes });
        parts.push(`![image:${ly.layout_id}](./${name})`, '');
      } else {
        const rawText = ly.text || '';
        const t = stripHtmlTags(stripUrlsFromText(rawText)).trim();
        if (t) parts.push(t, '');
      }
    }
  }
  return { markdown: parts.join('\n').trim() + '\n', assets, imageWarnings };
}

export function downloadTextFile(content: string, filename: string, ext: string) {
  const name = filename.endsWith(ext) ? filename : `${filename}${ext}`;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadBinaryFile(bytes: Uint8Array, filename: string) {
  const safe = new Uint8Array(Array.from(bytes));
  const blob = new Blob([safe], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZipBlob(
  files: Array<{ name: string; bytes: Uint8Array }>
): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = utf8Bytes(f.name.replace(/\\/g, '/'));
    const data = f.bytes;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const all = [...chunks, ...central, end].map(
    (part) => new Uint8Array(Array.from(part))
  );
  return new Blob(all, { type: 'application/zip' });
}
