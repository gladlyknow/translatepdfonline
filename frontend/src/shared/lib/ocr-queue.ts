import { getCloudflareContext } from '@opennextjs/cloudflare';
import { and, asc, eq, isNull, lte, ne, or } from 'drizzle-orm';

import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import {
  loadMarkdownFromR2,
  runOcrAndPersistParse,
  translateMarkdownWithDeepSeek,
} from '@/shared/lib/ocr-translate';
import {
  ensureOcrPendingExportsForTask,
  processOcrTaskExport,
} from '@/shared/lib/ocr-export-queue';
import {
  appendExportLog,
  OcrTaskExportStatus,
  updateExportRow,
} from '@/shared/models/ocr_task_export';
import { putObject } from '@/shared/lib/translate-r2';
import { tryGetAlsCfEnv } from '@/shared/lib/worker-runtime-env';

export type OcrPipelineQueueBody =
  | {
      type: 'ocr_pipeline';
      taskId: string;
    }
  | {
      type: 'ocr_export_generate';
      taskId: string;
      exportId: string;
      format: 'pdf' | 'md';
    };
type OcrStage =
  | 'ocr_submit_poll'
  | 'ocr_parse_persisted'
  | 'translate_markdown'
  | 'export_outputs'
  | 'completed';

const DEFAULT_OCR_BATCH_SIZE = Math.min(
  2,
  Math.max(1, Number(process.env.OCR_DISPATCH_BATCH_SIZE || '2') || 2)
);
const OCR_TASK_TIMEOUT_MS = 20 * 60 * 1000;
const OCR_ACCOUNT_MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.OCR_ACCOUNT_MAX_CONCURRENCY || '2') || 2
);
const DEFAULT_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.OCR_PIPELINE_MAX_ATTEMPTS || '3') || 3
);

function nowIso() {
  return new Date().toISOString();
}

function stagePercent(stage: OcrStage): number {
  if (stage === 'ocr_submit_poll') return 20;
  if (stage === 'ocr_parse_persisted') return 45;
  if (stage === 'translate_markdown') return 70;
  if (stage === 'export_outputs') return 90;
  return 100;
}

function normalizeStage(raw: string | null | undefined): OcrStage {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'ocr_submit_poll') return 'ocr_submit_poll';
  if (s === 'ocr_parse_persisted') return 'ocr_parse_persisted';
  if (s === 'translate_markdown') return 'translate_markdown';
  if (s === 'export_outputs') return 'export_outputs';
  if (s === 'completed') return 'completed';
  return 'ocr_submit_poll';
}

function normalizeErrorCodeForStage(stage: OcrStage): string {
  return `ocr_stage_${stage}_failed`;
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

function outputKeys(taskId: string) {
  return {
    outputPdfObjectKey: `translations/${taskId}/ocr-output.pdf`,
    outputMdObjectKey: `translations/${taskId}/ocr-output.md`,
    outputParseResultObjectKey: `translations/${taskId}/ocr-parse-result.json`,
    sourceMarkdownObjectKey: `translations/${taskId}/ocr-source.md`,
    translatedMarkdownObjectKey: `translations/${taskId}/ocr-translated.md`,
  };
}

type EnqueueResult = 'enqueue_ok' | 'fallback_dispatcher';
type EnqueueFailureReason =
  | 'binding_unavailable'
  | 'enqueue_rate_limited'
  | 'enqueue_runtime_error';
type QueueSendResult =
  | { ok: true }
  | {
      ok: false;
      reason: EnqueueFailureReason;
      errorName?: string;
      errorMessage?: string;
      stackHead?: string;
    };

class OcrTaskCancelledError extends Error {
  constructor() {
    super('ocr_task_cancelled');
    this.name = 'OcrTaskCancelledError';
  }
}

function classifyEnqueueError(err: unknown): EnqueueFailureReason {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate')) {
    return 'enqueue_rate_limited';
  }
  return 'enqueue_runtime_error';
}

