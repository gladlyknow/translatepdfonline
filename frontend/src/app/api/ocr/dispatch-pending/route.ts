import { dispatchPendingOcrJobs } from '@/shared/lib/ocr-queue';

/**
 * Cron：派发 OCR queued 任务（submit + enqueue + consumer）。
 * Header: x-cron-secret 与 CRON_SECRET 或 OCR_DISPATCH_SECRET 一致。
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET || process.env.OCR_DISPATCH_SECRET;
  if (!cronSecret) {
    return Response.json(
      { detail: 'OCR dispatch not configured (CRON_SECRET or OCR_DISPATCH_SECRET missing)' },
      { status: 503 }
    );
  }
  const provided = req.headers.get('x-cron-secret');
  if (provided !== cronSecret) {
    return Response.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await dispatchPendingOcrJobs(
      Math.min(
        20,
        Math.max(1, parseInt(process.env.OCR_DISPATCH_BATCH_SIZE || '6', 10) || 6)
      )
    );
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error('[ocr/dispatch-pending]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Dispatch failed' },
      { status: 500 }
    );
  }
}
