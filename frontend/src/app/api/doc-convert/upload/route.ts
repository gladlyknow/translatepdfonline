import { nanoid } from 'nanoid';

import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import {
  createDocConvertTask,
  DocConvertTaskStatus,
} from '@/shared/models/doc_convert_task';
import { putObject } from '@/shared/lib/translate-r2';

const ALLOWED = {
  'image/jpeg': 'jpg',
} as Record<string, string>;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const user = await getUserInfo();
    if (!user) return respErr('no auth, please sign in');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file || !(file instanceof File)) return respErr('file is required');

    const ext = ALLOWED[file.type];
    if (!ext) return respErr('only JPG / JPEG images are allowed');

    if (file.size > MAX_BYTES) return respErr('file too large (max 10MB)');

    const jobId = nanoid();
    const buf = new Uint8Array(await file.arrayBuffer());
    const key = `doc-convert/${user.id}/${jobId}/source.${ext}`;

    await putObject(key, buf, file.type || 'image/jpeg');

    const row = await createDocConvertTask({
      id: jobId,
      userId: user.id,
      sourceFormat: ext,
      targetFormat: 'word',
      sourceR2Key: key,
      sourceFilename: file.name || `upload.${ext}`,
      status: DocConvertTaskStatus.uploaded,
      percent: 0,
    });

    return respData({
      job: {
        id: row.id,
        status: row.status,
        sourceFormat: row.sourceFormat,
        sourceFilename: row.sourceFilename,
      },
    });
  } catch (e) {
    console.error('[doc-convert/upload]', e);
    return respErr(e instanceof Error ? e.message : 'upload error');
  }
}
