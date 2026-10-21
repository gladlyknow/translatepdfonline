export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

export function pathForLocale(
  pathname: string,
  locale: string,
  defaultLocale: string
): string {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return locale === defaultLocale ? '/' : `/${locale}`;
  }
  return locale === defaultLocale
    ? normalizedPath
    : `/${locale}${normalizedPath}`;
}

export function buildHreflangLinks({
  base,
  pathname,
  locales,
  defaultLocale,
}: {
  base: string;
  pathname: string;
  locales: readonly string[];
  defaultLocale: string;
}): string {
  const lines = locales.map((locale) => {
    const href = `${base}${pathForLocale(pathname, locale, defaultLocale)}`;
    return `    <xhtml:link rel="alternate" hreflang="${escapeXml(locale)}" href="${escapeXml(href)}"/>`;
  });
  const xDefault = `${base}${pathForLocale(pathname, defaultLocale, defaultLocale)}`;
  lines.push(
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(xDefault)}"/>`
  );
  return `${lines.join('\n')}\n`;
}

export function buildSitemapUrlEntry({
  base,
  pathname,
  locale,
  alternateLocales,
  defaultLocale,
  lastmod,
}: {
  base: string;
  pathname: string;
  locale: string;
  alternateLocales: readonly string[];
  defaultLocale: string;
  lastmod?: string;
}): string {
  const loc = `${base}${pathForLocale(pathname, locale, defaultLocale)}`;
  const lastmodLine = lastmod
    ? `    <lastmod>${escapeXml(lastmod)}</lastmod>\n`
    : '';
  return (
    `  <url>\n` +
    `    <loc>${escapeXml(loc)}</loc>\n` +
    lastmodLine +
    buildHreflangLinks({
      base,
      pathname,
      locales: alternateLocales,
      defaultLocale,
    }) +
    `  </url>\n`
  );
}

export function wrapSitemap(entries: readonly string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
    `xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    entries.join('') +
    `</urlset>\n`
  );
}
