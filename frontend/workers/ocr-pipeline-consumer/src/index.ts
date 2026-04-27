import {
  dispatchPendingOcrJobs,
  failTimedOutOcrTasks,
  invokeOcrPipelineForTask,
} from '../../../src/shared/lib/ocr-queue';
import { runWithCloudflareEnv } from '../../../src/shared/lib/worker-runtime-env';

type OcrQueueBody = { taskId?: string };

type OcrQueueMessage = {
  readonly body: OcrQueueBody;
  ack(): void;
  retry(): void;
};

type OcrQueueBatch = {
  readonly messages: readonly OcrQueueMessage[];
};

export default {
  async fetch(): Promise<Response> {
    return new Response('queue consumer only', { status: 403 });
  },
  async queue(batch: OcrQueueBatch, env: Record<string, unknown>): Promise<void> {
    await runWithCloudflareEnv(env, async () => {
      for (const msg of batch.messages) {
        const taskId = msg.body?.taskId;
        if (!taskId || typeof taskId !== 'string') {
          msg.ack();
          continue;
        }
        try {
          await invokeOcrPipelineForTask(taskId);
          msg.ack();
        } catch (e) {
          console.error('[ocr-pipeline-consumer]', e);
          msg.retry();
        }
      }
    });
  },
  async scheduled(_controller: unknown, env: Record<string, unknown>): Promise<void> {
    await runWithCloudflareEnv(env, async () => {
      const timeoutFailed = await failTimedOutOcrTasks();
      const limit = Math.min(
        2,
        Math.max(1, Number(process.env.OCR_DISPATCH_BATCH_SIZE || '2') || 2)
      );
      const result = await dispatchPendingOcrJobs(limit, { enqueueOnly: false });
      console.log(
        '[ocr-pipeline-consumer] cron_dispatch',
        JSON.stringify({ ...result, timeout_failed: timeoutFailed })
      );
    });
  },
};
