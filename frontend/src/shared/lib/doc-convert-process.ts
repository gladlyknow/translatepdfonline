/**
 * 百度 doc_convert 轮询处理：由 OCR_PIPELINE_QUEUE 的 doc_convert_poll 消息触发。
 * 循环查询百度任务（7s 间隔、5min 超时），retCode=3 完成后下载结果上传 R2、幂等扣费、更新状态。
 */

import {
  queryDocConvert,
  queryDocConvertDownloadUrl,
} from '@/shared/lib/doc-convert-baidu';
import { getObjectBody, putObject } from '@/shared/lib/translate-r2';
import {
  getTranslateCreditsPerPage,
  isTranslateCreditsEnabled,
} from '@/shared/lib/translate-billing';
import {
  consumeCredits,
  CreditTransactionScene,
} from '@/shared/models/credit';
import {
  DocConvertTaskStatus,
  findDocConvertTaskById,
  updateDocConvertTask,
} from '@/shared/models/doc_convert_task';

const POLL_INTERVAL_MS = 7_000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processDocConvertJob(taskId: string): Promise<void> {
  const job = await findDocConvertTaskById(taskId);
  if (!job) throw new Error(`doc_convert job not found: ${taskId}`);
  if (
    job.status !== DocConvertTaskStatus.submitted &&
    job.status !== DocConvertTaskStatus.processing
  ) {
    return;
  }
  if (!job.baiduTaskId) throw new Error('missing baidu_task_id');

  await updateDocConvertTask(taskId, {
    status: DocConvertTaskStatus.processing,
  });

  const startedAt = Date.now();
  let finalResultData: { word: string; excel: string } | null = null;

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const qr = await queryDocConvert(job.baiduTaskId);

    await updateDocConvertTask(taskId, {
      percent: Math.max(0, Math.min(100, qr.percent)),
    });

    if (qr.retCode === 3) {
      finalResultData = qr.resultData;
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (!finalResultData) {
    await updateDocConvertTask(taskId, {
      status: DocConvertTaskStatus.failed,
      errorMessage: 'doc_convert poll timeout',
    });
    throw new Error('doc_convert poll timeout');
  }

  // 下载百度结果 → R2
  const downloadUrl = queryDocConvertDownloadUrl(
    finalResultData,
    job.targetFormat
  );

  let resultR2Key: string | null = null;
  if (downloadUrl) {
    try {
      const dlRes = await fetch(downloadUrl);
      if (dlRes.ok) {
        const buffer = new Uint8Array(await dlRes.arrayBuffer());
        const ext = job.targetFormat === 'excel' ? 'xlsx' : 'docx';
        resultR2Key = `doc-convert/${taskId}/result.${ext}`;
        const contentType =
          job.targetFormat === 'excel'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        await putObject(resultR2Key, buffer, contentType);
      }
    } catch {
      // 下载失败，resultR2Key 保持 null
    }
  }

  // 幂等扣费：creditConsumeId 已存在则跳过
  if (isTranslateCreditsEnabled() && job.userId && !job.creditConsumeId) {
    try {
      const creditsPerPage = getTranslateCreditsPerPage();
      const consumed = await consumeCredits({
        userId: job.userId,
        credits: creditsPerPage,
        scene: CreditTransactionScene.TRANSLATE,
        description: `doc_convert task ${taskId} completed (${job.sourceFormat} → ${job.targetFormat})`,
        metadata: JSON.stringify({
          task_id: taskId,
          charge_key: job.baiduTaskId,
          source_format: job.sourceFormat,
          target_format: job.targetFormat,
          mode: 'doc_convert',
        }),
      });
      await updateDocConvertTask(taskId, { creditConsumeId: consumed.id });
    } catch (e) {
      // 扣费失败不阻塞结果就绪，仅记录日志
      console.error(
        '[doc-convert/billing] failed',
        JSON.stringify({
          task_id: taskId,
          error: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }

  await updateDocConvertTask(taskId, {
    status: DocConvertTaskStatus.ready,
    percent: 100,
    resultData: JSON.stringify(finalResultData),
    resultR2Key: resultR2Key || undefined,
  });
}
