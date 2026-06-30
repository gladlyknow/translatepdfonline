/**
 * 百度千帆合同对比 API 客户端
 * 参考 onlinepdftranslator 项目 compare-api.ts
 */
import { getAllConfigs } from '@/shared/models/config';

const SUBMIT_URL =
  'https://aip.baidubce.com/file/2.0/brain/online/v1/textdiff/create_task';
const QUERY_URL =
  'https://aip.baidubce.com/file/2.0/brain/online/v1/textdiff/query_task';
const SDK_BASE_URL =
  'https://textmind-sdk.bce.baidu.com/textmind/sdk/textdiff';

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';

export interface CompareSubmitParams {
  baseFile: Blob;
  baseFilename: string;
  baseMime: string;
  compareFile: Blob;
  compareFilename: string;
  compareMime: string;
  param?: {
    sealRecognition?: boolean;
    fullWidthHalfWidthRecognition?: boolean;
    fontFamilyRecognition?: boolean;
    fontSizeRecognition?: boolean;
    handWritingRecognition?: boolean;
  };
}

export interface CompareSubmitResult {
  taskId: string;
  raw: Record<string, unknown>;
}

export interface CompareQueryResult {
  taskId: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  duration?: string;
  errorType?: string;
  similarity?: string;
  totalDiff?: number;
  subTaskList?: CompareSubTask[];
  raw: Record<string, unknown>;
}

export interface CompareSubTask {
  similarity: string;
  totalDiff: number;
  baseDocId: string;
  baseDocName: string;
  baseDocOssURL?: string;
  compareDocId: string;
  compareDocName: string;
  compareDocOssURL?: string;
  compareStatus: string;
  compareMessage?: string;
  reportStatus?: string;
  reportMessage?: string;
  reportOssURL?: string;
  createdAt?: string;
  finishedAt?: string;
  diffItemList?: CompareDiffItem[];
}

export interface CompareDiffItem {
  id: string;
  basePageNum: number;
  baseDiffType: string;
  baseBoxArea: number[];
  baseDiffBoxes: string;
  baseDiffContent: string;
  baseDiffContext: string;
  baseDiffContentType: string[];
  comparePageNum: number;
  compareDiffType: string;
  compareBoxArea: number[];
  compareDiffBoxes: string;
  compareDiffContent: string;
  compareDiffContext: string;
  compareDiffContentType: string[];
}

// ---- 凭证读取 ----

function getBaiduAuthorizationRaw(configs: Record<string, string>): string {
  return String(
    configs.baidu_authorization ||
      process.env.BAIDU_AUTHORIZATION ||
      ''
  ).trim();
}

function normalizeBaiduAuthorizationHeader(raw: string): string {
  const t = raw.replace(/^["']|["']$/g, '').trim();
  if (!t) return '';
  if (/^Bearer\s+/i.test(t)) return t;
  return `Bearer ${t}`;
}

function getBaiduOcrKeys(configs: Record<string, string>) {
  return {
    apiKey: String(
      configs.baidu_ocr_api_key || process.env.BAIDU_OCR_API_KEY || ''
    ),
    secretKey: String(
      configs.baidu_ocr_secret_key || process.env.BAIDU_OCR_SECRET_KEY || ''
    ),
  };
}

let tokenCache: { token: string; exp: number } | null = null;

async function getBaiduAccessToken(
  apiKey: string,
  secretKey: string
): Promise<string> {
  const now = Date.now() / 1000;
  if (tokenCache && tokenCache.exp > now + 60) {
    return tokenCache.token;
  }
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: secretKey,
  });
  const res = await fetch(`${TOKEN_URL}?${params}`, { method: 'POST' });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(
      data.error_description || data.error || 'Baidu token failed'
    );
  }
  tokenCache = {
    token: data.access_token,
    exp: now + (data.expires_in ?? 2592000),
  };
  return data.access_token;
}

async function resolveAuth(): Promise<{
  accessToken?: string;
  authorizationHeader?: string;
}> {
  const configs = await getAllConfigs();
  const authRaw = getBaiduAuthorizationRaw(configs);
  const authHeader = normalizeBaiduAuthorizationHeader(authRaw);
  if (authHeader) return { authorizationHeader: authHeader };

  const { apiKey, secretKey } = getBaiduOcrKeys(configs);
  if (apiKey && secretKey) {
    const token = await getBaiduAccessToken(apiKey, secretKey);
    return { accessToken: token };
  }

  throw new Error('Baidu compare: no auth credentials configured');
}

