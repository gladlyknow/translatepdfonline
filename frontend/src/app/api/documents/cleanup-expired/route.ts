import { lt, inArray, count } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';

/**
 * POST /api/documents/cleanup-expired
 * Deletes documents with expiresAt < now() and their translation_tasks.
 * Intended for cron only. Requires header x-cron-secret to match CRON_SECRET env.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { detail: 'Cleanup not configured (CRON_SECRET missing)' },
      { status: 503 }
    );
  }
  const provided = req.headers.get('x-cron-secret');
  if (provided !== secret) {
    return Response.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const expired = await db()
      .select({ id: documents.id })
      .from(documents)
      .where(lt(documents.expiresAt, now));
    const ids = expired.map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      return Response.json({ deleted_documents: 0, deleted_tasks: 0 });
    }

    const [{ count: taskCount }] = await db()
      .select({ count: count() })
      .from(translationTasks)
      .where(inArray(translationTasks.documentId, ids));
    await db()
      .delete(translationTasks)
      .where(inArray(translationTasks.documentId, ids));
    await db()
      .delete(documents)
      .where(inArray(documents.id, ids));

    return Response.json({
      deleted_documents: ids.length,
      deleted_tasks: taskCount ?? 0,
    });
  } catch (e) {
    console.error('cleanup-expired failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Cleanup failed' },
      { status: 500 }
    );
  }
}
