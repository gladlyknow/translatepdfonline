/**
 * Worker-side scan / image-heavy PDF precheck before FC translate.
 * Combines metadata heuristics with BabelDOC-inspired byte-level signals (no FC changes).
 */

import { parseTranslatePageRange } from './translate-billing';

export type ScanMetadataDecision =
  | 'high_confidence_scan'
  | 'suspected_scan'
  | 'normal_pdf';

export type ScanMetadataResult = {
  decision: ScanMetadataDecision;
  reasonCodes: string[];
  confidence: 'low' | 'medium' | 'high';
  /**
   * 仅命中「页均 350KB+、总大小、多页」等软启发（未达 600/900KB 页均硬门槛）。
   * balanced 模式下不单独 409，避免误伤嵌入大图/设计稿类正规 PDF；仍可走二进制/CID 规则。
   */
  softMetadataOnly: boolean;
  /** Whole-file bytes / document page count (not page_range span — avoids inflating when translating 1–2 pages of a 7-page PDF) */
  avgBytesPerPage: number;
  /** Pages used for avgBytesPerPage denominator */
  pagesForAvgSize: number;
  /** Selected range span pages, else document pages (for logging / gates) */
  effectivePages: number;
};

export type BinaryScanSignals = {
  sampleBytes: number;
  /** /Subtype /Image (case-insensitive) occurrences in sample */
  imageSubtypeCount: number;
  /** Rough text-showing operator counts in Latin1 view */
  tjOperatorCount: number;
  /** (cid:n) style token count */
  cidTokenCount: number;
  /** Matches BabelDOC fast_check idea: text rendering mode 3 (invisible) */
  textRenderMode3Hits: number;
  /** Presence of marked-content + MCID patterns (BabelDOC Artifact/BDC heuristics, simplified) */
  mcidOrBdcHits: number;
};

export type ScanBlockMode =
  | 'off'
  | 'warn'
  | 'strict'
  | 'balanced'
  | 'aggressive';

export function normalizeScanBlockMode(raw: string | undefined | null): ScanBlockMode {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (
    s === 'off' ||
    s === 'warn' ||
    s === 'strict' ||
    s === 'balanced' ||
    s === 'aggressive'
  ) {
    return s;
  }
  /**
   * 默认 balanced：在 strict 基础上额外拦截 suspected_scan 硬证据、二进制强信号、
   * CID token 密度等，在 FC 请求前拦截更多扫描件，减少无效 FC 费用。
   * 需要更严格时设 SCAN_BLOCK_MODE=aggressive；完全关闭设 off。
   */
  return 'balanced';
}

/**
 * Metadata-only scan heuristics (filename + size / page averages).
 * Same rules as legacy `detectLikelyScannedPdf` in translate/route.ts.
 */
