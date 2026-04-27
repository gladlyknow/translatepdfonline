import { eq, and } from 'drizzle-orm';
import { db } from '@/core/db';
import { translationTasks, documents } from '@/config/db/schema';
import { getTranslateAuth } from '../../../translate/auth';
import { createPresignedGet, isR2Configured } from '@/shared/lib/translate-r2';
import { listExportsForTask, OcrTaskExportStatus } from '@/shared/models/ocr_task_export';

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
    let mdFileUrl: string | null = null;
    let ocrParseResultUrl: string | null = null;
    const outputs: { filename: string; download_url: string }[] = [];
    const exportRows = task.preprocessWithOcr ? await listExportsForTask(taskId) : [];
    const readyPdfExport = exportRows.find(
      (r: (typeof exportRows)[number]) =>
        r.format === 'pdf' && r.status === OcrTaskExportStatus.ready && r.r2Key
    );
    const readyMdExport = exportRows.find(
      (r: (typeof exportRows)[number]) =>
        r.format === 'md' && r.status === OcrTaskExportStatus.ready && r.r2Key
    );
    if (await isR2Configured()) {
      try {
        const sourceKey =
          task.sourceSliceObjectKey ?? doc?.objectKey ?? null;
        if (sourceKey) {
          sourcePdfUrl = await createPresignedGet(sourceKey, 3600);
        }
      } catch (_) {}
      const pdfKey = readyPdfExport?.r2Key ?? task.outputObjectKey;
      if (pdfKey && task.status === 'completed') {
        try {
          const outputDisp = 'attachment; filename="translation.pdf"';
          primaryFileUrl = await createPresignedGet(pdfKey, 3600, {
            responseContentDisposition: outputDisp,
          });
          outputs.push({
            filename: 'translation.pdf',
            download_url: primaryFileUrl,
          });
        } catch (_) {}
      }
      const mdKey = readyMdExport?.r2Key ?? task.outputPrimaryPath;
      if (mdKey && task.status === 'completed') {
        try {
          const mdDisp = 'attachment; filename="translation.md"';
          mdFileUrl = await createPresignedGet(mdKey, 3600, {
            responseContentDisposition: mdDisp,
          });
          outputs.push({
            filename: 'translation.md',
            download_url: mdFileUrl,
          });
        } catch (_) {}
      }
      if (task.preprocessWithOcr && task.status === 'completed') {
        const parseKey = `translations/${taskId}/ocr-parse-result.json`;
        try {
          const jsonDisp = 'attachment; filename="ocr-parse-result.json"';
          ocrParseResultUrl = await createPresignedGet(parseKey, 3600, {
            responseContentDisposition: jsonDisp,
          });
          outputs.push({
            filename: 'ocr-parse-result.json',
            download_url: ocrParseResultUrl,
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
        preprocess_with_ocr: task.preprocessWithOcr,
      },
      document_filename: documentFilename,
      document_size_bytes: documentSizeBytes,
      outputs,
      primary_file_url: primaryFileUrl,
      source_pdf_url: sourcePdfUrl,
      ocr_parse_result_url: ocrParseResultUrl,
      can_download: Boolean(primaryFileUrl || mdFileUrl),
      exports: exportRows.map((row: (typeof exportRows)[number]) => ({
        id: row.id,
        format: row.format,
        status: row.status,
        error_message: row.errorMessage,
        updated_at: row.updatedAt?.toISOString?.() ?? row.updatedAt,
      })),
    });
  } catch (e) {
    console.error('get task view failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Get failed' },
      { status: 500 }
    );
  }
}
