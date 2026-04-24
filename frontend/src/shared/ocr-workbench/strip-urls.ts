const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;

/** Remove http(s) URLs from a string (export constraint). */
export function stripUrlsFromText(s: string): string {
  return s.replace(URL_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/** True if string contains a URL substring. */
export function containsHttpUrl(s: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(s);
}
