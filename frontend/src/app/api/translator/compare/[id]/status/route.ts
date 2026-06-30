import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import {
  findCompareJobForUser,
  updateCompareJob,
  DocumentCompareJobStatus,
} from '@/shared/models/compare-job';
import { queryCompareTask } from '@/shared/lib/translator/compare-api';
import { putObject } from '@/shared/lib/translate-r2';

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

    // If already in terminal state, just return
    if (
      job.status === DocumentCompareJobStatus.ready ||
      job.status === DocumentCompareJobStatus.failed
    ) {
      return respData({
        id: job.id,
        status: job.status,
        similarity: job.similarity || null,
        totalDiff: job.totalDiff ?? null,
        errorMessage: job.errorMessage || null,
        baseFilename: job.baseFilename,
        compareFilename: job.compareFilename,
        baseFormat: job.baseFormat,
        compareFormat: job.compareFormat,
        createdAt: job.createdAt,
      });
    }

    // Poll Baidu for status update
    if (
      job.baiduTaskId &&
      (job.status === DocumentCompareJobStatus.submitted ||
        job.status === DocumentCompareJobStatus.processing)
    ) {
      try {
        const qr = await queryCompareTask(job.baiduTaskId);

        if (qr.status === 'success') {
          const subTask = qr.subTaskList?.[0];
          const resultR2Key = `translator/${user.id}/${id}/result.json`;
          const resultJson = new TextEncoder().encode(JSON.stringify({
            similarity: qr.similarity || subTask?.similarity || null,
            totalDiff: qr.totalDiff ?? subTask?.totalDiff ?? null,
            subTaskList: qr.subTaskList || null,
          }));
          try { await putObject(resultR2Key, resultJson, 'application/json'); } catch (e) { console.error('[compare/status] failed to save result JSON', e); }
          await updateCompareJob(id, user.id, {
            status: DocumentCompareJobStatus.ready,
            similarity: qr.similarity || subTask?.similarity || null,
            totalDiff: qr.totalDiff ?? subTask?.totalDiff ?? null,
            resultR2Key,
          });
        } else if (qr.status === 'failed') {
          await updateCompareJob(id, user.id, {
            status: DocumentCompareJobStatus.failed,
            errorMessage: qr.errorType || 'Comparison failed',
          });
        } else if (qr.status === 'processing') {
          if (job.status !== DocumentCompareJobStatus.processing) {
            await updateCompareJob(id, user.id, {
              status: DocumentCompareJobStatus.processing,
            });
          }
        }
      } catch (e) {
        console.error('[compare/status poll]', e);
      }
    }

    // Re-fetch updated job
    const updated = await findCompareJobForUser(id, user.id);
    if (!updated) {
      return respErr('job not found');
    }

    return respData({
      id: updated.id,
      status: updated.status,
      similarity: updated.similarity || null,
      totalDiff: updated.totalDiff ?? null,
      errorMessage: updated.errorMessage || null,
      baseFilename: updated.baseFilename,
      compareFilename: updated.compareFilename,
      baseFormat: updated.baseFormat,
      compareFormat: updated.compareFormat,
      createdAt: updated.createdAt,
    });
  } catch (e) {
    console.error('[compare/status]', e);
    return respErr(e instanceof Error ? e.message : 'status query failed');
  }
}
