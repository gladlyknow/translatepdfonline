import { and, eq } from 'drizzle-orm';

import { documents, translationTasks } from '@/config/db/schema';
import { db } from '@/core/db';
import { getTranslateAuth } from '@/app/api/translate/auth';
import {
  appendExportLog,
  cancelExportByTaskFormat,
  deleteExportByTaskFormat,
  findExportByTaskFormat,
  isOcrTaskExportFormat,
  listExportsForTask,
  OcrTaskExportStatus,
  updateExportRow,
  type OcrTaskExportFormat,
} from '@/shared/models/ocr_task_export';
import {
  exportStagingHtmlKey,
  retryOcrTaskExport,
  syncOcrTaskOutputPointersForTask,
} from '@/shared/lib/ocr-export-queue';
import {
  createPresignedGet,
  deleteObject,
  isR2Configured,
  putObject,
  r2ObjectExists,
} from '@/shared/lib/translate-r2';
import { sendOcrExportQueueMessage } from '@/shared/lib/ocr-queue';

export const maxDuration = 300;

const OCR_EXPORT_STALE_MS = Number.parseInt(
  process.env.OCR_EXPORT_STALE_MS || '300000',
  10
);
const OCR_EXPORT_STALE_PENDING_MS = Number.parseInt(
  process.env.OCR_EXPORT_STALE_PENDING_MS || String(Math.max(OCR_EXPORT_STALE_MS, 900000)),
  10
);
const OCR_EXPORT_STALE_PROCESSING_MS = Number.parseInt(
  process.env.OCR_EXPORT_STALE_PROCESSING_MS || String(Math.max(OCR_EXPORT_STALE_MS, 1800000)),
  10
);
const OCR_EXPORT_SIGNED_URL_TTL_SECONDS = Math.max(
  60,
  Math.min(
    3600,
    Number.parseInt(process.env.OCR_EXPORT_SIGNED_URL_TTL_SECONDS || '900', 10)
  )
);
const OCR_EXPORT_IMAGE_URL_TTL_SECONDS = Math.max(3600, 7 * 24 * 3600);

function extByContentType(contentType: string | null | undefined): string {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('svg')) return 'svg';
  return 'bin';
}

function extByDataUrlMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('svg')) return 'svg';
  return 'bin';
}

