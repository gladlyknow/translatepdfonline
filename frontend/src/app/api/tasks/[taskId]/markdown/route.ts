import { and, eq } from 'drizzle-orm';

import { translationTasks } from '@/config/db/schema';
import { db } from '@/core/db';
import { getTranslateAuth } from '@/app/api/translate/auth';
import { getObjectBody, isR2Configured, putObject } from '@/shared/lib/translate-r2';

export const maxDuration = 300;

function markdownObjectKey(
  taskId: string,
  sourceLang: string,
  targetLang: string
): string {
  const same =
    sourceLang.trim().toLowerCase() === targetLang.trim().toLowerCase();
  return same
    ? `translations/${taskId}/ocr-source.md`
    : `translations/${taskId}/ocr-translated.md`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { userId, anonId } = await getTranslateAuth();
    const ownerWhere = userId
      ? eq(translationTasks.userId, userId)
      : eq(translationTasks.anonId, anonId);
    const [task] = await db()
      .select({
        id: translationTasks.id,
        preprocessWithOcr: translationTasks.preprocessWithOcr,
        sourceLang: translationTasks.sourceLang,
        targetLang: translationTasks.targetLang,
        updatedAt: translationTasks.updatedAt,
      })
      .from(translationTasks)
      .where(and(eq(translationTasks.id, taskId), ownerWhere))
      .limit(1);
    if (!task) {
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }
    if (!task.preprocessWithOcr) {
      return Response.json({ detail: 'Not an OCR task' }, { status: 400 });
    }
    if (!(await isR2Configured())) {
      return Response.json({ detail: 'Storage not configured' }, { status: 503 });
    }
    const key = markdownObjectKey(taskId, task.sourceLang, task.targetLang);
    let md: string;
    try {
      const bytes = await getObjectBody(key);
      md = new TextDecoder('utf-8').decode(bytes);
    } catch {
      return Response.json({ detail: 'markdown not available' }, { status: 404 });
    }
    return Response.json({
      markdown: md,
      object_key: key,
      updated_at: task.updatedAt?.toISOString?.() ?? task.updatedAt,
    });
  } catch (e) {
    console.error('[tasks/markdown GET]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { userId, anonId } = await getTranslateAuth();
    const ownerWhere = userId
      ? eq(translationTasks.userId, userId)
      : eq(translationTasks.anonId, anonId);
    const [task] = await db()
      .select({
        id: translationTasks.id,
        preprocessWithOcr: translationTasks.preprocessWithOcr,
        sourceLang: translationTasks.sourceLang,
        targetLang: translationTasks.targetLang,
      })
      .from(translationTasks)
      .where(and(eq(translationTasks.id, taskId), ownerWhere))
      .limit(1);
    if (!task) {
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }
    if (!task.preprocessWithOcr) {
      return Response.json({ detail: 'Not an OCR task' }, { status: 400 });
    }
    if (!(await isR2Configured())) {
      return Response.json({ detail: 'Storage not configured' }, { status: 503 });
    }

    const payload = (await req.json()) as { markdown?: string };
    if (typeof payload.markdown !== 'string') {
      return Response.json({ detail: 'markdown string required' }, { status: 400 });
    }

    const key = markdownObjectKey(taskId, task.sourceLang, task.targetLang);
    await putObject(
      key,
      new TextEncoder().encode(payload.markdown),
      'text/markdown; charset=utf-8'
    );
    await db()
      .update(translationTasks)
      .set({ updatedAt: new Date() })
      .where(eq(translationTasks.id, taskId));

    return Response.json({ ok: true, object_key: key });
  } catch (e) {
    console.error('[tasks/markdown PATCH]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'error' },
      { status: 500 }
    );
  }
}
