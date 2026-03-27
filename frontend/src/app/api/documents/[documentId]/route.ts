import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { getTranslateAuth } from '../../translate/auth';

export async function GET(
  _req: Request,
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
    const pageCount =
      doc.pageCount != null && doc.pageCount > 0 ? doc.pageCount : null;
    return Response.json({
      id: doc.id,
      filename: doc.filename,
      size_bytes: doc.sizeBytes,
      status: doc.status,
      created_at: doc.createdAt?.toISOString?.() ?? doc.createdAt,
      expires_at: doc.expiresAt?.toISOString?.() ?? doc.expiresAt,
      page_count: pageCount,
    });
  } catch (e) {
    console.error('get document failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Get failed' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
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
    await db().delete(translationTasks).where(eq(translationTasks.documentId, documentId));
    await db().delete(documents).where(eq(documents.id, documentId));
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error('delete document failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Delete failed' },
      { status: 500 }
    );
  }
}
