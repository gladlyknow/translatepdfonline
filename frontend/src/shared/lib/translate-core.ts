/**
 * 翻译核心逻辑 — OCR 翻译流程的公共函数。
 * 供 /api/translate、/api/ocr/tasks、/api/v1/translate 复用。
 */
import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { isSupportedUiLang } from '@/shared/lib/translate-langs';
import {
  estimateTranslatedPages,
  getTranslateCreditsPerPage,
  intersectPageRangeWithDocument,
  isTranslateCreditsEnabled,
  normalizePageRangeInput,
  parseTranslatePageRange,
} from '@/shared/lib/translate-billing';
import { getRemainingCredits } from '@/shared/models/credit';
import { nanoid } from 'nanoid';

// ── Types ──

export interface TranslateParams {
  documentId: string;
  sourceLang: string;
  targetLang: string;
  pageRange?: string | null;
  sourceSliceObjectKey?: string | null;
  preprocessWithOcr?: boolean;
}

export interface ValidatedParams {
  documentId: string;
  sourceLang: string;
  targetLang: string;
  pageRange: string | null;
  sourceSliceObjectKey: string | null;
  preprocessWithOcr: boolean;
}

export type CreditCheckResult = {
  allowed: true;
  creditsNeeded: number;
  estimatedPages: number;
  perPage: number;
} | {
  allowed: false;
  error: Response;
};

// ── Validation ──

export function validateTranslateParams(body: any): { ok: true; params: ValidatedParams } | { ok: false; error: Response } {
  const documentId = String(body.document_id ?? '').trim();
  if (!documentId) return { ok: false, error: Response.json({ detail: 'document_id required' }, { status: 400 }) };

  const sourceLang = String(body.source_lang ?? 'en').trim().toLowerCase();
  const targetLang = String(body.target_lang ?? 'zh').trim().toLowerCase();
  if (!isSupportedUiLang(sourceLang) || !isSupportedUiLang(targetLang)) {
    return { ok: false, error: Response.json({ detail: 'Unsupported source_lang or target_lang', code: 'invalid_language' }, { status: 400 }) };
  }

  let pageRange = normalizePageRangeInput(body.page_range);
  if (pageRange != null && !parseTranslatePageRange(pageRange)) {
    return { ok: false, error: Response.json({ detail: 'Invalid page_range. Use a single page (e.g. 5) or a range (e.g. 1-10).', code: 'invalid_page_range' }, { status: 400 }) };
  }

  return {
    ok: true,
    params: {
      documentId,
      sourceLang,
      targetLang,
      pageRange,
      sourceSliceObjectKey: body.source_slice_object_key ?? null,
      preprocessWithOcr: Boolean(body.preprocess_with_ocr),
    },
  };
}

// ── Document lookup ──

export async function lookupDocument(documentId: string, userId?: string | null, anonId?: string | null) {
  const where = userId
    ? eq(documents.userId, userId)
    : anonId
      ? eq(documents.anonId, anonId)
      : undefined;
  if (!where) return null;
  const [doc] = await db().select().from(documents).where(and(eq(documents.id, documentId), where));
  return doc ?? null;
}

// ── Page range ──

export function preparePageRange(pageRange: string | null, docPages: number | null): {
  effective: string | null;
  adjusted: boolean;
  userInputToStore: string | null;
} {
  if (pageRange != null && docPages != null && docPages > 0) {
    const hit = intersectPageRangeWithDocument(pageRange, docPages);
    if (!hit.ok) return { effective: null, adjusted: false, userInputToStore: null };
    return { effective: hit.effectiveRange, adjusted: hit.adjusted, userInputToStore: hit.userInputToStore };
  }
  return { effective: pageRange, adjusted: false, userInputToStore: null };
}

// ── Credit check ──

export async function checkCreditsForTranslate(userId: string, pageRange: string | null, docPages: number | null): Promise<CreditCheckResult> {
  if (!isTranslateCreditsEnabled()) return { allowed: true, creditsNeeded: 0, estimatedPages: 0, perPage: 0 };

  const perPage = getTranslateCreditsPerPage();
  const estPages = estimateTranslatedPages(pageRange, docPages);
  const creditsNeeded = estPages * perPage;
  const balance = await getRemainingCredits(userId);

  if (balance < creditsNeeded) {
    return {
      allowed: false,
      error: Response.json({
        detail: `Insufficient credits: need ${creditsNeeded}, have ${balance}.`,
        code: 'insufficient_credits',
        need: creditsNeeded,
        have: balance,
        estimated_pages: estPages,
        credits_per_page: perPage,
      }, { status: 402 }),
    };
  }

  return { allowed: true, creditsNeeded, estimatedPages: estPages, perPage };
}

// ── Task creation ──

export interface CreateTaskParams {
  taskId: string;
  userId: string | null;
  anonId: string | null;
  documentId: string;
  sourceLang: string;
  targetLang: string;
  pageRange: string | null;
  pageRangeUserInput?: string | null;
  sourceSliceObjectKey?: string | null;
  preprocessWithOcr?: boolean;
  creditsEstimated?: number | null;
}

export async function insertTranslationTask(params: CreateTaskParams): Promise<void> {
  await db().insert(translationTasks).values({
    id: params.taskId,
    userId: params.userId ?? null,
    anonId: params.userId ? null : params.anonId,
    documentId: params.documentId,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
    pageRange: params.pageRange,
    pageRangeUserInput: params.pageRangeUserInput ?? null,
    status: 'queued',
    sourceSliceObjectKey: params.sourceSliceObjectKey ?? null,
    preprocessWithOcr: params.preprocessWithOcr ?? false,
    creditsEstimated: params.creditsEstimated ?? undefined,
  });
}

export function makeTaskId(): string {
  return nanoid(21);
}
