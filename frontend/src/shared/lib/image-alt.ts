const GENERIC_IMAGE_ALTS = new Set(['benefits', 'introduce', 'usage']);

export function resolveImageAlt(alt?: string, fallback?: string): string {
  const normalizedAlt = alt?.trim();

  if (normalizedAlt && !GENERIC_IMAGE_ALTS.has(normalizedAlt.toLowerCase())) {
    return normalizedAlt;
  }

  return fallback?.trim() ?? '';
}
