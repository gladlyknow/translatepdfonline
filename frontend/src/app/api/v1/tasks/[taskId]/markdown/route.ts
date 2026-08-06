/**
 * GET /api/v1/tasks/[taskId]/markdown — API Key 获取 OCR 任务的 Markdown 导出。
 * 认证：API Key（Bearer token 或 X-API-Key header）。
 * 仅支持 preprocess_with_ocr=true 的任务。
 */
import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks } from '@/config/db/schema';
import { guardApikeyRequest, withRateLimitHeaders } from '@/shared/lib/apikey-guard';
import { logApiUsage } from '@/shared/lib/api-usage-log';
import { getOcrParseResultBodyForRead } from '@/shared/lib/ocr-parse-result-r2-keys';
import { isR2Configured } from '@/shared/lib/translate-r2';
import { buildMarkdownExportWithAssets } from '@/shared/ocr-workbench/parse-result-export-md';
import { parseParseResultJson } from '@/shared/ocr-workbench/translator-parse-result';

export const maxDuration = 300;

function markdownObjectKey(
  taskId: string,
  sourceLang: string,
  targetLang: string,
): string {
  const same = sourceLang.trim().toLowerCase() === targetLang.trim().toLowerCase();
  return same
    ? `translations/${taskId}/ocr-source.md`
    : `translations/${taskId}/ocr-translated.md`;
}

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

  try {
    // 2. 查询任务（按 userId 归属过滤 — 安全边界，必须在 R2 读取前）
    const [task] = await db()
      .select({
        id: translationTasks.id,
        preprocessWithOcr: translationTasks.preprocessWithOcr,
        sourceLang: translationTasks.sourceLang,
        targetLang: translationTasks.targetLang,
        updatedAt: translationTasks.updatedAt,
      })
      .from(translationTasks)
      .where(and(eq(translationTasks.id, taskId), eq(translationTasks.userId, userId)))
      .limit(1);

    if (!task) {
      void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/tasks/[taskId]/markdown', method: 'GET', statusCode: 404, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }

    if (!task.preprocessWithOcr) {
      void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/tasks/[taskId]/markdown', method: 'GET', statusCode: 400, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: 'Not an OCR task' }, { status: 400 });
    }

    if (!(await isR2Configured())) {
      void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/tasks/[taskId]/markdown', method: 'GET', statusCode: 503, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: 'Storage not configured' }, { status: 503 });
    }

    // 3. 读取 OCR parse result JSON
    const key = markdownObjectKey(taskId, task.sourceLang, task.targetLang);
    let bytes: Uint8Array;
    try {
      bytes = await getOcrParseResultBodyForRead(taskId, task.sourceLang, task.targetLang);
    } catch {
      void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/tasks/[taskId]/markdown', method: 'GET', statusCode: 404, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: 'parse result not available' }, { status: 404 });
    }

    // 4. 解析 JSON
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch {
      void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/tasks/[taskId]/markdown', method: 'GET', statusCode: 500, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: 'invalid parse result JSON' }, { status: 500 });
    }

    const parsed = parseParseResultJson(raw);
    if (!parsed.ok) {
      void logApiUsage({ apikeyId, userId, taskId, endpoint: '/api/v1/tasks/[taskId]/markdown', method: 'GET', statusCode: 500, responseTimeMs: Date.now() - startTime });
      return Response.json({ detail: `invalid parse result: ${parsed.error}` }, { status: 500 });
    }

    // 5. 构建 Markdown
    const { markdown } = await buildMarkdownExportWithAssets(parsed.data, `ocr-${taskId}`);

    // 6. 记录用量
    void logApiUsage({
      apikeyId,
      userId,
      taskId,
      endpoint: '/api/v1/tasks/[taskId]/markdown',
      method: 'GET',
      statusCode: 200,
      ipAddress: req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
      responseTimeMs: Date.now() - startTime,
    });

    // 7. 返回
    return withRateLimitHeaders(
      Response.json({
        markdown,
        object_key: key,
        source: 'parse_result_rebuild',
        updated_at: task.updatedAt?.toISOString?.() ?? task.updatedAt,
      }),
      rateCheck,
    );
  } catch (e) {
    console.error('[v1/tasks/markdown GET]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'error' },
      { status: 500 },
    );
  }
}
