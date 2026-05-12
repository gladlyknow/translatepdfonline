import { tryGetAlsCfEnv } from '@/shared/lib/worker-runtime-env';

/**
 * OCR 队列 **Consumer**（`wrangler.consumer*.jsonc` 的 `main`，非 Next 用户站点）专用：
 * `env.BROWSER`（Browser Rendering 绑定）+ `@cloudflare/puppeteer`。
 *
 * PDF 素材为 **Workbench 矢量快照 HTML**：已由 API 写入 R2 staging，本函数仅对 **staging 字符串**
 * `setContent` → `page.pdf`。与 Next 前端进程无关。
 *
 * 不把 `playwright` 放进依赖图，否则 Wrangler 打包会解析 playwright-core 并失败。
 */
export async function renderWorkbenchHtmlToPdfBytes(html: string): Promise<Uint8Array> {
  const browserBinding = tryGetAlsCfEnv()?.BROWSER;
  if (!browserBinding) {
    throw new Error(
      'PDF_RENDER_BACKEND_UNAVAILABLE: Worker 需配置 Browser Rendering 绑定 `BROWSER`（见 wrangler.consumer）'
    );
  }
  const { htmlToPdfBytesCloudflareWithDiagnostics } = await import(
    './ocr-export-pdf-cloudflare'
  );
  const out = await htmlToPdfBytesCloudflareWithDiagnostics(html, browserBinding);
  return out.bytes;
}
