/**
 * 将各类图片 URL 规范为可嵌入导出 HTML/打印的 data URL（含缓存）。
 */

export type ResolveImageOptions = {
  /** 服务端拉 /api/proxy 时必须带站点根，例如 https://app.example.com */
  appOrigin?: string;
  /** 同源代理鉴权：导出 PDF 等服务端请求时传入原始请求的 Cookie */
  forwardCookie?: string;
};

function proxyFileUrl(remoteUrl: string, appOrigin?: string): string {
  const path = `/api/proxy/file?url=${encodeURIComponent(remoteUrl)}`;
  if (!appOrigin?.trim()) return path;
  return `${appOrigin.replace(/\/$/, '')}${path}`;
}

/** 服务端/导出：将 `/api/...` 补成可 fetch 的绝对地址 */
function toAbsoluteImageFetchUrl(
  url: string,
  options?: ResolveImageOptions
): string {
  const u = url.trim();
  if (!u || u.startsWith('data:') || u.startsWith('blob:')) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/') && options?.appOrigin?.trim()) {
    return `${options.appOrigin.replace(/\/$/, '')}${u}`;
  }
  return u;
}

export async function resolveImageDataUrl(
  url: string,
  cache: Map<string, string>,
  options?: ResolveImageOptions
): Promise<string> {
  if (!url) return '';
  const abs = toAbsoluteImageFetchUrl(url, options);
  if (abs.startsWith('data:')) return abs;
  if (cache.has(abs)) return cache.get(abs)!;

  let out = '';
  if (abs.startsWith('blob:')) {
    out = await fetchAsDataUrl(abs);
  } else {
    const useProxyFirst = shouldUseProxyFirst(abs);
    if (useProxyFirst) {
      const proxy = proxyFileUrl(abs, options?.appOrigin);
      out = await fetchAsDataUrl(proxy, false, options?.forwardCookie);
      if (!out) out = await fetchAsDataUrl(abs, true, options?.forwardCookie);
    } else {
      out = await fetchAsDataUrl(abs, true, options?.forwardCookie);
      if (!out) {
        const proxy = proxyFileUrl(abs, options?.appOrigin);
        out = await fetchAsDataUrl(proxy, false, options?.forwardCookie);
      }
    }
  }

  if (!out) {
    cache.set(abs, '');
    return '';
  }

  cache.set(abs, out);
  return out;
}

async function fetchAsDataUrl(
  input: string,
  cors = false,
  forwardCookie?: string
): Promise<string> {
  try {
    const r = await fetch(input, {
      ...(cors ? { mode: 'cors' as const } : {}),
      ...(forwardCookie
        ? { headers: { cookie: forwardCookie } }
        : {}),
    });
    if (!r.ok) {
      try {
        await r.body?.cancel();
      } catch {
        /* ignore */
      }
      return '';
    }
    const blob = await r.blob();
    const knownImageType =
      blob.type && blob.type.toLowerCase().startsWith('image/')
        ? blob.type.toLowerCase()
        : '';
    if (knownImageType) {
      if (typeof FileReader !== 'undefined') {
        return await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = () => reject(new Error('read'));
          fr.readAsDataURL(blob);
        });
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return `data:${knownImageType};base64,${bytesToBase64(bytes)}`;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sniffed = detectImageMime(bytes);
    if (!sniffed) return '';
    return `data:${sniffed};base64,${bytesToBase64(bytes)}`;
  } catch {
    return '';
  }
}

function detectImageMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return '';
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

function shouldUseProxyFirst(url: string): boolean {
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    if (typeof window === 'undefined') return true;
    return u.origin !== window.location.origin;
  } catch {
    return true;
  }
}

export type ImageRunBytes = { data: Uint8Array; type: 'png' | 'jpg' };

export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/i);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } catch {
    return null;
  }
}

export function extFromDataUrl(dataUrl: string): string {
  const m = dataUrl.match(/^data:([^;]+);base64,/i);
  const mime = m?.[1]?.toLowerCase() ?? '';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'bin';
}

/** 将 data URL 转为 docx ImageRun 可用的 png/jpeg 字节（含 webp 转 png） */
export async function dataUrlToImageRunBytes(
  dataUrl: string
): Promise<ImageRunBytes | null> {
  if (!dataUrl.startsWith('data:')) return null;
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const b64 = m[2];

  if (
    mime === 'image/png' ||
    mime === 'image/x-png' ||
    mime === 'image/jpeg' ||
    mime === 'image/jpg'
  ) {
    try {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return { data: u, type: mime.includes('png') ? 'png' : 'jpg' };
    } catch {
      return null;
    }
  }

  if (mime === 'image/webp' && typeof document !== 'undefined') {
    return webpDataUrlToPngBytes(dataUrl);
  }

  return null;
}

function webpDataUrlToPngBytes(
  dataUrl: string
): Promise<ImageRunBytes | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const png = c.toDataURL('image/png');
        const pm = png.match(/^data:[^;]+;base64,(.+)$/);
        if (!pm) {
          resolve(null);
          return;
        }
        const bin = atob(pm[1]);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        resolve({ data: u, type: 'png' });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
