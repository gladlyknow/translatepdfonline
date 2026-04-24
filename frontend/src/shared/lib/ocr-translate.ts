import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getAllConfigs } from '@/shared/models/config';
import { createPresignedGet, putObject } from '@/shared/lib/translate-r2';
import { tryLoadOcrPdfCjkFontBytes } from '@/shared/lib/ocr-export-pdf-font-bytes';

const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_TASK_URL =
  'https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task';
const BAIDU_QUERY_URL =
  'https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task/query';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

type BaiduAuth = {
  accessToken?: string;
  authorizationHeader?: string;
};

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

async function resolveOcrMarkdown(payload: unknown): Promise<string> {
  const parseResultUrl = extractParseResultUrl(payload);
  if (parseResultUrl) {
    const res = await fetch(parseResultUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch OCR parse_result_url (${res.status})`);
    }
    const json = (await res.json()) as unknown;
    const md = buildMarkdownFromOcrPayload(json);
    if (md) return md;
  }
  return buildMarkdownFromOcrPayload(payload);
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
      model: 'deepseek-chat',
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

export async function markdownToSimplePdfBytes(markdown: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let font = await doc.embedFont(StandardFonts.Helvetica);
  let useCjkFont = false;
  const cjkBytes = tryLoadOcrPdfCjkFontBytes();
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

export async function runOcrTranslatePipeline(params: {
  sourcePdfObjectKey: string;
  sourceFilename: string;
  sourceLang: string;
  targetLang: string;
  outputPdfObjectKey: string;
  outputMdObjectKey: string;
}): Promise<{
  markdown: string;
  translatedMarkdown: string;
}> {
  const startedAt = Date.now();
  const auth = await resolveBaiduAuth();
  const sourcePdfUrl = await createPresignedGet(params.sourcePdfObjectKey, 3600);
  console.log(
    '[ocr/pipeline] baidu_submit_started',
    JSON.stringify({ source_key: params.sourcePdfObjectKey, file_name: params.sourceFilename })
  );
  const baiduTaskId = await submitBaiduOcrTask({
    auth,
    fileUrl: sourcePdfUrl,
    fileName: params.sourceFilename || 'document.pdf',
  });

  let latestResult: unknown = null;
  let done = false;
  const pollStartedAt = Date.now();
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
  if (!done) {
    throw new Error('Baidu OCR timeout');
  }
  console.log(
    '[ocr/pipeline] baidu_poll_completed',
    JSON.stringify({ baidu_task_id: baiduTaskId, elapsed_ms: Date.now() - pollStartedAt })
  );

  const markdown = await resolveOcrMarkdown(latestResult);
  if (!markdown.trim()) {
    throw new Error('OCR produced empty text');
  }
  const translatedMarkdown = await translateMarkdownWithDeepSeek({
    markdown,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
  });
  console.log(
    '[ocr/pipeline] deepseek_translate_completed',
    JSON.stringify({ chars: translatedMarkdown.length })
  );
  const pdfBytes = await markdownToSimplePdfBytes(translatedMarkdown);
  const mdBytes = new TextEncoder().encode(translatedMarkdown);
  await putObject(params.outputPdfObjectKey, pdfBytes, 'application/pdf');
  await putObject(params.outputMdObjectKey, mdBytes, 'text/markdown; charset=utf-8');
  console.log(
    '[ocr/pipeline] export_completed',
    JSON.stringify({
      output_pdf: params.outputPdfObjectKey,
      output_md: params.outputMdObjectKey,
      elapsed_ms: Date.now() - startedAt,
    })
  );
  return {
    markdown,
    translatedMarkdown,
  };
}
