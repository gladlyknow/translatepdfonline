/**
 * POST /api/v1/translate — 对外公开的稳定翻译 API 端点。
 * 认证：API Key（Bearer token 或 X-API-Key header）。
 * 翻译引擎：OCR 流水线。
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

export async function POST(req: Request) {
  const startTime = Date.now();

  // 1. API Key 认证 + 限流
  const guard = await guardApikeyRequest(req);
  if (!guard.ok) return guard.response;

  const { apikeyId, userId, rateCheck } = guard;

  try {
    // 2. 参数校验
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ detail: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateTranslateParams(body);
    if (!validation.ok) return validation.error;

    const { documentId, sourceLang, targetLang, pageRange, sourceSliceObjectKey, preprocessWithOcr } = validation.params;

    // 3. 文档查找
    const doc = await lookupDocument(documentId, userId);
    if (!doc) {
      void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/translate', method: 'POST', statusCode: 404, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: 'Document not found' }, { status: 404 });
    }

    const docPages = doc.pageCount ?? null;

    // 4. Page range
    const rangeResult = preparePageRange(pageRange, docPages);
    if (pageRange != null && docPages != null && docPages > 0 && rangeResult.effective === null) {
      return Response.json({
        detail: `The selected page range does not overlap with this document (${docPages} page(s)).`,
        code: 'page_range_no_overlap',
        document_page_count: docPages,
      }, { status: 400 });
    }
    const effectiveRange = rangeResult.effective;

    // 5. 积分检查
    const creditCheck = await checkCreditsForTranslate(userId, effectiveRange, docPages);
    if (!creditCheck.allowed) return creditCheck.error;

    // 6. 创建翻译任务
    const taskId = makeTaskId();
    try {
      await insertTranslationTask({
        taskId,
        userId,
        anonId: null,
        documentId,
        sourceLang,
        targetLang,
        pageRange: effectiveRange,
        pageRangeUserInput: rangeResult.userInputToStore,
        sourceSliceObjectKey,
        preprocessWithOcr,
        creditsEstimated: creditCheck.creditsNeeded,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/translate', method: 'POST', statusCode: 500, creditsConsumed: 0, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: msg || 'Failed to create translation task' }, { status: 500 });
    }

    // 7. 触发 OCR 队列调度（动态 import，避免模块加载失败阻塞路由）
    try {
      const { dispatchPendingOcrJobs, ocrDispatchBatchSize, scheduleOcrDispatchInBackground } =
        await import('@/shared/lib/ocr-queue');
      scheduleOcrDispatchInBackground(() => dispatchPendingOcrJobs(ocrDispatchBatchSize()));
    } catch {
      // 队列调度失败不阻塞
    }

    // 8. 记录用量
    void logApiUsage({
      apikeyId,
      userId,
      taskId,
      endpoint: '/api/v1/translate',
      method: 'POST',
      statusCode: 200,
      creditsConsumed: creditCheck.creditsNeeded,
      ipAddress: req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
      responseTimeMs: Date.now() - startTime,
    });

    // 9. 返回
    return withRateLimitHeaders(
      Response.json({
        task_id: taskId,
        status: 'queued',
        page_range_effective: effectiveRange,
        credits_estimated: creditCheck.creditsNeeded,
      }),
      rateCheck,
    );
  } catch (e) {
    console.error('[v1/translate]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
