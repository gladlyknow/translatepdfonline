import type { Browser } from 'playwright';

/**
 * 将完整 HTML（含内联样式）用无头 Chromium 打印为 PDF，与浏览器「打印到 PDF」接近。
 * 仅适用于 Node 运行时（Next Route Handler）；Cloudflare Worker 等环境会抛错，由调用方降级。
 *
 * 启动顺序：PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH → 本机 Chrome → Edge → Playwright 自带 Chromium
 *（自带需执行 `pnpm exec playwright install chromium`）。
 */
export async function launchChromiumForPdf(): Promise<Browser> {
  const { chromium } = await import('playwright');
  const base = {
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'] as string[],
  };

  const execPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (execPath) {
    return chromium.launch({ ...base, executablePath: execPath });
  }

  const tries: Array<{ channel?: 'chrome' | 'msedge' }> = [
    { channel: 'chrome' },
    { channel: 'msedge' },
    {},
  ];

  let last: unknown;
  for (const t of tries) {
    try {
      if (t.channel) {
        return await chromium.launch({ ...base, channel: t.channel });
      }
      return await chromium.launch({ ...base });
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export type PlaywrightPdfDiagnostics = {
  fontsStatus: string;
  imageCount: number;
  uniqueFontFamilies: string[];
};

export async function htmlToPdfBytesPlaywrightWithDiagnostics(
  html: string
): Promise<{ bytes: Uint8Array; diagnostics: PlaywrightPdfDiagnostics }> {
  const browser = await launchChromiumForPdf();
  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page
      .waitForFunction(
        () => Array.from(document.images).every((img) => img.complete),
        { timeout: 90_000 }
      )
      .catch(() => {});
    await page
      .waitForFunction(
        () => (window as any).__prLayoutFitDone !== false,
        { timeout: 12_000 }
      )
      .catch(() => {});
    try {
      await page.evaluate(() => (document as any).fonts?.ready);
    } catch {
      /* ignore */
    }
    const diagnostics = await page.evaluate(() => {
      const fonts = Array.from(document.querySelectorAll<HTMLElement>('*'))
        .slice(0, 80)
        .map((el) => window.getComputedStyle(el).fontFamily || '')
        .filter(Boolean);
      const uniq = Array.from(new Set(fonts)).slice(0, 12);
      const status =
        (document as any).fonts && typeof (document as any).fonts.status === 'string'
          ? (document as any).fonts.status
          : 'unknown';
      return {
        fontsStatus: status,
        imageCount: document.images.length,
        uniqueFontFamilies: uniq,
      };
    });
    const buf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    });
    return {
      bytes: new Uint8Array(buf),
      diagnostics,
    };
  } finally {
    await browser.close();
  }
}

export async function htmlToPdfBytesPlaywright(html: string): Promise<Uint8Array> {
  const out = await htmlToPdfBytesPlaywrightWithDiagnostics(html);
  return out.bytes;
}
