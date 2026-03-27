import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/core/db';
import { documents } from '@/config/db/schema';
import { getTranslateAuth } from '../../translate/auth';
import { createPresignedPut, isR2Configured } from '@/shared/lib/translate-r2';

export async function POST(req: Request) {
  try {
    const { userId, anonId } = await getTranslateAuth();
    if (!(await isR2Configured())) {
      return Response.json(
        { detail: 'Storage not configured' },
        { status: 503 }
      );
    }
    const body = await req.json();
    const documentId = body.document_id;
    const pageRange = body.page_range;
    if (!documentId || !pageRange) {
      return Response.json(
        { detail: 'document_id and page_range required' },
        { status: 400 }
      );
    }
    const where = userId
      ? eq(documents.userId, userId)
      : eq(documents.anonId, anonId);
    const [doc] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), where));
    if (!doc) {
      return Response.json({ detail: 'Document not found' }, { status: 404 });
    }
    const sliceObjectKey = `slices/${documentId}/${nanoid(12)}.pdf`;
    const uploadUrl = await createPresignedPut(
      sliceObjectKey,
      'application/pdf',
      900
    );
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return Response.json({
      upload_url: uploadUrl,
      slice_object_key: sliceObjectKey,
      expires_at: expiresAt,
    });
  } catch (e) {
    console.error('presigned slice failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Request failed' },
      { status: 500 }
    );
  }
}
