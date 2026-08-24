/**
 * 百度 doc_convert / Paddle-VL parser 轮询处理：由 OCR_PIPELINE_QUEUE 的 doc_convert_poll 消息触发。
 * - word/excel：循环查询百度 doc_convert（7s 间隔、5min 超时），retCode=3 完成后下载结果上传 R2、幂等扣费、更新状态。
 * - md：轮询 Paddle-VL parser（超时更长），成功后构建 Markdown → 图片中转 R2 替换 URL → 上传 result.md。
 */

import {
  queryDocConvert,
  queryDocConvertDownloadUrl,
} from '@/shared/lib/doc-convert-baidu';
import { isBaiduNestedExcelZip } from '@/shared/lib/doc-convert-xlsx-merge';
import {
  queryBaiduOcrTask,
  resolveBaiduAuth,
  resolveOcrMarkdownAndStoragePayload,
} from '@/shared/lib/ocr-baidu-parser';
import { rewriteMarkdownImagesToR2 } from '@/shared/lib/ocr-parse-result-image-proxy';
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
  type DocConvertTask,
  findDocConvertTaskById,
  updateDocConvertTask,
} from '@/shared/models/doc_convert_task';

const POLL_INTERVAL_MS = 7_000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes
// Paddle-VL parser 慢于 doc_convert，md 轮询超时独立配置（默认 10min，env 可调）
const MD_POLL_TIMEOUT_MS = Math.max(
  300_000,
  Number(process.env.DOC_CONVERT_MD_POLL_TIMEOUT_MS || '600000') || 600_000
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 幂等扣费：creditConsumeId 已存在则跳过；扣费失败不阻塞结果就绪，仅记录日志 */
async function chargeDocConvertOnCompletion(
  taskId: string,
  job: DocConvertTask
): Promise<void> {
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
}

/**
 * md 目标：轮询 Paddle-VL parser → 构建 Markdown → 图片中转 R2 替换 URL → 上传 result.md。
 * 图片下载 `maxRetries: 2`（1 次原始 + 2 次重试 = 严格 3 次尝试），失败 URL 保持原百度 URL 不替换。
 */
async function processDocConvertMarkdownJob(
  taskId: string,
  job: DocConvertTask
): Promise<void> {
  const auth = await resolveBaiduAuth();
  const startedAt = Date.now();
  let latestResult: unknown = null;

  while (Date.now() - startedAt < MD_POLL_TIMEOUT_MS) {
    const q = await queryBaiduOcrTask({ auth, taskId: job.baiduTaskId! });
    if (q.status === 'failed') {
      const errorMessage = q.errorMessage || 'Baidu OCR failed';
      await updateDocConvertTask(taskId, {
        status: DocConvertTaskStatus.failed,
        errorMessage,
      });
      throw new Error(errorMessage);
    }
    if (q.status === 'success') {
      latestResult = q.result;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (latestResult == null) {
    const errorMessage = `Paddle-VL parser poll timeout after ${MD_POLL_TIMEOUT_MS}ms`;
    await updateDocConvertTask(taskId, {
      status: DocConvertTaskStatus.failed,
      errorMessage,
    });
    throw new Error(errorMessage);
  }

  const { markdown } = await resolveOcrMarkdownAndStoragePayload(latestResult);
  if (!markdown.trim()) {
    const errorMessage = 'OCR produced empty text';
    await updateDocConvertTask(taskId, {
      status: DocConvertTaskStatus.failed,
      errorMessage,
    });
    throw new Error(errorMessage);
  }

  // 图片中转：百度 BOS URL → 下载 → R2 → 替换；失败图片保留原百度 URL
  const mirrored = await rewriteMarkdownImagesToR2({
    markdown,
    taskId,
    assetKeyPrefix: `doc-convert/${taskId}/assets`,
    maxRetries: 2,
  });

  const resultR2Key = `doc-convert/${taskId}/result.md`;
  await putObject(
    resultR2Key,
    new TextEncoder().encode(mirrored.markdown),
    'text/markdown; charset=utf-8'
  );

  await chargeDocConvertOnCompletion(taskId, job);

  await updateDocConvertTask(taskId, {
    status: DocConvertTaskStatus.ready,
    percent: 100,
    resultData: JSON.stringify({
      markdown_chars: mirrored.markdown.length,
      images_replaced: mirrored.replaced,
      images_failed: mirrored.failed,
      images_total: mirrored.total,
    }),
    resultR2Key,
  });
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

  if (job.targetFormat === 'md') {
    await processDocConvertMarkdownJob(taskId, job);
    return;
  }

  await updateDocConvertTask(taskId, {
    status: DocConvertTaskStatus.processing,
  });

  const startedAt = Date.now();
  let finalResultData: { word: string; excel: string } | null = null;
  let failureMessage: string | null = null;
  let lastQr: { retCode: number; retMsg: string } | null = null;

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const qr = await queryDocConvert(job.baiduTaskId);
    lastQr = { retCode: qr.retCode, retMsg: qr.retMsg };

    await updateDocConvertTask(taskId, {
      percent: Math.max(0, Math.min(100, qr.percent)),
    });

    if (qr.retCode === 3) {
      finalResultData = qr.resultData;
      break;
    }

    // 百度顶层错误（鉴权/配额/拒绝等）→ 快速失败，透出真实原因
    if (qr.errorMsg) {
      failureMessage = qr.errorMsg;
      console.warn(
        '[doc-convert/poll] baidu_error',
        JSON.stringify({
          task_id: taskId,
          baidu_task_id: job.baiduTaskId,
          error_msg: qr.errorMsg,
          ret_code: qr.retCode,
        })
      );
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (!finalResultData) {
    const errorMessage =
      failureMessage ||
      `doc_convert poll timeout (last retCode=${lastQr?.retCode}, msg=${lastQr?.retMsg || ''})`;
    await updateDocConvertTask(taskId, {
      status: DocConvertTaskStatus.failed,
      errorMessage,
    });
    throw new Error(errorMessage);
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

        let ext: string;
        let contentType: string;

        if (job.targetFormat === 'excel') {
          // 百度多页 PDF 返回嵌套 ZIP（BaiduOCRConverter_Excel_xxx/page-N.xlsx）
          // 不做合并，检测到嵌套 ZIP 直接以 .zip 交付
          if (isBaiduNestedExcelZip(buffer)) {
            ext = 'zip';
            contentType = 'application/zip';
          } else {
            ext = 'xlsx';
            contentType =
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          }
        } else {
          ext = 'docx';
          contentType =
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }

        resultR2Key = `doc-convert/${taskId}/result.${ext}`;
        await putObject(resultR2Key, buffer, contentType);
      }
    } catch {
      // 下载失败，resultR2Key 保持 null
    }
  }

  // Excel 目标但百度未产出 Excel 结果（扫描件/复杂表格常见）
  if (job.targetFormat === 'excel' && !resultR2Key) {
    const errorMessage = downloadUrl
      ? 'Excel download failed'
      : 'Baidu did not produce an Excel result for this PDF (scan/complex tables may only yield Word output)';
    await updateDocConvertTask(taskId, {
      status: DocConvertTaskStatus.failed,
      errorMessage,
    });
    throw new Error(errorMessage);
  }

  // 幂等扣费：creditConsumeId 已存在则跳过
  await chargeDocConvertOnCompletion(taskId, job);

  await updateDocConvertTask(taskId, {
    status: DocConvertTaskStatus.ready,
    percent: 100,
    resultData: JSON.stringify(finalResultData),
    resultR2Key: resultR2Key || undefined,
  });
}
