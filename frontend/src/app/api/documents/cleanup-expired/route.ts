import { lt, inArray, count } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { deleteObject } from '@/shared/lib/translate-r2';
import { UPLOAD_KEY_PREFIX } from '@/app/api/upload/constants';

/**
 * POST /api/documents/cleanup-expired
 *
 * 删除 expiresAt < now() 的文档及其关联的 translation_tasks，并从 R2 移除文件。
 * 仅限 cron 调用，需 x-cron-secret 头匹配 CRON_SECRET 环境变量。
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { detail: 'Cleanup not configured (CRON_SECRET missing)' },
      { status: 503 }
    );
  }
  const provided = req.headers.get('x-cron-secret');
  if (provided !== secret) {
    return Response.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const expired = await db()
      .select({ id: documents.id, objectKey: documents.objectKey })
      .from(documents)
      .where(lt(documents.expiresAt, now));
    const ids = expired.map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      return Response.json({
        deleted_documents: 0,
        deleted_tasks: 0,
        deleted_r2_objects: 0,
      });
    }

    // 1. 从 R2 删除过期的文件对象
    let r2Deleted = 0;
    const r2Errors: string[] = [];
    for (const row of expired) {
      if (!row.objectKey) continue;
      try {
        await deleteObject(row.objectKey);
        r2Deleted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cleanup-expired] R2 delete failed for ${row.objectKey}: ${msg}`);
        r2Errors.push(`${row.objectKey}: ${msg}`);
      }
    }

    // 2. 同时尝试清理 uploads/ 前缀下对应的源文件（objectKey 通常是 uploads/xxx.pdf）
    //    额外扫描：某些过期文档的 objectKey 可能不在 uploads/ 下，也要清理
    let r2ExtraDeleted = 0;
    for (const row of expired) {
      if (!row.objectKey || row.objectKey.startsWith(UPLOAD_KEY_PREFIX)) continue;
      // 如果 R2 key 不在 uploads/ 前缀，也尝试删除对应的 uploads/ 副本
      const filename = row.objectKey.split('/').pop() || '';
      const uploadsKey = `${UPLOAD_KEY_PREFIX}${filename}`;
      if (uploadsKey === row.objectKey) continue; // 已经是同个 key，跳过
      try {
        await deleteObject(uploadsKey);
        r2ExtraDeleted++;
      } catch {
        // 404 等均视为正常（可能无此副本）
      }
    }

    // 3. 删除 DB 中的关联记录
    const [{ count: taskCount }] = await db()
      .select({ count: count() })
      .from(translationTasks)
      .where(inArray(translationTasks.documentId, ids));
    await db()
      .delete(translationTasks)
      .where(inArray(translationTasks.documentId, ids));
    await db()
      .delete(documents)
      .where(inArray(documents.id, ids));

    return Response.json({
      deleted_documents: ids.length,
      deleted_tasks: taskCount ?? 0,
      deleted_r2_objects: r2Deleted,
      deleted_r2_extra: r2ExtraDeleted,
      r2_errors: r2Errors.length > 0 ? r2Errors : undefined,
    });
  } catch (e) {
    console.error('cleanup-expired failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Cleanup failed' },
      { status: 500 }
    );
  }
}
