import { buildLayoutFitInlineScript } from '@/shared/ocr-workbench/parse-result-export-layout-fit-script';
import { resolveImageDataUrl } from '@/shared/ocr-workbench/parse-result-image-data';

const BLANK_PIXEL_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export type SnapshotImageIssue = {
  layoutId: string;
  src: string;
  reason: 'missing-src' | 'resolve-failed';
};

export type SnapshotPngAttempt = {
  strategy: 'direct' | 'strip-external-url' | 'minimal-style';
  ok: boolean;
  reason?: string;
};

export type SnapshotPngResult = {
  dataUrl: string;
  strategy: SnapshotPngAttempt['strategy'];
  attempts: SnapshotPngAttempt[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function computedStyleText(el: Element): string {
  const cs = window.getComputedStyle(el);
  let out = '';
  for (let i = 0; i < cs.length; i++) {
    const key = cs.item(i);
    if (!key) continue;
    out += `${key}:${cs.getPropertyValue(key)};`;
  }
  return out;
}

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll('*'))];
}

/** 打印快照里避免 scrollport（overflow:auto）被 Chromium PDF 裁切 */
function normalizeSnapshotOverflowForPrint(clone: HTMLElement): void {
  const candidates = clone.querySelectorAll<HTMLElement>(
    '[data-layout-id], .parse-result-rich-host'
  );
  for (const el of candidates) {
    const raw = el.getAttribute('style');
    if (!raw) continue;
    let next = raw;
    next = next.replace(/overflow-y\s*:\s*auto\b/gi, 'overflow-y:hidden');
    next = next.replace(/overflow-y\s*:\s*scroll\b/gi, 'overflow-y:hidden');
    next = next.replace(/overflow-x\s*:\s*auto\b/gi, 'overflow-x:hidden');
    next = next.replace(/overflow-x\s*:\s*scroll\b/gi, 'overflow-x:hidden');
    next = next.replace(/overflow\s*:\s*auto\b/gi, 'overflow:hidden');
    next = next.replace(/overflow\s*:\s*scroll\b/gi, 'overflow:hidden');
    if (next !== raw) el.setAttribute('style', next);
  }
}

/**
 * SVG foreignObject 内字体度量与主文档略有差异时，`overflow:hidden` 易把最后一行 descender 横切。
 * 光栅 PDF 前对文本块放宽裁切（表格/插图块保持原样）。
 */
function relaxSnapshotClipForRasterExport(clone: HTMLElement): void {
  const roots = clone.querySelectorAll<HTMLElement>('[data-layout-id]');
  for (const root of roots) {
    const kind = (root.dataset.layoutType || '').toLowerCase();
    if (kind === 'image' || kind === 'table') continue;
    stripLayoutOverflowClip(root);
    for (const host of root.querySelectorAll<HTMLElement>('.parse-result-rich-host')) {
      stripLayoutOverflowClip(host);
    }
  }
}

function stripLayoutOverflowClip(el: HTMLElement): void {
  const raw = el.getAttribute('style');
  if (!raw) return;
  let next = raw
    .replace(/overflow\s*:\s*hidden\b/gi, 'overflow:visible')
    .replace(/overflow-y\s*:\s*hidden\b/gi, 'overflow-y:visible')
    .replace(/overflow-x\s*:\s*hidden\b/gi, 'overflow-x:visible')
    .replace(/overflow\s*:\s*clip\b/gi, 'overflow:visible');
  if (next !== raw) el.setAttribute('style', next);
}

