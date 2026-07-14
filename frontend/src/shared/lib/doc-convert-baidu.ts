import { getAllConfigs } from '@/shared/models/config';

const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const SUBMIT_URL =
  'https://aip.baidubce.com/rest/2.0/ocr/v1/doc_convert/request';
const QUERY_URL =
  'https://aip.baidubce.com/rest/2.0/ocr/v1/doc_convert/get_request_result';

type BaiduAuth = {
  accessToken?: string;
  authorizationHeader?: string;
};

export interface DocConvertSubmitParams {
  /** base64-encoded image content (without data URI header) */
  image?: string;
}

export interface DocConvertSubmitResult {
  taskId: string;
  raw: Record<string, unknown>;
}

export interface DocConvertQueryResult {
  retCode: number; // 1=not started, 2=in progress, 3=done
  retMsg: string;
  percent: number;
  resultData: { word: string; excel: string };
  taskId: string;
  raw: Record<string, unknown>;
}

function normalizeBaiduAuthorizationHeader(raw: string): string {
  const t = String(raw || '').replace(/^["']|["']$/g, '').trim();
  if (!t) return '';
  if (/^Bearer\s+/i.test(t)) return t;
  return `Bearer ${t}`;
}

async function resolveBaiduAuth(): Promise<BaiduAuth> {
  const cfg = await getAllConfigs();
  const authorizationRaw = String(
    cfg.baidu_authorization || process.env.BAIDU_AUTHORIZATION || ''
  ).trim();
  const authorizationHeader = normalizeBaiduAuthorizationHeader(authorizationRaw);
  if (authorizationHeader) {
    return { authorizationHeader };
  }
  const apiKey = String(
    cfg.baidu_ocr_api_key || process.env.BAIDU_OCR_API_KEY || ''
  ).trim();
  const secretKey = String(
    cfg.baidu_ocr_secret_key || process.env.BAIDU_OCR_SECRET_KEY || ''
  ).trim();
  if (!apiKey || !secretKey) {
    throw new Error(
      'Baidu doc_convert credentials missing (need baidu_authorization or baidu_ocr_api_key/baidu_ocr_secret_key)'
    );
  }
  const tokenParams = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: secretKey,
  });
  const tokenRes = await fetch(`${BAIDU_TOKEN_URL}?${tokenParams.toString()}`, {
    method: 'POST',
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        `Baidu token request failed (${tokenRes.status})`
    );
  }
  return { accessToken: tokenJson.access_token };
}

function buildBaiduRequest(auth: BaiduAuth) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  let withToken = '';
  if (auth.authorizationHeader) {
    headers.Authorization = auth.authorizationHeader;
  } else if (auth.accessToken) {
    withToken = `?access_token=${encodeURIComponent(auth.accessToken)}`;
  } else {
    throw new Error('Baidu auth missing');
  }
  return { headers, withToken };
}

export async function submitDocConvert(
  params: DocConvertSubmitParams
): Promise<DocConvertSubmitResult> {
  const auth = await resolveBaiduAuth();
  const req = buildBaiduRequest(auth);

  const body = new URLSearchParams();
  if (params.image) {
    body.set('image', params.image);
  } else {
    throw new Error('doc_convert: image is required');
  }

  const res = await fetch(`${SUBMIT_URL}${req.withToken}`, {
    method: 'POST',
    headers: req.headers,
    body: body.toString(),
  });
  const raw = (await res.json()) as Record<string, unknown>;

  const success = raw.success === true || raw.success === 1;
  const result = (raw.result || {}) as { task_id?: string; taskId?: string };
  const taskId = result.task_id || result.taskId;
  if (!success && !taskId) {
    const msg =
      typeof raw.message === 'string'
        ? raw.message
        : `doc_convert submit failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  if (!taskId) {
    throw new Error('doc_convert submit: missing task_id in response');
  }

  return { taskId, raw };
}

export async function queryDocConvert(
  taskId: string
): Promise<DocConvertQueryResult> {
  const auth = await resolveBaiduAuth();
  const req = buildBaiduRequest(auth);

  const body = new URLSearchParams();
  body.set('task_id', taskId);

  const res = await fetch(`${QUERY_URL}${req.withToken}`, {
    method: 'POST',
    headers: req.headers,
    body: body.toString(),
  });
  const raw = (await res.json()) as Record<string, unknown>;

  const result = (raw.result || {}) as {
    task_id?: string;
    ret_code?: number;
    ret_msg?: string;
    percent?: number;
    result_data?: { word?: string; excel?: string };
  };

  return {
    taskId: result.task_id || taskId,
    retCode: result.ret_code ?? 0,
    retMsg: result.ret_msg || '',
    percent: result.percent ?? 0,
    resultData: {
      word: result.result_data?.word || '',
      excel: result.result_data?.excel || '',
    },
    raw,
  };
}

export function queryDocConvertDownloadUrl(
  resultData: { word: string; excel: string },
  targetFormat: string
): string {
  if (targetFormat === 'excel') {
    return resultData.excel || resultData.word || '';
  }
  return resultData.word || '';
}
