import { nanoid } from 'nanoid';

import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import {
  createCompareJob,
  DocumentCompareJobStatus,
  listCompareJobs,
} from '@/shared/models/compare-job';
import { putObject, getR2PublicBaseUrl, encodeR2KeyForPublicUrl } from '@/shared/lib/translate-r2';

const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.ms-wps': 'wps',
};

const MAX_BYTES = 50 * 1024 * 1024;

function buildPublicUrl(key: string): string {
  const base = getR2PublicBaseUrl();
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/${encodeR2KeyForPublicUrl(key)}`;
}

export async function POST(req: Request) {
  try {
    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const formData = await req.formData();
    const baseFile = formData.get('baseFile') as File | null;
    const compareFile = formData.get('compareFile') as File | null;

    if (!baseFile || !(baseFile instanceof File)) {
      return respErr('baseFile is required');
    }
    if (!compareFile || !(compareFile instanceof File)) {
      return respErr('compareFile is required');
    }

    const baseExt = ALLOWED[baseFile.type];
    const compareExt = ALLOWED[compareFile.type];
    if (!baseExt) {
      return respErr(`unsupported base file type: ${baseFile.type || 'unknown'}`);
    }
    if (!compareExt) {
      return respErr(`unsupported compare file type: ${compareFile.type || 'unknown'}`);
    }

    if (baseFile.size > MAX_BYTES) {
      return respErr('base file too large (max 50MB)');
    }
    if (compareFile.size > MAX_BYTES) {
      return respErr('compare file too large (max 50MB)');
    }

    const jobId = nanoid();

    const baseBuffer = new Uint8Array(await baseFile.arrayBuffer());
    const compareBuffer = new Uint8Array(await compareFile.arrayBuffer());

    const baseKey = `translator/${user.id}/${jobId}/base.${baseExt}`;
    const compareKey = `translator/${user.id}/${jobId}/compare.${compareExt}`;

    await Promise.all([
      putObject(baseKey, baseBuffer, baseFile.type),
      putObject(compareKey, compareBuffer, compareFile.type),
    ]);

    const row = await createCompareJob({
      id: jobId,
      userId: user.id,
      status: DocumentCompareJobStatus.uploaded,
      baseR2Key: baseKey,
      baseFilename: baseFile.name || `base.${baseExt}`,
      baseFormat: baseExt,
      basePublicUrl: buildPublicUrl(baseKey),
      compareR2Key: compareKey,
      compareFilename: compareFile.name || `compare.${compareExt}`,
      compareFormat: compareExt,
      comparePublicUrl: buildPublicUrl(compareKey),
    });

    return respData({
      job: {
        id: row.id,
        status: row.status,
        baseFilename: row.baseFilename,
        baseFormat: row.baseFormat,
        compareFilename: row.compareFilename,
        compareFormat: row.compareFormat,
      },
    });
  } catch (e) {
    console.error('[compare/upload]', e);
    const rawMessage = e instanceof Error ? e.message : 'upload error';
    if (/fetch failed/i.test(rawMessage)) {
      return respErr('upload failed: cannot reach R2 endpoint.');
    }
    return respErr(rawMessage);
  }
}

export async function GET(req: Request) {
  try {
    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const jobs = await listCompareJobs(user.id, limit, offset);

    return respData({ jobs });
  } catch (e) {
    console.error('[compare/list]', e);
    return respErr(e instanceof Error ? e.message : 'list compare jobs failed');
  }
}
