/**
 * 将 ParseResult JSON 内外链 / data URL 图片拉取并写入 R2，再把字段替换为可访问的 R2 URL（对齐 onlinepdftranslator image-proxy）。
 */
import {
  createPresignedGet,
  encodeR2KeyForPublicUrl,
  getR2PublicBaseUrl,
  putObject,
  r2ObjectExists,
} from '@/shared/lib/translate-r2';

import { runPool } from '@/shared/lib/async-pool';

const BAIDU_HOST_RE = /baidubce\.com|bcebos\.com|bdstatic\.com/i;
const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

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

/**
 * 将百度外链 / data URL 图片写入 `translations/{taskId}/assets/`，并原地替换 JSON 中的字符串。
 */
export async function rewriteExternalImagesToR2(params: {
  json: Record<string, unknown>;
  taskId: string;
  maxConcurrent?: number;
}): Promise<{ replaced: number; failed: number }> {
  const urls = new Set<string>();
  const dataUrls = new Set<string>();
  collectUrls(params.json, urls);
  collectDataUrls(params.json, dataUrls);
  const map = new Map<string, string>();
  let failed = 0;
  const list = [...urls];
  const dataList = [...dataUrls];
  const prefix = `translations/${params.taskId}/assets`;

  await runPool(list, params.maxConcurrent ?? 5, async (url) => {
    try {
      const hash = await shortHash(url);
      const ext =
        url.includes('.png')
          ? 'png'
          : url.includes('.jpg') || url.includes('.jpeg')
            ? 'jpg'
            : url.includes('.webp')
              ? 'webp'
              : url.includes('.gif')
                ? 'gif'
                : 'bin';
      const key = `${prefix}/${hash}.${ext}`;
      const exists = await r2ObjectExists(key);
      if (!exists) {
        const res = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) {
          failed++;
          return;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        const hdrCt = res.headers.get('content-type')?.split(';')[0].trim();
        const ct =
          hdrCt ||
          (ext === 'png'
            ? 'image/png'
            : ext === 'jpg'
              ? 'image/jpeg'
              : 'application/octet-stream');
        await putObject(key, buf, ct);
      }
      map.set(url, await publicUrlForAssetKey(key));
    } catch {
      failed++;
    }
  });

  await runPool(dataList, params.maxConcurrent ?? 5, async (dataUrl) => {
    try {
      const m = dataUrl.match(DATA_URL_RE);
      if (!m) {
        failed++;
        return;
      }
      const mime = m[1].toLowerCase();
      const ext = mime.includes('png')
        ? 'png'
        : mime.includes('jpeg') || mime.includes('jpg')
          ? 'jpg'
          : mime.includes('webp')
            ? 'webp'
            : mime.includes('gif')
              ? 'gif'
              : 'bin';
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
  return { replaced: map.size, failed };
}
