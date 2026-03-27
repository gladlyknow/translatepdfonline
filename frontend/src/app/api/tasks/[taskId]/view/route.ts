import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks, documents } from '@/config/db/schema';
import { getTranslateAuth } from '../../../translate/auth';
import { createPresignedGet, isR2Configured } from '@/shared/lib/translate-r2';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { userId, anonId } = await getTranslateAuth();
    const where = userId
      ? eq(translationTasks.userId, userId)
      : eq(translationTasks.anonId, anonId);
    const [task] = await db()
      .select()
      .from(translationTasks)
      .where(and(eq(translationTasks.id, taskId), where));
    if (!task) {
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }
    const [doc] = await db()
      .select()
      .from(documents)
      .where(eq(documents.id, task.documentId));
    const documentFilename = doc?.filename ?? '';
    const documentSizeBytes = doc?.sizeBytes ?? 0;
    let sourcePdfUrl: string | null = null;
    let primaryFileUrl: string | null = null;
    const outputs: { filename: string; download_url: string }[] = [];
    if (await isR2Configured()) {
      try {
        const sourceKey =
          task.sourceSliceObjectKey ?? doc?.objectKey ?? null;
        if (sourceKey) {
          sourcePdfUrl = await createPresignedGet(sourceKey, 3600);
        }
      } catch (_) {}
      if (task.outputObjectKey && task.status === 'completed') {
        try {
          const outputDisp = 'attachment; filename="translation.pdf"';
          primaryFileUrl = await createPresignedGet(task.outputObjectKey, 3600, {
            responseContentDisposition: outputDisp,
          });
          outputs.push({
            filename: 'translation.pdf',
            download_url: primaryFileUrl,
          });
        } catch (_) {}
      }
    }
    return Response.json({
      task: {
        id: task.id,
        document_id: task.documentId,
        source_lang: task.sourceLang,
        target_lang: task.targetLang,
        page_range: task.pageRange,
        page_range_user_input: task.pageRangeUserInput ?? null,
        status: task.status,
        created_at: task.createdAt?.toISOString?.() ?? task.createdAt,
        updated_at: task.updatedAt?.toISOString?.() ?? task.updatedAt,
        error_code: task.errorCode,
        error_message: task.errorMessage,
        progress_percent: task.progressPercent,
        progress_stage: task.progressStage,
        progress_current: task.progressCurrent,
        progress_total: task.progressTotal,
      },
      document_filename: documentFilename,
      document_size_bytes: documentSizeBytes,
      outputs,
      primary_file_url: primaryFileUrl,
      source_pdf_url: sourcePdfUrl,
      can_download: true,
    });
  } catch (e) {
    console.error('get task view failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Get failed' },
      { status: 500 }
    );
  }
}
