/**
 * API Key 速率限制 — 按 API Key 每分钟限流。
 * 查询近 60 秒同 API Key 的 api_usage_log 计数判断是否超限。
 */
import { db } from '@/core/db';
import { apiUsageLog } from '@/config/db/schema';
import { count, gte, and, eq } from 'drizzle-orm';

const DEFAULT_RPM = 60;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
};

export async function checkRateLimit(
  apikeyId: string,
): Promise<RateLimitResult> {
  const rpmRaw = process.env.APIKEY_RATE_LIMIT_RPM || String(DEFAULT_RPM);
  const limit = parseInt(rpmRaw, 10) || DEFAULT_RPM;
  const since = new Date(Date.now() - 60_000);

  const [result] = await db()
    .select({ total: count() })
    .from(apiUsageLog)
    .where(
      and(
        eq(apiUsageLog.apikeyId, apikeyId),
        gte(apiUsageLog.createdAt, since),
      ),
    );

  const currentCount = result?.total ?? 0;
  const allowed = currentCount < limit;

  return {
    allowed,
    remaining: Math.max(0, limit - currentCount),
    limit,
  };
}
