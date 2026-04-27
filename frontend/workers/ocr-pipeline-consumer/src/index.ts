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
      format?: 'pdf' | 'md';
    };

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
        try {
          await handleOcrPipelineQueueBatch({
            messages: [{ body: (msg.body ?? {}) as any }],
          });
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
      console.log(
        '[ocr-pipeline-consumer] cron_dispatch_disabled',
        JSON.stringify({
          reason: 'project_disabled_empty_scan',
          mode: 'disabled',
        })
      );
    });
  },
};
