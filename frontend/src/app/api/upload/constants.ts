/**
 * Shared upload validation constants for presigned and complete routes.
 */
export const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
export const ALLOWED_CONTENT_TYPE = 'application/pdf';

/** Object key we generate: uploads/<nanoid(16)>.pdf */
export const UPLOAD_KEY_PREFIX = 'uploads/';
export const UPLOAD_KEY_SUFFIX = '.pdf';
/** Nanoid(16) is alphanumeric + _ - */
export const UPLOAD_KEY_REGEX = /^uploads\/[A-Za-z0-9_-]{16}\.pdf$/;

export function isValidObjectKey(key: string): boolean {
  return typeof key === 'string' && key.length <= 64 && UPLOAD_KEY_REGEX.test(key.trim());
}

/** Sanitize filename for DB display: max length, no path. */
export function sanitizeFilename(name: string, maxLen = 255): string {
  const base = typeof name === 'string' ? name.trim() : 'document.pdf';
  const basename = base.includes('/') ? base.replace(/^.*\//, '') : base;
  const safe = basename.replace(/[^\w\s.-]/gi, '_');
  return safe.length > maxLen ? safe.slice(0, maxLen) : safe;
}
