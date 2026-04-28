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
import { parseParseResultJson } from '@/shared/ocr-workbench/translator-parse-result';
import { renderWorkbenchHtmlToPdfBytes } from '@/shared/lib/ocr-export-html-to-pdf-worker';
import { getOcrParseResultBodyForRead } from '@/shared/lib/ocr-parse-result-r2-keys';
import { createPresignedGet, getObjectBody, putObject } from '@/shared/lib/translate-r2';
import { toPublicOcrErrorMessage } from '@/shared/lib/ocr-public-error';
const OCR_EXPORT_UPLOAD_RETRY_MAX = Math.max(
  1,
  Number(process.env.OCR_EXPORT_UPLOAD_RETRY_MAX || '4') || 4
);
const OCR_EXPORT_STAGE_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.OCR_EXPORT_STAGE_TIMEOUT_MS || '180000') || 180000
);
const OCR_EXPORT_IMAGE_RETRY_MAX = 5;
const OCR_EXPORT_IMAGE_CONCURRENCY = 4;
const OCR_EXPORT_IMAGE_URL_TTL_SECONDS = Math.max(3600, 7 * 24 * 3600);

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
    : format === 'html'
      ? `translations/${taskId}/ocr-output.html`
      : `translations/${taskId}/ocr-output.md`;
}

export function exportStagingHtmlKey(taskId: string, exportId: string): string {
  return `translations/${taskId}/staging/ocr-export-${exportId}.html`;
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

function extByContentType(contentType: string | null | undefined): string {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('svg')) return 'svg';
  return 'bin';
}

function decodeDataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) throw new Error('invalid data url');
  const contentType = (match[1] || 'application/octet-stream').toLowerCase();
  const body = match[3] || '';
  const isBase64 = Boolean(match[2]);
  if (isBase64) {
    const raw = atob(body);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return { bytes: out, contentType };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(body)), contentType };
}

async function withRetry<T>(attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i >= attempts) break;
      await sleep(Math.min(300 * i, 1500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length)))
    .fill(0)
    .map(async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    });
  await Promise.all(workers);
}

async function materializeHtmlImagesToR2(params: {
  taskId: string;
  exportId: string;
  html: string;
}): Promise<{ html: string; count: number }> {
  const imgSrcRegex = /(<img\b[^>]*\bsrc=)(['"])([^'"]+)\2/gi;
  const uniqueSrcs = new Set<string>();
  let match: RegExpExecArray | null = null;
  while ((match = imgSrcRegex.exec(params.html)) !== null) {
    const src = (match[3] || '').trim();
    if (src) uniqueSrcs.add(src);
  }
  const srcList = Array.from(uniqueSrcs);
  if (srcList.length === 0) return { html: params.html, count: 0 };

  const replaceMap = new Map<string, string>();
  await runWithConcurrency(srcList, OCR_EXPORT_IMAGE_CONCURRENCY, async (src, index) => {
    const seq = index + 1;
    if (!src.startsWith('data:') && !/^https?:\/\//i.test(src)) return;
    const signed = await withRetry(OCR_EXPORT_IMAGE_RETRY_MAX, async () => {
      let bytes: Uint8Array;
      let contentType = 'application/octet-stream';
      if (src.startsWith('data:')) {
        const decoded = decodeDataUrlToBytes(src);
        bytes = decoded.bytes;
        contentType = decoded.contentType;
      } else {
        const res = await fetch(src);
        if (!res.ok) {
          throw new Error(`download export image failed: HTTP ${res.status}`);
        }
        bytes = new Uint8Array(await res.arrayBuffer());
        contentType = res.headers.get('content-type') || contentType;
      }
      const key = `translations/${params.taskId}/staging-assets/${params.exportId}/img-${seq}.${extByContentType(contentType)}`;
      await uploadWithRetry(key, bytes, contentType);
      return createPresignedGet(key, OCR_EXPORT_IMAGE_URL_TTL_SECONDS);
    });
    replaceMap.set(src, signed);
  });

  let nextHtml = params.html;
  for (const [from, to] of replaceMap.entries()) {
    nextHtml = nextHtml.split(from).join(to);
  }
  return { html: nextHtml, count: replaceMap.size };
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
    if (row.format === 'pdf') {
      await appendExportLog(
        exportId,
        'pdf: workbench_like HTML → Chromium (Browser Rendering required)'
      );
    }
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
      const stagingHtmlKey = exportStagingHtmlKey(row.taskId, exportId);
      const htmlBytes = await withStageTimeout(
        'load_staging_html',
        () => getObjectBody(stagingHtmlKey),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      ).catch(() => null);
      if (!htmlBytes) {
        throw new Error('staging html missing for pdf export');
      }
      const html = new TextDecoder('utf-8').decode(htmlBytes);
      const normalized = await withStageTimeout(
        'materialize_html_images_to_r2',
        () =>
          materializeHtmlImagesToR2({
            taskId: row.taskId,
            exportId,
            html,
          }),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      );
      console.log(
        '[ocr/export] pdf_render_context',
        JSON.stringify({
          task_id: row.taskId,
          export_id: exportId,
          render_mode: 'dom_snapshot_staging',
          staging_html_key: stagingHtmlKey,
          html_length: normalized.html.length,
          image_r2_urls: normalized.count,
        })
      );

      const pdfBytes = await withStageTimeout(
        'render_pdf_from_staging_html',
        () => renderWorkbenchHtmlToPdfBytes(normalized.html),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      );
      console.log(
        '[ocr/export] pdf_render_done',
        JSON.stringify({
          task_id: row.taskId,
          export_id: exportId,
          pdf_bytes: pdfBytes.byteLength,
        })
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
        `ready pdf_bytes=${pdfBytes.byteLength} staging_html`
      );
    } else if (row.format === 'html') {
      const stagingHtmlKey = exportStagingHtmlKey(row.taskId, exportId);
      const htmlBytes = await withStageTimeout(
        'load_staging_html',
        () => getObjectBody(stagingHtmlKey),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      ).catch(() => null);
      if (!htmlBytes) {
        throw new Error('staging html missing for html export');
      }
      const html = new TextDecoder('utf-8').decode(htmlBytes);
      const normalized = await withStageTimeout(
        'materialize_html_images_to_r2',
        () =>
          materializeHtmlImagesToR2({
            taskId: row.taskId,
            exportId,
            html,
          }),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      );
      const key = outputKeyForFormat(row.taskId, 'html');
      await uploadWithRetry(
        key,
        new TextEncoder().encode(normalized.html),
        'text/html; charset=utf-8'
      );
      await updateExportRow(exportId, {
        status: OcrTaskExportStatus.ready,
        r2Key: key,
        errorMessage: null,
        readyAt: new Date(),
      });
      await appendExportLog(
        exportId,
        `ready html_bytes=${normalized.html.length} image_r2_urls=${normalized.count} img_retry=${OCR_EXPORT_IMAGE_RETRY_MAX} img_concurrency=${OCR_EXPORT_IMAGE_CONCURRENCY}`
      );
    } else {
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
      const markdown = await withStageTimeout(
        'load_markdown',
        () => loadMarkdownFromR2(row.sourceMarkdownObjectKey),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      );
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
