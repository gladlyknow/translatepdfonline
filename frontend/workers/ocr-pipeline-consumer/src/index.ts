import {
  handleOcrPipelineQueueBatch,
} from '../../../src/shared/lib/ocr-queue';
import { runWithCloudflareEnv } from '../../../src/shared/lib/worker-runtime-env';

type OcrQueueBody =
  | {
      type?: 'ocr_pipeline';
      taskId?: string;
    }
  | {
      type?: 'ocr_export_generate';
      taskId?: string;
      exportId?: string;
      format?: 'pdf' | 'md' | 'html';
    };

type OcrQueueMessage = {
  readonly body: OcrQueueBody;
  ack(): void;
  retry(): void;
};

type OcrQueueBatch = {
  readonly messages: readonly OcrQueueMessage[];
};

type QueueExecutionContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

/**
 * Queues consumer：须 `export default` 上存在 `queue`（见 Cloudflare Queues 文档）。
 * wrangler.consumer*.jsonc 中已设 `preserve_file_names: true`，避免产物中方法名被过度改写。
 */
export default {
  async queue(
    batch: OcrQueueBatch,
    env: Record<string, unknown>,
    ctx?: QueueExecutionContext
  ): Promise<void> {
    await runWithCloudflareEnv(env, async () => {
      for (const msg of batch.messages) {
        try {
          await handleOcrPipelineQueueBatch({
            messages: [{ body: (msg.body ?? {}) as any }],
            executionCtx: ctx,
          });
          msg.ack();
        } catch (e) {
          console.error('[ocr-pipeline-consumer]', e);
          msg.retry();
        }
      }
    });
  },
  async fetch(): Promise<Response> {
    return new Response('queue consumer only', { status: 403 });
  },
};
