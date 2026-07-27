/**
 * API Key 验证模块 — 从 Request 提取并验证 API Key。
 * 支持 Authorization: Bearer <key> 和 X-API-Key: <key> 两种方式。
 */
import { db } from '@/core/db';
import { apikey } from '@/config/db/schema';
import { eq, and } from 'drizzle-orm';
import { ApikeyStatus } from '@/shared/models/apikey';

export type ApikeyAuthResult =
  | { authenticated: false; error: string }
  | { authenticated: true; apikeyId: string; userId: string };

export async function authenticateWithApikey(
  req: Request,
): Promise<ApikeyAuthResult> {
  const authHeader = req.headers.get('Authorization') || '';
  let key = '';

  if (authHeader.startsWith('Bearer ')) {
    key = authHeader.slice(7).trim();
  } else {
    key = req.headers.get('X-API-Key') || '';
  }

  if (!key) {
    return {
      authenticated: false,
      error: 'Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header.',
    };
  }

  const [row] = await db()
    .select({ id: apikey.id, userId: apikey.userId })
    .from(apikey)
    .where(and(eq(apikey.key, key), eq(apikey.status, ApikeyStatus.ACTIVE)))
    .limit(1);

  if (!row) {
    return { authenticated: false, error: 'Invalid or inactive API key.' };
  }

  // fire-and-forget: update last_used_at
  db()
    .update(apikey)
    .set({ lastUsedAt: new Date() } as any)
    .where(eq(apikey.id, row.id))
    .then(() => {})
    .catch(() => {});

  return { authenticated: true, apikeyId: row.id, userId: row.userId };
}
