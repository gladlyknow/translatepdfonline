import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import { findCompareJobForUser } from '@/shared/models/compare-job';
import { getObjectBody } from '@/shared/lib/translate-r2';

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

    if (job.status !== 'ready' || !job.resultR2Key) {
      return respErr('comparison result not ready');
    }

    const buf = await getObjectBody(job.resultR2Key);
    const text = new TextDecoder().decode(buf);
    const data = JSON.parse(text);

    return respData(data);
  } catch (e) {
    console.error('[compare/result]', e);
    return respErr(e instanceof Error ? e.message : 'result query failed');
  }
}
