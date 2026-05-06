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
  /** Bytes per page for selected range or full doc */
  avgBytesPerPage: number;
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
  /** Default: balanced (metadata + PDF head byte heuristics) */
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

  let effectivePages = pageCount > 0 ? pageCount : 0;
  if (range) {
    const hit = parseTranslatePageRange(range);
    if (hit) {
      effectivePages = Math.max(1, hit[1] - hit[0] + 1);
    }
  }
  const avgBytesPerPage =
    effectivePages > 0 ? sizeBytes / Math.max(1, effectivePages) : 0;

  if (effectivePages <= 0) {
    return {
      decision: 'normal_pdf',
      reasonCodes: ['page_count_unknown'],
      confidence: 'low',
      avgBytesPerPage: 0,
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
      avgBytesPerPage,
      effectivePages,
    };
  }
  if ((hugeImagePages && enoughPages) || (mediumImagePages && veryLargeFile)) {
    return {
      decision: 'suspected_scan',
      reasonCodes,
      confidence: 'medium',
      avgBytesPerPage,
      effectivePages,
    };
  }
  return {
    decision: 'normal_pdf',
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['not_enough_scan_signals'],
    confidence: 'low',
    avgBytesPerPage,
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

function countStrongBinarySignals(
  bin: BinaryScanSignals | null | undefined
): number {
  if (!bin || bin.sampleBytes < 500) return 0;
  let n = 0;
  const mb = bin.sampleBytes / (1024 * 1024) || 1e-6;
  const cidPerMb = bin.cidTokenCount / mb;

  if (bin.imageSubtypeCount >= 10 && bin.tjOperatorCount < 40) n += 1;
  if (cidPerMb >= 400) n += 1;
  if (bin.textRenderMode3Hits >= 5) n += 1;
  if (bin.mcidOrBdcHits >= 12) n += 1;

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

/**
 * Whether POST /api/translate should return 409 scan_detected_use_ocr.
 */
export function decideScanIntercept(params: {
  mode: ScanBlockMode;
  preprocessWithOcr: boolean;
  metadata: ScanMetadataResult;
  binary: BinaryScanSignals | null;
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
    if (meta.decision === 'suspected_scan' && strong >= 2) {
      return {
        intercept: true,
        reasonCodes: [
          ...meta.reasonCodes,
          'block_mode_balanced_suspected_plus_binary',
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
