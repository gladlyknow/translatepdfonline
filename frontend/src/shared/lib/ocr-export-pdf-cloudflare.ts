type PdfDiagnostics = {
  fontsStatus: string;
  imageCount: number;
  uniqueFontFamilies: string[];
};

type CloudflarePuppeteerModule = {
  launch: (binding: unknown) => Promise<{
    newPage: () => Promise<{
      setContent: (
        html: string,
        opts?: { waitUntil?: 'domcontentloaded'; timeout?: number }
      ) => Promise<void>;
      waitForFunction: (
        pageFunction: () => unknown,
        opts?: { timeout?: number }
      ) => Promise<void>;
      evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
      pdf: (opts?: {
        printBackground?: boolean;
        preferCSSPageSize?: boolean;
        margin?: { top?: string; bottom?: string; left?: string; right?: string };
      }) => Promise<Uint8Array | ArrayBuffer>;
    }>;
    close: () => Promise<void>;
  }>;
};

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

export async function htmlToPdfBytesCloudflareWithDiagnostics(
  html: string,
  browserBinding: unknown
): Promise<{ bytes: Uint8Array; diagnostics: PdfDiagnostics }> {
  if (!browserBinding) {
    throw new Error('PDF_RENDER_BACKEND_UNAVAILABLE');
  }

  const mod = (await import('@cloudflare/puppeteer')) as unknown as {
    default?: CloudflarePuppeteerModule;
    launch?: CloudflarePuppeteerModule['launch'];
  };
  const launch = mod.default?.launch || mod.launch;
  if (typeof launch !== 'function') {
    throw new Error('PDF_RENDER_BACKEND_UNAVAILABLE');
  }

  const browser = await launch(browserBinding);
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
      .waitForFunction(() => (window as any).__prLayoutFitDone !== false, {
        timeout: 12_000,
      })
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

    const output = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    });
    return {
      bytes: toUint8Array(output),
      diagnostics,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes('timeout')) {
      throw new Error(`PDF_RENDER_TIMEOUT: ${msg}`);
    }
    throw e;
  } finally {
    await browser.close();
  }
}