export function scanFromMetadata(params: {
  filename: string | null | undefined;
  sizeBytes: number | null | undefined;
  pageCount: number | null | undefined;
  pageRange: string | null;
}): ScanMetadataResult {
  const filename = (params.filename || '').toLowerCase();
  const sizeBytes = Number(params.sizeBytes || 0);
  const pageCount = Number(params.pageCount || 0);
  const range = params.pageRange?.trim() || '';

  const hasScanHintInName =
    /scan|scanned|ocr|image-only|图片|扫描|影印/.test(filename);

  const rangeHit = range ? parseTranslatePageRange(range) : null;
  const rangePageSpan = rangeHit
    ? Math.max(1, rangeHit[1] - rangeHit[0] + 1)
    : 0;
  const documentPages = pageCount > 0 ? pageCount : 0;
  /** 页均体积：整文件 / 文档总页数；无总页数时才用选中范围页数（避免「只译 1–2 页」把分母变成 2 而虚高） */
  const pagesForAvgSize =
    documentPages > 0 ? documentPages : rangePageSpan > 0 ? rangePageSpan : 0;
  const effectivePages =
    documentPages > 0 ? documentPages : rangePageSpan > 0 ? rangePageSpan : 0;

  const avgBytesPerPage =
    pagesForAvgSize > 0 ? sizeBytes / Math.max(1, pagesForAvgSize) : 0;

  if (pagesForAvgSize <= 0) {
    return {
      decision: 'normal_pdf',
      reasonCodes: ['page_count_unknown'],
      confidence: 'low',
      softMetadataOnly: false,
      avgBytesPerPage: 0,
      pagesForAvgSize: 0,
      effectivePages: 0,
    };
  }

  const hugeImagePages = avgBytesPerPage >= 900 * 1024;
  const mediumImagePages = avgBytesPerPage >= 600 * 1024;
  const veryLargeFile = sizeBytes >= 30 * 1024 * 1024;
  const enoughPages = effectivePages >= 2;

  const reasonCodes: string[] = [];
  if (hasScanHintInName) reasonCodes.push('filename_scan_hint');
  if (hugeImagePages) reasonCodes.push('avg_page_size_very_high');
  if (mediumImagePages) reasonCodes.push('avg_page_size_high');
  if (veryLargeFile) reasonCodes.push('file_size_very_large');
  if (enoughPages) reasonCodes.push('multi_page');

  if (hugeImagePages && veryLargeFile && enoughPages && hasScanHintInName) {
    return {
      decision: 'high_confidence_scan',
      reasonCodes,
      confidence: 'high',
      softMetadataOnly: false,
      avgBytesPerPage,
      pagesForAvgSize,
      effectivePages,
    };
  }
  if ((hugeImagePages && enoughPages) || (mediumImagePages && veryLargeFile)) {
    return {
      decision: 'suspected_scan',
      reasonCodes,
      confidence: 'medium',
      softMetadataOnly: false,
      avgBytesPerPage,
      pagesForAvgSize,
      effectivePages,
    };
  }

  /**
   * 多页 + 整文件偏大 + 页均偏高：常见于嵌入大图/扫描页，但达不到旧版 600KB/页 门槛。
   * 与「纯文本小 PDF」区分：总大小下限 + 页数下限 + 页均下限。
   */
  const softScanRisk =
    documentPages >= 2 &&
    sizeBytes >= 1.5 * 1024 * 1024 &&
    avgBytesPerPage >= 350 * 1024;
  if (softScanRisk) {
    const rc = [
      ...reasonCodes.filter((c) => c !== 'not_enough_scan_signals'),
      'avg_page_elevated_soft_scan_risk',
    ];
    return {
      decision: 'suspected_scan',
      reasonCodes: rc.length > 0 ? rc : ['avg_page_elevated_soft_scan_risk'],
      confidence: 'medium',
      softMetadataOnly: true,
      avgBytesPerPage,
      pagesForAvgSize,
      effectivePages,
    };
  }

  return {
    decision: 'normal_pdf',
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['not_enough_scan_signals'],
    confidence: 'low',
    softMetadataOnly: false,
    avgBytesPerPage,
    pagesForAvgSize,
    effectivePages,
  };
}

/** Latin1 view for PDF binary — good enough for ASCII operator tokens */
function bytesToLatin1(buf: Uint8Array, maxLen: number): string {
  const n = Math.min(buf.length, maxLen);
  let s = '';
  for (let i = 0; i < n; i++) {
    s += String.fromCharCode(buf[i]!);
  }
  return s;
}

/**
 * BabelDOC-inspired signals on first bytes of PDF (no full parse).
 * Not equivalent to BabelDOC paragraph CID ratio or SSIM scan detection.
 */
