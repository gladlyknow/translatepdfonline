/**
 * 轻量 pdf.js 文本提取试探：在 FC 调用前检测 PDF 是否有可提取的文字层。
 * 用于辅助 scan-precheck 判断扫描件/图片型 PDF，避免无效 FC 调用。
 *
 * 仅在 Worker/Node 环境下使用（通过 getObjectByteRange 获取 PDF 数据）。
 */

export type PdfjsTextCheckResult = {
  /** 是否成功执行了 pdf.js 文本提取 */
  checked: boolean;
  /** 有有效文字的页数（单页 > MIN_CHARS_PER_PAGE 字符） */
  pagesWithText: number;
  /** 检查的总页数 */
  pagesChecked: number;
  /** 所有检查页的总字符数 */
  totalChars: number;
  /** 是否文字极少（几乎所有页都没有文字层） */
  veryLowText: boolean;
  /** 错误信息（如有） */
  error?: string;
};

/** 单页最少有 20 个字符才算"有文字" */
const MIN_CHARS_PER_PAGE = 20;

/** 最多检查前 2 页 */
const MAX_PAGES_TO_CHECK = 2;

/**
 * 对 PDF 字节数据做文本提取试探。
 * @param pdfBytes - PDF 文件完整字节（或至少前几页足够的数据）
 * @returns PdfjsTextCheckResult
 */
export async function checkPdfTextWithPdfjs(
  pdfBytes: Uint8Array
): Promise<PdfjsTextCheckResult> {
  if (!pdfBytes || pdfBytes.length < 100) {
    return {
      checked: false,
      pagesWithText: 0,
      pagesChecked: 0,
      totalChars: 0,
      veryLowText: false,
      error: 'pdf_bytes_too_small',
    };
  }

  // 验证 PDF header
  const isPdf =
    pdfBytes[0] === 0x25 &&
    pdfBytes[1] === 0x50 &&
    pdfBytes[2] === 0x44 &&
    pdfBytes[3] === 0x46;
  if (!isPdf) {
    return {
      checked: false,
      pagesWithText: 0,
      pagesChecked: 0,
      totalChars: 0,
      veryLowText: false,
      error: 'not_a_pdf',
    };
  }

  try {
    // 动态导入 pdfjs-dist，避免在不需要时增加 bundle 体积
    let pdfjs: any;
    try {
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
      pdfjs = await import('pdfjs-dist');
    }

    // 使用 PDF 字节数据创建文档
    const loadingTask = pdfjs.getDocument({
      data: pdfBytes.slice(), // 复制一份避免 transfer 问题
      disableAutoFetch: true,
      disableStream: true,
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    const pagesToCheck = Math.min(numPages, MAX_PAGES_TO_CHECK);

    let pagesWithText = 0;
    let totalChars = 0;

    for (let i = 1; i <= pagesToCheck; i++) {
      try {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();

        let pageChars = 0;
        for (const item of textContent.items) {
          if (item && typeof (item as any).str === 'string') {
            pageChars += (item as any).str.replace(/\s/g, '').length;
          }
        }

        totalChars += pageChars;
        if (pageChars >= MIN_CHARS_PER_PAGE) {
          pagesWithText += 1;
        }
      } catch {
        // 单页提取失败，跳过
      }
    }

    // 清理
    try {
      await loadingTask.destroy();
    } catch {
      // ignore
    }

    // veryLowText: 检查的页中 ≤1 页有有效文字，且总字符数很少
    const veryLowText =
      pagesToCheck > 0 &&
      pagesWithText <= 1 &&
      totalChars < MIN_CHARS_PER_PAGE * pagesToCheck;

    return {
      checked: true,
      pagesWithText,
      pagesChecked: pagesToCheck,
      totalChars,
      veryLowText,
    };
  } catch (e) {
    return {
      checked: false,
      pagesWithText: 0,
      pagesChecked: 0,
      totalChars: 0,
      veryLowText: false,
      error: e instanceof Error ? e.message.slice(0, 200) : 'pdfjs_check_failed',
    };
  }
}

export { MIN_CHARS_PER_PAGE, MAX_PAGES_TO_CHECK };
