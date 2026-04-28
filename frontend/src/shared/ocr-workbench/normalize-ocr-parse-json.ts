import {
  parseParseResultJson,
  type ParseResult,
} from '@/shared/ocr-workbench/translator-parse-result';
import { extractOcrDocument } from '@/shared/lib/ocr-baidu-ocr-result';

function coercePagesShape(raw: Record<string, unknown>): Record<string, unknown> {
  const pages = raw.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    return raw;
  }
  const mapped = pages.map((p, idx) => {
    if (!p || typeof p !== 'object') {
      return {
        page_num: idx + 1,
        layouts: [],
        tables: [],
        images: [],
        text: '',
      };
    }
    const o = p as Record<string, unknown>;
    const pageNum =
      typeof o.page_num === 'number' && Number.isFinite(o.page_num)
        ? Math.max(0, Math.floor(o.page_num))
        : idx + 1;
    return {
      ...o,
      page_num: pageNum,
      layouts: Array.isArray(o.layouts) ? o.layouts : [],
      tables: Array.isArray(o.tables) ? o.tables : [],
      images: Array.isArray(o.images) ? o.images : [],
      text: typeof o.text === 'string' ? o.text : '',
    };
  });
  return { ...raw, pages: mapped };
}

export function tryNormalizeToParseResult(
  raw: unknown
): { ok: true; data: ParseResult } | { ok: false; error: string } {
  const first = parseParseResultJson(raw);
  if (first.ok) return first;

  const extracted = extractOcrDocument(raw);
  const second = parseParseResultJson(extracted);
  if (second.ok) return second;

  const coerced = coercePagesShape(extracted);
  const third = parseParseResultJson(coerced);
  if (third.ok) return third;

  return {
    ok: false,
    error: third.error || second.error || first.error,
  };
}
