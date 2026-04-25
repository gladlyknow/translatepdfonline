import { getCloudflareContext } from '@opennextjs/cloudflare';
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';

import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import {
  exportMarkdownToPdfAndMd,
  loadMarkdownFromR2,
  runOcrAndPersistParse,
  translateMarkdownWithDeepSeek,
} from '@/shared/lib/ocr-translate';
import { putObject } from '@/shared/lib/translate-r2';
import { tryGetAlsCfEnv } from '@/shared/lib/worker-runtime-env';

export type OcrPipelineQueueBody = { taskId: string };
type OcrStage =
  | 'ocr_submit_poll'
  | 'ocr_parse_persisted'
  | 'translate_markdown'
  | 'export_outputs'
  | 'completed';

const DEFAULT_OCR_BATCH_SIZE = Math.min(
  1,
  Math.max(1, Number(process.env.OCR_DISPATCH_BATCH_SIZE || '1') || 1)
);
const OCR_TASK_TIMEOUT_MS = 20 * 60 * 1000;
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

async function enqueueNextStage(taskId: string, nextStage: OcrStage): Promise<EnqueueResult> {
  const ok = await sendOcrPipelineQueueMessage(taskId);
  if (ok) return 'enqueue_ok';
  await db()
    .update(translationTasks)
    .set({
      status: 'queued',
      progressStage: nextStage,
      progressPercent: stagePercent(nextStage),
      fcNextAttemptAt: new Date(),
      fcInvokeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, taskId));
  console.warn(
    '[ocr/stage] enqueue_failed',
    JSON.stringify({ task_id: taskId, next_stage: nextStage, fallback: 'dispatcher' })
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
    .where(eq(translationTasks.id, taskId));
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
    let finalMarkdown = '';
    if (needTranslateForTask(params.sourceLang, params.targetLang)) {
      finalMarkdown = await loadMarkdownFromR2(keys.translatedMarkdownObjectKey);
    } else {
      finalMarkdown = await loadMarkdownFromR2(keys.sourceMarkdownObjectKey);
    }
    const exportMeta = await exportMarkdownToPdfAndMd({
      markdown: finalMarkdown,
      outputPdfObjectKey: keys.outputPdfObjectKey,
      outputMdObjectKey: keys.outputMdObjectKey,
    });
    console.log(
      '[ocr/export] done',
      JSON.stringify({
        task_id: params.taskId,
        markdown_chars: exportMeta.markdownChars,
        markdown_bytes: exportMeta.markdownBytes,
        pdf_render_chars: exportMeta.pdfRenderChars,
        pdf_bytes: exportMeta.pdfBytes,
        pdf_truncated: exportMeta.pdfTruncated,
      })
    );
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
  if (qAls?.send) return { send: qAls.send };

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
export async function sendOcrPipelineQueueMessage(taskId: string): Promise<boolean> {
  try {
    const q = getQueueBindingFromContext();
    if (!q || typeof q.send !== 'function') return false;
    await q.send({ taskId });
    console.log('[ocr/queue] enqueued', JSON.stringify({ task_id: taskId, at: nowIso() }));
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

export async function invokeOcrPipelineForTask(
  taskId: string,
  inlineDepth = 0
): Promise<void> {
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
    const nextStage = await runOneStage({
      taskId,
      stage,
      sourcePdfObjectKey: row.sourceSliceObjectKey || doc.objectKey,
      sourceFilename: doc.filename,
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
    });

    if (nextStage === 'completed') {
      const keys = outputKeys(taskId);
      await db()
        .update(translationTasks)
        .set({
          status: 'completed',
          progressStage: 'completed',
          progressPercent: 100,
          outputObjectKey: keys.outputPdfObjectKey,
          outputPrimaryPath: keys.outputMdObjectKey,
          errorCode: null,
          errorMessage: null,
          fcNextAttemptAt: null,
          fcDispatchAttemptCount: 0,
          fcInvokeLeaseUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(translationTasks.id, taskId));
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
    const enqueueResult = await enqueueNextStage(taskId, nextStage);
    console.log(
      '[ocr/stage] done',
      JSON.stringify({
        task_id: taskId,
        stage,
        next_stage: nextStage,
        enqueue_result: enqueueResult,
          inline_depth: inlineDepth,
        elapsed_ms: Date.now() - startedAt,
      })
    );
  } catch (e) {
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
          inline_depth: inlineDepth,
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
  if (!row || !row.preprocessWithOcr || row.status !== 'failed') {
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
    await invokeOcrPipelineForTask(id);
    taskIds.push(id);
  }
  return { processed: taskIds.length, task_ids: taskIds };
}

