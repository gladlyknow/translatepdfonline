/**
 * PDF 翻译积分：预估页数、每页消耗、是否启用（与 Shipany credit 表配合，不改动支付核心）。
 */

import { getWorkerBindingMeta } from '@/shared/lib/worker-env';

import {
  estimateTranslatedPages,
  intersectPageRangeWithDocument,
  parseTranslatePageRange,
} from '@/shared/lib/translate-billing-estimate';

export {
  estimateTranslatedPages,
  intersectPageRangeWithDocument,
  parseTranslatePageRange,
};

/** 仅当环境变量 TRANSLATE_CREDITS_ENABLED=true（或 1/yes）时启用，避免未配置时误拦翻译 */
export function isTranslateCreditsEnabled(): boolean {
  const w = getWorkerBindingMeta('TRANSLATE_CREDITS_ENABLED');
  const raw = (w.value || process.env.TRANSLATE_CREDITS_ENABLED || '')
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function getTranslateCreditsPerPage(): number {
  const w = getWorkerBindingMeta('TRANSLATE_CREDITS_PER_PAGE');
  const raw = (w.value || process.env.TRANSLATE_CREDITS_PER_PAGE || '10').trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** 为 true 时：成功回调若无 FC 页数字段则不扣积分，仅写 billing_error */
export function isTranslateBillingRequireFcPageCount(): boolean {
  const w = getWorkerBindingMeta('TRANSLATE_BILLING_REQUIRE_FC_PAGE_COUNT');
  const raw = (
    w.value ||
    process.env.TRANSLATE_BILLING_REQUIRE_FC_PAGE_COUNT ||
    ''
  )
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/** 仅从回调 body 解析 FC 显式页数；无则 null（区别于估算） */
export function pickFcPageCountFromCallback(body: {
  translated_page_count?: unknown;
  page_count?: unknown;
  pages?: unknown;
}): number | null {
  const pick = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1) {
      return Math.floor(v);
    }
    if (typeof v === 'string' && v.trim() !== '') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 1) return n;
    }
    return null;
  };
  return (
    pick(body.translated_page_count) ??
    pick(body.page_count) ??
    pick(body.pages)
  );
}

/**
 * 回调中计算实际扣费页数：优先 FC 回传的页数字段。
 */
export function resolveBillablePagesFromCallback(
  body: {
    translated_page_count?: unknown;
    page_count?: unknown;
    pages?: unknown;
  },
  taskPageRange: string | null | undefined,
  documentPageCount: number | null | undefined
): number {
  const fromFc = pickFcPageCountFromCallback(body);
  if (fromFc != null) {
    if (documentPageCount != null && documentPageCount > 0) {
      return Math.min(fromFc, documentPageCount);
    }
    return fromFc;
  }
  return estimateTranslatedPages(taskPageRange, documentPageCount);
}
