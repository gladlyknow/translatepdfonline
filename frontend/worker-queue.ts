import openNextWorker from './.open-next/worker.js';

type QueueMessage = { body?: { taskId?: string } };
type QueueBatch = { messages: QueueMessage[] };

type QueueEnv = {
  OCR_DISPATCH_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  OCR_DISPATCH_SECRET?: string;
  CRON_SECRET?: string;
};

function resolveDispatchUrl(env: QueueEnv): string {
  const explicit = (env.OCR_DISPATCH_URL || '').trim();
  if (explicit) return explicit;
  const appUrl = (env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (!appUrl) {
    throw new Error('OCR_DISPATCH_URL or NEXT_PUBLIC_APP_URL is required for queue worker');
  }
  return `${appUrl}/api/ocr/dispatch-pending`;
}

function resolveDispatchSecret(env: QueueEnv): string {
  const secret = (env.OCR_DISPATCH_SECRET || env.CRON_SECRET || '').trim();
  if (!secret) {
    throw new Error('OCR_DISPATCH_SECRET or CRON_SECRET is required for queue worker');
  }
  return secret;
}

async function triggerDispatch(env: QueueEnv): Promise<void> {
  const url = resolveDispatchUrl(env);
  const secret = resolveDispatchSecret(env);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-cron-secret': secret,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`dispatch-pending failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

const fetchHandler: unknown =
  (openNextWorker as { fetch?: unknown }).fetch ?? openNextWorker;

export default {
  fetch: fetchHandler as (request: Request, env: unknown, ctx: unknown) => Promise<Response>,
  async queue(batch: QueueBatch, env: QueueEnv): Promise<void> {
    if (!batch.messages?.length) return;
    await triggerDispatch(env);
  },
  async scheduled(_event: unknown, env: QueueEnv): Promise<void> {
    await triggerDispatch(env);
  },
};

