import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks, documents } from '@/config/db/schema';
import { getTranslateAuth } from '../../translate/auth';

export async function GET(
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
    return Response.json({
      id: task.id,
      document_id: task.documentId,
      source_lang: task.sourceLang,
      target_lang: task.targetLang,
      page_range: task.pageRange,
      page_range_user_input: task.pageRangeUserInput ?? null,
      status: task.status,
      created_at: task.createdAt?.toISOString?.() ?? task.createdAt,
      updated_at: task.updatedAt?.toISOString?.() ?? task.updatedAt,
      error_code: task.errorCode,
      error_message: task.errorMessage,
      progress_percent: task.progressPercent,
      progress_stage: task.progressStage,
      progress_current: task.progressCurrent,
      progress_total: task.progressTotal,
    });
  } catch (e) {
    console.error('get task failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Get failed' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
    await db().delete(translationTasks).where(eq(translationTasks.id, taskId));
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error('delete task failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Delete failed' },
      { status: 500 }
    );
  }
}
