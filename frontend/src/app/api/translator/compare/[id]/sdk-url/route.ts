import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import { findCompareJobForUser } from '@/shared/models/compare-job';
import {
  getCompareSdkUrl,
  resolveCompareAccessToken,
} from '@/shared/lib/translator/compare-api';

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

    if (job.status !== 'ready') {
      return respErr('comparison not ready yet');
    }
    if (!job.baiduTaskId) {
      return respErr('missing Baidu task ID');
    }

    const accessToken = await resolveCompareAccessToken();
    const sdkUrl = getCompareSdkUrl(job.baiduTaskId, accessToken);

    return respData({ sdkUrl });
  } catch (e) {
    console.error('[compare/sdk-url]', e);
    return respErr(e instanceof Error ? e.message : 'sdk url query failed');
  }
}