export function scanFromPdfHeadBytes(buf: Uint8Array): BinaryScanSignals {
  const sampleBytes = buf.length;
  if (sampleBytes === 0) {
    return {
      sampleBytes: 0,
      imageSubtypeCount: 0,
      tjOperatorCount: 0,
      cidTokenCount: 0,
      textRenderMode3Hits: 0,
      mcidOrBdcHits: 0,
    };
  }

  const latin1 = bytesToLatin1(buf, buf.length);
  const lower = latin1.toLowerCase();

  const imageSubtypeCount = [...lower.matchAll(/\/subtype\s*\/\s*image/gi)]
    .length;

  let tjOperatorCount = 0;
  for (const needle of [' Tj', ' TJ'] as const) {
    let i = 0;
    while (i < latin1.length) {
      const j = latin1.indexOf(needle, i);
      if (j === -1) break;
      tjOperatorCount += 1;
      i = j + needle.length;
    }
  }

  const cidTokenCount = [...latin1.matchAll(/\(cid:\d+\)/gi)].length;

  const textRenderMode3Hits = [...latin1.matchAll(/\s3\s+Tr\b/g)].length;

  const mcidOrBdcHits = [...lower.matchAll(/\/mcid\b|\bbdc\b/gi)].length;

  return {
    sampleBytes,
    imageSubtypeCount,
    tjOperatorCount,
    cidTokenCount,
    textRenderMode3Hits,
    mcidOrBdcHits,
  };
}

/** Merge head + tail byte scans (sum counts; sampleBytes totalled for density heuristics). */
export function mergeBinaryScanSignals(
  a: BinaryScanSignals,
  b: BinaryScanSignals
): BinaryScanSignals {
  return {
    sampleBytes: a.sampleBytes + b.sampleBytes,
    imageSubtypeCount: a.imageSubtypeCount + b.imageSubtypeCount,
    tjOperatorCount: a.tjOperatorCount + b.tjOperatorCount,
    cidTokenCount: a.cidTokenCount + b.cidTokenCount,
    textRenderMode3Hits: a.textRenderMode3Hits + b.textRenderMode3Hits,
    mcidOrBdcHits: a.mcidOrBdcHits + b.mcidOrBdcHits,
  };
}

function countStrongBinarySignals(
  bin: BinaryScanSignals | null | undefined
): number {
  if (!bin || bin.sampleBytes < 500) return 0;
  let n = 0;
  const mb = bin.sampleBytes / (1024 * 1024) || 1e-6;
  const cidPerMb = bin.cidTokenCount / mb;

  if (bin.imageSubtypeCount >= 8 && bin.tjOperatorCount < 48) n += 1;
  if (cidPerMb >= 120) n += 1;
  if (bin.textRenderMode3Hits >= 4) n += 1;
  if (bin.mcidOrBdcHits >= 8) n += 1;

  return n;
}

function veryStrongBinaryWithHeavyPages(
  bin: BinaryScanSignals | null | undefined,
  avgBytesPerPage: number
): boolean {
  if (!bin || bin.sampleBytes < 500) return false;
  return (
    bin.imageSubtypeCount >= 18 &&
    bin.tjOperatorCount < 25 &&
    avgBytesPerPage >= 250 * 1024
  );
}

export type ScanInterceptDecision = {
  intercept: boolean;
  reasonCodes: string[];
  /** For logs / 409 JSON */
  signals?: {
    metadata_decision: ScanMetadataDecision;
    binary: BinaryScanSignals | null;
    strong_binary_count: number;
    mode: ScanBlockMode;
  };
};

/** pdf.js 文本提取试探结果 */
export type PdfjsTextResult = {
  /** 是否成功执行了 pdf.js 文本提取 */
  checked: boolean;
  /** 有有效文字的页数（>MIN_CHARS_PER_PAGE 的页） */
  pagesWithText: number;
  /** 检查的页数 */
  pagesChecked: number;
  /** 所有检查页的总字符数 */
  totalChars: number;
  /** 是否有任一页文字极少（疑似扫描/图片页） */
  veryLowText: boolean;
};

/**
 * Whether POST /api/translate should return 409 scan_detected_use_ocr.
 */
