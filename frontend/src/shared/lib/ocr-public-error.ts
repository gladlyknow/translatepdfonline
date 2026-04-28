export function toPublicOcrErrorMessage(
  raw: string | null | undefined,
  fallback = 'OCR processing failed, please retry'
): string {
  const msg = (raw || '').trim();
  if (!msg) return fallback;
  const v = msg.toLowerCase();

  if (
    v.includes('connect timeout') ||
    v.includes('fetch failed') ||
    v.includes('socket') ||
    v.includes('econn') ||
    v.includes('network')
  ) {
    return 'Storage network timeout, check proxy/network and retry';
  }
  if (v.includes('timed out') || v.includes('timeout')) {
    return 'Request timed out, please retry';
  }
  if (v.includes('baidu') || v.includes('ocr')) {
    return 'AI OCR service temporarily unavailable, please retry';
  }
  if (v.includes('deepseek') || v.includes('translate')) {
    return 'Translation service temporarily unavailable, please retry';
  }
  if (v.includes('missing')) {
    return 'Required source is not ready yet, please retry';
  }
  return fallback;
}
