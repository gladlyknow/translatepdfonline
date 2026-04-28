import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { translationTaskExport } from '@/config/db/schema';
import { db } from '@/core/db';

export const OcrTaskExportStatus = {
  pending: 'pending',
  processing: 'processing',
  ready: 'ready',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

export type OcrTaskExportFormat = 'pdf' | 'md';

export function isOcrTaskExportFormat(v: string): v is OcrTaskExportFormat {
  return v === 'pdf' || v === 'md';
}

const OCR_EXPORT_LOG_MAX_CHARS = 12_000;

export async function listExportsForTask(taskId: string) {
  return db()
    .select()
    .from(translationTaskExport)
    .where(eq(translationTaskExport.taskId, taskId))
    .orderBy(desc(translationTaskExport.createdAt));
}

export async function findExportById(exportId: string) {
  const [row] = await db()
    .select()
    .from(translationTaskExport)
    .where(eq(translationTaskExport.id, exportId))
    .limit(1);
  return row ?? null;
}

export async function findExportByTaskFormat(
  taskId: string,
  format: OcrTaskExportFormat
) {
  const [row] = await db()
    .select()
    .from(translationTaskExport)
    .where(
      and(
        eq(translationTaskExport.taskId, taskId),
        eq(translationTaskExport.format, format)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function appendExportLog(exportId: string, line: string) {
  const row = await findExportById(exportId);
  if (!row) return;
  const ts = new Date().toISOString().slice(11, 23);
  const next = `${row.log ?? ''}[${ts}] ${line}\n`.slice(-OCR_EXPORT_LOG_MAX_CHARS);
  await db()
    .update(translationTaskExport)
    .set({ log: next, updatedAt: new Date() })
    .where(eq(translationTaskExport.id, exportId));
}

export async function claimExportForProcessing(exportId: string): Promise<boolean> {
  const updated = await db()
    .update(translationTaskExport)
    .set({
      status: OcrTaskExportStatus.processing,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(translationTaskExport.id, exportId),
        eq(translationTaskExport.status, OcrTaskExportStatus.pending)
      )
    )
    .returning({ id: translationTaskExport.id });
  return updated.length > 0;
}

export async function updateExportRow(
  exportId: string,
  patch: Partial<{
    status: string;
    r2Key: string | null;
    errorMessage: string | null;
    log: string | null;
    readyAt: Date | null;
  }>
) {
  await db()
    .update(translationTaskExport)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(translationTaskExport.id, exportId));
}

export async function cancelExportByTaskFormat(
  taskId: string,
  format: OcrTaskExportFormat
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await findExportByTaskFormat(taskId, format);
  if (!row) return { ok: false, reason: 'not_found' };
  if (
    row.status !== OcrTaskExportStatus.pending &&
    row.status !== OcrTaskExportStatus.processing
  ) {
    return { ok: false, reason: 'not_cancellable' };
  }
  await db()
    .update(translationTaskExport)
    .set({
      status: OcrTaskExportStatus.cancelled,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTaskExport.id, row.id));
  return { ok: true };
}

export async function deleteExportByTaskFormat(
  taskId: string,
  format: OcrTaskExportFormat
): Promise<void> {
  await db()
    .delete(translationTaskExport)
    .where(
      and(
        eq(translationTaskExport.taskId, taskId),
        eq(translationTaskExport.format, format)
      )
    );
}

export async function replaceWithPendingExport(params: {
  taskId: string;
  userId: string | null;
  anonId: string | null;
  format: OcrTaskExportFormat;
  sourceMarkdownObjectKey: string;
  exportId?: string;
}) {
  await db()
    .delete(translationTaskExport)
    .where(
      and(
        eq(translationTaskExport.taskId, params.taskId),
        eq(translationTaskExport.format, params.format)
      )
    );
  const exportId = params.exportId ?? nanoid();
  await db().insert(translationTaskExport).values({
    id: exportId,
    taskId: params.taskId,
    userId: params.userId,
    anonId: params.anonId,
    format: params.format,
    status: OcrTaskExportStatus.pending,
    sourceMarkdownObjectKey: params.sourceMarkdownObjectKey,
    r2Key: null,
    errorMessage: null,
    log: null,
    readyAt: null,
  });
  return exportId;
}
