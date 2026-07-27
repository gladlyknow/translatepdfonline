/**
 * API 调用日志记录（fire-and-forget，不阻塞主流程）。
 */
import { db } from '@/core/db';
import { apiUsageLog } from '@/config/db/schema';
import { getUuid } from '@/shared/lib/hash';

export type UsageLogParams = {
  apikeyId: string;
  userId: string;
  taskId?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  creditsConsumed?: number;
  ipAddress?: string;
  userAgent?: string;
  responseTimeMs?: number;
};

export async function logApiUsage(params: UsageLogParams): Promise<void> {
  try {
    await db().insert(apiUsageLog).values({
      id: getUuid(),
      apikeyId: params.apikeyId,
      userId: params.userId,
      taskId: params.taskId ?? null,
      endpoint: params.endpoint,
      method: params.method,
      statusCode: params.statusCode,
      creditsConsumed: params.creditsConsumed ?? 0,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      responseTimeMs: params.responseTimeMs ?? null,
    });
  } catch (e) {
    console.error('[api-usage-log] failed:', e);
  }
}
