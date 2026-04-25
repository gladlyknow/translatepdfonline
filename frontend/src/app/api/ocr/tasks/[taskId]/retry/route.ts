import { retryOcrTaskFromFailedStage } from '@/shared/lib/ocr-queue';
import { db } from '@/core/db';
import { translationTasks } from '@/config/db/schema';
import { and, eq } from 'drizzle-orm';
import { getTranslateAuth } from '../../../../translate/auth';

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
      .select({ id: translationTasks.id })
      .from(translationTasks)
      .where(and(eq(translationTasks.id, taskId), where))
      .limit(1);
    if (!task) {
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }

    const result = await retryOcrTaskFromFailedStage(taskId);
    if (!result.ok) {
      return Response.json(
        { detail: 'Task is not retryable from failed/cancelled stage' },
        { status: 400 }
      );
    }
    return Response.json({
      ok: true,
      task_id: taskId,
      resume_stage: result.resumeStage ?? null,
    });
  } catch (e) {
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Retry OCR task failed' },
      { status: 500 }
    );
  }
}

