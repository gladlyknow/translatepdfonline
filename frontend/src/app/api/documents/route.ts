import { eq, desc } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents } from '@/config/db/schema';
import type { InferSelectModel } from 'drizzle-orm';
import { getTranslateAuth } from '../translate/auth';

export async function GET() {
  try {
    const { userId, anonId } = await getTranslateAuth();
    const rows = await db()
      .select()
      .from(documents)
      .where(
        userId ? eq(documents.userId, userId) : eq(documents.anonId, anonId)
      )
      .orderBy(desc(documents.createdAt))
      .limit(100);
    return Response.json(
      rows.map((r: InferSelectModel<typeof documents>) => ({
        id: r.id,
        filename: r.filename,
        size_bytes: r.sizeBytes,
        status: r.status,
        created_at: r.createdAt?.toISOString?.() ?? r.createdAt,
      }))
    );
  } catch (e) {
    console.error('list documents failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'List failed' },
      { status: 500 }
    );
  }
}
