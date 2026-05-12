import { getCloudflareContext } from '@opennextjs/cloudflare';
import { and, asc, eq, isNull, lte, ne, or } from 'drizzle-orm';

import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { runOcrAndPersistParse } from '@/shared/lib/ocr-translate';
import {
  processOcrTaskExport,
} from '@/shared/lib/ocr-export-queue';
import { getObjectBody, putObject } from '@/shared/lib/translate-r2';
import { languagesNeedTranslation } from '@/shared/lib/ocr-lang';
import { translateAndPersistParseResultTarget } from '@/shared/lib/ocr-parse-result-target-translate';
import { mirrorBaiduImagesIntoParseResult } from '@/shared/lib/ocr-parse-result-image-proxy';
import { ocrParseResultSourceKey } from '@/shared/lib/ocr-parse-result-r2-keys';
import { tryGetAlsCfEnv } from '@/shared/lib/worker-runtime-env';
import { runOcrStage } from '@/shared/lib/ocr-step-runner';
import { ocrMetricLog, ocrWorkLog } from '@/shared/lib/ocr-work-log';
import { toPublicOcrErrorMessage } from '@/shared/lib/ocr-public-error';
import { parseParseResultJson } from '@/shared/ocr-workbench/translator-parse-result';
import {
  getTranslateCreditsPerPage,
  isTranslateCreditsEnabled,
} from '@/shared/lib/translate-billing';
import {
  consumeCredits,
  CreditTransactionScene,
} from '@/shared/models/credit';

export type OcrPipelineQueueBody =
  | {
      type: 'ocr_pipeline';
      taskId: string;
    }
  | {
      type: 'ocr_export_generate';
      taskId: string;
      exportId: string;
      format: 'pdf' | 'md' | 'html';
      pdfMode?: 'vector_shrink_only' | 'raster_snapshot';
    };
type OcrStage =
  | 'ocr_submit_poll'
  | 'mirror_baidu_images'
  | 'ocr_parse_persisted'
  | 'translate_parse_result'
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

/**
 * `mirror_baidu_images` 阶段配置：异步队列中下载百度签名图片到 R2，并改写 source ParseResult JSON。
 * 单图下载并发与每次重试细节由 `rewriteExternalImagesToR2` 内部处理。
 */
function clampInt(
  v: number,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
const OCR_IMAGE_MIRROR_CONCURRENCY = clampInt(
  Number(process.env.OCR_IMAGE_MIRROR_CONCURRENCY || '5'),
  1,
  16,
  5
);
const OCR_IMAGE_MIRROR_STAGE_TIMEOUT_MS = clampInt(
  Number(process.env.OCR_IMAGE_MIRROR_STAGE_TIMEOUT_MS || '480000'),
  30_000,
  3_600_000,
  480_000
);
const OCR_IMAGE_MIRROR_FAIL_RATIO_MAX = (() => {
  const raw = Number(process.env.OCR_IMAGE_MIRROR_FAIL_RATIO_MAX || '0.5');
  if (!Number.isFinite(raw)) return 0.5;
  return Math.max(0, Math.min(1, raw));
})();

function nowIso() {
  return new Date().toISOString();
}

/**
 * 阶段级 wall-clock 超时：仅给 `mirror_baidu_images` 用，单图 fetch 内部已有 90s 超时。
 * 超时后抛错让队列重试整阶段，不会回滚上一个阶段（source JSON 已落 R2）。
 */
function withMirrorStageTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`ocr stage timeout (mirror_baidu_images) after ${timeoutMs}ms`)
      );
    }, timeoutMs);
    fn()
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

function stagePercent(stage: OcrStage): number {
  if (stage === 'ocr_submit_poll') return 20;
  if (stage === 'mirror_baidu_images') return 35;
  if (stage === 'ocr_parse_persisted') return 45;
  if (stage === 'translate_parse_result') return 65;
  if (stage === 'export_outputs') return 90;
  return 100;
}

