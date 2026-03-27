import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks } from '@/config/db/schema';
import { getTranslateAuth } from '../../../translate/auth';

export async function POST(
  _req: Request,
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
    if (task.status === 'completed' || task.status === 'failed') {
      return Response.json({ ok: true, status: task.status });
    }
    await db()
      .update(translationTasks)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(translationTasks.id, taskId));
    return Response.json({ ok: true, status: 'cancelled' });
  } catch (e) {
    console.error('cancel task failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Cancel failed' },
      { status: 500 }
    );
  }
}
