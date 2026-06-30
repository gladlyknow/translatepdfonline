import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import {
  findCompareJobForUser,
  updateCompareJob,
  DocumentCompareJobStatus,
} from '@/shared/models/compare-job';
import { submitCompareTask } from '@/shared/lib/translator/compare-api';
import { getObjectBody } from '@/shared/lib/translate-r2';

export async function POST(
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
    if (job.status !== DocumentCompareJobStatus.uploaded) {
      return respErr(`job status is '${job.status}', expected 'uploaded'`);
    }

    // Download files from R2
    const [baseBuf, compareBuf] = await Promise.all([
      getObjectBody(job.baseR2Key),
      getObjectBody(job.compareR2Key),
    ]);

    if (!baseBuf || !compareBuf) {
      return respErr('failed to read uploaded files');
    }

    // Safety limit: max 100MB combined
    if (baseBuf.length + compareBuf.length > 100 * 1024 * 1024) {
      return respErr('files too large for comparison (max 100MB combined)');
    }

    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      wps: 'application/vnd.ms-wps',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
    };
    const baseMime = mimeMap[job.baseFormat] || 'application/octet-stream';
    const compareMime = mimeMap[job.compareFormat] || 'application/octet-stream';

    const result = await submitCompareTask({
      baseFile: new Blob([baseBuf as BlobPart], { type: baseMime }),
      baseFilename: job.baseFilename || `base.${job.baseFormat}`,
      baseMime,
      compareFile: new Blob([compareBuf as BlobPart], { type: compareMime }),
      compareFilename: job.compareFilename || `compare.${job.compareFormat}`,
      compareMime,
      param: {
        sealRecognition: true,
        handWritingRecognition: true,
      },
    });

    await updateCompareJob(id, user.id, {
      baiduTaskId: result.taskId,
      status: DocumentCompareJobStatus.submitted,
    });

    return respData({
      jobId: id,
      taskId: result.taskId,
      status: DocumentCompareJobStatus.submitted,
    });
  } catch (e) {
    console.error('[compare/start]', e);
    return respErr(e instanceof Error ? e.message : 'start comparison failed');
  }
}
