import { respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import { findDocConvertTaskForUser } from '@/shared/models/doc_convert_task';
import { createPresignedGet } from '@/shared/lib/translate-r2';

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

    if (job.status !== 'ready' || !job.resultR2Key) {
      return respErr('result not ready');
    }

    const ext = job.targetFormat === 'excel' ? 'xlsx' : 'docx';
    const baseName = (job.sourceFilename || 'document').replace(/\.[^.]+$/, '');
    const filename = `${baseName}_converted.${ext}`;

    const downloadUrl = await createPresignedGet(job.resultR2Key, 900, {
      responseContentDisposition: `attachment; filename="${filename}"`,
    });

    return Response.redirect(downloadUrl, 302);
  } catch (e) {
    console.error('[doc-convert/download]', e);
    return respErr(e instanceof Error ? e.message : 'download failed');
  }
}
