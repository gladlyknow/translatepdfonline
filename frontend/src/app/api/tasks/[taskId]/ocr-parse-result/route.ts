import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks } from '@/config/db/schema';
import { getTranslateAuth } from '../../../translate/auth';
import { putObject } from '@/shared/lib/translate-r2';

/**
 * 将用户编辑后的 OCR ParseResult JSON 写回 R2（与管线产物同键）。
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { userId, anonId } = await getTranslateAuth();
    const where = userId
      ? eq(translationTasks.userId, userId)
      : eq(translationTasks.anonId, anonId);
    const [task] = await db()
      .select()
      .from(translationTasks)
      .where(and(eq(translationTasks.id, taskId), where));
    if (!task) {
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }
    if (!task.preprocessWithOcr) {
      return Response.json({ detail: 'Not an OCR task' }, { status: 400 });
    }
    const raw = await req.json().catch(() => null);
    if (raw == null || typeof raw !== 'object') {
      return Response.json({ detail: 'Expected JSON object body' }, { status: 400 });
    }
    const key = `translations/${taskId}/ocr-parse-result.json`;
    const body = new TextEncoder().encode(JSON.stringify(raw, null, 2));
    await putObject(key, body, 'application/json; charset=utf-8');
    await db()
      .update(translationTasks)
      .set({ updatedAt: new Date() })
      .where(eq(translationTasks.id, taskId));
    return Response.json({ ok: true, object_key: key });
  } catch (e) {
    console.error('patch ocr-parse-result failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Save failed' },
      { status: 500 }
    );
  }
}
