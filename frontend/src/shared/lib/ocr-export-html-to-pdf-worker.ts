import { tryGetAlsCfEnv } from '@/shared/lib/worker-runtime-env';

/**
 * Queues consumer 专用：`env.BROWSER` + `@cloudflare/puppeteer`。
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
