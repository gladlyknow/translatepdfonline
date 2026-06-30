import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { documentCompareJob } from '@/config/db/schema';

export type DocumentCompareJob = typeof documentCompareJob.$inferSelect;
export type NewDocumentCompareJob = typeof documentCompareJob.$inferInsert;

export const DocumentCompareJobStatus = {
  uploaded: 'uploaded',
  submitted: 'submitted',
  processing: 'processing',
  ready: 'ready',
  failed: 'failed',
} as const;

export async function createCompareJob(row: NewDocumentCompareJob) {
  const [r] = await db().insert(documentCompareJob).values(row).returning();
  return r;
}

export async function findCompareJob(id: string) {
  const [r] = await db()
    .select()
    .from(documentCompareJob)
    .where(eq(documentCompareJob.id, id));
  return r ?? null;
}

export async function findCompareJobForUser(id: string, userId: string) {
  const [r] = await db()
    .select()
    .from(documentCompareJob)
    .where(
      and(
        eq(documentCompareJob.id, id),
        eq(documentCompareJob.userId, userId)
      )
    );
  return r ?? null;
}

export async function updateCompareJob(
  id: string,
  userId: string,
  patch: Partial<Omit<DocumentCompareJob, 'id' | 'userId' | 'createdAt'>>
) {
  const [r] = await db()
    .update(documentCompareJob)
    .set(patch as any)
    .where(
      and(
        eq(documentCompareJob.id, id),
        eq(documentCompareJob.userId, userId)
      )
    )
    .returning();
  return r ?? null;
}

export async function deleteCompareJob(id: string, userId: string) {
  const [r] = await db()
    .delete(documentCompareJob)
    .where(
      and(
        eq(documentCompareJob.id, id),
        eq(documentCompareJob.userId, userId)
      )
    )
    .returning();
  return r ?? null;
}

export async function listCompareJobs(
  userId: string,
  limit = 20,
  offset = 0
) {
  return db()
    .select()
    .from(documentCompareJob)
    .where(eq(documentCompareJob.userId, userId))
    .orderBy(desc(documentCompareJob.createdAt))
    .offset(Math.max(0, offset))
    .limit(limit);
}
