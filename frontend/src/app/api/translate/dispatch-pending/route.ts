import { dispatchPendingTranslateFcJobs } from '../invoke-fc';

/**
 * Cron：自动重试 / 派发 queued 的翻译任务（FC 429/503 或首次未在 waitUntil 内完成时）。
 * Header: x-cron-secret 与 CRON_SECRET 或 TRANSLATE_DISPATCH_SECRET 一致。
 */
export async function POST(req: Request) {
  const cronSecret =
    process.env.CRON_SECRET || process.env.TRANSLATE_DISPATCH_SECRET;
  if (!cronSecret) {
    return Response.json(
      { detail: 'Dispatch not configured (CRON_SECRET or TRANSLATE_DISPATCH_SECRET missing)' },
      { status: 503 }
    );
  }
  const provided = req.headers.get('x-cron-secret');
  if (provided !== cronSecret) {
    return Response.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await dispatchPendingTranslateFcJobs(
      Math.min(
        20,
        Math.max(1, parseInt(process.env.TRANSLATE_DISPATCH_BATCH_SIZE || '8', 10) || 8)
      )
    );
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error('[translate/dispatch-pending]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Dispatch failed' },
      { status: 500 }
    );
  }
}
