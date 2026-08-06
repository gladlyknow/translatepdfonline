/**
 * POST /api/v1/upload/presigned — API Key 预签名上传 URL。
 * 认证：API Key（Bearer token 或 X-API-Key header）。
 */
import { nanoid } from 'nanoid';
import { createPresignedPut, isR2Configured } from '@/shared/lib/translate-r2';
import { guardApikeyRequest, withRateLimitHeaders } from '@/shared/lib/apikey-guard';
import { logApiUsage } from '@/shared/lib/api-usage-log';
import {
  ALLOWED_CONTENT_TYPE,
  MAX_PDF_BYTES,
  UPLOAD_KEY_PREFIX,
  UPLOAD_KEY_SUFFIX,
} from '@/app/api/upload/constants';

export async function POST(req: Request) {
  const startTime = Date.now();

  // 1. API Key 认证 + 限流
  const guard = await guardApikeyRequest(req);
  if (!guard.ok) return guard.response;

  const { apikeyId, userId, rateCheck } = guard;

  // 2. R2 配置检查
  if (!(await isR2Configured())) {
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned', method: 'POST', statusCode: 503, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: 'Upload storage not configured' }, { status: 503 });
  }

  // 3. 参数校验
  let body: any;
  try {
    body = await req.json();
  } catch {
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned', method: 'POST', statusCode: 400, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  const sizeBytes = Number(body.size_bytes) || 0;
  if (sizeBytes <= 0 || sizeBytes > MAX_PDF_BYTES) {
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned', method: 'POST', statusCode: 400, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: 'Invalid size: must be between 1 and 100 MB' }, { status: 400 });
  }

  const contentType = typeof body.content_type === 'string' ? body.content_type.trim() : '';
  if (contentType !== ALLOWED_CONTENT_TYPE) {
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned', method: 'POST', statusCode: 400, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: 'Only application/pdf is allowed' }, { status: 400 });
  }

  // 4. 生成预签名上传 URL
  const objectKey = `${UPLOAD_KEY_PREFIX}${nanoid(16)}${UPLOAD_KEY_SUFFIX}`;
  let uploadUrl: string;
  try {
    uploadUrl = await createPresignedPut(objectKey, ALLOWED_CONTENT_TYPE, 600);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logApiUsage({ apikeyId, userId, endpoint: '/api/v1/upload/presigned', method: 'POST', statusCode: 500, responseTimeMs: Date.now() - startTime });
    return Response.json({ detail: msg || 'Failed to create upload URL' }, { status: 500 });
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // 5. 记录用量
  void logApiUsage({
    apikeyId,
    userId,
    endpoint: '/api/v1/upload/presigned',
    method: 'POST',
    statusCode: 200,
    ipAddress: req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
    responseTimeMs: Date.now() - startTime,
  });

  // 6. 返回
  return withRateLimitHeaders(
    Response.json({ upload_url: uploadUrl, object_key: objectKey, expires_at: expiresAt }),
    rateCheck,
  );
}
