import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getAllConfigs } from '@/shared/models/config';
import { createPresignedGet, getObjectBody, putObject } from '@/shared/lib/translate-r2';
import { loadOcrPdfCjkFontBytesAsync } from '@/shared/lib/ocr-export-pdf-font-bytes';
import { resolveBaiduOcrPayload } from '@/shared/lib/ocr-baidu-ocr-result';

const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_TASK_URL =
  'https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task';
const BAIDU_QUERY_URL =
  'https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task/query';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const OCR_PDF_RENDER_MAX_CHARS = Math.max(
  8000,
  Number(process.env.OCR_PDF_RENDER_MAX_CHARS || '12000') || 12000
);
const OCR_EXPORT_STAGE_TIMEOUT_MS = Math.max(
  8000,
  Number(process.env.OCR_EXPORT_STAGE_TIMEOUT_MS || '25000') || 25000
);
const OCR_EXPORT_UPLOAD_RETRY_MAX = Math.max(
  1,
  Number(process.env.OCR_EXPORT_UPLOAD_RETRY_MAX || '4') || 4
);

function resolveOcrDeepSeekModel(): string {
  return (
    String(process.env.OCR_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || '').trim() ||
    'deepseek-v4-flash'
  );
}

function resolveReasoningEffort(): 'high' | 'max' | undefined {
  const raw = String(
    process.env.OCR_DEEPSEEK_REASONING_EFFORT ||
      process.env.DEEPSEEK_REASONING_EFFORT ||
      ''
  )
    .trim()
    .toLowerCase();
  if (raw === 'high' || raw === 'max') return raw;
  return undefined;
}

