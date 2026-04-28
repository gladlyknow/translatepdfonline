function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
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
  </style></head><body>${pageSections.join('')}</body></html>`;
}
