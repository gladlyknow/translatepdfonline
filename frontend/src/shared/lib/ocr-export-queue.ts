import { and, eq, or } from 'drizzle-orm';

import { translationTaskExport, translationTasks } from '@/config/db/schema';
import { db } from '@/core/db';
import {
  appendExportLog,
  claimExportForProcessing,
  findExportById,
  isOcrTaskExportFormat,
  listExportsForTask,
  OcrTaskExportStatus,
  replaceWithPendingExport,
  updateExportRow,
  type OcrTaskExportFormat,
} from '@/shared/models/ocr_task_export';
import { loadMarkdownFromR2, markdownToSimplePdfBytes } from '@/shared/lib/ocr-translate';
import { putObject } from '@/shared/lib/translate-r2';

const OCR_EXPORT_PDF_RENDER_MAX_CHARS = Math.max(
  8000,
  Number(process.env.OCR_PDF_RENDER_MAX_CHARS || '12000') || 12000
);
const OCR_EXPORT_UPLOAD_RETRY_MAX = Math.max(
  1,
  Number(process.env.OCR_EXPORT_UPLOAD_RETRY_MAX || '4') || 4
);
const OCR_EXPORT_STAGE_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.OCR_EXPORT_STAGE_TIMEOUT_MS || '180000') || 180000
);

function toPublicExportErrorMessage(raw: string): string {
  const msg = raw.toLowerCase();
  if (
    msg.includes('connect timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('econn') ||
    msg.includes('network')
  ) {
    return 'Storage network timeout, check proxy/network and retry';
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Export timed out, please retry';
  }
  if (msg.includes('pdf') && msg.includes('render')) {
    return 'PDF render timed out, please retry later';
  }
  if (msg.includes('missing')) {
    return 'Export source is not ready, please retry shortly';
  }
  return 'Export failed, please retry';
}

function withStageTimeout<T>(
  stage: string,
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`export stage timeout (${stage}) after ${timeoutMs}ms`));
    }, timeoutMs);
    fn()
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputKeyForFormat(taskId: string, format: OcrTaskExportFormat): string {
  return format === 'pdf'
    ? `translations/${taskId}/ocr-output.pdf`
    : `translations/${taskId}/ocr-output.md`;
}

async function isTaskCancelled(taskId: string): Promise<boolean> {
  const [row] = await db()
    .select({ status: translationTasks.status })
    .from(translationTasks)
    .where(eq(translationTasks.id, taskId))
    .limit(1);
  return row?.status === 'cancelled';
}