export async function snapshotPageElement(
  pageEl: HTMLElement,
  cache: Map<string, string>,
  options?: {
    orientation?: 'portrait' | 'landscape';
    /** 光栅 PDF：放宽块级 overflow，避免 foreignObject 与主文档度量差导致最后一行被切 */
    forRaster?: boolean;
  }
): Promise<{
  sectionHtml: string;
  pageHtml: string;
  pageW: number;
  pageH: number;
  imageWarnings: number;
  imageIssues: SnapshotImageIssue[];
}> {
  const clone = pageEl.cloneNode(true) as HTMLElement;
  const srcEls = allElements(pageEl);
  const dstEls = allElements(clone);
  const n = Math.min(srcEls.length, dstEls.length);
  for (let i = 0; i < n; i++) {
    const src = srcEls[i];
    const dst = dstEls[i];
    if (dst instanceof HTMLElement) {
      dst.setAttribute('style', computedStyleText(src));
      dst.removeAttribute('contenteditable');
      dst.removeAttribute('data-layout-editable');
      dst.removeAttribute('tabindex');
    }
  }

  normalizeSnapshotOverflowForPrint(clone);
  if (options?.forRaster) {
    relaxSnapshotClipForRasterExport(clone);
  }

  let imageWarnings = 0;
  const imageIssues: SnapshotImageIssue[] = [];
  const srcImgs = Array.from(pageEl.querySelectorAll('img'));
  const dstImgs = Array.from(clone.querySelectorAll('img'));
  const m = Math.min(srcImgs.length, dstImgs.length);
  for (let i = 0; i < m; i++) {
    const src = srcImgs[i];
    const dst = dstImgs[i];
    const owner = src.closest<HTMLElement>('[data-layout-id]');
    const layoutId = owner?.dataset.layoutId ?? `unknown-${i}`;
    const raw = (src.currentSrc || src.src || '').trim();
    if (!raw) {
      dst.setAttribute('src', BLANK_PIXEL_DATA_URL);
      imageWarnings += 1;
      imageIssues.push({ layoutId, src: '', reason: 'missing-src' });
      continue;
    }
    const inlined = await resolveImageDataUrl(raw, cache);
    if (inlined) {
      const rect = src.getBoundingClientRect();
      const optimized = await optimizeDataUrlForSnapshot(
        inlined,
        Math.max(1, rect.width),
        Math.max(1, rect.height)
      );
      dst.setAttribute('src', optimized || inlined);
    } else {
      // Keep original URL for backend staging download/rewrite.
      // Do not blank it here, otherwise export loses recoverable images.
      dst.setAttribute('src', raw);
      imageWarnings += 1;
      imageIssues.push({ layoutId, src: raw, reason: 'resolve-failed' });
    }
    dst.removeAttribute('srcset');
  }

  const rect = pageEl.getBoundingClientRect();
  const pageW = Math.max(1, Math.ceil(rect.width));
  const pageH = Math.max(1, Math.ceil(rect.height));
  // 96dpi 下 A4 约 794x1123；打印时把编辑页等比压入一张纸内，避免一页拆成两页
  const orientation = options?.orientation === 'landscape' ? 'landscape' : 'portrait';
  const printLimitW = orientation === 'landscape' ? 1123 : 794;
  const printLimitH = orientation === 'landscape' ? 794 : 1123;
  const printScale = Math.min(1, printLimitW / pageW, printLimitH / pageH);
  const pageHtml = clone.outerHTML;

  return {
    sectionHtml: `<section class="snapshot-page-wrap" style="--page-w:${pageW}px;--page-h:${pageH}px;--print-scale:${printScale};"><div class="snapshot-page-scale">${pageHtml}</div></section>`,
    pageHtml,
    pageW,
    pageH,
    imageWarnings,
    imageIssues,
  };
}

export async function snapshotPageHtmlToPngDataUrl(
  pageHtml: string,
  pageW: number,
  pageH: number
): Promise<string> {
  const { dataUrl } = await snapshotPageHtmlToPngDataUrlWithDiagnostics(
    pageHtml,
    pageW,
    pageH
  );
  return dataUrl;
}

/** 将 DOM 快照栅格化为 JPEG，减小随 PDF 上传的 HTML 体积。 */
export async function snapshotPageHtmlToJpegDataUrlForPdf(
  pageHtml: string,
  pageW: number,
  pageH: number,
  quality = 0.88
): Promise<string> {
  const png = await snapshotPageHtmlToPngDataUrl(pageHtml, pageW, pageH);
  return encodePngDataUrlAsJpeg(png, quality);
}

