/**
 * 调用 babeldoc_fc（与 POST /api/translate 内逻辑一致），并更新 FC 调度字段（重试 / 可观测）。
 */

import { eq, and, or, isNull, lte, asc } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { getAllConfigs } from '@/shared/models/config';
import { createPresignedGet, isR2Configured } from '@/shared/lib/translate-r2';
import {
  getWorkerBindingMeta,
  getWorkerBindingString,
} from '@/shared/lib/worker-env';

const RETRYABLE_STATUS = new Set([429, 502, 503, 500]);

/** FC 冷启动 + BabelDOC 可能数分钟；过短会导致对端报 Invocation canceled by client */
const FC_FETCH_TIMEOUT_MS = Math.min(
  900_000,
  Math.max(
    60_000,
    Number(process.env.TRANSLATE_FC_FETCH_TIMEOUT_MS) || 600_000
  )
);

function fcFetchSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    return undefined;
  }
  return AbortSignal.timeout(FC_FETCH_TIMEOUT_MS);
}

function errorCodeFromFcErrorBodySnippet(snippet: string): string | null {
  const low = snippet.toLowerCase();
  if (
    low.includes('no paragraphs') ||
    low.includes('contains no paragraphs') ||
    low.includes('extracttexterror')
  ) {
    return 'no_paragraphs';
  }
  return null;
}

function parseRetryAfterMs(res: Response): number | null {
  const ra = res.headers.get('retry-after');
  if (!ra) return null;
  const sec = parseInt(ra.trim(), 10);
  if (!Number.isNaN(sec) && sec >= 0) return sec * 1000;
  const t = Date.parse(ra);
  if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  return null;
}

/** 指数退避：30s 起，封顶 15min；attempt 从 1 起 */
export function fcBackoffMs(attempt: number): number {
  const base = 30_000;
  const max = 15 * 60_000;
  const exp = Math.min(8, Math.max(0, attempt - 1));
  return Math.min(max, base * 2 ** exp);
}

export async function resolveTranslateFcEndpoint(): Promise<{
  url: string;
  secret: string;
  authHeader: string;
  authScheme: string;
}> {
  const u1 = getWorkerBindingMeta('TRANSLATE_FC_URL');
  const u2 = getWorkerBindingMeta('BABELDOC_FC_URL');
  let FC_URL = u1.value || u2.value || '';
  const s1 = getWorkerBindingMeta('TRANSLATE_FC_SECRET');
  const s2 = getWorkerBindingMeta('BABELDOC_FC_SECRET');
  let FC_SECRET = s1.value || s2.value || '';
  if (!FC_URL || !FC_SECRET) {
    const configs = await getAllConfigs();
    if (!FC_URL) FC_URL = String(configs.translate_fc_url ?? '').trim();
    if (!FC_SECRET) FC_SECRET = String(configs.translate_fc_secret ?? '').trim();
  }
  const authHeader =
    getWorkerBindingString('TRANSLATE_FC_AUTH_HEADER') || 'X-Babeldoc-Secret';
  const authScheme = getWorkerBindingString('TRANSLATE_FC_AUTH_SCHEME') || '';
  return { url: FC_URL, secret: FC_SECRET, authHeader, authScheme };
}

function buildCallbackBaseUrl(): string {
  const { value: publicAppUrl } = getWorkerBindingMeta('NEXT_PUBLIC_APP_URL');
  return (
    publicAppUrl ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'http://localhost:3000'
  );
}

