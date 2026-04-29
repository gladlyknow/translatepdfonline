import { nanoid } from 'nanoid';
import { db } from '@/core/db';
import { documents } from '@/config/db/schema';
import { getTranslateAuth } from '../../../translate/auth';
import {
  MAX_PDF_BYTES,
  isValidObjectKey,
  sanitizeFilename,
} from '../../constants';
import { ensureDocumentPageCount } from '@/shared/lib/document-page-count';

export async function POST(req: Request) {
  try {
    const { userId } = await getTranslateAuth();
    if (!userId) {
      return Response.json(
        { detail: 'Login required to upload' },
        { status: 401 }
      );
    }
    const body = await req.json();
    const objectKey =
      typeof body.object_key === 'string' ? body.object_key.trim() : '';
    if (!objectKey || !isValidObjectKey(objectKey)) {
      return Response.json(
        { detail: 'Invalid object_key format' },
        { status: 400 }
      );
    }
    const sizeBytes = Number(body.size_bytes) || 0;
    if (sizeBytes <= 0 || sizeBytes > MAX_PDF_BYTES) {
      return Response.json(
        { detail: 'Invalid size: must be between 1 and 100 MB' },
        { status: 400 }
      );
    }
    const filename = sanitizeFilename(
      typeof body.filename === 'string' ? body.filename : 'document.pdf'
    );
    const documentId = nanoid(21);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db()
      .insert(documents)
      .values({
        id: documentId,
        userId,
        anonId: null,
        objectKey,
        filename,
        sizeBytes,
        status: 'uploaded',
        expiresAt,
      });
    const pageCountResult = await ensureDocumentPageCount({
      documentId,
      objectKey,
      knownPageCount: null,
      reason: 'upload_complete',
    });
    return Response.json({
      document_id: documentId,
      page_count: pageCountResult.pageCount,
      page_count_ready: pageCountResult.pageCount != null,
    });
  } catch (e) {
    console.error('complete presigned upload failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Complete failed' },
      { status: 500 }
    );
  }
}
