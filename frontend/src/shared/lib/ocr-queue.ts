import { getCloudflareContext } from '@opennextjs/cloudflare';
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { runOcrTranslatePipeline } from '@/shared/lib/ocr-translate';

export type OcrPipelineQueueBody = { taskId: string };

/**
 * 向 Cloudflare Queues 投递 OCR 任务（需在 Dashboard 创建 `ocr-pipeline-queue` 并部署带 producer 绑定的 Worker）。
 * 非 Worker 或未配置绑定时返回 false，由调用方回退到 waitUntil(dispatchPendingOcrJobs)。
 */
export async function sendOcrPipelineQueueMessage(taskId: string): Promise<boolean> {
  try {
    const wrapped = getCloudflareContext() as unknown as {
      env?: { OCR_PIPELINE_QUEUE?: { send: (b: OcrPipelineQueueBody) => Promise<void> } };
    };
    const q = wrapped?.env?.OCR_PIPELINE_QUEUE;
    if (!q || typeof q.send !== 'function') return false;
    await q.send({ taskId });
    console.log('[ocr/queue] enqueued', JSON.stringify({ task_id: taskId }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Queues consumer 入口：与 OpenNext 默认 `fetch` 导出合并为 `export default { fetch, queue }` 时调用。
 * batch 建议 max_batch_size=1，避免长任务并行占满 CPU。
 */
export async function handleOcrPipelineQueueBatch(batch: {
  messages: Array<{ body: OcrPipelineQueueBody }>;
}): Promise<void> {
  for (const msg of batch.messages) {
    const taskId = msg.body?.taskId;
    if (!taskId || typeof taskId !== 'string') continue;
    await invokeOcrPipelineForTask(taskId);
  }
}

const DEFAULT_OCR_BATCH_SIZE = 4;

function ocrBackoffMs(attempt: number): number {
  const base = 15_000;
  const max = 8 * 60_000;
  const exp = Math.min(6, Math.max(0, attempt - 1));
  return Math.min(max, base * 2 ** exp);
}

function isTransientOcrError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('temporarily') ||
    msg.includes('429') ||
    msg.includes('503')
  );
}

export async function enqueueOcrTask(taskId: string): Promise<void> {
  await db()
    .update(translationTasks)
    .set({
      status: 'queued',
      progressStage: 'ocr_enqueued',
      progressPercent: 8,
      fcNextAttemptAt: new Date(),
      fcInvokeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(translationTasks.id, taskId), eq(translationTasks.preprocessWithOcr, true)));
}

export async function invokeOcrPipelineForTask(taskId: string): Promise<void> {
  const now = new Date();
  const leaseUntil = new Date(Date.now() + 180_000);
  const claimed = await db()
    .update(translationTasks)
    .set({ fcInvokeLeaseUntil: leaseUntil, updatedAt: new Date() })
    .where(
      and(
        eq(translationTasks.id, taskId),
        eq(translationTasks.preprocessWithOcr, true),
        eq(translationTasks.status, 'queued'),
        or(
          isNull(translationTasks.fcNextAttemptAt),
          lte(translationTasks.fcNextAttemptAt, now)
        ),
        or(
          isNull(translationTasks.fcInvokeLeaseUntil),
          lte(translationTasks.fcInvokeLeaseUntil, now)
        )
      )
    )
    .returning();

  if (!claimed.length) return;

  const row = claimed[0];
  const [doc] = await db()
    .select()
    .from(documents)
    .where(eq(documents.id, row.documentId))
    .limit(1);

  if (!doc) {
    await db()
      .update(translationTasks)
      .set({
        status: 'failed',
        errorCode: 'document_missing',
        errorMessage: 'Document not found for OCR task',
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    return;
  }

  await db()
    .update(translationTasks)
    .set({
      status: 'processing',
      progressPercent: 16,
      progressStage: 'ocr_consumer_started',
      fcInvokeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, taskId));

  const outputPdfObjectKey = `translations/${taskId}/ocr-output.pdf`;
  const outputMdObjectKey = `translations/${taskId}/ocr-output.md`;
  const outputParseResultObjectKey = `translations/${taskId}/ocr-parse-result.json`;
  const prevAttempts = row.fcDispatchAttemptCount ?? 0;
  const thisAttempt = prevAttempts + 1;

  const pipelineStartedAt = Date.now();
  try {
    await runOcrTranslatePipeline({
      sourcePdfObjectKey: row.sourceSliceObjectKey || doc.objectKey,
      sourceFilename: doc.filename,
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
      outputPdfObjectKey,
      outputMdObjectKey,
      outputParseResultObjectKey,
    });

    await db()
      .update(translationTasks)
      .set({
        status: 'completed',
        outputObjectKey: outputPdfObjectKey,
        outputPrimaryPath: outputMdObjectKey,
        progressPercent: 100,
        progressStage: 'ocr_completed',
        errorCode: null,
        errorMessage: null,
        fcNextAttemptAt: null,
        fcDispatchAttemptCount: 0,
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    console.log(
      '[ocr/consumer] completed',
      JSON.stringify({
        task_id: taskId,
        elapsed_ms: Date.now() - pipelineStartedAt,
        output_pdf: outputPdfObjectKey,
        output_md: outputMdObjectKey,
      })
    );
  } catch (e) {
    const allowRetry =
      isTransientOcrError(e) &&
      thisAttempt < Math.max(1, Number(process.env.OCR_PIPELINE_MAX_ATTEMPTS) || 3);
    if (allowRetry) {
      const nextAt = new Date(Date.now() + ocrBackoffMs(thisAttempt));
      await db()
        .update(translationTasks)
        .set({
          status: 'queued',
          progressStage: 'ocr_retry_scheduled',
          progressPercent: 10,
          errorMessage: `OCR pipeline transient error: ${
            e instanceof Error ? e.message : String(e)
          }`.slice(0, 500),
          fcDispatchAttemptCount: thisAttempt,
          fcNextAttemptAt: nextAt,
          fcInvokeLeaseUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(translationTasks.id, taskId));
      console.warn(
        '[ocr/consumer] retry_scheduled',
        JSON.stringify({
          task_id: taskId,
          attempt: thisAttempt,
          next_at: nextAt.toISOString(),
          error: e instanceof Error ? e.message : String(e),
        })
      );
      return;
    }

    await db()
      .update(translationTasks)
      .set({
        status: 'failed',
        errorCode: 'ocr_pipeline_failed',
        errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        progressPercent: 0,
        progressStage: 'ocr_failed',
        fcNextAttemptAt: null,
        fcDispatchAttemptCount: thisAttempt,
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    console.error(
      '[ocr/consumer] failed',
      JSON.stringify({
        task_id: taskId,
        attempt: thisAttempt,
        error: e instanceof Error ? e.message : String(e),
      })
    );
  }
}

export async function dispatchPendingOcrJobs(limit = DEFAULT_OCR_BATCH_SIZE): Promise<{
  processed: number;
  task_ids: string[];
}> {
  const now = new Date();
  const taskIds: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const rows = await db()
      .select({ id: translationTasks.id })
      .from(translationTasks)
      .where(
        and(
          eq(translationTasks.preprocessWithOcr, true),
          eq(translationTasks.status, 'queued'),
          or(
            isNull(translationTasks.fcNextAttemptAt),
            lte(translationTasks.fcNextAttemptAt, now)
          ),
          or(
            isNull(translationTasks.fcInvokeLeaseUntil),
            lte(translationTasks.fcInvokeLeaseUntil, now)
          )
        )
      )
      .orderBy(asc(translationTasks.createdAt))
      .limit(1);
    const id = rows[0]?.id;
    if (!id) break;
    await invokeOcrPipelineForTask(id);
    taskIds.push(id);
  }
  return { processed: taskIds.length, task_ids: taskIds };
}