function encodePngDataUrlAsJpeg(pngDataUrl: string, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(pngDataUrl);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(pngDataUrl);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(pngDataUrl);
      }
    };
    img.onerror = () => reject(new Error('raster jpeg encode failed'));
    img.src = pngDataUrl;
  });
}

export type SnapshotRasterPdfPage = {
  dataUrl: string;
  w: number;
  h: number;
};

/**
 * PDF 专用：每页为一张与 Workbench 同像素栅格图，打印时 `object-fit: contain` 放入 A4，
 * 避免 HTML→PDF 二次排版、transform 与块级 overflow 导致的裁切。
 */
export function buildSnapshotRasterPdfDocument(
  pages: SnapshotRasterPdfPage[],
  title: string,
  options?: { orientation?: 'portrait' | 'landscape' }
): string {
  const safeTitle = escapeHtml(title || 'document');
  const orientation = options?.orientation === 'landscape' ? 'landscape' : 'portrait';
  const pageWmm = orientation === 'landscape' ? '297mm' : '210mm';
  const pageHmm = orientation === 'landscape' ? '210mm' : '297mm';

  const sectionsWithImages = pages
    .map((p, i) => {
      const esc = p.dataUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<section class="snapshot-raster-page" aria-label="page ${i + 1}"><img src="${esc}" alt="" width="${p.w}" height="${p.h}"/></section>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${safeTitle}</title><style>
    :root{color-scheme:light;}
    html,body{margin:0;padding:0;}
    body{
      padding:12px;
      background:#f3f4f6;
      -webkit-print-color-adjust:exact;
      print-color-adjust:exact;
    }
    .snapshot-raster-page{
      box-sizing:border-box;
      width:${pageWmm};
      min-height:${pageHmm};
      margin:0 auto 18px;
      display:flex;
      align-items:center;
      justify-content:center;
      background:#fff;
    }
    .snapshot-raster-page img{
      display:block;
      max-width:100%;
      max-height:${pageHmm};
      width:auto;
      height:auto;
      object-fit:contain;
      -webkit-print-color-adjust:exact;
      print-color-adjust:exact;
    }
    @page{margin:0;size:A4 ${orientation};}
    @media print{
      body{padding:0;background:#fff;}
      .snapshot-raster-page{
        margin:0 auto;
        break-after:page;
        page-break-after:always;
        break-inside:avoid;
        page-break-inside:avoid;
      }
      .snapshot-raster-page:last-child{
        break-after:auto;
        page-break-after:auto;
      }
    }
  </style></head><body>${sectionsWithImages}<script>window.__prLayoutFitDone=true;</script></body></html>`;
}

export async function snapshotPageHtmlToPngDataUrlWithDiagnostics(
  pageHtml: string,
  pageW: number,
  pageH: number
): Promise<SnapshotPngResult> {
  // SVG foreignObject 渲染时，远程 <img src="http..."> 容易触发整页渲染失败；仅在 PNG 快照路径把非 data URL 兜底为空像素。
  const safeHtml = toXmlSafeHtml(
    pageHtml.replace(
      /(<img\b[^>]*\bsrc=)(['"])(?!data:)[^'"]*\2/gi,
      `$1"${BLANK_PIXEL_DATA_URL}"`
    )
  );
  const attempts: SnapshotPngAttempt[] = [];
  try {
    const dataUrl = await renderSvgHtmlToPngDataUrl(safeHtml, pageW, pageH);
    attempts.push({ strategy: 'direct', ok: true });
    return { dataUrl, strategy: 'direct', attempts };
  } catch (e) {
    attempts.push({
      strategy: 'direct',
      ok: false,
      reason: e instanceof Error ? e.message : 'unknown',
    });
  }
  const retryHtml = stripExternalCssUrls(safeHtml);
  try {
    const dataUrl = await renderSvgHtmlToPngDataUrl(retryHtml, pageW, pageH);
    attempts.push({ strategy: 'strip-external-url', ok: true });
    return { dataUrl, strategy: 'strip-external-url', attempts };
  } catch (e) {
    attempts.push({
      strategy: 'strip-external-url',
      ok: false,
      reason: e instanceof Error ? e.message : 'unknown',
    });
  }
  const minimalHtml = minimizeSvgRiskHtml(retryHtml);
  try {
    const dataUrl = await renderSvgHtmlToPngDataUrl(minimalHtml, pageW, pageH);
    attempts.push({ strategy: 'minimal-style', ok: true });
    return { dataUrl, strategy: 'minimal-style', attempts };
  } catch (e) {
    attempts.push({
      strategy: 'minimal-style',
      ok: false,
      reason: e instanceof Error ? e.message : 'unknown',
    });
  }
  const reason = attempts
    .filter((a) => !a.ok)
    .map((a) => `${a.strategy}:${a.reason ?? 'failed'}`)
    .join('; ');
  throw new Error(`snapshot render failed (${reason})`);
}

async function renderSvgHtmlToPngDataUrl(
  html: string,
  pageW: number,
  pageH: number
): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}">
  <foreignObject x="0" y="0" width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${pageW}px;height:${pageH}px;overflow:visible;background:#fff;">
      ${html}
    </div>
  </foreignObject>
</svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('snapshot svg render failed'));
      i.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement('canvas');
  canvas.width = pageW;
  canvas.height = pageH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('snapshot canvas context missing');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pageW, pageH);
  ctx.drawImage(img, 0, 0, pageW, pageH);
  return canvas.toDataURL('image/png');
}

function toXmlSafeHtml(html: string): string {
  let out = html;
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  out = out.replace(/&(?!(?:[a-z]+|#\d+|#x[\da-f]+);)/gi, '&amp;');
  out = out.replace(
    /<\s*(img|br|hr|input|meta|link|source|track|wbr|area|base|col|embed|param)\b([^>]*?)(?<!\/)>/gi,
    '<$1$2 />'
  );
  return out;
}

function stripExternalCssUrls(html: string): string {
  return html.replace(/url\((['"]?)(?!data:|#)[^)]+\1\)/gi, 'none');
}

function stripUnsupportedColorFunctions(html: string): string {
  return html.replace(/style=(['"])([\s\S]*?)\1/gi, (_m, quote: string, css: string) => {
    const next = css
      .split(';')
      .map((piece) => piece.trim())
      .filter(Boolean)
      .map((decl) => {
        const idx = decl.indexOf(':');
        if (idx <= 0) return '';
        const key = decl.slice(0, idx).trim().toLowerCase();
        let val = decl.slice(idx + 1).trim();
        if (!/\b(?:oklch|oklab|lch|lab)\(/i.test(val)) {
          return `${key}:${val}`;
        }
        if (key.includes('background')) {
          val = 'transparent';
        } else if (key === 'color' || key.endsWith('-color')) {
          if (key.includes('border')) {
            val = 'rgba(0,0,0,0.25)';
          } else {
            val = 'rgb(17,24,39)';
          }
        } else {
          return '';
        }
        return `${key}:${val}`;
      })
      .filter(Boolean)
      .join(';');
    return `style=${quote}${next}${quote}`;
  });
}

function minimizeSvgRiskHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  try {
    const host = document.createElement('div');
    host.innerHTML = html;
    const whitelist = new Set([
      'position',
      'left',
      'top',
      'right',
      'bottom',
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'display',
      'box-sizing',
      'overflow',
      'overflow-x',
      'overflow-y',
      'margin',
      'margin-left',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'padding',
      'padding-left',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'border',
      'border-left',
      'border-top',
      'border-right',
      'border-bottom',
      'border-width',
      'border-style',
      'border-color',
      'border-radius',
      'background',
      'background-color',
      'color',
      'font',
      'font-size',
      'font-family',
      'font-weight',
      'font-style',
      'line-height',
      'text-align',
      'white-space',
      'word-break',
      'overflow-wrap',
      'opacity',
      'transform',
      'transform-origin',
      'object-fit',
      'object-position',
      'z-index',
    ]);
    for (const el of Array.from(host.querySelectorAll<HTMLElement>('*'))) {
      const raw = el.getAttribute('style');
      if (!raw) continue;
      const keep: string[] = [];
      for (const piece of raw.split(';')) {
        const idx = piece.indexOf(':');
        if (idx <= 0) continue;
        const key = piece.slice(0, idx).trim().toLowerCase();
        const val = piece.slice(idx + 1).trim();
        if (!key || !val) continue;
        if (!whitelist.has(key)) continue;
        if (/url\((?!['"]?(?:data:|#))/i.test(val)) continue;
        keep.push(`${key}:${val}`);
      }
      if (keep.length > 0) el.setAttribute('style', keep.join(';'));
      else el.removeAttribute('style');
    }
    return host.innerHTML;
  } catch {
    return html;
  }
}

async function optimizeDataUrlForSnapshot(
  dataUrl: string,
  boxW: number,
  boxH: number
): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  if (dataUrl.length < 1_200_000) return dataUrl;
  const m = dataUrl.match(/^data:([^;]+);base64,/i);
  const mime = m?.[1]?.toLowerCase() ?? '';
  if (mime.includes('gif')) return dataUrl;
  if (typeof document === 'undefined') return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('load image'));
      el.src = dataUrl;
    });
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    if (!nw || !nh) return dataUrl;
    const maxW = Math.max(1, Math.round(boxW * 2));
    const maxH = Math.max(1, Math.round(boxH * 2));
    const scale = Math.min(1, maxW / nw, maxH / nh);
    if (scale >= 0.999) return dataUrl;
    const tw = Math.max(1, Math.round(nw * scale));
    const th = Math.max(1, Math.round(nh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, tw, th);
    const asPng = mime.includes('png');
    return canvas.toDataURL(asPng ? 'image/png' : 'image/jpeg', 0.86);
  } catch {
    return dataUrl;
  }
}

export function buildSnapshotHtmlDocument(
  pageSections: string[],
  title: string,
  options?: { orientation?: 'portrait' | 'landscape' }
): string {
  const safeTitle = escapeHtml(title || 'document');
  const orientation = options?.orientation === 'landscape' ? 'landscape' : 'portrait';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${safeTitle}</title><style>
    :root{color-scheme:light;}
    html,body{margin:0;padding:0;}
    body{
      padding:12px;
      background:#f3f4f6;
      font-family:system-ui,-apple-system,sans-serif;
      -webkit-print-color-adjust:exact;
      print-color-adjust:exact;
    }
    .snapshot-page-wrap{
      margin:0 auto 18px;
      width:max-content;
      max-width:100%;
    }
    .snapshot-page-scale{
      transform-origin:top left;
    }
    @page{
      margin:0;
      size:A4 ${orientation};
    }
    @media print{
      body{padding:0;background:#fff;}
      .snapshot-page-wrap{
        margin:0 auto;
        break-after:page;
        page-break-after:always;
        break-inside:avoid;
        page-break-inside:avoid;
        width:calc(var(--page-w) * var(--print-scale));
        height:calc(var(--page-h) * var(--print-scale));
        overflow:hidden;
      }
      .snapshot-page-wrap:last-child{
        break-after:auto;
        page-break-after:auto;
      }
      .snapshot-page-scale{
        width:var(--page-w);
        height:var(--page-h);
        transform:scale(var(--print-scale));
      }
    }
  </style></head><body>${pageSections.join('')}${buildLayoutFitInlineScript('[data-layout-id]')}</body></html>`;
}
