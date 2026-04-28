import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getAllConfigs } from '@/shared/models/config';
import { createPresignedGet, getObjectBody, putObject } from '@/shared/lib/translate-r2';
import { loadOcrPdfCjkFontBytesAsync } from '@/shared/lib/ocr-export-pdf-font-bytes';

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
  const parseResultUrl = extractParseResultUrl(payload);
  if (parseResultUrl) {
    const res = await fetch(parseResultUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch OCR parse_result_url (${res.status})`);
    }
    const json = (await res.json()) as unknown;
    const mdFromJson = buildMarkdownFromOcrPayload(json);
    if (mdFromJson.trim()) {
      return { markdown: mdFromJson, parseJson: json };
    }
    return {
      markdown: buildMarkdownFromOcrPayload(payload),
      parseJson: json,
    };
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
  const prompt = [
    `Translate the following markdown from ${params.sourceLang} to ${params.targetLang}.`,
    'Keep markdown structure, formulas, URLs, and code blocks unchanged.',
    'Return translated markdown only.',
    '',
    params.markdown,
  ].join('\n');
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:
        String(process.env.OCR_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || '')
          .trim() || 'deepseek-chat',
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
    message?: string;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!res.ok || !content) {
    throw new Error(
      json.error?.message ||
        json.message ||
        `DeepSeek translate failed (${res.status})`
    );
  }
  return content;
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