export function decideScanIntercept(params: {
  mode: ScanBlockMode;
  preprocessWithOcr: boolean;
  metadata: ScanMetadataResult;
  binary: BinaryScanSignals | null;
  pdfjsText?: PdfjsTextResult | null;
}): ScanInterceptDecision {
  if (params.preprocessWithOcr) {
    return {
      intercept: false,
      reasonCodes: ['skipped_preprocess_with_ocr'],
      signals: {
        metadata_decision: params.metadata.decision,
        binary: params.binary,
        strong_binary_count: 0,
        mode: params.mode,
      },
    };
  }

  const mode = params.mode;
  const meta = params.metadata;
  const bin = params.binary;
  const strong = countStrongBinarySignals(bin);

  if (mode === 'off' || mode === 'warn') {
    return {
      intercept: false,
      reasonCodes: [],
      signals: {
        metadata_decision: meta.decision,
        binary: bin,
        strong_binary_count: strong,
        mode,
      },
    };
  }

  const signalsBase = {
    metadata_decision: meta.decision,
    binary: bin,
    strong_binary_count: strong,
    mode,
  } as const;

  if (mode === 'strict') {
    const block = meta.decision === 'high_confidence_scan';
    return {
      intercept: block,
      reasonCodes: block
        ? [...meta.reasonCodes, 'block_mode_strict_metadata_high']
        : [],
      signals: signalsBase,
    };
  }

  if (mode === 'balanced') {
    if (meta.decision === 'high_confidence_scan') {
      return {
        intercept: true,
        reasonCodes: [...meta.reasonCodes, 'block_mode_balanced_metadata_high'],
        signals: signalsBase,
      };
    }
    /**
     * 硬 suspected（页均 600KB+ 且大文件、或 900KB+ 多页等）仍直接 409。
     * 仅 softMetadataOnly（350KB+ 页均等弱信号）不误伤正规大图 PDF，改由下方二进制/CID/ pdf.js 规则兜底。
     */
    if (meta.decision === 'suspected_scan' && meta.softMetadataOnly !== true) {
      return {
        intercept: true,
        reasonCodes: [
          ...meta.reasonCodes,
          'block_mode_balanced_suspected_metadata',
        ],
        signals: signalsBase,
      };
    }
    /**
     * pdf.js 文本试探：前 2 页几乎无文字 + 元数据有任意扫描信号 → 拦截。
     * 常见于扫描件（文件大但无文字层），避免仅靠文件大小误伤嵌入大图的文字 PDF。
     */
    if (
      params.pdfjsText?.checked &&
      params.pdfjsText.veryLowText &&
      meta.decision !== 'normal_pdf'
    ) {
      return {
        intercept: true,
        reasonCodes: [
          'pdfjs_very_low_text',
          ...meta.reasonCodes,
          'block_mode_balanced_pdfjs',
        ],
        signals: signalsBase,
      };
    }
    if (veryStrongBinaryWithHeavyPages(bin, meta.avgBytesPerPage)) {
      return {
        intercept: true,
        reasonCodes: [
          'binary_image_heavy_low_text_ops',
          'block_mode_balanced_binary_only',
        ],
        signals: signalsBase,
      };
    }
    // CID token 密度检查：用每 MB 密度替代固定阈值，避免误伤带嵌入字体的正常 PDF
    // 同时要求文字算子极少（Tj < 24），有正常文字的 PDF 不会被拦截
    if (bin && bin.sampleBytes >= 512) {
      const mb = bin.sampleBytes / (1024 * 1024);
      const cidPerMb = bin.cidTokenCount / Math.max(mb, 0.5);
      const hasEnoughTextOps = bin.tjOperatorCount >= 24;
      if (cidPerMb >= 40 && !hasEnoughTextOps) {
        return {
          intercept: true,
          reasonCodes: ['block_mode_balanced_cid_tokens_high_density'],
          signals: signalsBase,
        };
      }
    }
    return { intercept: false, reasonCodes: [], signals: signalsBase };
  }

  // aggressive
  if (meta.decision === 'high_confidence_scan' || meta.decision === 'suspected_scan') {
    return {
      intercept: true,
      reasonCodes: [...meta.reasonCodes, 'block_mode_aggressive_metadata'],
      signals: signalsBase,
    };
  }
  if (strong >= 2) {
    return {
      intercept: true,
      reasonCodes: ['block_mode_aggressive_binary'],
      signals: signalsBase,
    };
  }
  if (veryStrongBinaryWithHeavyPages(bin, meta.avgBytesPerPage)) {
    return {
      intercept: true,
      reasonCodes: ['block_mode_aggressive_binary_heavy_pages'],
      signals: signalsBase,
    };
  }

  return { intercept: false, reasonCodes: [], signals: signalsBase };
}
