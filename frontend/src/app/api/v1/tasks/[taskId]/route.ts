/**
 * GET /api/v1/tasks/[taskId] — API Key 查询翻译/OCR 任务状态。
 * 认证：API Key（Bearer token 或 X-API-Key header）。
 */
import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks } from '@/config/db/schema';
import { guardApikeyRequest, withRateLimitHeaders } from '@/shared/lib/apikey-guard';
import { logApiUsage } from '@/shared/lib/api-usage-log';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const startTime = Date.now();

  // 1. API Key 认证 + 限流
  const guard = await guardApikeyRequest(req);
  if (!guard.ok) return guard.response;

  const { apikeyId, userId, rateCheck } = guard;
  const { taskId } = await params;

  // 2. 查询任务（按 userId 归属过滤）
  let task: typeof translationTasks.$inferSelect | undefined;
  try {
    [task] = await db()
      .select()
      .from(translationTasks)
      .where(and(eq(translationTasks.id, taskId), eq(translationTasks.userId, userId)))
      .limit(1);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/tasks/[taskId]', method: 'GET', statusCode: 500, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: msg || 'Query failed' }, { status: 500 });
  }

  if (!task) {
    void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/tasks/[taskId]', method: 'GET', statusCode: 404, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: 'Task not found' }, { status: 404 });
  }

  // 3. 记录用量
  void logApiUsage({
    apikeyId,
    userId,
    taskId,
    endpoint: '/api/v1/tasks/[taskId]',
    method: 'GET',
    statusCode: 200,
    ipAddress: req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
    responseTimeMs: Date.now() - startTime,
  });

  // 4. 返回
  return withRateLimitHeaders(
    Response.json({
      id: task.id,
      document_id: task.documentId,
      source_lang: task.sourceLang,
      target_lang: task.targetLang,
      page_range: task.pageRange,
      page_range_user_input: task.pageRangeUserInput ?? null,
      status: task.status,
      created_at: task.createdAt?.toISOString?.() ?? task.createdAt,
      updated_at: task.updatedAt?.toISOString?.() ?? task.updatedAt,
      error_code: task.errorCode,
      error_message: task.errorMessage,
      post_complete_hint: task.postCompleteHint ?? null,
      progress_percent: task.progressPercent,
      progress_stage: task.progressStage,
      progress_current: task.progressCurrent,
      progress_total: task.progressTotal,
      preprocess_with_ocr: task.preprocessWithOcr,
    }),
    rateCheck,
  );
}
