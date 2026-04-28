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
import { languagesNeedTranslation } from '@/shared/lib/ocr-lang';
import { loadMarkdownFromR2 } from '@/shared/lib/ocr-translate';
import { buildMarkdownExportWithAssets } from '@/shared/ocr-workbench/parse-result-export-md';
import { buildSelfContainedHtml } from '@/shared/ocr-workbench/parse-result-export-html';
import { parseParseResultJson } from '@/shared/ocr-workbench/translator-parse-result';
import { renderWorkbenchHtmlToPdfBytes } from '@/shared/lib/ocr-export-html-to-pdf-worker';
import { getOcrParseResultBodyForRead } from '@/shared/lib/ocr-parse-result-r2-keys';
import { createPresignedGet, putObject } from '@/shared/lib/translate-r2';
import { toPublicOcrErrorMessage } from '@/shared/lib/ocr-public-error';
const OCR_EXPORT_UPLOAD_RETRY_MAX = Math.max(
  1,
  Number(process.env.OCR_EXPORT_UPLOAD_RETRY_MAX || '4') || 4
);
const OCR_EXPORT_STAGE_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.OCR_EXPORT_STAGE_TIMEOUT_MS || '180000') || 180000
);

function toPublicExportErrorMessage(raw: string): string {
  return toPublicOcrErrorMessage(raw, 'Export failed, please retry');
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

function contentTypeForAssetName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function buildMarkdownWithR2ImageUrls(
  taskId: string,
  sourceLang: string,
  targetLang: string,
  fallbackMarkdown: string
): Promise<string> {
  let parseJson: unknown = null;
  try {
    const parseBytes = await withStageTimeout(
      'load_parse_result_json',
      () => getOcrParseResultBodyForRead(taskId, sourceLang, targetLang),
      OCR_EXPORT_STAGE_TIMEOUT_MS
    );
    parseJson = JSON.parse(new TextDecoder('utf-8').decode(parseBytes));
  } catch {
    return fallbackMarkdown;
  }
  const parsed = parseParseResultJson(parseJson);
  if (!parsed.ok) return fallbackMarkdown;

  const baseName = `ocr-${taskId}`;
  const { markdown, assets } = await buildMarkdownExportWithAssets(parsed.data, baseName);
  if (!assets.length) return markdown;

  let markdownWithR2Urls = markdown;
  for (const asset of assets) {
    const assetKey = `translations/${taskId}/${asset.name}`;
    await uploadWithRetry(assetKey, asset.bytes, contentTypeForAssetName(asset.name));
    const assetUrl = await createPresignedGet(assetKey, 7 * 24 * 3600);
    markdownWithR2Urls = markdownWithR2Urls.replace(`(./${asset.name})`, `(${assetUrl})`);
  }
  return markdownWithR2Urls;
}

/** 供导出 DELETE 等路径在删库后刷新 translation_tasks 输出指针 */
export async function syncOcrTaskOutputPointersForTask(taskId: string): Promise<void> {
  await syncTaskOutputPointers(taskId);
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
  const finalMarkdownKey = languagesNeedTranslation(params.sourceLang, params.targetLang)
    ? translatedMarkdownKey
    : sourceMarkdownKey;

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
    const [langRow] = await db()
      .select({
        sourceLang: translationTasks.sourceLang,
        targetLang: translationTasks.targetLang,
      })
      .from(translationTasks)
      .where(eq(translationTasks.id, row.taskId))
      .limit(1);
    const sourceLang = langRow?.sourceLang ?? '';
    const targetLang = langRow?.targetLang ?? '';

    if (row.format === 'pdf') {
      await appendExportLog(
        exportId,
        'pdf: workbench_like HTML → Chromium (Browser Rendering required)'
      );
    }
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
      const parseBytes = await withStageTimeout(
        'load_parse_result_json',
        () => getOcrParseResultBodyForRead(row.taskId, sourceLang, targetLang),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      );
      const rawJson = JSON.parse(new TextDecoder('utf-8').decode(parseBytes));
      const parsed = parseParseResultJson(rawJson);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }

      const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || '')
        .trim()
        .replace(/\/$/, '');
      const { html, imageWarnings } = await buildSelfContainedHtml(parsed.data, {
        forPrint: true,
        renderMode: 'workbench_like',
        appOrigin: appOrigin || undefined,
        locale: 'zh-CN',
      });
      if (imageWarnings > 0) {
        await appendExportLog(
          exportId,
          `pdf: ${imageWarnings} image(s) missing or could not be inlined`
        );
      }

      const pdfBytes = await withStageTimeout(
        'render_pdf_from_workbench_html',
        () => renderWorkbenchHtmlToPdfBytes(html),
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
        `ready pdf_bytes=${pdfBytes.byteLength} workbench_html`
      );
    } else {
      const markdownWithR2Urls = await withStageTimeout(
        'rewrite_markdown_image_urls',
        () => buildMarkdownWithR2ImageUrls(row.taskId, sourceLang, targetLang, markdown),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      );
      const markdownBytes = new TextEncoder().encode(markdownWithR2Urls);
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
  const finalMarkdownKey = languagesNeedTranslation(task.sourceLang, task.targetLang)
    ? translatedMarkdownKey
    : sourceMarkdownKey;
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
