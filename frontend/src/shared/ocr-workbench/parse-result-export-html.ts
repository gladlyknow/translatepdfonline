import MarkdownIt from 'markdown-it';

import {
  findImageForLayout,
  findTableForLayout,
  getPageBox,
  sortLayoutsByReadingOrder,
} from '@/shared/ocr-workbench/parse-result-document';
import { resolveImageDataUrl } from '@/shared/ocr-workbench/parse-result-image-data';
import type { ParseLayout, ParseResult } from '@/shared/ocr-workbench/translator-parse-result';
import { buildSnapshotHtmlDocument } from '@/shared/ocr-workbench/parse-result-export-snapshot';

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

function editorInlineStyle(ly: ParseLayout): string {
  const ed = (ly as ParseLayout & { _editor?: Record<string, string> })._editor;
  let s = '';
  if (ed?.fontSize) s += `font-size:${ed.fontSize};`;
  else s += 'font-size:16px;';
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
      ? 'line-height:1.2;'
      : 'line-height:1.45;';
  return s;
}

function renderLayoutTextHtml(rawText: string): string {
  if (!rawText) return '<p><br></p>';
  if (looksLikeHtml(rawText)) return stripScriptTags(rawText);
  return mdIt.render(rawText) || '<p><br></p>';
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
  const snapshotSections: string[] = [];
  const renderMode = options?.renderMode || 'standard';
  const orientation = options?.orientation === 'landscape' ? 'landscape' : 'portrait';
  const printLimitW = orientation === 'landscape' ? 1123 : 794;
  const printLimitH = orientation === 'landscape' ? 794 : 1123;
  for (const page of doc.pages) {
    const { w, h } = getPageBox(page);
    const pageBreak = options?.forPrint ? 'page-break-after:always;' : '';
    if (renderMode === 'workbench_like') {
      const printScale = Math.min(1, printLimitW / w, printLimitH / h);
      body += `<section class="pr-page" style="position:relative;width:${w}px;height:${h}px;${pageBreak}">`;
    } else {
      body += `<section class="pr-page-wrap"><section class="pr-page" style="position:relative;width:${w}px;height:${h}px;${pageBreak}">`;
    }
    for (const ly of sortLayoutsByReadingOrder(page.layouts)) {
      const [x, y, pw, ph] = ly.position;
      const ed = editorInlineStyle(ly);
      let inner = '';
      if (ly.type === 'table') {
        const tb = findTableForLayout(page, ly.layout_id);
        inner = `<div class="parse-result-rich-host pr-table-host">${mdIt.render(tb?.markdown ?? '')}</div>`;
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
        inner = `<div class="pr-text parse-result-rich-host">${renderLayoutTextHtml(ly.text || '')}</div>`;
      }
      body += `<div class="pr-layout" data-layout-id="${escapeHtml(ly.layout_id)}" data-layout-type="${escapeHtml(ly.type || 'text')}" style="position:absolute;left:${x}px;top:${y}px;width:${pw}px;height:${ph}px;overflow:hidden;box-sizing:border-box;${ed}">${inner}</div>`;
    }
    if (renderMode === 'workbench_like') {
      body += `</section>`;
      snapshotSections.push(
        `<section class="snapshot-page-wrap" style="--page-w:${w}px;--page-h:${h}px;--print-scale:${Math.min(
          1,
          printLimitW / w,
          printLimitH / h
        )};"><div class="snapshot-page-scale">${body}</div></section>`
      );
      body = '';
    } else {
      body += `</section></section>`;
    }
  }

  const rawLocale = (options?.locale || 'zh-CN').trim().slice(0, 24);
  const lang = /^[\w-]+$/.test(rawLocale) ? escapeHtml(rawLocale) : 'zh-CN';
  const title = escapeHtml(doc.file_name || 'document');
  if (renderMode === 'workbench_like') {
    const snapshotHtml = buildSnapshotHtmlDocument(
      snapshotSections,
      doc.file_name || 'document',
      { orientation }
    );
    return {
      html: snapshotHtml,
      imageWarnings,
    };
  }

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
  </style></head><body>${body}</body></html>`;
  return { html, imageWarnings };
}
