/**
 * 将 ParseResult JSON 内外链 / data URL 图片拉取并写入 R2，再把字段替换为可访问的 R2 URL（对齐 onlinepdftranslator image-proxy）。
 *
 * 单图下载：默认 5 路并发；每张图最多重试 `maxRetries`（默认 3）次，仅对网络错误 / 5xx /
 * 408 / 425 / 429 重试，401/403/404/410 按 fast-fail 直接计入 `failed`，避免百度签名过期场景下浪费阶段预算。
 */
import {
  createPresignedGet,
  encodeR2KeyForPublicUrl,
  getObjectBody,
  getR2PublicBaseUrl,
  putObject,
  r2ObjectExists,
} from '@/shared/lib/translate-r2';

import { runPool } from '@/shared/lib/async-pool';

const BAIDU_HOST_RE = /baidubce\.com|bcebos\.com|bdstatic\.com/i;
const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;
const INLINE_BAIDU_URL_RE =
  /https?:\/\/[^\s)\]"'<>]+(?:baidubce\.com|bcebos\.com|bdstatic\.com)[^\s)\]"'<>]*/gi;

const FAST_FAIL_STATUSES = new Set([401, 403, 404, 410]);
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function clampInt(
  v: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Math.floor(Number(v ?? fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function safeUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid)';
  }
}

function backoffMs(attempt: number): number {
  return Math.min(4000, 300 * 2 ** attempt) + Math.random() * 200;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function collectUrls(obj: unknown, out: Set<string>): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    if (
      obj.startsWith('http') &&
      (BAIDU_HOST_RE.test(obj) || obj.includes('baidu'))
    ) {
      out.add(obj);
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) collectUrls(x, out);
    return;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) collectUrls(v, out);
  }
}

/**
 * 收集字符串字段中**内嵌**的百度 URL（覆盖 markdown / HTML 形如 `<img src="...">`、`![](...)` 等）。
 * 与 `collectUrls` 共用一个 Set；后续替换通过 map 命中相同 URL。
 */
function collectInlineUrls(obj: unknown, out: Set<string>): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    const matches = obj.match(INLINE_BAIDU_URL_RE);
    if (matches) {
      for (const m of matches) out.add(m);
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) collectInlineUrls(x, out);
    return;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) collectInlineUrls(v, out);
  }
}

function collectDataUrls(obj: unknown, out: Set<string>): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    if (DATA_URL_RE.test(obj.trim())) out.add(obj.trim());
    return;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) collectDataUrls(x, out);
    return;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) collectDataUrls(v, out);
  }
}

async function shortHash(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function publicUrlForAssetKey(key: string): Promise<string> {
  const base = getR2PublicBaseUrl();
  if (base) {
    return `${base.replace(/\/$/, '')}/${encodeR2KeyForPublicUrl(key)}`;
  }
  return createPresignedGet(key, 7 * 24 * 3600);
}

/** 整字段精确替换（保留原 ParseResult 结构语义） */
function replaceStringsInPlace(o: unknown, map: Map<string, string>): void {
  if (o === null || o === undefined) return;
  if (typeof o === 'string') return;
  if (Array.isArray(o)) {
    for (const x of o) replaceStringsInPlace(x, map);
    return;
  }
  if (typeof o === 'object') {
    const rec = o as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'string' && map.has(v)) {
        rec[k] = map.get(v)!;
      } else {
        replaceStringsInPlace(v, map);
      }
    }
  }
}

/** 字符串字段内嵌的百度 URL 用 map 中映射的 R2 URL 替换；命中失败的 URL 保持原样 */
function replaceInlineUrlsInPlace(o: unknown, map: Map<string, string>): void {
  if (o === null || o === undefined) return;
  if (typeof o === 'string') return;
  if (Array.isArray(o)) {
    for (const x of o) replaceInlineUrlsInPlace(x, map);
    return;
  }
  if (typeof o === 'object') {
    const rec = o as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'string') {
        if (INLINE_BAIDU_URL_RE.test(v)) {
          INLINE_BAIDU_URL_RE.lastIndex = 0;
          rec[k] = v.replace(INLINE_BAIDU_URL_RE, (m) => map.get(m) ?? m);
        }
      } else {
        replaceInlineUrlsInPlace(v, map);
      }
    }
  }
}

type FetchImageOk = { ok: true; res: Response; attempts: number };
type FetchImageFail = {
  ok: false;
  lastStatus: number | null;
  attempts: number;
  reason: 'fast_fail_status' | 'non_retryable_status' | 'max_attempts';
};