// ---- API 函数 ----

export async function submitCompareTask(
  params: CompareSubmitParams
): Promise<CompareSubmitResult> {
  const auth = await resolveAuth();

  const form = new FormData();
  form.set('baseFile', params.baseFile, params.baseFilename);
  form.set('compareFile', params.compareFile, params.compareFilename);

  form.set('sealRecognition', params.param?.sealRecognition ? 'true' : 'false');
  form.set(
    'handWritingRecognition',
    params.param?.handWritingRecognition ? 'true' : 'false'
  );
  if (params.param?.fullWidthHalfWidthRecognition) {
    form.set('fullWidthHalfWidthRecognition', 'true');
  }
  if (params.param?.fontFamilyRecognition) {
    form.set('fontFamilyRecognition', 'true');
  }
  if (params.param?.fontSizeRecognition) {
    form.set('fontSizeRecognition', 'true');
  }

  const headers: Record<string, string> = {};

  let url = SUBMIT_URL;
  if (auth.authorizationHeader) {
    headers['Authorization'] = auth.authorizationHeader;
  } else if (auth.accessToken) {
    url = `${SUBMIT_URL}?access_token=${encodeURIComponent(auth.accessToken)}`;
  }

  const res = await fetch(url, { method: 'POST', headers, body: form });
  const raw = (await res.json()) as Record<string, unknown>;

  if (raw.error_code !== 0) {
    const msg =
      typeof raw.error_msg === 'string'
        ? raw.error_msg
        : `compare submit failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const result = (raw.result || {}) as { taskId?: string };
  if (!result.taskId) {
    throw new Error('compare submit: missing taskId in response');
  }

  return { taskId: result.taskId, raw };
}

export async function queryCompareTask(
  taskId: string
): Promise<CompareQueryResult> {
  const auth = await resolveAuth();

  const form = new FormData();
  form.set('taskId', taskId);

  const headers: Record<string, string> = {};

  let url = QUERY_URL;
  if (auth.authorizationHeader) {
    headers['Authorization'] = auth.authorizationHeader;
  } else if (auth.accessToken) {
    url = `${QUERY_URL}?access_token=${encodeURIComponent(auth.accessToken)}`;
  }

  const res = await fetch(url, { method: 'POST', headers, body: form });
  const raw = (await res.json()) as Record<string, unknown>;

  if (raw.error_code !== 0) {
    const msg =
      typeof raw.error_msg === 'string'
        ? raw.error_msg
        : `compare query failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const result = (raw.result || {}) as Record<string, unknown>;

  const status = (result.status as string) || 'processing';

  return {
    taskId: (result.taskId as string) || taskId,
    status: status as CompareQueryResult['status'],
    duration: result.duration as string | undefined,
    errorType: result.errorType as string | undefined,
    similarity: result.similarity as string | undefined,
    totalDiff: result.totalDiff as number | undefined,
    subTaskList: (result.subTaskList as CompareSubTask[]) || undefined,
    raw,
  };
}

export function getCompareSdkUrl(
  taskId: string,
  accessToken: string
): string {
  return `${SDK_BASE_URL}/${encodeURIComponent(taskId)}?access_token=${encodeURIComponent(accessToken)}`;
}

export async function resolveCompareAccessToken(): Promise<string> {
  const configs = await getAllConfigs();

  const { apiKey, secretKey } = getBaiduOcrKeys(configs);
  if (apiKey && secretKey) {
    return getBaiduAccessToken(apiKey, secretKey);
  }

  const clientId = (
    configs.baidu_client_id ||
    process.env.BAIDU_CLIENT_ID ||
    ''
  ).trim();
  const clientSecret = (
    configs.baidu_client_secret ||
    process.env.BAIDU_CLIENT_SECRET ||
    ''
  ).trim();
  if (clientId && clientSecret) {
    return getBaiduAccessToken(clientId, clientSecret);
  }

  throw new Error(
    'Baidu compare SDK: no credentials configured. Set BAIDU_CLIENT_ID + BAIDU_CLIENT_SECRET or BAIDU_OCR_API_KEY + BAIDU_OCR_SECRET_KEY.'
  );
}
