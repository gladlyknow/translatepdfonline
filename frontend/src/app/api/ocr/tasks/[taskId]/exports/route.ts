import { and, eq } from 'drizzle-orm';

import { translationTasks } from '@/config/db/schema';
import { db } from '@/core/db';
import { getTranslateAuth } from '@/app/api/translate/auth';
import {
  findExportByTaskFormat,
  isOcrTaskExportFormat,
  listExportsForTask,
  OcrTaskExportStatus,
} from '@/shared/models/ocr_task_export';
import { createPresignedGet, isR2Configured } from '@/shared/lib/translate-r2';
import { retryOcrTaskExport } from '@/shared/lib/ocr-export-queue';
import { sendOcrExportQueueMessage } from '@/shared/lib/ocr-queue';

function parseLogLines(raw: string | null | undefined, maxLines = 80): string[] {
  if (!raw?.trim()) return [];
  return raw
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .slice(-maxLines);
}

export async function GET(
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

    const url = new URL(req.url);
    const downloadUrlOnly = url.searchParams.get('downloadUrl') === '1';
    const format = (url.searchParams.get('format') || '').toLowerCase();
    if (downloadUrlOnly) {
      if (!isOcrTaskExportFormat(format)) {
        return Response.json({ detail: 'invalid format' }, { status: 400 });
      }
      if (!(await isR2Configured())) {
        return Response.json({ detail: 'Storage not configured' }, { status: 503 });
      }
      const row = await findExportByTaskFormat(taskId, format);
      if (!row || row.status !== OcrTaskExportStatus.ready || !row.r2Key) {
        return Response.json({ detail: 'export not ready' }, { status: 404 });
      }
      const fileName = format === 'pdf' ? 'translation.pdf' : 'translation.md';
      const downloadUrl = await createPresignedGet(row.r2Key, 900, {
        responseContentDisposition: `attachment; filename="${fileName}"`,
      });
      return Response.json({
        format,
        status: row.status,
        download_url: downloadUrl,
      });
    }

    const rows = await listExportsForTask(taskId);
    return Response.json({
      exports: rows.map((r: (typeof rows)[number]) => ({
        id: r.id,
        task_id: r.taskId,
        format: r.format,
        status: r.status,
        error_message: r.errorMessage,
        created_at: r.createdAt?.toISOString?.() ?? r.createdAt,
        updated_at: r.updatedAt?.toISOString?.() ?? r.updatedAt,
        ready_at: r.readyAt?.toISOString?.() ?? r.readyAt ?? null,
        logs: parseLogLines(r.log),
      })),
    });
  } catch (e) {
    console.error('[ocr/exports GET]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Failed to load exports' },
      { status: 500 }
    );
  }
}

export async function POST(
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
    const body = (await req.json()) as { format?: string };
    const format = String(body.format || '').trim().toLowerCase();
    if (!isOcrTaskExportFormat(format)) {
      return Response.json({ detail: 'invalid format' }, { status: 400 });
    }
    const exportId = await retryOcrTaskExport(taskId, format);
    if (!exportId) {
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }
    const queued = await sendOcrExportQueueMessage({
      taskId,
      exportId,
      format,
    });
    if (!queued.ok) {
      return Response.json({ detail: 'Export queue unavailable' }, { status: 503 });
    }
    return Response.json({
      ok: true,
      export_id: exportId,
      format,
      status: OcrTaskExportStatus.pending,
    });
  } catch (e) {
    console.error('[ocr/exports POST]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Failed to start export' },
      { status: 500 }
    );
  }
}