/** 对单任务发起一次 FC HTTP；根据响应更新 fc_* 字段或置为 failed */
export async function invokeTranslateFcForTask(taskId: string): Promise<void> {
  const { url: FC_URL, secret: FC_SECRET, authHeader, authScheme } =
    await resolveTranslateFcEndpoint();

  if (!FC_URL?.trim()) {
    console.warn('[translate/invoke-fc] skipped: no FC URL', taskId);
    return;
  }

  const now = new Date();
  const leaseUntil = new Date(Date.now() + 120_000);

  const claimed = await db()
    .update(translationTasks)
    .set({ fcInvokeLeaseUntil: leaseUntil, updatedAt: new Date() })
    .where(
      and(
        eq(translationTasks.id, taskId),
        eq(translationTasks.status, 'queued'),
        or(
          isNull(translationTasks.fcInvokeLeaseUntil),
          lte(translationTasks.fcInvokeLeaseUntil, now)
        ),
        or(
          isNull(translationTasks.fcNextAttemptAt),
          lte(translationTasks.fcNextAttemptAt, now)
        )
      )
    )
    .returning();

  if (!claimed.length) {
    return;
  }

  const row = claimed[0];

  const [doc] = await db()
    .select()
    .from(documents)
    .where(eq(documents.id, row.documentId));
  if (!doc) {
    await db()
      .update(translationTasks)
      .set({
        status: 'failed',
        errorCode: 'document_missing',
        errorMessage: 'Document not found for FC invoke',
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    return;
  }

  if (!(await isR2Configured())) {
    await db()
      .update(translationTasks)
      .set({
        status: 'failed',
        errorCode: 'r2_not_configured',
        errorMessage: 'R2 not configured; cannot presign for FC',
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    return;
  }

  const key = row.sourceSliceObjectKey || doc.objectKey;
  let sourcePdfUrl: string;
  try {
    sourcePdfUrl = await createPresignedGet(key, 3600);
  } catch (e) {
    await db()
      .update(translationTasks)
      .set({
        status: 'failed',
        errorCode: 'presign_failed',
        errorMessage:
          e instanceof Error ? e.message.slice(0, 500) : 'presign failed',
        fcInvokeLeaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    return;
  }

  const callbackUrl = `${buildCallbackBaseUrl()}/api/translate/callback`;
  const outputObjectKey = `translations/${taskId}/output.pdf`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (FC_SECRET) {
    headers[authHeader] = authScheme + FC_SECRET;
  }

  const fcPayload: Record<string, unknown> = {
    task_id: taskId,
    source_pdf_url: sourcePdfUrl,
    output_object_key: outputObjectKey,
    source_lang: row.sourceLang,
    target_lang: row.targetLang,
    callback_url: callbackUrl,
  };
  if (row.pageRange != null && String(row.pageRange).trim() !== '') {
    fcPayload.page_range = row.pageRange;
  }

  const prevAttempts = row.fcDispatchAttemptCount ?? 0;
  const thisAttempt = prevAttempts + 1;

  let res: Response;
  try {
    res = await fetch(FC_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(fcPayload),
      signal: fcFetchSignal(),
    });
  } catch (e) {
    const delay = fcBackoffMs(thisAttempt);
    const nextAt = new Date(Date.now() + delay);
    await db()
      .update(translationTasks)
      .set({
        fcLastHttpStatus: null,
        fcLastInvokedAt: new Date(),
        fcNextAttemptAt: nextAt,
        fcDispatchAttemptCount: thisAttempt,
        fcInvokeLeaseUntil: null,
        progressStage: 'fc_network_error_retry_scheduled',
        progressPercent: Math.min(15, 5 + thisAttempt * 2),
        errorMessage: `FC fetch failed: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          500
        ),
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    console.error(
      '[translate/invoke-fc] fetch_failed',
      JSON.stringify({ task_id: taskId, attempt: thisAttempt, next_at: nextAt.toISOString() })
    );
    return;
  }

  const status = res.status;
  const retryAfterMs = parseRetryAfterMs(res);

  if (res.ok) {
    await db()
      .update(translationTasks)
      .set({
        fcLastHttpStatus: status,
        fcLastInvokedAt: new Date(),
        fcNextAttemptAt: null,
        fcDispatchAttemptCount: 0,
        fcInvokeLeaseUntil: null,
        progressStage: 'fc_accepted',
        progressPercent: Math.max(row.progressPercent ?? 0, 25),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    console.log(
      '[translate/invoke-fc] ok',
      JSON.stringify({ task_id: taskId, http_status: status })
    );
    return;
  }

  if (RETRYABLE_STATUS.has(status)) {
    const delay =
      retryAfterMs ?? fcBackoffMs(thisAttempt);
    const nextAt = new Date(Date.now() + delay);
    let snippet = '';
    try {
      snippet = (await res.text()).slice(0, 400);
    } catch {
      snippet = '';
    }
    await db()
      .update(translationTasks)
      .set({
        fcLastHttpStatus: status,
        fcLastInvokedAt: new Date(),
        fcNextAttemptAt: nextAt,
        fcDispatchAttemptCount: thisAttempt,
        fcInvokeLeaseUntil: null,
        progressStage: 'fc_busy_retry_scheduled',
        progressPercent: Math.min(20, 5 + thisAttempt * 2),
        errorMessage:
          `FC returned ${status}; automatic retry scheduled. ${snippet}`.slice(
            0,
            500
          ),
        updatedAt: new Date(),
      })
      .where(eq(translationTasks.id, taskId));
    console.warn(
      '[translate/invoke-fc] retryable',
      JSON.stringify({
        task_id: taskId,
        http_status: status,
        attempt: thisAttempt,
        next_at: nextAt.toISOString(),
      })
    );
    return;
  }

  let bodySnippet = '';
  try {
    bodySnippet = (await res.text()).slice(0, 500);
  } catch {
    bodySnippet = '';
  }
  const derivedCode = errorCodeFromFcErrorBodySnippet(bodySnippet);
  await db()
    .update(translationTasks)
    .set({
      fcLastHttpStatus: status,
      fcLastInvokedAt: new Date(),
      status: 'failed',
      errorCode: derivedCode ?? 'fc_http_error',
      errorMessage: `FC HTTP ${status}: ${bodySnippet}`.slice(0, 500),
      progressPercent: 0,
      fcInvokeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(translationTasks.id, taskId));
  console.error(
    '[translate/invoke-fc] non_retryable',
    JSON.stringify({ task_id: taskId, http_status: status })
  );
}

/**
 * Cron：挑选待派发的 queued 任务（fc_next_attempt_at 已到期或为空），FIFO，限制条数。
 */
export async function dispatchPendingTranslateFcJobs(limit = 8): Promise<{
  processed: number;
  task_ids: string[];
}> {
  const taskIds: string[] = [];
  const now = new Date();

  for (let i = 0; i < limit; i++) {
    const rows = await db()
      .select({ id: translationTasks.id })
      .from(translationTasks)
      .where(
        and(
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

    await invokeTranslateFcForTask(id);
    taskIds.push(id);
  }

  return { processed: taskIds.length, task_ids: taskIds };
}
