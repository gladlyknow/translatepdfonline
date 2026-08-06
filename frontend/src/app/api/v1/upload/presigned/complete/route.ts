/**
 * POST /api/v1/upload/presigned/complete — API Key 确认预签名上传完成，创建文档记录。
 * 认证：API Key（Bearer token 或 X-API-Key header）。
 */
import { nanoid } from 'nanoid';
import { db } from '@/core/db';
import { documents } from '@/config/db/schema';
import { guardApikeyRequest, withRateLimitHeaders } from '@/shared/lib/apikey-guard';
import { logApiUsage } from '@/shared/lib/api-usage-log';
import { ensureDocumentPageCount } from '@/shared/lib/document-page-count';
import {
  MAX_PDF_BYTES,
  isValidObjectKey,
  sanitizeFilename,
} from '@/app/api/upload/constants';

export async function POST(req: Request) {
  const startTime = Date.now();

  // 1. API Key 认证 + 限流
  const guard = await guardApikeyRequest(req);
  if (!guard.ok) return guard.response;

  const { apikeyId, userId, rateCheck } = guard;

  // 2. 参数校验
  let body: any;
  try {
    body = await req.json();
  } catch {
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned/complete', method: 'POST', statusCode: 400, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  const objectKey = typeof body.object_key === 'string' ? body.object_key.trim() : '';
  if (!objectKey || !isValidObjectKey(objectKey)) {
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned/complete', method: 'POST', statusCode: 400, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: 'Invalid object_key format' }, { status: 400 });
  }

  const sizeBytes = Number(body.size_bytes) || 0;
  if (sizeBytes <= 0 || sizeBytes > MAX_PDF_BYTES) {
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned/complete', method: 'POST', statusCode: 400, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: 'Invalid size: must be between 1 and 100 MB' }, { status: 400 });
  }

  const filename = sanitizeFilename(
    typeof body.filename === 'string' ? body.filename : 'document.pdf',
  );

  // 3. 创建文档记录（userId 来自 API Key 认证）
  const documentId = nanoid(21);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    await db()
      .insert(documents)
      .values({
        id: documentId,
        userId,
        anonId: null,
        objectKey,
        filename,
        sizeBytes,
        status: 'uploaded',
        expiresAt,
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned/complete', method: 'POST', statusCode: 500, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: msg || 'Failed to create document' }, { status: 500 });
  }

  // 4. 获取页数
  const pageCountResult = await ensureDocumentPageCount({
    documentId,
    objectKey,
    knownPageCount: null,
    reason: 'upload_complete',
  });

  // 5. 记录用量
  void logApiUsage({
    apikeyId,
    userId,
    endpoint: '/api/v1/upload/presigned/complete',
    method: 'POST',
    statusCode: 200,
    ipAddress: req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
    responseTimeMs: Date.now() - startTime,
  });

  // 6. 返回
  return withRateLimitHeaders(
    Response.json({
      document_id: documentId,
      page_count: pageCountResult.pageCount,
      page_count_ready: pageCountResult.pageCount != null,
    }),
    rateCheck,
  );
}
