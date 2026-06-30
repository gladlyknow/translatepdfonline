import { nanoid } from 'nanoid';

import { respData, respErr } from '@/shared/lib/resp';
import { getAllConfigs } from '@/shared/models/config';
import { getUserInfo } from '@/shared/models/user';
import {
  createCompareJob,
  DocumentCompareJobStatus,
  listCompareJobs,
} from '@/shared/models/compare-job';
import { getStorageService } from '@/shared/services/storage';

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

export async function POST(req: Request) {
  try {
    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const configs = await getAllConfigs();
    const hasR2Creds =
      Boolean(configs.r2_access_key) &&
      Boolean(configs.r2_secret_key) &&
      Boolean(configs.r2_bucket_name);
    const hasR2Endpoint = Boolean(configs.r2_endpoint || configs.r2_account_id);
    if (!hasR2Creds) {
      return respErr('R2 config missing. Please configure R2 credentials.');
    }
    if (!hasR2Endpoint) {
      return respErr('R2 endpoint missing.');
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

    const storage = await getStorageService();
    const jobId = nanoid();

    const baseBuffer = new Uint8Array(await baseFile.arrayBuffer());
    const compareBuffer = new Uint8Array(await compareFile.arrayBuffer());

    const baseKey = `translator/${user.id}/${jobId}/base.${baseExt}`;
    const compareKey = `translator/${user.id}/${jobId}/compare.${compareExt}`;

    const [baseResult, compareResult] = await Promise.all([
      storage.uploadFile({
        key: baseKey,
        body: baseBuffer,
        contentType: baseFile.type,
        disposition: 'inline',
      }),
      storage.uploadFile({
        key: compareKey,
        body: compareBuffer,
        contentType: compareFile.type,
        disposition: 'inline',
      }),
    ]);

    if (!baseResult.success) {
      return respErr(baseResult.error || 'base file upload failed');
    }
    if (!compareResult.success) {
      return respErr(compareResult.error || 'compare file upload failed');
    }

    const basePublicUrl = storage.getPublicUrl({ key: baseKey }) || '';
    const comparePublicUrl = storage.getPublicUrl({ key: compareKey }) || '';

    const row = await createCompareJob({
      id: jobId,
      userId: user.id,
      status: DocumentCompareJobStatus.uploaded,
      baseR2Key: baseKey,
      baseFilename: baseFile.name || `base.${baseExt}`,
      baseFormat: baseExt,
      basePublicUrl,
      compareR2Key: compareKey,
      compareFilename: compareFile.name || `compare.${compareExt}`,
      compareFormat: compareExt,
      comparePublicUrl,
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
