import { eq, desc } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents } from '@/config/db/schema';
import type { InferSelectModel } from 'drizzle-orm';
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
    const { userId, anonId } = await getTranslateAuth();
    const rows = await db()
      .select()
      .from(documents)
      .where(
        userId ? eq(documents.userId, userId) : eq(documents.anonId, anonId)
      )
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset);
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