function normalizeStage(raw: string | null | undefined): OcrStage {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'ocr_submit_poll') return 'ocr_submit_poll';
  if (s === 'mirror_baidu_images') return 'mirror_baidu_images';
  if (s === 'ocr_parse_persisted') return 'ocr_parse_persisted';
  /** 旧队列/DB 可能仍存 translate_markdown，归并到 translate_parse_result */
  if (s === 'translate_markdown') return 'translate_parse_result';
  if (s === 'translate_parse_result') return 'translate_parse_result';
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
  return languagesNeedTranslation(sourceLang, targetLang);
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
    return 'mirror_baidu_images';
  }

  if (params.stage === 'mirror_baidu_images') {
    const startedAt = Date.now();
    console.log(
      '[ocr/stage] start',
      JSON.stringify({
        stage: 'mirror_baidu_images',
        task_id: params.taskId,
        concurrency: OCR_IMAGE_MIRROR_CONCURRENCY,
        timeout_ms: OCR_IMAGE_MIRROR_STAGE_TIMEOUT_MS,
        fail_ratio_max: OCR_IMAGE_MIRROR_FAIL_RATIO_MAX,
      })
    );
    const result = await withMirrorStageTimeout(
      () =>
        mirrorBaiduImagesIntoParseResult({
          taskId: params.taskId,
          parseResultKey: keys.outputParseResultObjectKey,
          maxConcurrent: OCR_IMAGE_MIRROR_CONCURRENCY,
        }),
      OCR_IMAGE_MIRROR_STAGE_TIMEOUT_MS
    );
    const failRatio = result.total === 0 ? 0 : result.failed / result.total;
    const partial = result.failed > 0;
    console.log(
      '[ocr/parse_image_mirror] done',
      JSON.stringify({
        task_id: params.taskId,
        replaced: result.replaced,
        failed: result.failed,
        total: result.total,
        written: result.written,
        fail_ratio: Number(failRatio.toFixed(3)),
        mirror_partial: partial,
        elapsed_ms: Date.now() - startedAt,
      })
    );
    if (
      result.total > 0 &&
      result.failed > 0 &&
      failRatio > OCR_IMAGE_MIRROR_FAIL_RATIO_MAX
    ) {
      throw new Error(
        `mirror_baidu_images failure ratio ${failRatio.toFixed(3)} > ${OCR_IMAGE_MIRROR_FAIL_RATIO_MAX} (failed=${result.failed}/${result.total})`
      );
    }
    return 'ocr_parse_persisted';
  }

  if (params.stage === 'ocr_parse_persisted') {
    return needTranslateForTask(params.sourceLang, params.targetLang)
      ? 'translate_parse_result'
      : 'export_outputs';
  }

  if (params.stage === 'translate_parse_result') {
    console.log(
      '[ocr/stage] translate_parse_result_enter',
      JSON.stringify({
        task_id: params.taskId,
        source_lang: params.sourceLang,
        target_lang: params.targetLang,
      })
    );
    await translateAndPersistParseResultTarget({
      taskId: params.taskId,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
    });
    return 'export_outputs';
  }

  if (params.stage === 'export_outputs') {
    // 与 onlinepdftranslator 对齐：export_outputs 只负责投递异步导出任务，
    // 不在 OCR 主流水线中执行 PDF 渲染，避免 CPU 峰值。
    return 'completed';
  }

  return 'completed';
}

