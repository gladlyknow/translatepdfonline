import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { docConvertTasks } from '@/config/db/schema';

export type DocConvertTask = typeof docConvertTasks.$inferSelect;
export type NewDocConvertTask = typeof docConvertTasks.$inferInsert;

export const DocConvertTaskStatus = {
  uploaded: 'uploaded',
  submitted: 'submitted',
  processing: 'processing',
  ready: 'ready',
  failed: 'failed',
} as const;

export async function createDocConvertTask(row: NewDocConvertTask) {
  const [r] = await db().insert(docConvertTasks).values(row).returning();
  return r;
}

export async function findDocConvertTaskForUser(id: string, userId: string) {
  const [r] = await db()
    .select()
    .from(docConvertTasks)
    .where(
      and(eq(docConvertTasks.id, id), eq(docConvertTasks.userId, userId))
    );
  return r ?? null;
}

export async function findDocConvertTaskById(id: string) {
  const [r] = await db()
    .select()
    .from(docConvertTasks)
    .where(eq(docConvertTasks.id, id));
  return r ?? null;
}

export async function updateDocConvertTask(
  id: string,
  patch: Partial<Omit<DocConvertTask, 'id' | 'userId' | 'createdAt'>>
) {
  const [r] = await db()
    .update(docConvertTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(docConvertTasks.id, id))
    .returning();
  return r ?? null;
}

export async function listDocConvertTasks(
  userId: string,
  limit = 20,
  offset = 0
) {
  return db()
    .select()
    .from(docConvertTasks)
    .where(eq(docConvertTasks.userId, userId))
    .orderBy(desc(docConvertTasks.createdAt))
    .offset(Math.max(0, offset))
    .limit(limit);
}
