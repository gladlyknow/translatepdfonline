import { eq, desc } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks, documents } from '@/config/db/schema';
import { getTranslateAuth } from '../translate/auth';

export async function GET() {
  try {
    const { userId, anonId } = await getTranslateAuth();
    const where = userId
      ? eq(translationTasks.userId, userId)
      : eq(translationTasks.anonId, anonId);
    const rows = await db()
      .select({
        id: translationTasks.id,
        documentId: translationTasks.documentId,
        status: translationTasks.status,
        sourceLang: translationTasks.sourceLang,
        targetLang: translationTasks.targetLang,
        preprocessWithOcr: translationTasks.preprocessWithOcr,
        createdAt: translationTasks.createdAt,
        updatedAt: translationTasks.updatedAt,
        pageRange: translationTasks.pageRange,
        pageRangeUserInput: translationTasks.pageRangeUserInput,
        documentPageCount: documents.pageCount,
        filename: documents.filename,
      })
      .from(translationTasks)
      .leftJoin(documents, eq(documents.id, translationTasks.documentId))
      .where(where)
      .orderBy(desc(translationTasks.createdAt))
      .limit(100);
    type TaskListRow = (typeof rows)[number];
    return Response.json(
      rows.map((r: TaskListRow) => ({
        id: r.id,
        document_id: r.documentId,
        status: r.status,
        source_lang: r.sourceLang,
        target_lang: r.targetLang,
        preprocess_with_ocr: Boolean(r.preprocessWithOcr),
        created_at: r.createdAt?.toISOString?.() ?? r.createdAt,
        updated_at: r.updatedAt?.toISOString?.() ?? r.updatedAt,
        document_filename: r.filename ?? null,
        page_range: r.pageRange,
        page_range_user_input: r.pageRangeUserInput ?? null,
        document_page_count: r.documentPageCount ?? null,
      }))
    );
  } catch (e) {
    console.error('list tasks failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'List failed' },
      { status: 500 }
    );
  }
}