async function settleOcrBillingOnCompleted(params: {
  taskId: string;
  userId: string | null;
  creditConsumeId: string | null;
  creditsEstimated: number | null;
}): Promise<{
  creditConsumeId: string | null;
  creditsCharged: number | null;
  billingError: string | null;
  skipReason: string | null;
}> {
  if (!isTranslateCreditsEnabled()) {
    return {
      creditConsumeId: params.creditConsumeId,
      creditsCharged: null,
      billingError: null,
      skipReason: 'credits_disabled',
    };
  }
  if (!params.userId) {
    return {
      creditConsumeId: params.creditConsumeId,
      creditsCharged: null,
      billingError: null,
      skipReason: 'missing_user_id',
    };
  }
  if (params.creditConsumeId) {
    return {
      creditConsumeId: params.creditConsumeId,
      creditsCharged: params.creditsEstimated ?? null,
      billingError: null,
      skipReason: 'already_charged',
    };
  }

  let pageCountFromParse: number | null = null;
  try {
    const parseBody = await getObjectBody(ocrParseResultSourceKey(params.taskId));
    const parseJson = JSON.parse(new TextDecoder().decode(parseBody));
    const parsed = parseParseResultJson(parseJson);
    if (parsed.ok) {
      pageCountFromParse = parsed.data.pages.length;
    }
  } catch {
    pageCountFromParse = null;
  }

  const pageCount = pageCountFromParse ?? 0;
  if (pageCount < 1) {
    return {
      creditConsumeId: null,
      creditsCharged: null,
      billingError: 'ocr_billing_skipped_parse_pages_unknown',
      skipReason: 'parse_pages_unknown',
    };
  }
  const creditsPerPage = getTranslateCreditsPerPage();
  const creditsToCharge = pageCount * creditsPerPage;
  if (creditsToCharge < 1) {
    return {
      creditConsumeId: null,
      creditsCharged: null,
      billingError: null,
      skipReason: 'credits_to_charge_lt_1',
    };
  }
  try {
    const consumed = await consumeCredits({
      userId: params.userId,
      credits: creditsToCharge,
      scene: CreditTransactionScene.TRANSLATE,
      description: `OCR task ${params.taskId} completed`,
      metadata: JSON.stringify({
        task_id: params.taskId,
        page_count: pageCount,
        page_count_source: 'ocr_parse_result',
        credits_per_page: creditsPerPage,
        mode: 'ocr',
      }),
    });
    return {
      creditConsumeId: consumed.id,
      creditsCharged: creditsToCharge,
      billingError: null,
      skipReason: null,
    };
  } catch (error) {
    return {
      creditConsumeId: null,
      creditsCharged: null,
      billingError:
        error instanceof Error
          ? `ocr_billing_failed:${error.message}`
          : 'ocr_billing_failed',
      skipReason: 'consume_credits_failed',
    };
  }
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
 * 向 Cloudflare Queues 投递 OCR 任务。Consumer Worker 的 `wrangler.consumer*.jsonc` 须为同名队列配置
 * `queues.producers` → `OCR_PIPELINE_QUEUE`，否则此处会得到 `binding_unavailable`。
 * 非 Worker 或未配置绑定时返回 false，由调用方回退到 dispatchPendingOcrJobs（invoke）。
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
  format: 'pdf' | 'md' | 'html';
  pdfMode?: 'vector_shrink_only' | 'raster_snapshot';
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
      pdfMode: params.pdfMode,
    });
    console.log(
      '[ocr/export-queue] enqueued',
      JSON.stringify({
        task_id: params.taskId,
        export_id: params.exportId,
        format: params.format,
        pdf_mode: params.pdfMode,
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
        pdf_mode: params.pdfMode,
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

type OcrQueueExecutionContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

function _ocrDeferRequeueDelayMs(): number {
  return Math.max(
    1_000,
    Math.min(
      120_000,
      Number(process.env.OCR_DEFER_REQUEUE_DELAY_MS || '8000') || 8_000
    )
  );
}

/**
 * 并发让路后：当前队列消息已 ack，若不再投递则任务会卡在 fcNextAttemptAt 之后仍无人拾取。
 * 用 waitUntil 延迟重新 send 到 OCR 队列（与 defer 写入的 fcNextAttemptAt 对齐）。
 */
function scheduleOcrDeferredRequeue(
  taskId: string,
  executionCtx: OcrQueueExecutionContext | undefined
): void {
  const delayMs = _ocrDeferRequeueDelayMs();
  const run = async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    const res = await sendOcrPipelineQueueMessage(taskId);
    console.log(
      '[ocr/stage] deferred_requeue',
      JSON.stringify({
        task_id: taskId,
        delay_ms: delayMs,
        ok: res.ok,
        reason: res.ok ? undefined : res.reason,
      })
    );
  };
  const p = run();
  if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(p);
  } else {
    void p.catch((e) =>
      console.error(
        '[ocr/stage] deferred_requeue_no_waitUntil',
        JSON.stringify({
          task_id: taskId,
          error: e instanceof Error ? e.message : String(e),
        })
      )
    );
  }
}

/**
 * Queues consumer 入口：与 OpenNext 默认 `fetch` 导出合并为 `export default { fetch, queue }` 时调用。
 * batch 建议 max_batch_size=1，避免长任务并行占满 CPU。
 */
export async function handleOcrPipelineQueueBatch(batch: {
  messages: Array<{ body: OcrPipelineQueueBody }>;
  executionCtx?: OcrQueueExecutionContext;
}): Promise<void> {
  for (const msg of batch.messages) {
    const body = msg.body;
    if (!body || typeof body !== 'object') continue;
    if (body.type === 'ocr_pipeline' || !('type' in body)) {
      const taskId = (body as { taskId?: string }).taskId;
      if (!taskId || typeof taskId !== 'string') continue;
      await invokeOcrPipelineForTask(taskId, {
        executionCtx: batch.executionCtx,
      });
      continue;
    }
    if (body.type === 'ocr_export_generate') {
      if (!body.exportId || typeof body.exportId !== 'string') continue;
      await processOcrTaskExport(body.exportId, {
        pdfMode: body.pdfMode,
      });
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

export async function invokeOcrPipelineForTask(
  taskId: string,
  options?: { executionCtx?: OcrQueueExecutionContext }
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
  if (!claimed.length) {
    const peek = await db()
      .select({
        status: translationTasks.status,
        progressStage: translationTasks.progressStage,
        fcNextAttemptAt: translationTasks.fcNextAttemptAt,
        fcInvokeLeaseUntil: translationTasks.fcInvokeLeaseUntil,
        preprocessWithOcr: translationTasks.preprocessWithOcr,
      })
      .from(translationTasks)
      .where(eq(translationTasks.id, taskId))
      .limit(1);
    const r = peek[0];
    console.warn(
      '[ocr/pipeline] claim_skipped',
      JSON.stringify({
        task_id: taskId,
        row: r
          ? {
              status: r.status,
              progress_stage: r.progressStage,
              fc_next_attempt_at: r.fcNextAttemptAt?.toISOString?.() ?? r.fcNextAttemptAt,
              fc_invoke_lease_until:
                r.fcInvokeLeaseUntil?.toISOString?.() ?? r.fcInvokeLeaseUntil,
              preprocess_with_ocr: r.preprocessWithOcr,
            }
          : null,
        at: nowIso(),
      })
    );
    return;
  }

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
    console.warn(
      '[ocr/pipeline] deferred_owner_concurrency',
      JSON.stringify({
        task_id: taskId,
        limit: OCR_ACCOUNT_MAX_CONCURRENCY,
        processing_peer_count: ownerProcessingRows.length,
      })
    );
    await deferTaskForConcurrency(taskId, 'owner_concurrency_limit');
    scheduleOcrDeferredRequeue(taskId, options?.executionCtx);
    return;
  }
  const stage = normalizeStage(row.progressStage);
  /** 仅首轮 OCR 轮询用任务创建时间判超时；后续阶段 / 用户重试的旧任务不因 createdAt 过长被立即拒绝 */
  if (stage === 'ocr_submit_poll') {
    const createdAtMs = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
    if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > OCR_TASK_TIMEOUT_MS) {
      await db()
        .update(translationTasks)
        .set({
          status: 'failed',
          progressStage: stage,
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

  const startedAt = Date.now();
  const prevAttempts = row.fcDispatchAttemptCount ?? 0;
  const thisAttempt = prevAttempts + 1;
  console.log(
    '[ocr/stage] start',
    JSON.stringify({ task_id: taskId, stage, attempt: thisAttempt, at: nowIso() })
  );
  ocrWorkLog(taskId, `stage_start:${stage}`, { attempt: thisAttempt });

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
    const nextStage = await runOcrStage({
      taskId,
      stage,
      fn: () =>
        runOneStage({
          taskId,
          stage,
          sourcePdfObjectKey: row.sourceSliceObjectKey || doc.objectKey,
          sourceFilename: doc.filename,
          sourceLang: row.sourceLang,
          targetLang: row.targetLang,
        }),
      onStart: () => {
        ocrWorkLog(taskId, `run_stage:${stage}`);
      },
      onSuccess: (out) => {
        ocrMetricLog('ocr_stage_succeeded', {
          taskId,
          stage,
          nextStage: out,
          attempt: thisAttempt,
        });
      },
      onError: (error) => {
        ocrMetricLog('ocr_stage_failed', {
          taskId,
          stage,
          attempt: thisAttempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    await ensureTaskNotCancelled(taskId);

    if (nextStage === 'completed') {
      const billing = await settleOcrBillingOnCompleted({
        taskId,
        userId: row.userId ?? null,
        creditConsumeId: row.creditConsumeId ?? null,
        creditsEstimated: row.creditsEstimated ?? null,
      });
      const creditsPerPage = getTranslateCreditsPerPage();
      const billedPageCount =
        billing.creditsCharged != null && creditsPerPage > 0
          ? Math.floor(billing.creditsCharged / creditsPerPage)
          : null;
      console.log(
        '[ocr/billing] settle_on_completed',
        JSON.stringify({
          task_id: taskId,
          recognized_pages: billedPageCount,
          credits_per_page: creditsPerPage,
          credits_to_charge:
            billedPageCount != null ? billedPageCount * creditsPerPage : null,
          credits_charged: billing.creditsCharged,
          charge_result: billing.creditConsumeId
            ? 'charged'
            : billing.billingError
              ? 'failed_or_skipped'
              : 'skipped',
          skip_reason: billing.skipReason,
          task_user_id: row.userId ?? null,
          credit_consume_id: billing.creditConsumeId,
          billing_error: billing.billingError,
        })
      );
      // Export is now strictly user-triggered from OCR workbench.
      // Do not auto-create/auto-enqueue exports when OCR pipeline completes.
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
          creditConsumeId: billing.creditConsumeId,
          creditsCharged: billing.creditsCharged,
          billingError: billing.billingError,
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
          errorMessage: toPublicOcrErrorMessage(
            `Stage retry (${stage}): ${e instanceof Error ? e.message : String(e)}`
          ).slice(0, 500),
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
          errorMessage: toPublicOcrErrorMessage(
            e instanceof Error ? e.message : String(e)
          ).slice(0, 500),
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

