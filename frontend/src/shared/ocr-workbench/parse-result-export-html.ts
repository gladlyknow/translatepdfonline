import MarkdownIt from 'markdown-it';

import {
  findImageForLayout,
  findTableForLayout,
  getPageBox,
  sortLayoutsByReadingOrder,
} from '@/shared/ocr-workbench/parse-result-document';
import { resolveImageDataUrl } from '@/shared/ocr-workbench/parse-result-image-data';
import { stripUrlsFromText } from '@/shared/ocr-workbench/strip-urls';
import type { ParseLayout, ParseResult } from '@/shared/ocr-workbench/translator-parse-result';

const mdIt = new MarkdownIt({ html: false, linkify: false });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function looksLikeHtml(s: string): boolean {
  if (!s.trim()) return false;
  return /<\/?[a-z][\s\S]*>/i.test(s) || /<\s*br\s*\/?>/i.test(s);
}

function stripScriptTags(html: string): string {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

/** 与画布 `editorStyleToCss` 默认一致，避免导出页全局小字号压过编辑样式。 */
function stripHtmlForFit(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function estimateWeightedTextLength(text: string): number {
  let total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) {
      total += 0.45;
      continue;
    }
    if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) {
      total += 1.95;
      continue;
    }
    if (/[A-Z0-9]/.test(ch)) {
      total += 1.05;
      continue;
    }
    total += 0.9;
  }
  return Math.max(1, total);
}

function estimateFitFontSizeForExport(ly: ParseLayout): number {
  const text = stripHtmlForFit(ly.text || '');
  const [, , w, h] = ly.position || [0, 0, 0, 0];
  const safeW = Math.max(24, Number(w) || 0);
  const safeH = Math.max(20, Number(h) || 0);
  const kind = (ly.type || '').toLowerCase();
  const minSize = kind.includes('title')
    ? 12
    : kind.includes('formula')
      ? 11
      : kind.includes('table')
        ? 10
        : kind.includes('code')
          ? 10
          : 9;
  if (!text) {
    return Math.min(16, Math.max(minSize, Math.floor(safeH / 2.2)));
  }
  const weightedLength = estimateWeightedTextLength(text);
  for (let size = 72; size >= minSize; size -= 1) {
    const charsPerLine = Math.max(2.4, (safeW * 1.72) / size);
    const lines = Math.ceil(weightedLength / charsPerLine);
    const lineHeight = kind.includes('table') || kind.includes('code') ? 1.25 : 1.45;
    const neededH = lines * size * lineHeight;
    if (neededH <= safeH * 0.92) return size;
  }
  return minSize;
}

function editorInlineStyle(ly: ParseLayout): string {
  const ed = (ly as ParseLayout & { _editor?: Record<string, string> })._editor;
  let s = '';
  if (ed?.fontSize) s += `font-size:${ed.fontSize};`;
  else s += `font-size:${estimateFitFontSizeForExport(ly)}px;`;
  if (ed?.fontFamily) s += `font-family:${ed.fontFamily};`;
  else {
    s +=
      'font-family:"Noto Sans SC","Noto Sans JP","Noto Sans KR","Noto Sans","Microsoft YaHei",system-ui,sans-serif;';
  }
  if (ed?.fontWeight) s += `font-weight:${ed.fontWeight};`;
  if (ed?.color) s += `color:${ed.color};`;
  else s += 'color:#2b2525;';
  if (ed?.textAlign) s += `text-align:${ed.textAlign};`;
  s +=
    (ly.type || '').toLowerCase().includes('table') ||
    (ly.type || '').toLowerCase().includes('code')
      ? 'line-height:1.25;'
      : 'line-height:1.45;';
  return s;
}

