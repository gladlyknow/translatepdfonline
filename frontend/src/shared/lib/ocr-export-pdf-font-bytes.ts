import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 与 @fontsource/noto-sans-sc 中文件名一致；可放到 public/fonts/ 由 APP_URL 拉取 */
export const OCR_CJK_PUBLIC_FONT_FILE = 'noto-sans-sc-chinese-simplified-400-normal.woff';

const FONTSOURCE_CJK_WOFF_REL = join(
  'node_modules',
  '@fontsource',
  'noto-sans-sc',
  'files',
  OCR_CJK_PUBLIC_FONT_FILE
);

/** jsDelivr 与 package.json 中 @fontsource/noto-sans-sc 版本保持一致，供 Workers 无 node_modules 时 fetch */
const JSDELIVR_NOTO_SC_WOFF = `https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.9/files/${OCR_CJK_PUBLIC_FONT_FILE}`;

let cachedAsyncFont: Uint8Array | null | undefined;

function tryReadFontsourceFromNodeModules(): Uint8Array | null {
  if (typeof process === 'undefined' || typeof process.cwd !== 'function') {
    return null;
  }
  try {
    const abs = join(process.cwd(), FONTSOURCE_CJK_WOFF_REL);
    if (!existsSync(abs)) return null;
    return new Uint8Array(readFileSync(abs));
  } catch {
    return null;
  }
}

/**
 * OCR 导出的 pdf-lib 回退字体加载（同步，仅 Node 有 fs 时）：
 * - 优先读取 PDF_CJK_FONT_PATH（自定义路径）
 * - 其次读取常见系统字体
 * - 再读 node_modules/@fontsource/noto-sans-sc 内置 woff
 * - 最后读取仓库内 public/fonts/NotoSansSC-Regular.otf 或同名 woff（如存在）
 */
export function tryLoadOcrPdfCjkFontBytes(): Uint8Array | null {
  const fromEnv = process.env.PDF_CJK_FONT_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    try {
      return new Uint8Array(readFileSync(fromEnv));
    } catch {
      // ignore and continue fallback
    }
  }

  const winCandidates = [
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\simfang.ttf',
    'C:\\Windows\\Fonts\\msyh.ttf',
  ];
  const posixCandidates = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/System/Library/Fonts/Supplemental/Songti.ttc',
    '/System/Library/Fonts/PingFang.ttc',
  ];
  const candidates = process.platform === 'win32' ? winCandidates : posixCandidates;
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return new Uint8Array(readFileSync(p));
    } catch {
      // keep trying
    }
  }

  const fromFontsource = tryReadFontsourceFromNodeModules();
  if (fromFontsource) return fromFontsource;

  const repoOtf = join(process.cwd(), 'public', 'fonts', 'NotoSansSC-Regular.otf');
  if (existsSync(repoOtf)) {
    try {
      return new Uint8Array(readFileSync(repoOtf));
    } catch {
      // no-op
    }
  }
  const repoWoff = join(process.cwd(), 'public', 'fonts', OCR_CJK_PUBLIC_FONT_FILE);
  if (existsSync(repoWoff)) {
    try {
      return new Uint8Array(readFileSync(repoWoff));
    } catch {
      // no-op
    }
  }
  return null;
}

function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.CF_PAGES_URL?.trim() ||
    '';
  return raw.replace(/\/$/, '');
}

/**
 * 异步加载 CJK 字体字节（Workers / 无本地字体时）：同步路径失败后 fetch 同源 /fonts 或 jsDelivr。
 */
export async function loadOcrPdfCjkFontBytesAsync(): Promise<Uint8Array | null> {
  if (cachedAsyncFont !== undefined) {
    return cachedAsyncFont;
  }
  const sync = tryLoadOcrPdfCjkFontBytes();
  if (sync) {
    cachedAsyncFont = sync;
    return sync;
  }

  const urls: string[] = [];
  const base = appBaseUrl();
  if (base) {
    urls.push(`${base}/fonts/${OCR_CJK_PUBLIC_FONT_FILE}`);
    urls.push(`${base}/fonts/NotoSansSC-Regular.otf`);
  }
  urls.push(JSDELIVR_NOTO_SC_WOFF);

  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > 1024) {
        cachedAsyncFont = buf;
        return buf;
      }
    } catch {
      // try next
    }
  }
  cachedAsyncFont = null;
  return null;
}
