import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { db } from '@/core/db';
import { documents } from '@/config/db/schema';
import { getObjectBody } from '@/shared/lib/translate-r2';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAttempts(): number {
  return Math.max(1, Number(process.env.DOCUMENT_PAGECOUNT_RETRY_ATTEMPTS || '3') || 3);
}

function retryDelayMs(): number {
  return Math.max(100, Number(process.env.DOCUMENT_PAGECOUNT_RETRY_DELAY_MS || '350') || 350);
}

export async function extractPdfPageCountFromR2(
  objectKey: string
): Promise<number | null> {
  try {
    const pdfBytes = await getObjectBody(objectKey);
    const srcPdf = await PDFDocument.load(pdfBytes);
    const totalPages = srcPdf.getPageCount();
    return totalPages > 0 ? totalPages : null;
  } catch {
    return null;
  }
}

export async function ensureDocumentPageCount(params: {
  documentId: string;
  objectKey: string;
  knownPageCount?: number | null;
  reason: 'upload_complete' | 'ocr_precheck';
}): Promise<{
  pageCount: number | null;
  source: 'known' | 'r2_pdf' | 'unavailable';
  attempts: number;
  latencyMs: number;
}> {
  const startedAt = Date.now();
  const known = Number(params.knownPageCount || 0);
  if (known > 0) {
    return {
      pageCount: known,
      source: 'known',
      attempts: 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  const attempts = retryAttempts();
  const delayMs = retryDelayMs();
  for (let i = 1; i <= attempts; i += 1) {
    const pageCount = await extractPdfPageCountFromR2(params.objectKey);
    if (pageCount != null && pageCount > 0) {
      await db()
        .update(documents)
        .set({ pageCount })
        .where(
          and(
            eq(documents.id, params.documentId),
            or(isNull(documents.pageCount), lt(documents.pageCount, 1))
          )
        )
        .catch(() => {});
      console.log(
        '[document/page_count] backfill_ok',
        JSON.stringify({
          reason: params.reason,
          document_id: params.documentId,
          page_count: pageCount,
          attempts: i,
          latency_ms: Date.now() - startedAt,
        })
      );
      return {
        pageCount,
        source: 'r2_pdf',
        attempts: i,
        latencyMs: Date.now() - startedAt,
      };
    }
    if (i < attempts) {
      await sleep(delayMs);
    }
  }

  console.warn(
    '[document/page_count] backfill_unavailable',
    JSON.stringify({
      reason: params.reason,
      document_id: params.documentId,
      attempts,
      latency_ms: Date.now() - startedAt,
    })
  );
  return {
    pageCount: null,
    source: 'unavailable',
    attempts,
    latencyMs: Date.now() - startedAt,
  };
}
