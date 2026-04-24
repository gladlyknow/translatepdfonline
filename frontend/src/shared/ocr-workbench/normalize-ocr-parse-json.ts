import {
  parseParseResultJson,
  type ParseResult,
} from '@/shared/ocr-workbench/translator-parse-result';

/** 与旧站 extractOcrDocument 对齐：从 Baidu 嵌套响应中取出含 pages 的对象 */
function extractOcrDocument(root: unknown): Record<string, unknown> {
  if (root === null || root === undefined) {
    return { pages: [] };
  }
  if (typeof root === 'string') {
    const s = root.trim();
    if (!s || s === 'null') {
      return { pages: [] };
    }
    try {
      return extractOcrDocument(JSON.parse(s));
    } catch {
      return { pages: [], _unparsedResult: s.slice(0, 500) };
    }
  }
  if (typeof root !== 'object') {
    return { pages: [] };
  }
  const r = root as Record<string, unknown>;
  if (Array.isArray(r.pages)) {
    return r;
  }
  const purl = r.parse_result_url;
  if (typeof purl === 'string' && /^https?:\/\//i.test(purl)) {
    return r;
  }
  if ('result' in r && r.result !== undefined) {
    const inner = extractOcrDocument(r.result);
    if (Array.isArray(inner.pages) && inner.pages.length > 0) {
      return inner;
    }
    if (
      typeof inner.parse_result_url === 'string' &&
      /^https?:\/\//i.test(inner.parse_result_url)
    ) {
      return inner;
    }
  }
  const ret = r.ret as Record<string, unknown> | undefined;
  if (ret && Array.isArray(ret.pages)) {
    return ret;
  }
  const data = r.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.pages)) {
    return data;
  }
  const pr = r.parse_result as Record<string, unknown> | undefined;
  if (pr && Array.isArray(pr.pages)) {
    return pr;
  }
  return { pages: [], _normalizedFromKeys: Object.keys(r) };
}

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
