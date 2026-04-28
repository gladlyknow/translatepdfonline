import { and, eq } from 'drizzle-orm';

import { documents, translationTasks } from '@/config/db/schema';
import { db } from '@/core/db';
import { getTranslateAuth } from '@/app/api/translate/auth';
import {
  findExportByTaskFormat,
  isOcrTaskExportFormat,
  OcrTaskExportStatus,
  type OcrTaskExportFormat,
} from '@/shared/models/ocr_task_export';
import { createPresignedGet, isR2Configured } from '@/shared/lib/translate-r2';

type Body = {
  task_ids?: string[];
  formats?: string[];
};

function dispositionFilename(base: string, ext: string) {
  const safe = `${base}.${ext}`.replace(/[^\w.\-]+/g, '_');
  return `attachment; filename="${encodeURIComponent(safe)}"`;
}

function normalizeFormats(formats?: string[]): OcrTaskExportFormat[] {
  const raw = Array.isArray(formats) ? formats : ['pdf', 'md'];
  return Array.from(new Set(raw.map((f) => f.toLowerCase()))).filter((f): f is OcrTaskExportFormat =>
    isOcrTaskExportFormat(f)
  );
}

export async function POST(req: Request) {
  try {
    const { userId, anonId } = await getTranslateAuth();
    const ownerWhere = userId
      ? eq(translationTasks.userId, userId)
      : eq(translationTasks.anonId, anonId);

    const body = (await req.json()) as Body;
    const taskIds = Array.from(
      new Set((body.task_ids || []).map((id) => id.trim()).filter(Boolean))
    );
    if (taskIds.length === 0) {
      return Response.json({ detail: 'task_ids is required' }, { status: 400 });
    }
    if (taskIds.length > 100) {
      return Response.json({ detail: 'too many task_ids' }, { status: 400 });
    }
    const formats = normalizeFormats(body.formats);
    if (formats.length === 0) {
      return Response.json({ detail: 'invalid formats' }, { status: 400 });
    }

    if (!(await isR2Configured())) {
      return Response.json({ detail: 'Storage not configured' }, { status: 503 });
    }

    const expiresInSeconds = Math.max(
      60,
      Math.min(
        3600,
        Number.parseInt(process.env.OCR_EXPORT_SIGNED_URL_TTL_SECONDS || '900', 10)
      )
    );

    const items: Array<{
      task_id: string;
      source_filename: string;
      format: OcrTaskExportFormat;
      status: 'ready' | 'not_ready' | 'missing' | 'error';
      reason?: string;
      download_url?: string;
    }> = [];

    for (const taskId of taskIds) {
      const [task] = await db()
        .select({
          id: translationTasks.id,
          documentId: translationTasks.documentId,
          preprocessWithOcr: translationTasks.preprocessWithOcr,
        })
        .from(translationTasks)
        .where(and(eq(translationTasks.id, taskId), ownerWhere))
        .limit(1);

      if (!task || !task.preprocessWithOcr) {
        for (const format of formats) {
          items.push({
            task_id: taskId,
            source_filename: taskId,
            format,
            status: 'missing',
            reason: !task ? 'task not found' : 'not an OCR task',
          });
        }
        continue;
      }

      const [doc] = await db()
        .select({ filename: documents.filename })
        .from(documents)
        .where(eq(documents.id, task.documentId))
        .limit(1);
      const base =
        (doc?.filename || 'document').replace(/\.[^.]+$/, '') || 'document';

      for (const format of formats) {
        const row = await findExportByTaskFormat(taskId, format);
        if (!row || row.status !== OcrTaskExportStatus.ready || !row.r2Key) {
          items.push({
            task_id: task.id,
            source_filename: doc?.filename || task.id,
            format,
            status: 'not_ready',
            reason: row ? `status=${row.status}` : 'export not found',
          });
          continue;
        }
        try {
          const signed = await createPresignedGet(row.r2Key, expiresInSeconds, {
            responseContentDisposition: dispositionFilename(
              base,
              format === 'pdf' ? 'pdf' : format === 'html' ? 'html' : 'md'
            ),
          });
          items.push({
            task_id: task.id,
            source_filename: doc?.filename || task.id,
            format,
            status: 'ready',
            download_url: signed,
          });
        } catch {
          items.push({
            task_id: task.id,
            source_filename: doc?.filename || task.id,
            format,
            status: 'error',
            reason: 'signed url unavailable',
          });
        }
      }
    }

    return Response.json({
      expires_in_seconds: expiresInSeconds,
      items,
    });
  } catch (e) {
    console.error('[ocr/exports/download-list POST]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'error' },
      { status: 500 }
    );
  }
}
