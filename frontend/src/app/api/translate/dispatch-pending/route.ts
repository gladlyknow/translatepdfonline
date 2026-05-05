import {
  dispatchPendingTranslateFcJobs,
  reapStaleFcAcceptedTasks,
} from '../invoke-fc';

/**
 * Cron：派发仍为 queued 的翻译任务（仅负责向 FC **提交**请求：异步 ACK 或同步首轮）。
 * 长耗时翻译与 LLM 重试在 **babeldoc_fc 内部**；此处仅为调度下一窗口或提交失败后的有限次重试（见 TRANSLATE_FC_SUBMIT_MAX_ATTEMPTS）。
 * 顺带 reap：已 fc_async_submitted / fc_accepted 但长期无 callback 的任务。
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
    const reap = await reapStaleFcAcceptedTasks();
    const result = await dispatchPendingTranslateFcJobs(
      Math.min(
        20,
        Math.max(1, parseInt(process.env.TRANSLATE_DISPATCH_BATCH_SIZE || '8', 10) || 8)
      )
    );
    if (result.processed === 0 && reap.reaped === 0) {
      return new Response(null, { status: 204 });
    }
    return Response.json({ ok: true, ...result, ...reap });
  } catch (e) {
    console.error('[translate/dispatch-pending]', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Dispatch failed' },
      { status: 500 }
    );
  }
}
