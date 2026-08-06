/**
 * POST /api/v1/ocr — API Key 创建 OCR 翻译任务。
 * 认证：API Key（Bearer token 或 X-API-Key header）。
 * 功能与 /api/v1/translate 完全相同，使用不同路径避免 CF 308 重定向问题。
 */
import { guardApikeyRequest, withRateLimitHeaders } from '@/shared/lib/apikey-guard';
import { logApiUsage } from '@/shared/lib/api-usage-log';
import {
  validateTranslateParams,
  lookupDocument,
  preparePageRange,
  checkCreditsForTranslate,
  insertTranslationTask,
  makeTaskId,
} from '@/shared/lib/translate-core';
import {
  dispatchPendingOcrJobs,
  ocrDispatchBatchSize,
  scheduleOcrDispatchInBackground,
} from '@/shared/lib/ocr-queue';

export async function POST(req: Request) {
  const startTime = Date.now();

  const guard = await guardApikeyRequest(req);
  if (!guard.ok) return guard.response;

  const { apikeyId, userId, rateCheck } = guard;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ detail: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateTranslateParams(body);
    if (!validation.ok) return validation.error;

    const { documentId, sourceLang, targetLang, pageRange, sourceSliceObjectKey, preprocessWithOcr } = validation.params;

    const doc = await lookupDocument(documentId, userId);
    if (!doc) {
      void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/ocr', method: 'POST', statusCode: 404, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: 'Document not found' }, { status: 404 });
    }

    const docPages = doc.pageCount ?? null;
    const rangeResult = preparePageRange(pageRange, docPages);
    if (pageRange != null && docPages != null && docPages > 0 && rangeResult.effective === null) {
      return Response.json({
        detail: `The selected page range does not overlap with this document (${docPages} page(s)).`,
        code: 'page_range_no_overlap',
        document_page_count: docPages,
      }, { status: 400 });
    }
    const effectiveRange = rangeResult.effective;

    const creditCheck = await checkCreditsForTranslate(userId, effectiveRange, docPages);
    if (!creditCheck.allowed) return creditCheck.error;

    const taskId = makeTaskId();
    try {
      await insertTranslationTask({
        taskId, userId, anonId: null, documentId,
        sourceLang, targetLang,
        pageRange: effectiveRange,
        pageRangeUserInput: rangeResult.userInputToStore,
        sourceSliceObjectKey, preprocessWithOcr,
        creditsEstimated: creditCheck.creditsNeeded,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/ocr', method: 'POST', statusCode: 500, creditsConsumed: 0, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: msg || 'Failed to create translation task' }, { status: 500 });
    }

    try {
      scheduleOcrDispatchInBackground(() => dispatchPendingOcrJobs(ocrDispatchBatchSize()));
    } catch { /* non-blocking */ }

    void logApiUsage({
      apikeyId, userId, taskId,
      endpoint: '/api/v1/ocr', method: 'POST', statusCode: 200,
      creditsConsumed: creditCheck.creditsNeeded,
      ipAddress: req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
      responseTimeMs: Date.now() - startTime,
    });

    return withRateLimitHeaders(
      Response.json({
        task_id: taskId, status: 'queued',
        page_range_effective: effectiveRange,
        credits_estimated: creditCheck.creditsNeeded,
      }),
      rateCheck,
    );
  } catch (e) {
    console.error('[v1/ocr]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
