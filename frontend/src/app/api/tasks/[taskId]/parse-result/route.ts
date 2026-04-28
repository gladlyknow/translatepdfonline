import { and, eq } from 'drizzle-orm';

import { translationTasks } from '@/config/db/schema';
import { db } from '@/core/db';
import { getTranslateAuth } from '@/app/api/translate/auth';
import { rewriteExternalImagesToR2 } from '@/shared/lib/ocr-parse-result-image-proxy';
import { getObjectBody, isR2Configured, putObject } from '@/shared/lib/translate-r2';

export const maxDuration = 300;

const PARSE_KEY = (taskId: string) => `translations/${taskId}/ocr-parse-result.json`;

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
    let raw: unknown;
    try {
      const bytes = await getObjectBody(PARSE_KEY(taskId));
      raw = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch {
      return Response.json({ detail: 'Parse result not found' }, { status: 404 });
    }
    if (!raw || typeof raw !== 'object') {
      return Response.json({ detail: 'Invalid parse result' }, { status: 500 });
    }
    return Response.json(raw);
  } catch (e) {
    console.error('[tasks/parse-result GET]', e);
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
      .select({ id: translationTasks.id, preprocessWithOcr: translationTasks.preprocessWithOcr })
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ detail: 'Expected JSON body' }, { status: 400 });
    }
    if (body === null || typeof body !== 'object') {
      return Response.json({ detail: 'Expected JSON object body' }, { status: 400 });
    }

    const json = body as Record<string, unknown>;
    try {
      await rewriteExternalImagesToR2({ json, taskId, maxConcurrent: 5 });
    } catch (e) {
      console.warn('[tasks/parse-result PATCH] rewrite images', e);
    }

    const key = PARSE_KEY(taskId);
    const encoded = new TextEncoder().encode(JSON.stringify(json, null, 2));
    await putObject(key, encoded, 'application/json; charset=utf-8');
    await db()
      .update(translationTasks)
      .set({ updatedAt: new Date() })
      .where(eq(translationTasks.id, taskId));

    return Response.json({ ok: true, object_key: key });
  } catch (e) {
    console.error('[tasks/parse-result PATCH]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Save failed' },
      { status: 500 }
    );
  }
}
