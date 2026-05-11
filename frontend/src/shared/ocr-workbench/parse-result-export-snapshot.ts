import { buildLayoutFitInlineScript } from '@/shared/ocr-workbench/parse-result-export-layout-fit-script';
import { resolveImageDataUrl } from '@/shared/ocr-workbench/parse-result-image-data';

const BLANK_PIXEL_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export type SnapshotImageIssue = {
  layoutId: string;
  src: string;
  reason: 'missing-src' | 'resolve-failed';
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

export async function snapshotPageElement(
  pageEl: HTMLElement,
  cache: Map<string, string>,
  options?: { orientation?: 'portrait' | 'landscape' }
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
