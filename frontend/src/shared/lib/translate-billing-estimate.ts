/**
 * 纯函数：预估翻译页数（客户端与服务端共用，不依赖 Worker env）。
 */

export function parseTranslatePageRange(
  range: string | null | undefined
): [number, number] | null {
  if (range == null || String(range).trim() === '') return null;
  const s = String(range).trim();
  const dash = s.indexOf('-');
  if (dash === -1) {
    const n = parseInt(s, 10);
    if (Number.isNaN(n) || n < 1) return null;
    return [n, n];
  }
  const start = parseInt(s.slice(0, dash).trim(), 10);
  const end = parseInt(s.slice(dash + 1).trim(), 10);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 1 ||
    end < start
  ) {
    return null;
  }
  return [start, end];
}

/** 与文档 [1, docPages] 取交集后的规范页范围字符串（单页为数字，区间为 a-b） */
export function formatEffectivePageRange(start: number, end: number): string {
  if (start === end) return String(start);
  return `${start}-${end}`;
}

export type IntersectPageRangeResult =
  | {
      ok: true;
      effectiveRange: string;
      adjusted: boolean;
      /** 与 effective 不一致时写入库的用户规范化输入，否则 null */
      userInputToStore: string | null;
    }
  | { ok: false };

/**
 * 将已解析且合法的页范围与文档页数取交集。
 * userNormalizedRange 须与 {@link parseTranslatePageRange} 所用规范化一致。
 */
export function intersectPageRangeWithDocument(
  userNormalizedRange: string,
  docPages: number
): IntersectPageRangeResult {
  const pr = parseTranslatePageRange(userNormalizedRange);
  if (!pr) return { ok: false };
  if (docPages < 1) return { ok: false };
  const effStart = Math.max(pr[0], 1);
  const effEnd = Math.min(pr[1], docPages);
  if (effStart > effEnd) return { ok: false };
  const effectiveRange = formatEffectivePageRange(effStart, effEnd);
  const adjusted = userNormalizedRange !== effectiveRange;
  return {
    ok: true,
    effectiveRange,
    adjusted,
    userInputToStore: adjusted ? userNormalizedRange : null,
  };
}

/**
 * 预估本次任务会翻译的页数（用于预校验余额；实际扣费以回调为准）。
 */
export function estimateTranslatedPages(
  pageRange: string | null | undefined,
  documentPageCount: number | null | undefined
): number {
  const pr = parseTranslatePageRange(pageRange ?? null);
  if (pr) {
    const span = pr[1] - pr[0] + 1;
    if (documentPageCount != null && documentPageCount > 0) {
      const cappedStart = Math.min(Math.max(pr[0], 1), documentPageCount);
      const cappedEnd = Math.min(
        Math.max(pr[1], cappedStart),
        documentPageCount
      );
      return Math.max(1, cappedEnd - cappedStart + 1);
    }
    return Math.max(1, span);
  }
  if (documentPageCount != null && documentPageCount > 0) {
    return documentPageCount;
  }
  return 1;
}