async function materializeHtmlImagesToR2(params: {
  taskId: string;
  exportId: string;
  html: string;
}): Promise<{ html: string; count: number }> {
  const imgSrcRegex = /(<img\b[^>]*\bsrc=)(['"])([^'"]+)\2/gi;
  const srcs = new Set<string>();
  let m: RegExpExecArray | null = null;
  while ((m = imgSrcRegex.exec(params.html)) !== null) {
    const src = (m[3] || '').trim();
    if (src) srcs.add(src);
  }
  if (srcs.size === 0) return { html: params.html, count: 0 };

  const replaceMap = new Map<string, string>();
  let idx = 0;
  for (const src of srcs) {
    idx += 1;
    let bytes: Uint8Array;
    let contentType = 'application/octet-stream';
    if (src.startsWith('data:')) {
      const dm = src.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
      if (!dm) throw new Error(`invalid data url image #${idx}`);
      const mime = (dm[1] || 'application/octet-stream').toLowerCase();
      const payload = dm[3] || '';
      const isBase64 = Boolean(dm[2]);
      bytes = isBase64
        ? Uint8Array.from(Buffer.from(payload, 'base64'))
        : new TextEncoder().encode(decodeURIComponent(payload));
      contentType = mime;
      const key = `translations/${params.taskId}/staging-assets/${params.exportId}/img-${idx}.${extByDataUrlMime(mime)}`;
      await putObject(key, bytes, contentType);
      const signed = await createPresignedGet(key, OCR_EXPORT_IMAGE_URL_TTL_SECONDS);
      replaceMap.set(src, signed);
      continue;
    }
    if (!/^https?:\/\//i.test(src)) {
      continue;
    }
    const res = await fetch(src);
    if (!res.ok) {
      throw new Error(`download export image failed: HTTP ${res.status}`);
    }
    bytes = new Uint8Array(await res.arrayBuffer());
    contentType = res.headers.get('content-type') || contentType;
    const key = `translations/${params.taskId}/staging-assets/${params.exportId}/img-${idx}.${extByContentType(contentType)}`;
    await putObject(key, bytes, contentType);
    const signed = await createPresignedGet(key, OCR_EXPORT_IMAGE_URL_TTL_SECONDS);
    replaceMap.set(src, signed);
  }

  if (replaceMap.size === 0) return { html: params.html, count: 0 };
  let nextHtml = params.html;
  for (const [from, to] of replaceMap.entries()) {
    nextHtml = nextHtml.split(from).join(to);
  }
  return { html: nextHtml, count: replaceMap.size };
}

function dispositionFilename(base: string, ext: string) {
  const safe = `${base}.${ext}`.replace(/[^\w.\-]+/g, '_');
  return `attachment; filename="${encodeURIComponent(safe)}"`;
}

function parseLogLines(raw: string | null | undefined, maxLines = 80): string[] {
  if (!raw?.trim()) return [];
  return raw
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .slice(-maxLines);
}

function toPublicErrorMessage(msg: string | null | undefined): string | null {
  if (!msg) return null;
  const v = msg.toLowerCase();
  if (
    v.includes('connect timeout') ||
    v.includes('fetch failed') ||
    v.includes('econn') ||
    v.includes('network')
  ) {
    return 'Storage network timeout, check proxy/network and retry';
  }
  if (v.includes('timed out') || v.includes('timeout')) {
    return 'Export timed out, please retry';
  }
  if (v.includes('pdf') && v.includes('render')) {
    return 'PDF render timed out, please retry later';
  }
  if (v.includes('missing')) {
    return 'Export source is not ready, please retry shortly';
  }
  if (v.includes('queue unavailable')) {
    return 'Export queue unavailable, please retry later';
  }
  return msg.slice(0, 300) || 'Export failed, please retry';
}

function toTimeMs(v: Date | string | null | undefined): number {
  if (!v) return 0;
  const d = v instanceof Date ? v : new Date(v);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function markStaleExportIfNeeded(row: {
  id: string;
  format: string;
  status: string;
  updatedAt: Date | string | null | undefined;
}): Promise<boolean> {
  const staleMs =
    row.status === OcrTaskExportStatus.pending
      ? OCR_EXPORT_STALE_PENDING_MS
      : row.status === OcrTaskExportStatus.processing
        ? OCR_EXPORT_STALE_PROCESSING_MS
        : 0;
  if (!staleMs) return false;
  const updatedMs = toTimeMs(row.updatedAt);
  if (!updatedMs) return false;
  if (Date.now() - updatedMs <= staleMs) return false;
  await appendExportLog(
    row.id,
    `stale export auto-failed: status=${row.status} exceeded ${staleMs}ms`
  );
  await updateExportRow(row.id, {
    status: OcrTaskExportStatus.failed,
    errorMessage: `Export timed out after waiting over ${Math.floor(staleMs / 1000)}s`,
    r2Key: null,
  });
  return true;
}

async function resolveTaskDocumentBasename(taskId: string): Promise<string> {
  const [row] = await db()
    .select({
      documentId: translationTasks.documentId,
    })
    .from(translationTasks)
    .where(eq(translationTasks.id, taskId))
    .limit(1);
  if (!row?.documentId) return 'document';
  const [doc] = await db()
    .select({ filename: documents.filename })
    .from(documents)
    .where(eq(documents.id, row.documentId))
    .limit(1);
  const base = (doc?.filename || 'document').replace(/\.[^.]+$/, '') || 'document';
  return base;
}

function exportContentDispositionForFormat(
  base: string,
  format: OcrTaskExportFormat
): string {
  const ext = format === 'pdf' ? 'pdf' : format === 'html' ? 'html' : 'md';
  return dispositionFilename(base, ext);
}

/**
 * GET — 列出导出；?downloadUrl=1&format= — JSON 含签名 URL；
 * ?download=1&format= — 302 跳转签名地址（对齐 translator exports）。
 */
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
    const download = url.searchParams.get('download');
    const downloadUrlOnly = url.searchParams.get('downloadUrl') === '1';
    const format = (url.searchParams.get('format') || '').toLowerCase();

    if (download === '1' || downloadUrlOnly) {
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
      const base = await resolveTaskDocumentBasename(taskId);
      const disp = exportContentDispositionForFormat(base, format);
      let exists = true;
      try {
        exists = await r2ObjectExists(row.r2Key);
      } catch {
        exists = true;
      }
      if (!exists) {
        console.warn('[ocr/exports] exists check negative, continue signing', {
          taskId,
          format,
          key: row.r2Key,
        });
      }
      const downloadUrl = await createPresignedGet(row.r2Key, OCR_EXPORT_SIGNED_URL_TTL_SECONDS, {
        responseContentDisposition: disp,
      });
      if (downloadUrlOnly) {
        return Response.json({
          format,
          status: row.status,
          download_url: downloadUrl,
          file_name: `${base}.${format === 'pdf' ? 'pdf' : format === 'html' ? 'html' : 'md'}`,
          expires_in_seconds: OCR_EXPORT_SIGNED_URL_TTL_SECONDS,
          via: 'signed',
        });
      }
      return Response.redirect(downloadUrl, 302);
    }

    let rows = await listExportsForTask(taskId);
    let hasStaleUpdated = false;
    for (const row of rows) {
      if (
        await markStaleExportIfNeeded({
          id: row.id,
          format: row.format,
          status: row.status,
          updatedAt: row.updatedAt,
        })
      ) {
        hasStaleUpdated = true;
      }
    }
    if (hasStaleUpdated) {
      rows = await listExportsForTask(taskId);
    }
    const latestByFormat = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latestByFormat.has(row.format)) {
        latestByFormat.set(row.format, row);
      }
    }
    return Response.json({
      exports: Array.from(latestByFormat.values()).map((r: (typeof rows)[number]) => ({
        id: r.id,
        task_id: r.taskId,
        format: r.format,
        status: r.status,
        error_message: toPublicErrorMessage(r.errorMessage),
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
    const body = (await req.json()) as {
      format?: string;
      action?: string;
      htmlDocument?: string;
      orientation?: 'portrait' | 'landscape';
    };
    const format = String(body.format || '').trim().toLowerCase();
    if (!isOcrTaskExportFormat(format)) {
      return Response.json({ detail: 'invalid format' }, { status: 400 });
    }

    if (body.action === 'cancel') {
      const r = await cancelExportByTaskFormat(taskId, format);
      if (!r.ok) {
        if (r.reason === 'not_found') {
          return Response.json({ detail: 'no export to cancel' }, { status: 404 });
        }
        return Response.json({ detail: 'export cannot be cancelled' }, { status: 409 });
      }
      const row = await findExportByTaskFormat(taskId, format);
      if (row?.id) {
        await appendExportLog(row.id, 'cancel requested via API');
      }
      return Response.json({ ok: true, format, status: OcrTaskExportStatus.cancelled });
    }

    const existing = await findExportByTaskFormat(taskId, format);
    if (existing) {
      await markStaleExportIfNeeded({
        id: existing.id,
        format: existing.format,
        status: existing.status,
        updatedAt: existing.updatedAt,
      });
    }
    const latest = await findExportByTaskFormat(taskId, format);
    if (
      latest &&
      (latest.status === OcrTaskExportStatus.pending ||
        latest.status === OcrTaskExportStatus.processing)
    ) {
      return Response.json({ detail: 'export already in progress' }, { status: 409 });
    }
    const exportId = await retryOcrTaskExport(taskId, format);
    if (!exportId) {
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }
    if (format === 'pdf' || format === 'html') {
      const htmlDocument = String(body.htmlDocument || '');
      if (!htmlDocument.trim()) {
        return Response.json(
          { detail: 'htmlDocument is required for pdf/html export' },
          { status: 400 }
        );
      }
      const normalized = await materializeHtmlImagesToR2({
        taskId,
        exportId,
        html: htmlDocument,
      });
      const stagingKey = exportStagingHtmlKey(taskId, exportId);
      await putObject(
        stagingKey,
        new TextEncoder().encode(normalized.html),
        'text/html; charset=utf-8'
      );
      await appendExportLog(
        exportId,
        `staged html uploaded key=${stagingKey} bytes=${normalized.html.length} image_r2_urls=${normalized.count}`
      );
    }
    const queued = await sendOcrExportQueueMessage({
      taskId,
      exportId,
      format,
    });
    if (!queued.ok) {
      await updateExportRow(exportId, {
        status: OcrTaskExportStatus.failed,
        r2Key: null,
        readyAt: null,
        errorMessage: 'Export queue unavailable',
      });
      await appendExportLog(exportId, `enqueue failed: ${queued.reason}`);
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

export async function DELETE(
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

    const format = (new URL(req.url).searchParams.get('format') || '').toLowerCase();
    if (!isOcrTaskExportFormat(format)) {
      return Response.json({ detail: 'invalid format' }, { status: 400 });
    }

    const row = await findExportByTaskFormat(taskId, format);
    if (row?.r2Key && (await isR2Configured())) {
      try {
        await deleteObject(row.r2Key);
      } catch (e) {
        console.warn('[ocr/exports DELETE] r2 delete', e);
      }
      try {
        await deleteObject(exportStagingHtmlKey(taskId, row.id));
      } catch (e) {
        console.warn('[ocr/exports DELETE] staging r2 delete', e);
      }
    }

    await deleteExportByTaskFormat(taskId, format as OcrTaskExportFormat);
    await syncOcrTaskOutputPointersForTask(taskId);
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[ocr/exports DELETE]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'failed to delete export' },
      { status: 500 }
    );
  }
}