function sanitizeErrorForLog(err: unknown): {
  errorName?: string;
  errorMessage?: string;
  stackHead?: string;
} {
  if (!(err instanceof Error)) {
    return { errorMessage: String(err).slice(0, 300) };
  }
  return {
    errorName: err.name?.slice(0, 80),
    errorMessage: err.message?.slice(0, 300),
    stackHead: err.stack?.split('\n').slice(0, 2).join(' | ').slice(0, 500),
  };
}

async function enqueueNextStage(taskId: string, nextStage: OcrStage): Promise<EnqueueResult> {
  const sendResult = await sendOcrPipelineQueueMessage(taskId);
  if (sendResult.ok) return 'enqueue_ok';
  const fallbackDelayMs = sendResult.reason === 'enqueue_rate_limited' ? 5_000 : 3_000;
  await db()
    .update(translationTasks)
    .set({
      status: 'queued',
      progressStage: nextStage,
      progressPercent: stagePercent(nextStage),
      fcNextAttemptAt: new Date(Date.now() + fallbackDelayMs),
      fcInvokeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, taskId));
  console.warn(
    '[ocr/stage] enqueue_failed',
    JSON.stringify({
      task_id: taskId,
      next_stage: nextStage,
      fallback: 'dispatcher',
      fallback_reason: sendResult.reason,
      fallback_delay_ms: fallbackDelayMs,
    })
  );
  return 'fallback_dispatcher';
}

function needTranslateForTask(sourceLang: string, targetLang: string): boolean {
  const src = String(sourceLang || '').trim().toLowerCase();
  const tgt = String(targetLang || '').trim().toLowerCase();
  if (!src || !tgt) return false;
  return src !== tgt;
}

