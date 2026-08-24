import { getAllConfigs } from '@/shared/models/config';
import { resolveBaiduOcrPayload } from '@/shared/lib/ocr-baidu-ocr-result';

/**
 * 百度 Paddle-VL parser 客户端（提交 / 轮询 / 构建 Markdown）。
 * 从 ocr-translate.ts 提取为独立模块，供 OCR 翻译流水线与 doc-convert md 分支共用，
 * 避免 converter 打包时引入 ocr-translate.ts 的 pdf-lib / fontkit / DeepSeek 等无关依赖。
 */

const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_TASK_URL =
  'https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task';
const BAIDU_QUERY_URL =
  'https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task/query';

export type BaiduAuth = {
  accessToken?: string;
  authorizationHeader?: string;
};

export function normalizeBaiduAuthorizationHeader(raw: string): string {
  const t = String(raw || '').replace(/^["']|["']$/g, '').trim();
  if (!t) return '';
  if (/^Bearer\s+/i.test(t)) return t;
  return `Bearer ${t}`;
}

export async function resolveBaiduAuth(): Promise<BaiduAuth> {
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
      'Baidu OCR credentials missing (need baidu_authorization or baidu_ocr_api_key/baidu_ocr_secret_key)'
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

export function buildBaiduRequest(params: BaiduAuth) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  let withToken = '';
  if (params.authorizationHeader) {
    headers.Authorization = params.authorizationHeader;
  } else if (params.accessToken) {
    withToken = `?access_token=${encodeURIComponent(params.accessToken)}`;
  } else {
    throw new Error('Baidu auth missing');
  }
  return { headers, withToken };
}

export async function submitBaiduOcrTask(params: {
  auth: BaiduAuth;
  fileUrl: string;
  fileName: string;
}): Promise<string> {
  const req = buildBaiduRequest(params.auth);
  const body = new URLSearchParams({
    file_url: params.fileUrl,
    file_name: params.fileName || 'document.pdf',
    parse_image_layout: 'true',
    merge_tables: 'true',
  });
  const res = await fetch(`${BAIDU_TASK_URL}${req.withToken}`, {
    method: 'POST',
    headers: req.headers,
    body: body.toString(),
  });
  const json = (await res.json()) as {
    task_id?: string;
    error_code?: number;
    error_msg?: string;
    result?: { task_id?: string };
  };
  const taskId = json.task_id || json.result?.task_id;
  if (!res.ok || (json.error_code != null && json.error_code !== 0) || !taskId) {
    throw new Error(
      json.error_msg ||
        `Baidu submit failed (${res.status})`
    );
  }
  return taskId;
}

function normalizeQueryStatus(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const obj = raw as Record<string, unknown>;
  const v =
    obj.task_status ??
    obj.taskStatus ??
    obj.task_state ??
    obj.taskState ??
    obj.status ??
    obj.state;
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export async function queryBaiduOcrTask(params: {
  auth: BaiduAuth;
  taskId: string;
}): Promise<{ status: string; result?: unknown; errorMessage?: string }> {
  const req = buildBaiduRequest(params.auth);
  const body = new URLSearchParams({ task_id: params.taskId });
  const res = await fetch(`${BAIDU_QUERY_URL}${req.withToken}`, {
    method: 'POST',
    headers: req.headers,
    body: body.toString(),
  });
  const json = (await res.json()) as Record<string, unknown> & {
    error_code?: number;
    error_msg?: string;
    result?: unknown;
    data?: unknown;
  };
  const ec = json.error_code;
  if (!res.ok || (ec != null && ec !== 0)) {
    return {
      status: 'failed',
      errorMessage:
        json.error_msg || `Baidu OCR query failed (${res.status})`,
    };
  }
  const status =
    normalizeQueryStatus(json) ||
    (json.data ? normalizeQueryStatus(json.data) : '') ||
    (json.result ? normalizeQueryStatus(json.result) : '');
  if (['success', 'finished', 'complete'].includes(status)) {
    return { status: 'success', result: json.result ?? json.data ?? json };
  }
  if (['failed', 'fail'].includes(status)) {
    return {
      status: 'failed',
      errorMessage: (json.error_msg as string) || 'Baidu OCR task failed',
    };
  }
  return { status: 'running', result: json.result ?? json.data ?? json };
}

function collectTextChunks(raw: unknown, acc: string[]) {
  if (raw == null) return;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.length >= 2) acc.push(s);
    return;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) collectTextChunks(item, acc);
    return;
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (
        ['text', 'title', 'content', 'markdown', 'paragraph', 'caption'].includes(
          k.toLowerCase()
        )
      ) {
        collectTextChunks(v, acc);
      } else if (typeof v === 'object') {
        collectTextChunks(v, acc);
      }
    }
  }
}

export function buildMarkdownFromOcrPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const obj = payload as Record<string, unknown>;
  const parseResultUrl =
    typeof obj.parse_result_url === 'string' ? obj.parse_result_url : '';
  if (parseResultUrl) {
    return '';
  }
  const chunks: string[] = [];
  const pages = Array.isArray(obj.pages) ? obj.pages : [];
  if (pages.length > 0) {
    pages.forEach((page, idx) => {
      const pageChunks: string[] = [];
      collectTextChunks(page, pageChunks);
      if (pageChunks.length > 0) {
        chunks.push(`## Page ${idx + 1}\n\n${pageChunks.join('\n\n')}`);
      }
    });
  } else {
    collectTextChunks(payload, chunks);
  }
  const uniq = [...new Set(chunks.map((x) => x.trim()).filter(Boolean))];
  return uniq.join('\n\n').slice(0, 200_000);
}

function extractParseResultUrl(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (typeof obj.parse_result_url === 'string') return obj.parse_result_url;
  if (obj.result && typeof obj.result === 'object') {
    const nested = obj.result as Record<string, unknown>;
    if (typeof nested.parse_result_url === 'string') return nested.parse_result_url;
  }
  return '';
}

/**
 * 解析 Baidu OCR 结果为 Markdown，并返回应持久化到 R2 的 JSON（来自 parse_result_url 或原始 payload）。
 */
export async function resolveOcrMarkdownAndStoragePayload(payload: unknown): Promise<{
  markdown: string;
  parseJson: unknown;
}> {
  const cfg = await getAllConfigs();
  const authorizationRaw = String(
    cfg.baidu_authorization || process.env.BAIDU_AUTHORIZATION || ''
  ).trim();
  const authorizationHeader = normalizeBaiduAuthorizationHeader(authorizationRaw) || undefined;
  const tokenAuth = await resolveBaiduAuth().catch(() => ({} as BaiduAuth));
  const accessToken = tokenAuth.accessToken;
  const resolved = await resolveBaiduOcrPayload(payload, { authorizationHeader, accessToken });
  const mdFromResolved = buildMarkdownFromOcrPayload(resolved);
  if (mdFromResolved.trim()) {
    return { markdown: mdFromResolved, parseJson: resolved };
  }
  const parseResultUrl = extractParseResultUrl(payload);
  if (parseResultUrl) {
    const res = await fetch(parseResultUrl);
    if (!res.ok) throw new Error(`Failed to fetch OCR parse_result_url (${res.status})`);
    const json = (await res.json()) as unknown;
    return { markdown: buildMarkdownFromOcrPayload(json), parseJson: json };
  }
  return {
    markdown: buildMarkdownFromOcrPayload(payload),
    parseJson: payload,
  };
}