async function uploadWithRetry(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= OCR_EXPORT_UPLOAD_RETRY_MAX; attempt += 1) {
    try {
      await putObject(key, body, contentType);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt >= OCR_EXPORT_UPLOAD_RETRY_MAX) break;
      await sleep(Math.min(600 * attempt, 2500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function syncTaskOutputPointers(taskId: string): Promise<void> {
  const rows = await listExportsForTask(taskId);
  const readyPdf = rows.find(
    (r: (typeof rows)[number]) =>
      r.format === 'pdf' && r.status === OcrTaskExportStatus.ready && r.r2Key
  );
  const readyMd = rows.find(
    (r: (typeof rows)[number]) =>
      r.format === 'md' && r.status === OcrTaskExportStatus.ready && r.r2Key
  );
  await db()
    .update(translationTasks)
    .set({
      outputObjectKey: readyPdf?.r2Key ?? null,
      outputPrimaryPath: readyMd?.r2Key ?? null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, taskId));
}

export async function ensureOcrPendingExportsForTask(params: {
  taskId: string;
  userId: string | null;
  anonId: string | null;
  sourceLang: string;
  targetLang: string;
}): Promise<Array<{ exportId: string; format: OcrTaskExportFormat }>> {
  const translatedMarkdownKey = `translations/${params.taskId}/ocr-translated.md`;
  const sourceMarkdownKey = `translations/${params.taskId}/ocr-source.md`;
  const finalMarkdownKey =
    params.sourceLang.trim().toLowerCase() === params.targetLang.trim().toLowerCase()
      ? sourceMarkdownKey
      : translatedMarkdownKey;

  const exportIds: Array<{ exportId: string; format: OcrTaskExportFormat }> = [];
  for (const format of ['pdf', 'md'] as const) {
    const exportId = await replaceWithPendingExport({
      taskId: params.taskId,
      userId: params.userId,
      anonId: params.anonId,
      format,
      sourceMarkdownObjectKey: finalMarkdownKey,
    });
    exportIds.push({ exportId, format });
  }
  await db()
    .update(translationTasks)
    .set({
      outputObjectKey: null,
      outputPrimaryPath: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, params.taskId));
  return exportIds;
}

export async function processOcrTaskExport(exportId: string): Promise<void> {
  const row = await findExportById(exportId);
  if (!row) return;
  if (row.status === OcrTaskExportStatus.cancelled) return;
  if (row.status !== OcrTaskExportStatus.pending) return;
  if (!isOcrTaskExportFormat(row.format)) {
    await updateExportRow(exportId, {
      status: OcrTaskExportStatus.failed,
      errorMessage: 'unsupported export format',
    });
    return;
  }
  const claimed = await claimExportForProcessing(exportId);
  if (!claimed) return;

  try {
    if (await isTaskCancelled(row.taskId)) {
      await updateExportRow(exportId, {
        status: OcrTaskExportStatus.cancelled,
        errorMessage: null,
        readyAt: null,
      });
      await appendExportLog(exportId, 'stopped (task cancelled)');
      return;
    }
    await appendExportLog(exportId, `start format=${row.format}`);
    const markdown = await withStageTimeout(
      'load_markdown',
      () => loadMarkdownFromR2(row.sourceMarkdownObjectKey),
      OCR_EXPORT_STAGE_TIMEOUT_MS
    );
    if (await isTaskCancelled(row.taskId)) {
      await updateExportRow(exportId, {
        status: OcrTaskExportStatus.cancelled,
        errorMessage: null,
        readyAt: null,
      });
      await appendExportLog(exportId, 'stopped (task cancelled)');
      return;
    }
    if (row.format === 'pdf') {
      const pdfMarkdown =
        markdown.length > OCR_EXPORT_PDF_RENDER_MAX_CHARS
          ? `${markdown.slice(
              0,
              OCR_EXPORT_PDF_RENDER_MAX_CHARS
            )}\n\n---\n\n[OCR PDF export truncated for rendering limit; full text is in markdown output.]`
          : markdown;
      const pdfBytes = await withStageTimeout(
        'render_pdf_bytes',
        () => markdownToSimplePdfBytes(pdfMarkdown),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      );
      const key = outputKeyForFormat(row.taskId, 'pdf');
      await uploadWithRetry(key, pdfBytes, 'application/pdf');
      await updateExportRow(exportId, {
        status: OcrTaskExportStatus.ready,
        r2Key: key,
        errorMessage: null,
        readyAt: new Date(),
      });
      await appendExportLog(
        exportId,
        `ready pdf_bytes=${pdfBytes.byteLength} render_chars=${pdfMarkdown.length}`
      );
    } else {
      const markdownBytes = new TextEncoder().encode(markdown);
      const key = outputKeyForFormat(row.taskId, 'md');
      await uploadWithRetry(key, markdownBytes, 'text/markdown; charset=utf-8');
      await updateExportRow(exportId, {
        status: OcrTaskExportStatus.ready,
        r2Key: key,
        errorMessage: null,
        readyAt: new Date(),
      });
      await appendExportLog(exportId, `ready markdown_bytes=${markdownBytes.byteLength}`);
    }
    await syncTaskOutputPointers(row.taskId);
  } catch (e) {
    const rawMsg = e instanceof Error ? e.message : String(e);
    const msg = rawMsg.slice(0, 300);
    const safeMsg = toPublicExportErrorMessage(rawMsg).slice(0, 300);
    await appendExportLog(exportId, `failed: ${safeMsg}`);
    await updateExportRow(exportId, {
      status: OcrTaskExportStatus.failed,
      r2Key: null,
      errorMessage: safeMsg,
      readyAt: null,
    });
    throw e;
  }
}

export async function retryOcrTaskExport(taskId: string, format: OcrTaskExportFormat) {
  const [task] = await db()
    .select({
      id: translationTasks.id,
      userId: translationTasks.userId,
      anonId: translationTasks.anonId,
      sourceLang: translationTasks.sourceLang,
      targetLang: translationTasks.targetLang,
    })
    .from(translationTasks)
    .where(eq(translationTasks.id, taskId))
    .limit(1);
  if (!task) return null;
  const translatedMarkdownKey = `translations/${taskId}/ocr-translated.md`;
  const sourceMarkdownKey = `translations/${taskId}/ocr-source.md`;
  const finalMarkdownKey =
    task.sourceLang.trim().toLowerCase() === task.targetLang.trim().toLowerCase()
      ? sourceMarkdownKey
      : translatedMarkdownKey;
  const exportId = await replaceWithPendingExport({
    taskId,
    userId: task.userId,
    anonId: task.anonId,
    format,
    sourceMarkdownObjectKey: finalMarkdownKey,
  });
  return exportId;
}

export async function cancelOcrTaskExports(taskId: string): Promise<void> {
  await db()
    .update(translationTaskExport)
    .set({
      status: OcrTaskExportStatus.cancelled,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(translationTaskExport.taskId, taskId),
        // 已在处理中的导出也统一标记 cancelled，处理函数会在下一检查点终止落盘。
        or(
          eq(translationTaskExport.status, OcrTaskExportStatus.pending),
          eq(translationTaskExport.status, OcrTaskExportStatus.processing)
        )
      )
    );
}
