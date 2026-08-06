/**
 * API Key 守卫 — 认证 + 限流二合一，供 v1 API 端点复用。
 * 所有 v1 端点统一使用此模块，保持与 POST /api/v1/translate 一致的认证/限流行为。
 */
import { authenticateWithApikey } from '@/shared/lib/apikey-auth';
import { checkRateLimit, type RateLimitResult } from '@/shared/lib/apikey-rate-limit';

export type { RateLimitResult } from '@/shared/lib/apikey-rate-limit';

export type ApikeyGuardOk = {
  ok: true;
  apikeyId: string;
  userId: string;
  rateCheck: RateLimitResult;
};

export type ApikeyGuardResult =
  | ApikeyGuardOk
  | { ok: false; response: Response };

/**
 * 执行 API Key 认证 + 限流检查。
 * 认证失败返回 401，限流超限返回 429。
 * 注意：此函数不写 usage log（由各端点自行调用 logApiUsage）。
 */
export async function guardApikeyRequest(
  req: Request,
): Promise<ApikeyGuardResult> {
  // 1. API Key 认证
  const auth = await authenticateWithApikey(req);
  if (!auth.authenticated) {
    return {
      ok: false,
      response: Response.json(
        { error: auth.error, code: 'unauthorized' },
        { status: 401 },
      ),
    };
  }

  // 2. Rate limiting
  const rateCheck = await checkRateLimit(auth.apikeyId);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Rate limit exceeded. Try again shortly.', code: 'rate_limited' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(rateCheck.limit),
            'X-RateLimit-Remaining': String(rateCheck.remaining),
          },
        },
      ),
    };
  }

  return {
    ok: true,
    apikeyId: auth.apikeyId,
    userId: auth.userId,
    rateCheck,
  };
}

/**
 * 给成功响应附加 X-RateLimit-* 头。
 * 用法：withRateLimitHeaders(Response.json(data), rateCheck)
 *       或 withRateLimitHeaders(new Response(...), rateCheck)
 */
export function withRateLimitHeaders(
  response: Response,
  rateCheck: RateLimitResult,
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Limit', String(rateCheck.limit));
  headers.set('X-RateLimit-Remaining', String(rateCheck.remaining));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
