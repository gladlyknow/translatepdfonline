import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import {
  deleteCompareJob,
  findCompareJobForUser,
} from '@/shared/models/compare-job';
import { deleteObject } from '@/shared/lib/translate-r2';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const { id } = await ctx.params;
    const job = await findCompareJobForUser(id, user.id);
    if (!job) {
      return respErr('job not found');
    }

    return respData({ job });
  } catch (e) {
    console.error('[compare/get]', e);
    return respErr(e instanceof Error ? e.message : 'get job failed');
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const { id } = await ctx.params;
    const job = await findCompareJobForUser(id, user.id);
    if (!job) {
      return respErr('job not found');
    }

    const deleteKeys = [
      job.baseR2Key,
      job.compareR2Key,
      job.resultR2Key,
    ].filter(Boolean) as string[];

    await Promise.allSettled(
      deleteKeys.map((key) => deleteObject(key).catch(() => {}))
    );

    await deleteCompareJob(id, user.id);

    return respData({ deleted: true });
  } catch (e) {
    console.error('[compare/delete]', e);
    return respErr(e instanceof Error ? e.message : 'delete failed');
  }
}
