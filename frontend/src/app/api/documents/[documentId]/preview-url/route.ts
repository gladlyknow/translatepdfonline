import { eq, and } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { db } from '@/core/db';
import { documents } from '@/config/db/schema';
import { getTranslateAuth } from '../../../translate/auth';
import {
  createPresignedGet,
  encodeR2KeyForPublicUrl,
  getObjectBody,
  getR2PublicBaseUrl,
  isR2Configured,
  putObject,
  r2ObjectExists,
} from '@/shared/lib/translate-r2';
import { isCloudflareWorker } from '@/shared/lib/env';

const SLICE_PREFIX = 'slices/';

/** Worker 内存紧：限制整本加载；超出则要求依赖公网首屏或已缓存切片 */
function maxPreviewLoadBytes(): number {
  return isCloudflareWorker ? 8 * 1024 * 1024 : 64 * 1024 * 1024;
}

function tooLargeDetail(maxMb: number): string {
  return `PDF too large for server-side page slicing on this plan (>${maxMb}MB). Use page 1 preview, download the file, or split the PDF.`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const { userId, anonId } = await getTranslateAuth();
    const where = userId
      ? eq(documents.userId, userId)
      : eq(documents.anonId, anonId);
    const [doc] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), where));
    if (!doc) {
      return Response.json({ detail: 'Not found' }, { status: 404 });
    }
    if (!(await isR2Configured())) {
      return Response.json(
        { detail: 'Storage not configured' },
        { status: 503 }
      );
    }
    const url = new URL(req.url);
    const pageParam = url.searchParams.get('page');
    const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);

    const maxBytes = maxPreviewLoadBytes();
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    const totalFromDoc =
      doc.pageCount != null && doc.pageCount > 0 ? doc.pageCount : null;

    const publicBase = getR2PublicBaseUrl();

    // 第 1 页：公网直链（有 R2_PUBLIC_URL）或预签名（无公网 base），避免大文件仅因缺 publicBase 命中 413
    if (page === 1 && doc.objectKey) {
      if (publicBase) {
        if (totalFromDoc != null) {
          return Response.json({
            preview_url: `${publicBase}/${encodeR2KeyForPublicUrl(doc.objectKey)}`,
            total_pages: totalFromDoc,
          });
        }
        if (doc.sizeBytes > maxBytes) {
          return Response.json({
            preview_url: `${publicBase}/${encodeR2KeyForPublicUrl(doc.objectKey)}`,
            total_pages: 0,
          });
        }
        const pdfBytes = await getObjectBody(doc.objectKey);
        const srcPdf = await PDFDocument.load(pdfBytes);
        const totalPages = srcPdf.getPageCount();
        if (totalPages > 0 && (doc.pageCount == null || doc.pageCount < 1)) {
          await db()
            .update(documents)
            .set({ pageCount: totalPages })
            .where(eq(documents.id, documentId))
            .catch(() => {});
        }
        return Response.json({
          preview_url: `${publicBase}/${encodeR2KeyForPublicUrl(doc.objectKey)}`,
          total_pages: totalPages,
        });
      }
      if (totalFromDoc != null) {
        return Response.json({
          preview_url: await createPresignedGet(doc.objectKey, 3600),
          total_pages: totalFromDoc,
        });
      }
      if (doc.sizeBytes > maxBytes) {
        return Response.json({
          preview_url: await createPresignedGet(doc.objectKey, 3600),
          total_pages: 0,
        });
      }
      const pdfBytesEarly = await getObjectBody(doc.objectKey);
      const srcPdfEarly = await PDFDocument.load(pdfBytesEarly);
      const totalPagesEarly = srcPdfEarly.getPageCount();
      if (totalPagesEarly > 0 && (doc.pageCount == null || doc.pageCount < 1)) {
        await db()
          .update(documents)
          .set({ pageCount: totalPagesEarly })
          .where(eq(documents.id, documentId))
          .catch(() => {});
      }
      return Response.json({
        preview_url: await createPresignedGet(doc.objectKey, 3600),
        total_pages: totalPagesEarly,
      });
    }

    const totalHint = totalFromDoc;
    const pageIndex =
      totalHint != null ? Math.min(page, totalHint) : page;
    const sliceKey = `${SLICE_PREFIX}${documentId}/page-${pageIndex}.pdf`;

    // 已缓存单页切片：只签发 URL，不加载原文件
    if (totalHint != null && (await r2ObjectExists(sliceKey))) {
      const previewUrl = await createPresignedGet(sliceKey, 3600);
      return Response.json({
        preview_url: previewUrl,
        total_pages: totalHint,
      });
    }

    if (doc.sizeBytes > maxBytes) {
      return Response.json({ detail: tooLargeDetail(maxMb) }, { status: 413 });
    }

    const pdfBytes = await getObjectBody(doc.objectKey);
    const srcPdf = await PDFDocument.load(pdfBytes);
    const totalPages = srcPdf.getPageCount();
    if (totalPages < 1) {
      return Response.json({ detail: 'PDF has no pages' }, { status: 400 });
    }
    if (totalPages > 0 && (doc.pageCount == null || doc.pageCount < 1)) {
      await db()
        .update(documents)
        .set({ pageCount: totalPages })
        .where(eq(documents.id, documentId))
        .catch(() => {});
    }

    const idx = Math.min(page, totalPages);

    const sliceKeyResolved = `${SLICE_PREFIX}${documentId}/page-${idx}.pdf`;
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
    console.error('document preview-url failed:', e);
    const err = e as Error & { cause?: { code?: string } };
    const msg = err?.message ?? '';
    const isTimeout =
      typeof msg === 'string' &&
      (msg.includes('timed out') || msg.includes('timeout'));
    const status = isTimeout ? 503 : 500;
    const detail = isTimeout
      ? 'Storage connection timed out. Check network or try again later.'
      : e instanceof Error
        ? e.message
        : 'Preview failed';
    return Response.json({ detail }, { status });
  }
}
