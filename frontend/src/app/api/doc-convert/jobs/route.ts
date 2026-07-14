import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import {
  listDocConvertTasks,
  type DocConvertTask,
} from '@/shared/models/doc_convert_task';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const user = await getUserInfo();
    if (!user) return respErr('no auth, please sign in');

    const url = new URL(req.url);
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get('limit')) || 20)
    );
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const jobs = await listDocConvertTasks(user.id, limit + 1, offset);
    const hasMore = jobs.length > limit;
    const rows = jobs.slice(0, limit);

    return respData({
      jobs: rows.map((j: DocConvertTask) => ({
        id: j.id,
        status: j.status,
        sourceFormat: j.sourceFormat,
        targetFormat: j.targetFormat,
        sourceFilename: j.sourceFilename,
        percent: j.percent,
        hasDownload: j.status === 'ready' && Boolean(j.resultR2Key),
        errorMessage: j.errorMessage,
        createdAt: j.createdAt,
      })),
      hasMore,
      nextOffset: hasMore ? offset + limit : undefined,
    });
  } catch (e) {
    console.error('[doc-convert/jobs]', e);
    return respErr(e instanceof Error ? e.message : 'list failed');
  }
}