/**
 * 单图下载（带重试）：1 次原始 + `maxRetries` 次重试。
 * - 重试条件：网络异常 / 408 / 425 / 429 / 5xx
 * - Fast-fail：401 / 403 / 404 / 410 直接返回失败（百度签名过期等确定性失败）
 * - 退避：`min(4000, 300*2^attempt) + jitter(0..200)` ms
 */
async function fetchImageWithRetry(
  url: string,
  opts: { maxRetries: number; perAttemptTimeoutMs: number }
): Promise<FetchImageOk | FetchImageFail> {
  const maxAttempts = Math.max(1, opts.maxRetries + 1);
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.perAttemptTimeoutMs),
      });
      if (res.ok) {
        return { ok: true, res, attempts: attempt };
      }
      lastStatus = res.status;
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      if (FAST_FAIL_STATUSES.has(res.status)) {
        console.warn(
          '[ocr/parse_image_mirror] give_up',
          JSON.stringify({
            url_host: safeUrlHost(url),
            attempts: attempt,
            last_status: res.status,
            reason: 'fast_fail_status',
          })
        );
        return {
          ok: false,
          lastStatus,
          attempts: attempt,
          reason: 'fast_fail_status',
        };
      }
      if (!RETRY_STATUSES.has(res.status) || attempt === maxAttempts) {
        const reason: FetchImageFail['reason'] =
          attempt === maxAttempts ? 'max_attempts' : 'non_retryable_status';
        console.warn(
          '[ocr/parse_image_mirror] give_up',
          JSON.stringify({
            url_host: safeUrlHost(url),
            attempts: attempt,
            last_status: res.status,
            reason,
          })
        );
        return { ok: false, lastStatus, attempts: attempt, reason };
      }
      const delay = backoffMs(attempt);
      console.warn(
        '[ocr/parse_image_mirror] retry',
        JSON.stringify({
          url_host: safeUrlHost(url),
          attempt,
          max_retries: opts.maxRetries,
          status: res.status,
          backoff_ms: Math.round(delay),
        })
      );
      await sleep(delay);
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'Error';
      if (attempt === maxAttempts) {
        console.warn(
          '[ocr/parse_image_mirror] give_up',
          JSON.stringify({
            url_host: safeUrlHost(url),
            attempts: attempt,
            last_status: lastStatus,
            error_name: errName,
            reason: 'max_attempts',
          })
        );
        return {
          ok: false,
          lastStatus,
          attempts: attempt,
          reason: 'max_attempts',
        };
      }
      const delay = backoffMs(attempt);
      console.warn(
        '[ocr/parse_image_mirror] retry',
        JSON.stringify({
          url_host: safeUrlHost(url),
          attempt,
          max_retries: opts.maxRetries,
          error_name: errName,
          backoff_ms: Math.round(delay),
        })
      );
      await sleep(delay);
    }
  }
  return {
    ok: false,
    lastStatus,
    attempts: maxAttempts,
    reason: 'max_attempts',
  };
}

function guessExtFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return 'png';
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'jpg';
  if (lower.includes('.webp')) return 'webp';
  if (lower.includes('.gif')) return 'gif';
  return 'bin';
}

function guessExtFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'bin';
}

