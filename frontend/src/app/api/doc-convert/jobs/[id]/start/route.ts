import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import {
  findDocConvertTaskForUser,
  updateDocConvertTask,
  DocConvertTaskStatus,
} from '@/shared/models/doc_convert_task';
import { submitDocConvert } from '@/shared/lib/doc-convert-baidu';
import { sendDocConvertPollQueueMessage } from '@/shared/lib/ocr-queue';
import { getObjectBody } from '@/shared/lib/translate-r2';
import {
  getTranslateCreditsPerPage,
  isTranslateCreditsEnabled,
} from '@/shared/lib/translate-billing';
import { getRemainingCredits } from '@/shared/models/credit';

const VALID_SOURCES = new Set(['jpg', 'jpeg']);
const VALID_TARGETS = new Set(['word']);

export const runtime = 'nodejs';

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

    let body: { sourceFormat?: string; targetFormat?: string };
    try {
      body = (await req.json()) as {
        sourceFormat?: string;
        targetFormat?: string;
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

    // 从 R2 读取源图 → base64
    const fileBytes = await getObjectBody(job.sourceR2Key);
    if (!fileBytes || fileBytes.length === 0) {
      return respErr('source file not found in storage');
    }
    const base64 = Buffer.from(fileBytes).toString('base64');

    // 提交百度 doc_convert
    const { taskId } = await submitDocConvert({ image: base64 });

    await updateDocConvertTask(id, {
      sourceFormat,
      targetFormat,
      baiduTaskId: taskId,
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
      taskId,
      status: DocConvertTaskStatus.submitted,
    });
  } catch (e) {
    console.error('[doc-convert/start]', e);
    return respErr(e instanceof Error ? e.message : 'start failed');
  }
}
