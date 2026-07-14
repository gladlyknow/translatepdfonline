import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import { findDocConvertTaskForUser } from '@/shared/models/doc_convert_task';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserInfo();
    if (!user) return respErr('no auth, please sign in');

    const { id } = await ctx.params;
    const job = await findDocConvertTaskForUser(id, user.id);
    if (!job) return respErr('job not found');

    return respData({
      id: job.id,
      status: job.status,
      percent: job.percent,
      sourceFormat: job.sourceFormat,
      targetFormat: job.targetFormat,
      sourceFilename: job.sourceFilename,
      errorMessage: job.errorMessage,
      hasDownload: job.status === 'ready' && Boolean(job.resultR2Key),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (e) {
    console.error('[doc-convert/status]', e);
    return respErr(e instanceof Error ? e.message : 'status failed');
  }
}
