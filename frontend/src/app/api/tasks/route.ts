import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks, documents } from '@/config/db/schema';
import { getTranslateAuth } from '../translate/auth';

function parseNumberParam(url: URL, name: string, fallback: number): number {
  const raw = Number(url.searchParams.get(name));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.floor(raw));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseNumberParam(url, 'limit', 100)));
    const offset = parseNumberParam(url, 'offset', 0);
    const ocrOnly = url.searchParams.get('ocr_only') === '1';
    const { userId, anonId } = await getTranslateAuth();
    const ownerWhere = userId
      ? eq(translationTasks.userId, userId)
      : eq(translationTasks.anonId, anonId);
    const where = ocrOnly
      ? and(ownerWhere, eq(translationTasks.preprocessWithOcr, true))
      : ownerWhere;
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
      .limit(limit)
      .offset(offset);
    type TaskListRow = (typeof rows)[number];
    const normalized = rows.map((r: TaskListRow) => ({
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
      }));
    return Response.json(normalized);
  } catch (e) {
    console.error('list tasks failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'List failed' },
      { status: 500 }
    );
  }
}
