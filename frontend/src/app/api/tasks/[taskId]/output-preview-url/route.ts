import { eq, and } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { db } from '@/core/db';
import { translationTasks, documents } from '@/config/db/schema';
import { getTranslateAuth } from '../../../translate/auth';
import {
  createPresignedGet,
  encodeR2KeyForPublicUrl,
  getObjectBody,
  getR2PublicBaseUrl,
  isR2Configured,
  putObject,
  r2HeadObject,
  r2ObjectExists,
} from '@/shared/lib/translate-r2';
import { isCloudflareWorker } from '@/shared/lib/env';

const SLICE_PREFIX = 'slices/task-output/';

function maxPreviewLoadBytes(): number {
  return isCloudflareWorker ? 8 * 1024 * 1024 : 64 * 1024 * 1024;
}

function tooLargeDetail(maxMb: number): string {
  return `Translated PDF too large for server-side page slicing (>${maxMb}MB on this runtime). Try downloading the file or use page 1.`;
}

export async function GET(
  req: Request,
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
      return Response.json({ detail: 'Not found' }, { status: 404 });
    }
    if (!task.outputObjectKey) {
      return Response.json(
        { detail: 'Translation output not ready' },
        { status: 404 }
      );
    }
    if (!(await isR2Configured())) {
      return Response.json(
        { detail: 'Storage not configured' },
        { status: 503 }
      );
    }

    const [srcDoc] = await db()
      .select({ pageCount: documents.pageCount })
      .from(documents)
      .where(eq(documents.id, task.documentId))
      .limit(1);
    const totalFromSource =
      srcDoc?.pageCount != null && srcDoc.pageCount > 0
        ? srcDoc.pageCount
        : null;

    const url = new URL(req.url);
    const pageParam = url.searchParams.get('page');
    const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);

    const maxBytes = maxPreviewLoadBytes();
    const maxMb = Math.round(maxBytes / (1024 * 1024));

    const outHead = await r2HeadObject(task.outputObjectKey);
    if (!outHead.ok) {
      return Response.json(
        { detail: 'Output file not found in storage. It may still be uploading.' },
        { status: 404 }
      );
    }
    const outputSize = outHead.contentLength ?? 0;

    const publicBase = getR2PublicBaseUrl();

    // 第 1 页：公网直链或预签名，避免大译稿仅因缺 publicBase 命中 413
    if (page === 1 && task.outputObjectKey) {
      if (publicBase) {
        if (totalFromSource != null) {
          return Response.json({
            preview_url: `${publicBase}/${encodeR2KeyForPublicUrl(task.outputObjectKey)}`,
            total_pages: totalFromSource,
          });
        }
        if (outputSize > maxBytes) {
          return Response.json({
            preview_url: `${publicBase}/${encodeR2KeyForPublicUrl(task.outputObjectKey)}`,
            total_pages: 0,
          });
        }
      } else {
        if (totalFromSource != null) {
          return Response.json({
            preview_url: await createPresignedGet(task.outputObjectKey, 3600),
            total_pages: totalFromSource,
          });
        }
        if (outputSize > maxBytes) {
          return Response.json({
            preview_url: await createPresignedGet(task.outputObjectKey, 3600),
            total_pages: 0,
          });
        }
      }
    }

    if (outputSize > maxBytes) {
      return Response.json({ detail: tooLargeDetail(maxMb) }, { status: 413 });
    }

    const totalHint = totalFromSource;
    const pageIndex =
      totalHint != null ? Math.min(page, totalHint) : page;
    const sliceKey = `${SLICE_PREFIX}${taskId}/page-${pageIndex}.pdf`;

    if (totalHint != null && (await r2ObjectExists(sliceKey))) {
      const previewUrl = await createPresignedGet(sliceKey, 3600);
      return Response.json({
        preview_url: previewUrl,
        total_pages: totalHint,
      });
    }

    const pdfBytes = await getObjectBody(task.outputObjectKey);
    const srcPdf = await PDFDocument.load(pdfBytes);
    const totalPages = srcPdf.getPageCount();
    if (totalPages < 1) {
      return Response.json(
        { detail: 'PDF has no pages' },
        { status: 400 }
      );
    }

    const idx = Math.min(page, totalPages);
    if (page === 1 && task.outputObjectKey) {
      if (publicBase) {
        return Response.json({
          preview_url: `${publicBase}/${encodeR2KeyForPublicUrl(task.outputObjectKey)}`,
          total_pages: totalPages,
        });
      }
      return Response.json({
        preview_url: await createPresignedGet(task.outputObjectKey, 3600),
        total_pages: totalPages,
      });
    }

    const sliceKeyResolved = `${SLICE_PREFIX}${taskId}/page-${idx}.pdf`;
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(srcPdf, [idx - 1]);
    newPdf.addPage(copiedPage);
    const sliceBytes = await newPdf.save();

    await putObject(sliceKeyResolved, sliceBytes);
    const previewUrl = await createPresignedGet(sliceKeyResolved, 3600);

    return Response.json({
      preview_url: previewUrl,
      total_pages: totalPages,
    });
  } catch (e) {
    console.error('task output-preview-url failed:', e);
    const err = e as NodeJS.ErrnoException & { name?: string };
    const msg = err?.message ?? '';
    const isTimeout =
      err?.code === 'ETIMEDOUT' ||
      err?.name === 'TimeoutError' ||
      (typeof msg === 'string' && msg.includes('ETIMEDOUT'));
    const isNotFound =
      (typeof msg === 'string' && (msg.includes('404') || msg.includes('not found'))) ||
      err?.message === 'R2 get failed: 404';
    const message = isTimeout
      ? 'Storage connection timed out. Check network or try again later.'
      : isNotFound
        ? 'Output file not found in storage. It may still be uploading.'
        : e instanceof Error
          ? e.message
          : 'Preview failed';
    const status = isNotFound ? 404 : isTimeout ? 503 : 500;
    return Response.json({ detail: message }, { status });
  }
}