function defaultContentType(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

export type RewriteImagesResult = {
  /** 命中并成功改写为 R2 URL 的源 URL 数（含 data URL） */
  replaced: number;
  /** 重试 3 次仍失败 / fast-fail / 解码异常的源 URL 数 */
  failed: number;
  /** 本次扫描到的所有去重后的源 URL 数（http URL ∪ inline ∪ data URL） */
  total: number;
};

/**
 * 将百度外链 / data URL 图片写入 `translations/{taskId}/assets/`，并原地替换 JSON 中的字符串。
 * 同时改写「字段值即 URL」与「字段值含内嵌 URL（markdown / HTML）」两类。
 */
export async function rewriteExternalImagesToR2(params: {
  json: Record<string, unknown>;
  taskId: string;
  /** 单图下载并发。默认 5；优先级：调用方 > env `OCR_IMAGE_MIRROR_CONCURRENCY` > 5 */
  maxConcurrent?: number;
  /** 单图下载最多重试次数（不含首次）。默认 3；优先级：调用方 > env `OCR_IMAGE_MIRROR_MAX_RETRIES` > 3 */
  maxRetries?: number;
  /** 单次 fetch 超时。默认 90s；优先级：调用方 > env `OCR_IMAGE_MIRROR_FETCH_TIMEOUT_MS` > 90000 */
  fetchTimeoutMs?: number;
}): Promise<RewriteImagesResult> {
  const urlsExact = new Set<string>();
  const urlsInline = new Set<string>();
  const dataUrls = new Set<string>();
  collectUrls(params.json, urlsExact);
  collectInlineUrls(params.json, urlsInline);
  collectDataUrls(params.json, dataUrls);
  const allUrls = new Set<string>([...urlsExact, ...urlsInline]);
  const list = [...allUrls];
  const dataList = [...dataUrls];
  const total = list.length + dataList.length;
  if (total === 0) {
    return { replaced: 0, failed: 0, total: 0 };
  }

  const concurrency = clampInt(
    params.maxConcurrent ?? envNumber('OCR_IMAGE_MIRROR_CONCURRENCY') ?? 5,
    1,
    16,
    5
  );
  const maxRetries = clampInt(
    params.maxRetries ?? envNumber('OCR_IMAGE_MIRROR_MAX_RETRIES') ?? 3,
    0,
    5,
    3
  );
  const perAttemptTimeoutMs = clampInt(
    params.fetchTimeoutMs ??
      envNumber('OCR_IMAGE_MIRROR_FETCH_TIMEOUT_MS') ??
      90_000,
    1_000,
    600_000,
    90_000
  );

  const map = new Map<string, string>();
  let failed = 0;
  const prefix = `translations/${params.taskId}/assets`;

  await runPool(list, concurrency, async (url) => {
    try {
      const hash = await shortHash(url);
      const ext = guessExtFromUrl(url);
      const key = `${prefix}/${hash}.${ext}`;
      const exists = await r2ObjectExists(key);
      if (!exists) {
        const result = await fetchImageWithRetry(url, {
          maxRetries,
          perAttemptTimeoutMs,
        });
        if (!result.ok) {
          failed++;
          return;
        }
        const buf = new Uint8Array(await result.res.arrayBuffer());
        const hdrCt = result.res.headers
          .get('content-type')
          ?.split(';')[0]
          .trim();
        const ct = hdrCt || defaultContentType(ext);
        await putObject(key, buf, ct);
      }
      map.set(url, await publicUrlForAssetKey(key));
    } catch (err) {
      failed++;
      console.warn(
        '[ocr/parse_image_mirror] error',
        JSON.stringify({
          url_host: safeUrlHost(url),
          error_name: err instanceof Error ? err.name : 'Error',
          error_message: (err instanceof Error ? err.message : String(err)).slice(
            0,
            300
          ),
        })
      );
    }
  });

  await runPool(dataList, concurrency, async (dataUrl) => {
    try {
      const m = dataUrl.match(DATA_URL_RE);
      if (!m) {
        failed++;
        return;
      }
      const mime = m[1].toLowerCase();
      const ext = guessExtFromMime(mime);
      const base64 = m[2].replace(/\s+/g, '');
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const hash = await shortHash(dataUrl);
      const key = `${prefix}/${hash}.${ext}`;
      const exists = await r2ObjectExists(key);
      if (!exists) {
        await putObject(key, bytes, mime);
      }
      const pub = await publicUrlForAssetKey(key);
      map.set(dataUrl, pub);
    } catch {
      failed++;
    }
  });

  replaceStringsInPlace(params.json, map);
  replaceInlineUrlsInPlace(params.json, map);
  return { replaced: map.size, failed, total };
}

export type MirrorBaiduImagesResult = RewriteImagesResult & {
  /** R2 上 parse JSON 是否被改写并写回（无可改写 URL 时为 false） */
  written: boolean;
};

/**
 * 读取 R2 中已写入的 ParseResult JSON，镜像其中的百度图片到 R2 并改写 URL，再写回同一 key。
 * 设计为独立 OCR 阶段使用：如果 `total === 0` 则跳过写回，避免无意义的 R2 PUT。
 */
export async function mirrorBaiduImagesIntoParseResult(params: {
  taskId: string;
  parseResultKey: string;
  maxConcurrent?: number;
  maxRetries?: number;
  fetchTimeoutMs?: number;
}): Promise<MirrorBaiduImagesResult> {
  const bytes = await getObjectBody(params.parseResultKey);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `mirror_baidu_images parse JSON failed: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
  const result = await rewriteExternalImagesToR2({
    json,
    taskId: params.taskId,
    maxConcurrent: params.maxConcurrent,
    maxRetries: params.maxRetries,
    fetchTimeoutMs: params.fetchTimeoutMs,
  });
  if (result.replaced === 0) {
    return { ...result, written: false };
  }
  await putObject(
    params.parseResultKey,
    new TextEncoder().encode(JSON.stringify(json)),
    'application/json; charset=utf-8'
  );
  return { ...result, written: true };
}
