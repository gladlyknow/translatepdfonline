import { PDFDocument } from 'pdf-lib';

import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import {
  findDocConvertTaskForUser,
  updateDocConvertTask,
  DocConvertTaskStatus,
} from '@/shared/models/doc_convert_task';
import { submitDocConvert } from '@/shared/lib/doc-convert-baidu';
import { resolveBaiduAuth, submitBaiduOcrTask } from '@/shared/lib/ocr-baidu-parser';
import { sendDocConvertPollQueueMessage } from '@/shared/lib/ocr-queue';
import { createPresignedGet, getObjectBody, putObject } from '@/shared/lib/translate-r2';
import {
  getTranslateCreditsPerPage,
  isTranslateCreditsEnabled,
} from '@/shared/lib/translate-billing';
import { getRemainingCredits } from '@/shared/models/credit';

const VALID_SOURCES = new Set(['jpg', 'jpeg', 'pdf']);
const VALID_TARGETS = new Set(['word', 'excel', 'md']);

export const runtime = 'nodejs';

/** 解析 "1,3,5-8" 逗号分隔页码 → 升序页码数组；非法输入返回 null */
function parsePdfPageList(raw: string): number[] | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const out = new Set<number>();
  for (const part of s.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const dash = p.indexOf('-');
    if (dash === -1) {
      const n = parseInt(p, 10);
      if (Number.isNaN(n) || n < 1) return null;
      out.add(n);
    } else {
      const start = parseInt(p.slice(0, dash).trim(), 10);
      const end = parseInt(p.slice(dash + 1).trim(), 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < start) {
        return null;
      }
      if (end - start > 2000) return null; // 防御超大区间
      for (let i = start; i <= end; i += 1) out.add(i);
    }
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : null;
}

/**
 * 用 pdf-lib 将源 PDF 切成指定页码的切片 PDF 并上传 R2，返回切片预签名 URL。
 * 解析失败（加密/损坏/越界）返回 null，调用方回退全量源文件。
 */
async function trySlicePdf(
  sourceKey: string,
  sliceKey: string,
  pages: number[]
): Promise<string | null> {
  try {
    const bytes = await getObjectBody(sourceKey);
    if (!bytes || bytes.length === 0) return null;
    const doc = await PDFDocument.load(bytes);
    const count = doc.getPageCount();
    const valid = pages.filter((p) => p >= 1 && p <= count);
    if (valid.length === 0) return null;
    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      doc,
      valid.map((p) => p - 1)
    );
    for (const page of copied) out.addPage(page);
    const sliceBytes = await out.save();
    await putObject(sliceKey, sliceBytes, 'application/pdf');
    return createPresignedGet(sliceKey, 3600);
  } catch (e) {
    console.warn(
      '[doc-convert/start] pdf_slice_failed',
      JSON.stringify({
        source_key: sourceKey,
        error: e instanceof Error ? e.message : String(e),
      })
    );
    return null;
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserInfo();
    if (!user) return respErr('no auth, please sign in');

    const { id } = await ctx.params;
    const job = await findDocConvertTaskForUser(id, user.id);
    if (!job) return respErr('job not found');

    if (
      job.status !== DocConvertTaskStatus.uploaded &&
      job.status !== DocConvertTaskStatus.failed
    ) {
      return respErr('job already started or not in uploaded/failed state');
    }

    let body: { sourceFormat?: string; targetFormat?: string; pdfFileNum?: string };
    try {
      body = (await req.json()) as {
        sourceFormat?: string;
        targetFormat?: string;
        pdfFileNum?: string;
      };
    } catch {
      body = {};
    }

    const sourceFormat = (body.sourceFormat || job.sourceFormat || '')
      .toLowerCase()
      .trim();
    const targetFormat = (body.targetFormat || job.targetFormat || 'word')
      .toLowerCase()
      .trim();

    if (!VALID_SOURCES.has(sourceFormat)) {
      return respErr('invalid source format');
    }
    if (!VALID_TARGETS.has(targetFormat)) {
      return respErr('invalid target format');
    }

    // 积分校验：单图按 1 页计
    if (isTranslateCreditsEnabled()) {
      const required = getTranslateCreditsPerPage();
      const remaining = await getRemainingCredits(user.id);
      if (remaining < required) {
        return respErr(
          `Insufficient credits: have ${remaining}, need ${required}. Please purchase more credits.`
        );
      }
    }

    let baiduTaskId: string;

    if (targetFormat === 'md') {
      // md 走 Paddle-VL parser（百度 doc_convert 无 md 输出）
      if (sourceFormat !== 'pdf') {
        return respErr('markdown conversion only supports PDF source');
      }
      const auth = await resolveBaiduAuth();
      let fileUrl = await createPresignedGet(job.sourceR2Key, 3600);
      let fileName = job.sourceFilename || 'document.pdf';

      // 页码范围切片：解析失败/越界/加密 → 回退全量源文件
      const pages = parsePdfPageList(body.pdfFileNum || '');
      if (pages && pages.length > 0) {
        const sliceKey = job.sourceR2Key.replace(/source\.pdf$/, 'slice.pdf');
        const sliceUrl = await trySlicePdf(job.sourceR2Key, sliceKey, pages);
        if (sliceUrl) {
          fileUrl = sliceUrl;
          fileName =
            (job.sourceFilename || 'document.pdf').replace(/\.pdf$/i, '') +
            '_pages.pdf';
        }
      }

      baiduTaskId = await submitBaiduOcrTask({ auth, fileUrl, fileName });
    } else {
      // 从 R2 读取源图 → base64
      const fileBytes = await getObjectBody(job.sourceR2Key);
      if (!fileBytes || fileBytes.length === 0) {
        return respErr('source file not found in storage');
      }
      const base64 = Buffer.from(fileBytes).toString('base64');

      // 提交百度 doc_convert — PDF 和图片使用不同参数
      const isPdf = sourceFormat === 'pdf';
      const submitParams = isPdf
        ? { pdfFile: base64, pdfFileNum: body.pdfFileNum || undefined }
        : { image: base64 };
      baiduTaskId = (await submitDocConvert(submitParams)).taskId;
    }

    await updateDocConvertTask(id, {
      sourceFormat,
      targetFormat,
      baiduTaskId,
      status: DocConvertTaskStatus.submitted,
      percent: 0,
      errorMessage: null,
    });

    // 入队轮询
    const enq = await sendDocConvertPollQueueMessage(id);
    if (!enq.ok) {
      console.warn(
        '[doc-convert/start] enqueue_failed',
        JSON.stringify({ task_id: id, reason: enq.reason })
      );
    }

    return respData({
      jobId: id,
      taskId: baiduTaskId,
      status: DocConvertTaskStatus.submitted,
    });
  } catch (e) {
    console.error('[doc-convert/start]', e);
    return respErr(e instanceof Error ? e.message : 'start failed');
  }
}