export async function buildSelfContainedHtml(
  doc: ParseResult,
  options?: {
    forPrint?: boolean;
    appOrigin?: string;
    forwardCookie?: string;
    locale?: string;
    renderMode?: 'standard' | 'workbench_like';
    orientation?: 'portrait' | 'landscape';
  }
): Promise<{ html: string; imageWarnings: number }> {
  const cache = new Map<string, string>();
  let imageWarnings = 0;

  let body = '';
  const renderMode = options?.renderMode || 'standard';
  const orientation = options?.orientation === 'landscape' ? 'landscape' : 'portrait';
  const printLimitW = orientation === 'landscape' ? 1123 : 794;
  const printLimitH = orientation === 'landscape' ? 794 : 1123;
  for (const page of doc.pages) {
    const { w, h } = getPageBox(page);
    const pageBreak = options?.forPrint ? 'page-break-after:always;' : '';
    if (renderMode === 'workbench_like') {
      const printScale = Math.min(1, printLimitW / w, printLimitH / h);
      body += `<section class="snapshot-page-wrap" style="--page-w:${w}px;--page-h:${h}px;--print-scale:${printScale};"><div class="snapshot-page-scale"><section class="pr-page" style="position:relative;width:${w}px;height:${h}px;${pageBreak}">`;
    } else {
      body += `<section class="pr-page-wrap"><section class="pr-page" style="position:relative;width:${w}px;height:${h}px;${pageBreak}">`;
    }
    for (const ly of sortLayoutsByReadingOrder(page.layouts)) {
      const [x, y, pw, ph] = ly.position;
      const ed = editorInlineStyle(ly);
      let inner = '';
      if (ly.type === 'table') {
        const tb = findTableForLayout(page, ly.layout_id);
        inner = `<div class="parse-result-rich-host pr-table-host">${mdIt.render(
          stripUrlsFromText(tb?.markdown ?? '')
        )}</div>`;
      } else if (ly.type === 'image') {
        const im = findImageForLayout(page, ly.layout_id);
        const raw = im?.data_url?.trim() ?? '';
        const inlined = raw
          ? await resolveImageDataUrl(raw, cache, {
              appOrigin: options?.appOrigin,
              forwardCookie: options?.forwardCookie,
            })
          : '';
        const src = inlined || raw || '';
        if (!src) {
          imageWarnings += 1;
        }
        const safeAttr = src.replace(/"/g, '&quot;');
        inner = src
          ? `<img src="${safeAttr}" alt="" style="display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;" />`
          : '';
      } else {
        const rawText = ly.text || '';
        if (looksLikeHtml(rawText)) {
          inner = `<div class="pr-text parse-result-rich-host">${stripScriptTags(rawText)}</div>`;
        } else {
          inner = `<div class="pr-text parse-result-rich-host">${mdIt.render(
            stripUrlsFromText(rawText)
          )}</div>`;
        }
      }
      body += `<div class="pr-layout" data-layout-id="${escapeHtml(ly.layout_id)}" data-layout-type="${escapeHtml(ly.type || 'text')}" style="position:absolute;left:${x}px;top:${y}px;width:${pw}px;height:${ph}px;overflow:hidden;box-sizing:border-box;${ed}">${inner}</div>`;
    }
    if (renderMode === 'workbench_like') {
      body += `</section></div></section>`;
    } else {
      body += `</section></section>`;
    }
  }

  const rawLocale = (options?.locale || 'zh-CN').trim().slice(0, 24);
  const lang = /^[\w-]+$/.test(rawLocale) ? escapeHtml(rawLocale) : 'zh-CN';
  const title = escapeHtml(doc.file_name || 'document');
  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>
    :root{color-scheme:light;}
    html,body{margin:0;padding:0;}
    body{
      padding:12px;
      background:#f3f4f6;
      font-family:"Noto Sans SC","Noto Sans JP","Noto Sans KR","Noto Sans","Microsoft YaHei",system-ui,sans-serif;
      -webkit-print-color-adjust:exact;
      print-color-adjust:exact;
    }
    .pr-page-wrap{
      margin:0 auto 18px;
      width:max-content;
      max-width:100%;
      box-sizing:border-box;
      padding:0;
    }
    .pr-page{
      background:#fff;
      box-shadow:0 1px 3px rgba(0,0,0,.08);
      overflow:hidden;
    }
    .snapshot-page-wrap{
      margin:0 auto 18px;
      width:max-content;
      max-width:100%;
      box-sizing:border-box;
      padding:0;
    }
    .snapshot-page-scale{
      transform-origin:top left;
    }
    .pr-layout{
      box-sizing:border-box;
      word-break:break-word;
      overflow-wrap:anywhere;
    }
    .parse-result-rich-host{line-height:1.45;}
    .parse-result-rich-host p{margin:0;}
    .parse-result-rich-host ol{list-style:decimal;list-style-position:inside;padding-left:0.5rem;margin:0;}
    .parse-result-rich-host ul{list-style:disc;list-style-position:inside;padding-left:0.5rem;margin:0;}
    .parse-result-rich-host li{margin:0.125rem 0;display:list-item;}
    .pr-table-host{height:100%;width:100%;overflow:hidden;line-height:1.2;}
    .pr-table-host table{width:100%;height:100%;table-layout:fixed;border-collapse:collapse;}
    .pr-table-host td,.pr-table-host th{word-break:break-word;vertical-align:top;border:1px solid #e7e5e4;padding:2px 4px;}
    .pr-layout .pr-text,
    .pr-layout .pr-text *,
    .pr-layout .parse-result-rich-host,
    .pr-layout .parse-result-rich-host *{
      box-sizing:border-box;
    }
    .pr-layout img{display:block;}
    @page{
      margin:0;
      size:A4 ${orientation};
    }
    @media print{
      body{padding:0;background:#fff;}
      .pr-page-wrap{margin:0 auto;}
      .pr-page{box-shadow:none;}
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
  </style></head><body>${body}<script>
    (() => {
      const MIN_FONT = 7;
      const MAX_STEPS = 30;
      function isOverflow(el) {
        return el.scrollHeight > el.clientHeight + 0.8 || el.scrollWidth > el.clientWidth + 0.8;
      }
      function fitTextLayout(el) {
        const kind = (el.getAttribute('data-layout-type') || '').toLowerCase();
        if (kind === 'image' || kind === 'table') return;
        if (!isOverflow(el)) return;
        const cs = window.getComputedStyle(el);
        let fontSize = Number.parseFloat(cs.fontSize || '') || 12;
        let lineHeight = Number.parseFloat(cs.lineHeight || '') || fontSize * 1.4;
        let steps = 0;
        while (steps < MAX_STEPS && isOverflow(el) && fontSize > MIN_FONT) {
          fontSize -= 0.5;
          lineHeight = Math.max(fontSize * 1.15, lineHeight - 0.35);
          el.style.fontSize = fontSize.toFixed(2) + 'px';
          el.style.lineHeight = lineHeight.toFixed(2) + 'px';
          steps += 1;
        }
      }
      function runFit() {
        const layouts = Array.from(document.querySelectorAll('.pr-layout'));
        for (const one of layouts) {
          fitTextLayout(one);
        }
        window.__prLayoutFitDone = true;
      }
      window.__prLayoutFitDone = false;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runFit, { once: true });
      } else {
        runFit();
      }
    })();
  </script></body></html>`;
  return { html, imageWarnings };
}