async function markStageQueued(taskId: string, stage: OcrStage, percent: number): Promise<void> {
  await db()
    .update(translationTasks)
    .set({
      status: 'queued',
      progressStage: stage,
      progressPercent: percent,
      fcNextAttemptAt: new Date(),
      fcInvokeLeaseUntil: null,
      fcDispatchAttemptCount: 0,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(and(eq(translationTasks.id, taskId), ne(translationTasks.status, 'cancelled')));
}

async function runOneStage(params: {
  taskId: string;
  stage: OcrStage;
  sourcePdfObjectKey: string;
  sourceFilename: string;
  sourceLang: string;
  targetLang: string;
}): Promise<OcrStage> {
  const keys = outputKeys(params.taskId);
  if (params.stage === 'ocr_submit_poll') {
    await runOcrAndPersistParse({
      sourcePdfObjectKey: params.sourcePdfObjectKey,
      sourceFilename: params.sourceFilename,
      outputParseResultObjectKey: keys.outputParseResultObjectKey,
      outputMarkdownObjectKey: keys.sourceMarkdownObjectKey,
    });
    return 'ocr_parse_persisted';
  }

  if (params.stage === 'ocr_parse_persisted') {
    return needTranslateForTask(params.sourceLang, params.targetLang)
      ? 'translate_markdown'
      : 'export_outputs';
  }

  if (params.stage === 'translate_markdown') {
    const markdown = await loadMarkdownFromR2(keys.sourceMarkdownObjectKey);
    const translated = await translateMarkdownWithDeepSeek({
      markdown,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
    });
    await putObject(
      keys.translatedMarkdownObjectKey,
      new TextEncoder().encode(translated),
      'text/markdown; charset=utf-8'
    );
    return 'export_outputs';
  }

  if (params.stage === 'export_outputs') {
    // 与 onlinepdftranslator 对齐：export_outputs 只负责投递异步导出任务，
    // 不在 OCR 主流水线中执行 PDF 渲染，避免 CPU 峰值。
    return 'completed';
  }

  return 'completed';
}

function getQueueBindingFromContext():
  | { send: (b: OcrPipelineQueueBody) => Promise<void> }
  | undefined {
  const fromAls = tryGetAlsCfEnv();
  const qAls = fromAls?.OCR_PIPELINE_QUEUE as
    | { send?: (b: OcrPipelineQueueBody) => Promise<void> }
    | undefined;
  if (qAls?.send) {
    // Return the original binding object to preserve method `this`.
    return qAls as { send: (b: OcrPipelineQueueBody) => Promise<void> };
  }

  try {
    const wrapped = getCloudflareContext() as unknown as {
      env?: { OCR_PIPELINE_QUEUE?: { send: (b: OcrPipelineQueueBody) => Promise<void> } };
    };
    return wrapped?.env?.OCR_PIPELINE_QUEUE;
  } catch {
    return undefined;
  }
}

/**
 * 向 Cloudflare Queues 投递 OCR 任务（需在 Dashboard 创建 `ocr-pipeline-queue` 并部署带 producer 绑定的 Worker）。
 * 非 Worker 或未配置绑定时返回 false，由调用方回退到 waitUntil(dispatchPendingOcrJobs)。
 */
export async function sendOcrPipelineQueueMessage(taskId: string): Promise<QueueSendResult> {
  try {
    const q = getQueueBindingFromContext();
    if (!q || typeof q.send !== 'function') {
      console.warn(
        '[ocr/queue] binding_unavailable',
        JSON.stringify({ task_id: taskId })
      );
      return { ok: false, reason: 'binding_unavailable' };
    }
    await q.send({ type: 'ocr_pipeline', taskId });
    console.log('[ocr/queue] enqueued', JSON.stringify({ task_id: taskId, at: nowIso() }));
    return { ok: true };
  } catch (e) {
    const reason = classifyEnqueueError(e);
    const sanitized = sanitizeErrorForLog(e);
    const tag =
      reason === 'enqueue_rate_limited'
        ? '[ocr/queue] enqueue_rate_limited'
        : '[ocr/queue] enqueue_runtime_error';
    console.warn(
      tag,
      JSON.stringify({
        task_id: taskId,
        reason,
        ...sanitized,
      })
    );
    return { ok: false, reason, ...sanitized };
  }
}

export async function sendOcrExportQueueMessage(params: {
  taskId: string;
  exportId: string;
  format: 'pdf' | 'md';
}): Promise<QueueSendResult> {
  try {
    const q = getQueueBindingFromContext();
    if (!q || typeof q.send !== 'function') {
      return { ok: false, reason: 'binding_unavailable' };
    }
    await q.send({
      type: 'ocr_export_generate',
      taskId: params.taskId,
      exportId: params.exportId,
      format: params.format,
    });
    console.log(
      '[ocr/export-queue] enqueued',
      JSON.stringify({
        task_id: params.taskId,
        export_id: params.exportId,
        format: params.format,
        at: nowIso(),
      })
    );
    return { ok: true };
  } catch (e) {
    const reason = classifyEnqueueError(e);
    const sanitized = sanitizeErrorForLog(e);
    console.warn(
      '[ocr/export-queue] enqueue_failed',
      JSON.stringify({
        task_id: params.taskId,
        export_id: params.exportId,
        format: params.format,
        reason,
        ...sanitized,
      })
    );
    return { ok: false, reason, ...sanitized };
  }
}

async function isTaskCancelled(taskId: string): Promise<boolean> {
  const rows = await db()
    .select({ status: translationTasks.status })
    .from(translationTasks)
    .where(eq(translationTasks.id, taskId))
    .limit(1);
  return rows[0]?.status === 'cancelled';
}

async function ensureTaskNotCancelled(taskId: string): Promise<void> {
  if (await isTaskCancelled(taskId)) {
    throw new OcrTaskCancelledError();
  }
}

async function deferTaskForConcurrency(
  taskId: string,
  reason: string
): Promise<void> {
  await db()
    .update(translationTasks)
    .set({
      status: 'queued',
      fcNextAttemptAt: new Date(Date.now() + 8_000),
      fcInvokeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, taskId));
  console.log(
    '[ocr/stage] deferred',
    JSON.stringify({ task_id: taskId, reason })
  );
}

/**
 * Queues consumer 入口：与 OpenNext 默认 `fetch` 导出合并为 `export default { fetch, queue }` 时调用。
 * batch 建议 max_batch_size=1，避免长任务并行占满 CPU。
 */
export async function handleOcrPipelineQueueBatch(batch: {
  messages: Array<{ body: OcrPipelineQueueBody }>;
}): Promise<void> {
  for (const msg of batch.messages) {
    const body = msg.body;
    if (!body || typeof body !== 'object') continue;
    if (body.type === 'ocr_pipeline' || !('type' in body)) {
      const taskId = (body as { taskId?: string }).taskId;
      if (!taskId || typeof taskId !== 'string') continue;
      await invokeOcrPipelineForTask(taskId);
      continue;
    }
    if (body.type === 'ocr_export_generate') {
      if (!body.exportId || typeof body.exportId !== 'string') continue;
      await processOcrTaskExport(body.exportId);
    }
  }
}

export async function enqueueOcrTask(taskId: string): Promise<void> {
  await db()
    .update(translationTasks)
    .set({
      status: 'queued',
      progressStage: 'ocr_submit_poll',
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
        or(isNull(translationTasks.fcNextAttemptAt), lte(translationTasks.fcNextAttemptAt, now)),
        or(
          isNull(translationTasks.fcInvokeLeaseUntil),
          lte(translationTasks.fcInvokeLeaseUntil, now)
        )
      )
    )
    .returning();
  if (!claimed.length) return;

  const row = claimed[0];
  const ownerWhere = row.userId
    ? eq(translationTasks.userId, row.userId)
    : eq(translationTasks.anonId, row.anonId ?? '');
  const ownerProcessingRows = await db()
    .select({ id: translationTasks.id })
    .from(translationTasks)
    .where(
      and(
        eq(translationTasks.preprocessWithOcr, true),
        eq(translationTasks.status, 'processing'),
        ownerWhere,
        ne(translationTasks.id, taskId)
      )
    )
    .limit(OCR_ACCOUNT_MAX_CONCURRENCY);
  if (ownerProcessingRows.length >= OCR_ACCOUNT_MAX_CONCURRENCY) {
    await deferTaskForConcurrency(taskId, 'owner_concurrency_limit');
    return;
  }
  const createdAtMs = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
  if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > OCR_TASK_TIMEOUT_MS) {
    await db()
      .update(translationTasks)
      .set({
        status: 'failed',
        progressStage: normalizeStage(row.progressStage),
        errorCode: 'ocr_task_timeout_20m',
        errorMessage: 'OCR task exceeded 20 minutes timeout window',
        fcNextAttemptAt: null,
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    console.warn('[ocr/stage] timeout', JSON.stringify({ task_id: taskId }));
    return;
  }
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
        progressStage: 'ocr_submit_poll',
        errorCode: 'document_missing',
        errorMessage: 'Document not found for OCR task',
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    return;
  }

  const stage = normalizeStage(row.progressStage);
  const startedAt = Date.now();
  const prevAttempts = row.fcDispatchAttemptCount ?? 0;
  const thisAttempt = prevAttempts + 1;
  console.log(
    '[ocr/stage] start',
    JSON.stringify({ task_id: taskId, stage, attempt: thisAttempt, at: nowIso() })
  );

  await db()
    .update(translationTasks)
    .set({
      status: 'processing',
      progressStage: stage,
      progressPercent: stagePercent(stage),
      fcInvokeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, taskId));

  try {
    await ensureTaskNotCancelled(taskId);
    const nextStage = await runOneStage({
      taskId,
      stage,
      sourcePdfObjectKey: row.sourceSliceObjectKey || doc.objectKey,
      sourceFilename: doc.filename,
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
    });
    await ensureTaskNotCancelled(taskId);

    if (nextStage === 'completed') {
      const pendingExports = await ensureOcrPendingExportsForTask({
        taskId,
        userId: row.userId ?? null,
        anonId: row.anonId ?? null,
        sourceLang: row.sourceLang,
        targetLang: row.targetLang,
      });
      for (const exp of pendingExports) {
        const enqueueExportResult = await sendOcrExportQueueMessage({
          taskId,
          exportId: exp.exportId,
          format: exp.format,
        });
        if (!enqueueExportResult.ok) {
          await updateExportRow(exp.exportId, {
            status: OcrTaskExportStatus.failed,
            r2Key: null,
            readyAt: null,
            errorMessage: 'Export queue unavailable',
          });
          await appendExportLog(
            exp.exportId,
            `enqueue failed: ${enqueueExportResult.reason}`
          );
          console.warn(
            '[ocr/export-queue] enqueue_failed',
            JSON.stringify({
              task_id: taskId,
              export_id: exp.exportId,
              format: exp.format,
              reason: enqueueExportResult.reason,
            })
          );
        }
      }
      await db()
        .update(translationTasks)
        .set({
          status: 'completed',
          progressStage: 'completed',
          progressPercent: 100,
          outputObjectKey: null,
          outputPrimaryPath: null,
          errorCode: null,
          errorMessage: null,
          fcNextAttemptAt: null,
          fcDispatchAttemptCount: 0,
          fcInvokeLeaseUntil: null,
          updatedAt: new Date(),
        })
        .where(and(eq(translationTasks.id, taskId), ne(translationTasks.status, 'cancelled')));
      console.log(
        '[ocr/stage] done',
        JSON.stringify({
          task_id: taskId,
          stage,
          next_stage: 'completed',
          elapsed_ms: Date.now() - startedAt,
        })
      );
      return;
    }

    await markStageQueued(taskId, nextStage, stagePercent(nextStage));
    await ensureTaskNotCancelled(taskId);
    const enqueueResult = await enqueueNextStage(taskId, nextStage);
    console.log(
      '[ocr/stage] done',
      JSON.stringify({
        task_id: taskId,
        stage,
        next_stage: nextStage,
        enqueue_result: enqueueResult,
        elapsed_ms: Date.now() - startedAt,
      })
    );
  } catch (e) {
    if (e instanceof OcrTaskCancelledError) {
      await db()
        .update(translationTasks)
        .set({
          status: 'cancelled',
          fcNextAttemptAt: null,
          fcInvokeLeaseUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(translationTasks.id, taskId));
      console.warn('[ocr/stage] cancelled', JSON.stringify({ task_id: taskId, stage }));
      return;
    }
    const transient = isTransientOcrError(e);
    if (transient && thisAttempt < DEFAULT_MAX_ATTEMPTS) {
      await db()
        .update(translationTasks)
        .set({
          status: 'queued',
          progressStage: stage,
          progressPercent: stagePercent(stage),
          errorCode: normalizeErrorCodeForStage(stage),
          errorMessage: `Stage retry (${stage}): ${
            e instanceof Error ? e.message : String(e)
          }`.slice(0, 500),
          fcDispatchAttemptCount: thisAttempt,
          fcNextAttemptAt: new Date(),
          fcInvokeLeaseUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(translationTasks.id, taskId));
      let enqueueResult = await enqueueNextStage(taskId, stage);
      console.warn(
        '[ocr/stage] retry',
        JSON.stringify({
          task_id: taskId,
          stage,
          attempt: thisAttempt,
          enqueue_result: enqueueResult,
          error: e instanceof Error ? e.message : String(e),
        })
      );
      return;
    }

    await db()
      .update(translationTasks)
      .set({
        status: 'failed',
        progressStage: stage,
        progressPercent: stagePercent(stage),
        errorCode: normalizeErrorCodeForStage(stage),
        errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        fcNextAttemptAt: null,
        fcDispatchAttemptCount: thisAttempt,
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    console.error(
      '[ocr/stage] failed',
      JSON.stringify({
        task_id: taskId,
        stage,
        attempt: thisAttempt,
        error: e instanceof Error ? e.message : String(e),
      })
    );
  }
}

export async function retryOcrTaskFromFailedStage(taskId: string): Promise<{
  ok: boolean;
  resumeStage?: OcrStage;
}> {
  const [row] = await db()
    .select({
      id: translationTasks.id,
      status: translationTasks.status,
      preprocessWithOcr: translationTasks.preprocessWithOcr,
      progressStage: translationTasks.progressStage,
    })
    .from(translationTasks)
    .where(eq(translationTasks.id, taskId))
    .limit(1);
  if (
    !row ||
    !row.preprocessWithOcr ||
    (row.status !== 'failed' && row.status !== 'cancelled')
  ) {
    return { ok: false };
  }
  const stage = normalizeStage(row.progressStage);
  await db()
    .update(translationTasks)
    .set({
      status: 'queued',
      progressStage: stage,
      progressPercent: stagePercent(stage),
      errorCode: null,
      errorMessage: null,
      fcDispatchAttemptCount: 0,
      fcNextAttemptAt: new Date(),
      fcInvokeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, taskId));
  await enqueueNextStage(taskId, stage);
  return { ok: true, resumeStage: stage };
}

export async function failTimedOutOcrTasks(limit = 20): Promise<number> {
  const deadline = new Date(Date.now() - OCR_TASK_TIMEOUT_MS);
  const rows = await db()
    .select({
      id: translationTasks.id,
      progressStage: translationTasks.progressStage,
    })
    .from(translationTasks)
    .where(
      and(
        eq(translationTasks.preprocessWithOcr, true),
        lte(translationTasks.createdAt, deadline),
        or(
          eq(translationTasks.status, 'queued'),
          eq(translationTasks.status, 'processing')
        )
      )
    )
    .orderBy(asc(translationTasks.createdAt))
    .limit(Math.max(1, limit));
  for (const row of rows) {
    await db()
      .update(translationTasks)
      .set({
        status: 'failed',
        progressStage: normalizeStage(row.progressStage),
        errorCode: 'ocr_task_timeout_20m',
        errorMessage: 'OCR task exceeded 20 minutes timeout window',
        fcNextAttemptAt: null,
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, row.id));
  }
  if (rows.length > 0) {
    console.warn('[ocr/stage] timeout_sweep', JSON.stringify({ count: rows.length }));
  }
  return rows.length;
}

export async function dispatchPendingOcrJobs(
  limit = DEFAULT_OCR_BATCH_SIZE,
  options?: { enqueueOnly?: boolean }
): Promise<{
  processed: number;
  task_ids: string[];
  mode: 'invoke' | 'enqueue_only';
}> {
  const now = new Date();
  const taskIds: string[] = [];
  const enqueueOnly = options?.enqueueOnly === true;
  for (let i = 0; i < limit; i += 1) {
    const rows = await db()
      .select({ id: translationTasks.id })
      .from(translationTasks)
      .where(
        and(
          eq(translationTasks.preprocessWithOcr, true),
          eq(translationTasks.status, 'queued'),
          or(isNull(translationTasks.fcNextAttemptAt), lte(translationTasks.fcNextAttemptAt, now)),
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
    if (enqueueOnly) {
      const queued = await sendOcrPipelineQueueMessage(id);
      if (!queued.ok) {
        console.warn(
          '[ocr/dispatch] enqueue_only_failed',
          JSON.stringify({ task_id: id, reason: queued.reason })
        );
        continue;
      }
    } else {
      await invokeOcrPipelineForTask(id);
    }
    taskIds.push(id);
  }
  return {
    processed: taskIds.length,
    task_ids: taskIds,
    mode: enqueueOnly ? 'enqueue_only' : 'invoke',
  };
}