type BaiduAuth = {
  accessToken?: string;
  authorizationHeader?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withStageTimeout<T>(
  stage: string,
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ocr export stage timeout (${stage}) after ${timeoutMs}ms`));
    }, timeoutMs);
    fn()
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

function isRetryableStorageLikeError(raw: string): boolean {
  const v = raw.toLowerCase();
  return (
    v.includes('timeout') ||
    v.includes('timed out') ||
    v.includes('network') ||
    v.includes('fetch failed') ||
    v.includes('socket') ||
    v.includes('econn') ||
    v.includes('503') ||
    v.includes('429')
  );
}

async function putObjectWithRetry(params: {
  key: string;
  body: Uint8Array;
  contentType: string;
  stage: string;
}): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= OCR_EXPORT_UPLOAD_RETRY_MAX; attempt += 1) {
    try {
      await withStageTimeout(
        `${params.stage}_attempt_${attempt}`,
        () => putObject(params.key, params.body, params.contentType),
        OCR_EXPORT_STAGE_TIMEOUT_MS
      );
      return;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = isRetryableStorageLikeError(msg);
      if (!retryable || attempt >= OCR_EXPORT_UPLOAD_RETRY_MAX) break;
      await sleep(Math.min(600 * attempt, 2500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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

function buildBaiduRequest(params: BaiduAuth) {
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

async function submitBaiduOcrTask(params: {
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

async function queryBaiduOcrTask(params: {
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

function buildMarkdownFromOcrPayload(payload: unknown): string {
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
async function resolveOcrMarkdownAndStoragePayload(payload: unknown): Promise<{
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

export async function translateMarkdownWithDeepSeek(params: {
  markdown: string;
  sourceLang: string;
  targetLang: string;
}): Promise<string> {
  const cfg = await getAllConfigs();
  const apiKey = String(
    cfg.deepseek_api_key || process.env.DEEPSEEK_API_KEY || ''
  ).trim();
  if (!apiKey) {
    throw new Error('DeepSeek API key missing');
  }
  const fromClause = params.sourceLang ? `from ${params.sourceLang} ` : '';
  const prompt = [
    `Translate the following markdown ${fromClause}to ${params.targetLang}.`,
    'Keep markdown structure, formulas, URLs, and code blocks unchanged.',
    'Return translated markdown only.',
    '',
    params.markdown,
  ].join('\n');
  const model = resolveOcrDeepSeekModel();
  /** 整篇 OCR Markdown 单次请求；默认比 parse 批更长，避免大文档无意义超时 */
  const fetchTimeoutMs = Math.max(
    60_000,
    Number(
      process.env.OCR_MARKDOWN_TRANSLATE_FETCH_TIMEOUT_MS || '180000'
    ) || 180_000
  );
  const RETRY_MAX = Math.max(
    1,
    Number(process.env.OCR_MARKDOWN_TRANSLATE_RETRY_MAX || '3') || 3
  );
  const mdChars = params.markdown.length;
  const maxTokens = resolveBatchMaxTokens(mdChars);

  let lastError = '';
  for (let attempt = 1; attempt <= RETRY_MAX; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
          // 与 translateStringListWithDeepSeek 对齐：关闭 Thinking，避免 translate_markdown 长时间无响应
          extra_body: { thinking: { type: 'disabled' } },
        }),
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout =
        name === 'TimeoutError' || msg.toLowerCase().includes('abort');
      lastError = isTimeout
        ? `DeepSeek markdown translate timeout after ${fetchTimeoutMs}ms`
        : `DeepSeek markdown translate fetch failed: ${msg}`;
      if (attempt < RETRY_MAX) {
        const base = 600;
        const expo = Math.min(8000, base * 2 ** (attempt - 1));
        await sleep(expo + Math.floor(Math.random() * base));
      }
      continue;
    }

    const json = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
      message?: string;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!res.ok || !content) {
      lastError =
        json.error?.message ||
        json.message ||
        `DeepSeek translate failed (${res.status})`;
      if (isRetryableDeepSeekStatus(res.status) && attempt < RETRY_MAX) {
        const base = 600;
        const expo = Math.min(8000, base * 2 ** (attempt - 1));
        await sleep(expo + Math.floor(Math.random() * base));
        continue;
      }
      if (!isRetryableDeepSeekStatus(res.status)) break;
      continue;
    }
    return content;
  }
  throw new Error(lastError || 'DeepSeek markdown translate failed');
}

type DeepSeekBatchPlan = {
  index: number;
  start: number;
  end: number;
  slice: string[];
  chars: number;
};

function planDeepSeekParseBatches(
  parts: string[],
  maxChunkItems: number,
  maxChunkChars: number
): DeepSeekBatchPlan[] {
  const plans: DeepSeekBatchPlan[] = [];
  let start = 0;
  let index = 0;
  while (start < parts.length) {
    let end = start;
    let charBudget = 0;
    while (
      end < parts.length &&
      end - start < maxChunkItems &&
      charBudget < maxChunkChars
    ) {
      charBudget += (parts[end]?.length ?? 0) + 8;
      end += 1;
    }
    if (end === start) end = start + 1;
    const slice = parts.slice(start, end);
    index += 1;
    plans.push({
      index,
      start,
      end,
      slice,
      chars: slice.reduce((a, s) => a + (s?.length ?? 0), 0),
    });
    start = end;
  }
  return plans;
}

/**
 * DeepSeek 偶发多返回 1 条（尾部 ""、或末两项相同）；与输入条数对齐，避免整阶段失败。
 * 仍过长时取前 N 条并打日志（顺序与 batch 一致，优于任务失败）。
 */
function normalizeDeepSeekBatchArrayOutput(
  parsed: unknown[],
  expectedLen: number
): string[] | null {
  const toStr = (x: unknown) =>
    typeof x === 'string' ? x : x == null ? '' : String(x);
  let arr = parsed.map(toStr);
  while (arr.length > expectedLen && arr[arr.length - 1].trim() === '') {
    arr = arr.slice(0, -1);
  }
  while (arr.length > expectedLen && arr[0].trim() === '') {
    arr = arr.slice(1);
  }
  if (arr.length === expectedLen) return arr;
  if (arr.length === expectedLen + 1) {
    const a = arr[arr.length - 2];
    const b = arr[arr.length - 1];
    if (a === b) return arr.slice(0, -1);
  }
  if (arr.length > expectedLen) {
    console.warn(
      '[ocr/deepseek_parse_batch] output_length_mismatch_trim',
      JSON.stringify({ expectedLen, got: arr.length, action: 'slice_head' })
    );
    return arr.slice(0, expectedLen);
  }
  return null;
}

const COERCE_DEEPSEEK_BATCH_JSON_MAX_DEPTH = 3;

const DEEPSEEK_BATCH_ARRAY_KEYS = [
  'translations',
  'translation',
  'items',
  'item',
  'result',
  'results',
  'data',
  'strings',
  'texts',
  'output',
  'content',
] as const;

/** 去掉助手回复外的 Markdown 代码围栏与首尾空白 */
function stripAssistantJsonContent(raw: string): string {
  let s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fenced) {
    return fenced[1].trim();
  }
  return s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * 从助手正文中解析 JSON：先 strip，再 parse，最后用非贪婪方式抽取首个 `[...]`。
 */
function parseAssistantContentToJson(rawContent: string): unknown | null {
  const stripped = stripAssistantJsonContent(rawContent);
  const direct = tryParseJson(stripped);
  if (direct != null) return direct;
  const bracket = stripped.match(/\[[\s\S]*?\]/);
  if (bracket) {
    return tryParseJson(bracket[0]);
  }
  return null;
}

type DeepSeekBatchParseFailReason = 'invalid_json' | 'coerce_null' | 'length_mismatch';

/**
 * 模型偶发返回对象包裹数组或 JSON 字符串；规范为数组供 normalize 使用。
 * `coerced` 为真表示顶层曾为非数组形态（用于观测性 warn）。
 */
function coerceDeepSeekBatchJsonToArray(
  parsed: unknown,
  depth = 0
): { arr: unknown[] | null; coerced: boolean } {
  if (Array.isArray(parsed)) {
    return { arr: parsed, coerced: depth > 0 };
  }
  if (depth >= COERCE_DEEPSEEK_BATCH_JSON_MAX_DEPTH) {
    return { arr: null, coerced: false };
  }
  if (typeof parsed === 'string') {
    const s = stripAssistantJsonContent(parsed);
    if (
      (s.startsWith('[') && s.endsWith(']')) ||
      (s.startsWith('{') && s.endsWith('}'))
    ) {
      const inner = tryParseJson(s);
      if (inner != null) {
        const r = coerceDeepSeekBatchJsonToArray(inner, depth + 1);
        return { arr: r.arr, coerced: r.coerced || r.arr != null };
      }
      const bracket = s.match(/\[[\s\S]*?\]/);
      if (bracket) {
        const fromBracket = tryParseJson(bracket[0]);
        if (fromBracket != null) {
          const r = coerceDeepSeekBatchJsonToArray(fromBracket, depth + 1);
          return { arr: r.arr, coerced: r.coerced || r.arr != null };
        }
      }
    }
    return { arr: null, coerced: false };
  }
  if (parsed != null && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    for (const k of DEEPSEEK_BATCH_ARRAY_KEYS) {
      const x = o[k];
      if (Array.isArray(x)) {
        return { arr: x, coerced: true };
      }
    }
    const keys = Object.keys(o);
    if (keys.length === 1) {
      const only = o[keys[0]!];
      if (Array.isArray(only)) {
        return { arr: only, coerced: true };
      }
      if (only != null && typeof only === 'object') {
        const nested = coerceDeepSeekBatchJsonToArray(only, depth + 1);
        if (nested.arr) {
          return { arr: nested.arr, coerced: true };
        }
      }
    }
    const numericKeys = keys.filter((k) => /^\d+$/.test(k));
    if (numericKeys.length > 0 && numericKeys.length === keys.length) {
      numericKeys.sort((a, b) => Number(a) - Number(b));
      return {
        arr: numericKeys.map((k) => o[k]),
        coerced: true,
      };
    }
    for (const v of Object.values(o)) {
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        const nested = coerceDeepSeekBatchJsonToArray(v, depth + 1);
        if (nested.arr) {
          return { arr: nested.arr, coerced: true };
        }
      }
    }
  }
  return { arr: null, coerced: false };
}

function parseDeepSeekBatchAssistantContent(
  rawContent: string,
  expectedLen: number
):
  | { ok: true; strings: string[]; coerced: boolean }
  | {
      ok: false;
      reason: DeepSeekBatchParseFailReason;
      lastError: string;
      got?: number;
    } {
  const rawParsed = parseAssistantContentToJson(rawContent);
  if (rawParsed == null) {
    return {
      ok: false,
      reason: 'invalid_json',
      lastError: `DeepSeek batch translate: invalid JSON (expected array of ${expectedLen} strings)`,
    };
  }
  const { arr, coerced } = coerceDeepSeekBatchJsonToArray(rawParsed);
  if (!arr) {
    return {
      ok: false,
      reason: 'coerce_null',
      lastError: `DeepSeek batch translate: response is not a JSON array (expected ${expectedLen} strings)`,
    };
  }
  const normalized = normalizeDeepSeekBatchArrayOutput(arr, expectedLen);
  if (!normalized) {
    return {
      ok: false,
      reason: 'length_mismatch',
      got: arr.length,
      lastError: `DeepSeek batch translate: expected ${expectedLen} strings, got ${arr.length}`,
    };
  }
  return { ok: true, strings: normalized, coerced };
}

function logDeepSeekBatchParseFailed(
  logBase: Record<string, unknown>,
  params: {
    attempt: number;
    reason: DeepSeekBatchParseFailReason;
    lastError: string;
    rawContent: string;
    finishReason?: string;
    got?: number;
  }
): void {
  console.warn(
    '[ocr/deepseek_parse_batch] parse_failed',
    JSON.stringify({
      ...logBase,
      attempt: params.attempt,
      parse_reason: params.reason,
      finish_reason: params.finishReason ?? null,
      raw_len: params.rawContent.length,
      raw_prefix: params.rawContent.slice(0, 400),
      got: params.got ?? null,
      last_error: params.lastError,
    })
  );
}

function isRetryableDeepSeekStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function resolveParseTranslateTemperature(): number {
  const raw = Number(process.env.OCR_PARSE_TRANSLATE_TEMPERATURE);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 2) return raw;
  return 1.3;
}

function resolveParseTranslateConcurrencyMax(): number {
  /** 与 DeepSeek Rate Limit（429 动态限流）配合：上限可配，避免误设过大占满 Worker */
  const raw = Number(process.env.OCR_PARSE_TRANSLATE_CONCURRENCY_MAX || '32') || 32;
  const n = Math.trunc(raw);
  if (!Number.isFinite(n) || n < 1) return 32;
  return Math.min(64, Math.max(1, n));
}

function resolveParseTranslateConcurrency(): number {
  /** 默认 24：更小单批 + 略高并行，缩短 translate_parse_result 墙钟；遇 429 走现有退避 */
  const max = resolveParseTranslateConcurrencyMax();
  const raw = Number(process.env.OCR_PARSE_TRANSLATE_CONCURRENCY || '24') || 24;
  return Math.min(max, Math.max(1, Math.trunc(raw)));
}

const MAX_TOKENS_HARD_CAP = 8000;
const MAX_TOKENS_FLOOR = 1024;

/**
 * 按 batch 字符量给输出 max_tokens 一个动态上界，避免「跑飞」吃 384K 默认预算。
 * 中文输出比原文 chars 略多 token，4× chars + 256 头比较稳；硬顶 8000。
 * `OCR_PARSE_TRANSLATE_MAX_TOKENS_BUDGET` 可手动覆盖（env 优先，仍受硬顶 clamp）。
 */
function resolveBatchMaxTokens(sliceChars: number): number {
  const envOverride = Number(process.env.OCR_PARSE_TRANSLATE_MAX_TOKENS_BUDGET);
  if (Number.isFinite(envOverride) && envOverride > 0) {
    return Math.min(MAX_TOKENS_HARD_CAP, Math.max(256, Math.trunc(envOverride)));
  }
  const dynamic = Math.round(sliceChars * 4) + 256;
  return Math.min(MAX_TOKENS_HARD_CAP, Math.max(MAX_TOKENS_FLOOR, dynamic));
}

/**
 * 将字符串列表按批送给 DeepSeek，顺序与长度必须一致（用于版面 JSON 字段翻译）。
 *
 * 设计要点（DeepSeek V4 Production Playbook）：
 * - V4 默认开启 Thinking，本函数显式 `extra_body.thinking.type = "disabled"` 关掉，避免每批跑思考链；
 *   `reasoning_effort` 在 thinking-disabled 模式下被忽略，因此不再传以免误导。
 * - `system` 放固定指令（缓存友好），`user` 仅放该批 JSON 数组，提升 Context Cache 命中。
 * - 批次按 `OCR_PARSE_TRANSLATE_CONCURRENCY` 并行发送（默认 24，clamp [1, OCR_PARSE_TRANSLATE_CONCURRENCY_MAX]，默认 max=32）。
 * - 429/5xx/timeout 才进退避：`min(8000, 600 * 2^(attempt-1)) + random(0..600)` ms。
 */
export async function translateStringListWithDeepSeek(params: {
  parts: string[];
  sourceLang: string;
  targetLang: string;
  /** 传入后在 consumer 日志中输出每批进度，便于排查 translate_parse_result 长时间无输出 */
  logContext?: { taskId?: string };
}): Promise<string[]> {
  const { parts, sourceLang, targetLang, logContext } = params;
  if (parts.length === 0) return [];
  const cfg = await getAllConfigs();
  const apiKey = String(
    cfg.deepseek_api_key || process.env.DEEPSEEK_API_KEY || ''
  ).trim();
  if (!apiKey) {
    throw new Error('DeepSeek API key missing');
  }
  const model = resolveOcrDeepSeekModel();
  const temperature = resolveParseTranslateTemperature();
  const concurrencyMax = resolveParseTranslateConcurrencyMax();
  const concurrency = resolveParseTranslateConcurrency();
  const maxChunkItems = Math.max(
    4,
    Number(process.env.OCR_PARSE_TRANSLATE_CHUNK_ITEMS || '8') || 8
  );
  const maxChunkChars = Math.max(
    1000,
    Number(process.env.OCR_PARSE_TRANSLATE_CHUNK_CHARS || '2000') || 2000
  );
  const fetchTimeoutMs = Math.max(
    30_000,
    Number(process.env.OCR_PARSE_TRANSLATE_FETCH_TIMEOUT_MS || '90000') || 90_000
  );
  const RETRY_MAX = Math.max(
    1,
    Number(process.env.OCR_PARSE_TRANSLATE_RETRY_MAX || '3') || 3
  );

  const plans = planDeepSeekParseBatches(parts, maxChunkItems, maxChunkChars);
  const totalBatches = plans.length;
  const out: string[] = new Array(parts.length);

  const taskIdField = logContext?.taskId ? { task_id: logContext.taskId } : {};

  // 同一任务内 system 完全一致 → DeepSeek prompt cache 跨批命中（首批 miss，第二批起命中）。
  // 不要在这里嵌入随 batch 变化的字段（如 slice.length），否则前缀被破坏 → 全部 cache miss。
  // sourceLang 在同一任务内是固定的（非空或全空），不会破坏 cache 稳定性。
  const fromClause = sourceLang ? `from ${sourceLang} ` : '';
  const systemPrompt = [
    `Translate each string in the JSON array sent by the user ${fromClause}to ${targetLang}.`,
    'Preserve markdown/HTML/LaTeX tags, numbers, URLs, and code. Do not add explanations.',
    "Return ONLY a JSON array of strings whose length equals the input array's length, in the same order.",
  ].join('\n');

  const runOneBatch = async (plan: DeepSeekBatchPlan): Promise<void> => {
    const batchMaxTokens = resolveBatchMaxTokens(plan.chars);
    const logBase = {
      ...taskIdField,
      batch: plan.index,
      batches_total: totalBatches,
      slice_items: plan.slice.length,
      slice_chars: plan.chars,
      parts_total: parts.length,
      concurrency,
      concurrency_max: concurrencyMax,
      thinking_disabled: true,
      cache_stable_system: true,
      chunk_items_max: maxChunkItems,
      chunk_chars_max: maxChunkChars,
      fetch_timeout_ms: fetchTimeoutMs,
      max_tokens: batchMaxTokens,
    };
    console.log('[ocr/deepseek_parse_batch] start', JSON.stringify(logBase));
    const batchStarted = Date.now();

    const userPayload = JSON.stringify(plan.slice);

    let parsedArr: unknown = null;
    let lastError = '';
    let usageInfo: Record<string, unknown> | null = null;
    /** 仅最后一次「成功收到 HTTP 响应」的解析结果；fetch 抛错时不更新，避免误把更早的 200 空响应当作最终态 */
    let lastAttemptHttp:
      | {
          received: true;
          ok: boolean;
          rawContentEmpty: boolean;
          explicitApiError: boolean;
          finishReason?: string;
        }
      | { received: false } = { received: false };

    for (let attempt = 1; attempt <= RETRY_MAX; attempt += 1) {
      let res: Response;
      try {
        res = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: batchMaxTokens,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPayload },
            ],
            extra_body: { thinking: { type: 'disabled' } },
          }),
          signal: AbortSignal.timeout(fetchTimeoutMs),
        });
      } catch (e) {
        lastAttemptHttp = { received: false };
        const name = e instanceof Error ? e.name : '';
        const msg = e instanceof Error ? e.message : String(e);
        const isTimeout =
          name === 'TimeoutError' || msg.toLowerCase().includes('abort');
        lastError = isTimeout
          ? `DeepSeek fetch timeout after ${fetchTimeoutMs}ms (batch ${plan.index}/${totalBatches})`
          : `DeepSeek fetch failed: ${msg}`;
        if (attempt < RETRY_MAX) {
          const base = 600;
          const expo = Math.min(8000, base * 2 ** (attempt - 1));
          await sleep(expo + Math.floor(Math.random() * base));
        }
        continue;
      }

      const json = (await res.json().catch(() => ({}))) as {
        choices?: Array<{
          message?: { content?: string };
          finish_reason?: string;
        }>;
        usage?: Record<string, unknown>;
        error?: { message?: string };
        message?: string;
      };
      if (json.usage) usageInfo = json.usage;

      const choice0 = json.choices?.[0];
      const rawForSnapshot = String(choice0?.message?.content ?? '').trim();
      lastAttemptHttp = {
        received: true,
        ok: res.ok,
        rawContentEmpty: res.ok ? !rawForSnapshot : false,
        explicitApiError: Boolean(String(json.error?.message ?? '').trim()),
        finishReason:
          res.ok && choice0 && typeof choice0.finish_reason === 'string'
            ? choice0.finish_reason
            : undefined,
      };

      if (!res.ok) {
        lastError =
          json.error?.message ||
          json.message ||
          `DeepSeek batch translate failed (${res.status})`;
        if (isRetryableDeepSeekStatus(res.status) && attempt < RETRY_MAX) {
          const base = 600;
          const expo = Math.min(8000, base * 2 ** (attempt - 1));
          await sleep(expo + Math.floor(Math.random() * base));
          continue;
        }
        if (!isRetryableDeepSeekStatus(res.status)) break;
        continue;
      }

      const rawContent = json.choices?.[0]?.message?.content?.trim();
      if (!rawContent) {
        lastError =
          json.error?.message ||
          json.message ||
          `DeepSeek batch translate: empty content (${res.status})`;
      } else {
        const parsed = parseDeepSeekBatchAssistantContent(
          rawContent,
          plan.slice.length
        );
        if (parsed.ok) {
          if (parsed.coerced) {
            console.warn(
              '[ocr/deepseek_parse_batch] output_coerced_to_array',
              JSON.stringify({ ...logBase, coerce: true, attempt })
            );
          }
          parsedArr = parsed.strings;
          break;
        }
        lastError = parsed.lastError;
        logDeepSeekBatchParseFailed(logBase, {
          attempt,
          reason: parsed.reason,
          lastError: parsed.lastError,
          rawContent,
          finishReason:
            lastAttemptHttp.received === true
              ? lastAttemptHttp.finishReason
              : undefined,
          got: parsed.got,
        });
        parsedArr = null;
      }
      if (attempt < RETRY_MAX) {
        const base = 600;
        const expo = Math.min(8000, base * 2 ** (attempt - 1));
        await sleep(expo + Math.floor(Math.random() * base));
      }
    }

    if (Array.isArray(parsedArr) && parsedArr.length === plan.slice.length) {
      const filled = parsedArr as string[];
      for (let i = 0; i < plan.slice.length; i++) {
        out[plan.start + i] = filled[i];
      }

      console.log(
        '[ocr/deepseek_parse_batch] done',
        JSON.stringify({
          ...logBase,
          elapsed_ms: Date.now() - batchStarted,
          ...(usageInfo
            ? {
                prompt_tokens: usageInfo.prompt_tokens ?? null,
                completion_tokens: usageInfo.completion_tokens ?? null,
                prompt_cache_hit_tokens:
                  usageInfo.prompt_cache_hit_tokens ?? null,
                prompt_cache_miss_tokens:
                  usageInfo.prompt_cache_miss_tokens ?? null,
              }
            : {}),
        })
      );
      return;
    }

    const canPassthroughEmptyContent =
      lastAttemptHttp.received === true &&
      lastAttemptHttp.ok === true &&
      lastAttemptHttp.rawContentEmpty === true &&
      lastAttemptHttp.explicitApiError === false;

    if (canPassthroughEmptyContent) {
      const fr =
        lastAttemptHttp.received === true ? lastAttemptHttp.finishReason ?? null : null;
      for (let i = 0; i < plan.slice.length; i++) {
        out[plan.start + i] = plan.slice[i] ?? '';
      }
      console.warn(
        '[ocr/deepseek_parse_batch] degraded_passthrough',
        JSON.stringify({
          ...logBase,
          reason: 'empty_content',
          finish_reason: fr,
          last_error: lastError || null,
          elapsed_ms: Date.now() - batchStarted,
        })
      );
      return;
    }

    throw new Error(lastError || 'DeepSeek batch translate failed');
  };

  const wavesEstimate = Math.ceil(
    totalBatches / Math.min(concurrency, Math.max(1, totalBatches))
  );
  console.log(
    '[ocr/deepseek_parse_batches] plan',
    JSON.stringify({
      ...taskIdField,
      parts_total: parts.length,
      batches_total: totalBatches,
      waves_estimate: wavesEstimate,
      concurrency,
      concurrency_max: concurrencyMax,
      chunk_items_max: maxChunkItems,
      chunk_chars_max: maxChunkChars,
      fetch_timeout_ms: fetchTimeoutMs,
      thinking_disabled: true,
      cache_stable_system: true,
      temperature,
      model,
    })
  );
  /** CF Queue consumer 单次 invocation 墙上限约 15min；批次数多时每波若接近 fetch 超时易触发 exceededCpu */
  if (wavesEstimate * fetchTimeoutMs > 10 * 60 * 1000) {
    console.warn(
      '[ocr/deepseek_parse_batches] wall_risk',
      JSON.stringify({
        ...taskIdField,
        batches_total: totalBatches,
        waves_estimate: wavesEstimate,
        concurrency,
        concurrency_max: concurrencyMax,
        fetch_timeout_ms: fetchTimeoutMs,
        pessimistic_serial_ms: wavesEstimate * fetchTimeoutMs,
        hint: 'raise_OCR_PARSE_TRANSLATE_CHUNK_*_or_concurrency;_or_split_stage',
      })
    );
  }

  let cursor = 0;
  let firstError: unknown = null;
  const next = async (): Promise<void> => {
    while (firstError == null) {
      const idx = cursor++;
      if (idx >= plans.length) return;
      try {
        await runOneBatch(plans[idx]);
      } catch (e) {
        if (firstError == null) firstError = e;
        return;
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, plans.length) },
    () => next()
  );
  await Promise.all(workers);
  if (firstError) {
    throw firstError instanceof Error
      ? firstError
      : new Error(String(firstError));
  }
  return out;
}

function wrapLineByWidth(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const out: string[] = [];
  const raw = text.replace(/\t/g, '  ');
  if (!raw.trim()) return [''];
  let current = '';
  for (const ch of raw) {
    const candidate = current + ch;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    current = ch;
  }
  if (current) out.push(current);
  return out;
}

/** Cloudflare Queues 内 PDF 渲染应传 `skipCjkFont: true`，避免 pdf-lib subset CJK 远超 Workers CPU 配额。 */
export type MarkdownToSimplePdfOptions = {
  skipCjkFont?: boolean;
};

export async function markdownToSimplePdfBytes(
  markdown: string,
  options?: MarkdownToSimplePdfOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let font = await doc.embedFont(StandardFonts.Helvetica);
  let useCjkFont = false;
  const skipCjk = options?.skipCjkFont === true;
  if (!skipCjk) {
    doc.registerFontkit(fontkit);
    const cjkBytes = await loadOcrPdfCjkFontBytesAsync();
    if (cjkBytes) {
      try {
        font = await doc.embedFont(cjkBytes, { subset: true });
        useCjkFont = true;
      } catch (e) {
        console.warn(
          '[ocr/pdf] cjk_font_embed_failed_fallback_helvetica',
          e instanceof Error ? e.message : String(e)
        );
      }
    }
  }
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  const fontSize = 11;
  const lineHeight = 15;
  const maxWidth = pageWidth - margin * 2;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const toSafeFontText = (text: string): string => {
    if (!text) return '';
    const normalized = text.replace(/\r/g, '').replace(/\t/g, '  ');
    if (useCjkFont) return normalized;
    let out = '';
    for (const ch of Array.from(normalized)) {
      if (ch === '\n') continue;
      try {
        font.widthOfTextAtSize(ch, fontSize);
        out += ch;
      } catch {
        out += ch.trim() ? '?' : ' ';
      }
    }
    return out;
  };

  const drawLine = (line: string) => {
    if (y < margin + lineHeight) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth,
    });
    y -= lineHeight;
  };

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    const safeLine = toSafeFontText(line);
    const wrapped = wrapLineByWidth(safeLine, maxWidth, (s) =>
      font.widthOfTextAtSize(s, fontSize)
    );
    for (const w of wrapped) {
      drawLine(w);
    }
  }

  const bytes = await doc.save();
  return bytes;
}

export async function runOcrAndPersistParse(params: {
  sourcePdfObjectKey: string;
  sourceFilename: string;
  outputParseResultObjectKey: string;
  outputMarkdownObjectKey: string;
}): Promise<{ markdown: string }> {
  const auth = await resolveBaiduAuth();
  const sourcePdfUrl = await createPresignedGet(params.sourcePdfObjectKey, 3600);
  console.log(
    '[ocr/stage] start',
    JSON.stringify({ stage: 'ocr_submit_poll' })
  );
  const baiduTaskId = await submitBaiduOcrTask({
    auth,
    fileUrl: sourcePdfUrl,
    fileName: params.sourceFilename || 'document.pdf',
  });

  let latestResult: unknown = null;
  let done = false;
  for (let i = 0; i < 180; i += 1) {
    const q = await queryBaiduOcrTask({ auth, taskId: baiduTaskId });
    if (q.status === 'failed') {
      throw new Error(q.errorMessage || 'Baidu OCR failed');
    }
    if (q.status === 'success') {
      latestResult = q.result;
      done = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (!done) throw new Error('Baidu OCR timeout');

  const { markdown, parseJson } = await resolveOcrMarkdownAndStoragePayload(latestResult);
  if (!markdown.trim()) throw new Error('OCR produced empty text');

  await putObject(
    params.outputParseResultObjectKey,
    new TextEncoder().encode(JSON.stringify(parseJson)),
    'application/json; charset=utf-8'
  );
  await putObject(
    params.outputMarkdownObjectKey,
    new TextEncoder().encode(markdown),
    'text/markdown; charset=utf-8'
  );
  console.log(
    '[ocr/stage] done',
    JSON.stringify({
      stage: 'ocr_submit_poll',
      markdown_chars: markdown.length,
    })
  );
  return { markdown };
}

export async function loadMarkdownFromR2(markdownObjectKey: string): Promise<string> {
  const bytes = await getObjectBody(markdownObjectKey);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function exportMarkdownToPdfAndMd(params: {
  markdown: string;
  outputPdfObjectKey: string;
  outputMdObjectKey: string;
}): Promise<{
  pdfTruncated: boolean;
  markdownChars: number;
  pdfRenderChars: number;
  markdownBytes: number;
  pdfBytes: number;
}> {
  const startedAt = Date.now();
  const mdBytes = new TextEncoder().encode(params.markdown);
  const pdfMarkdown =
    params.markdown.length > OCR_PDF_RENDER_MAX_CHARS
      ? `${params.markdown.slice(0, OCR_PDF_RENDER_MAX_CHARS)}\n\n---\n\n[OCR PDF export truncated for rendering limit; full text is in markdown output.]`
      : params.markdown;
  console.log(
    '[ocr/export] begin',
    JSON.stringify({
      markdown_chars: params.markdown.length,
      pdf_render_chars: pdfMarkdown.length,
      timeout_ms: OCR_EXPORT_STAGE_TIMEOUT_MS,
      upload_retry_max: OCR_EXPORT_UPLOAD_RETRY_MAX,
    })
  );
  const pdfBytes = await withStageTimeout(
    'render_pdf_bytes',
    () => markdownToSimplePdfBytes(pdfMarkdown),
    OCR_EXPORT_STAGE_TIMEOUT_MS
  );
  console.log(
    '[ocr/export] rendered',
    JSON.stringify({
      elapsed_ms: Date.now() - startedAt,
      pdf_bytes: pdfBytes.byteLength,
    })
  );
  await putObjectWithRetry({
    key: params.outputPdfObjectKey,
    body: pdfBytes,
    contentType: 'application/pdf',
    stage: 'upload_pdf',
  });
  await putObjectWithRetry({
    key: params.outputMdObjectKey,
    body: mdBytes,
    contentType: 'text/markdown; charset=utf-8',
    stage: 'upload_markdown',
  });
  return {
    pdfTruncated: params.markdown.length > OCR_PDF_RENDER_MAX_CHARS,
    markdownChars: params.markdown.length,
    pdfRenderChars: pdfMarkdown.length,
    markdownBytes: mdBytes.byteLength,
    pdfBytes: pdfBytes.byteLength,
  };
}

export async function runOcrTranslatePipeline(params: {
  sourcePdfObjectKey: string;
  sourceFilename: string;
  sourceLang: string;
  targetLang: string;
  outputPdfObjectKey: string;
  outputMdObjectKey: string;
  /** R2 键，如 translations/{taskId}/ocr-parse-result.json */
  outputParseResultObjectKey: string;
}): Promise<{
  markdown: string;
  translatedMarkdown: string;
}> {
  const startedAt = Date.now();
  const markdownObjectKey = `${params.outputParseResultObjectKey}.md`;
  const { markdown } = await runOcrAndPersistParse({
    sourcePdfObjectKey: params.sourcePdfObjectKey,
    sourceFilename: params.sourceFilename,
    outputParseResultObjectKey: params.outputParseResultObjectKey,
    outputMarkdownObjectKey: markdownObjectKey,
  });
  const translatedMarkdown = await translateMarkdownWithDeepSeek({
    markdown,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
  });
  console.log(
    '[ocr/pipeline] deepseek_translate_completed',
    JSON.stringify({ chars: translatedMarkdown.length })
  );
  const exportRes = await exportMarkdownToPdfAndMd({
    markdown: translatedMarkdown,
    outputPdfObjectKey: params.outputPdfObjectKey,
    outputMdObjectKey: params.outputMdObjectKey,
  });
  console.log(
    '[ocr/pipeline] export_completed',
    JSON.stringify({
      elapsed_ms: Date.now() - startedAt,
      pdf_render_chars: exportRes.pdfRenderChars,
      markdown_chars: exportRes.markdownChars,
      pdf_truncated: exportRes.pdfTruncated,
    })
  );
  return {
    markdown,
    translatedMarkdown,
  };
}
