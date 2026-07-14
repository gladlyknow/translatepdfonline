import { defaultLocale, locales } from '@/config/locale';

/** 面向搜索引擎的公开路径（与 robots 允许范围一致） */
const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/ocrtranslator',
  '/pdf-to-text',
  '/image-to-text',
  '/docs',
  '/contract-comparison',
  '/privacy-policy',
  '/terms-of-service',
] as const;

function pathForLocale(pathname: string, locale: string): string {
  if (pathname === '/') {
    return locale === defaultLocale ? '/' : `/${locale}`;
  }
  return locale === defaultLocale ? pathname : `/${locale}${pathname}`;
}

function buildSitemapXml(base: string): string {
  const urls: string[] = [];

  for (const path of PUBLIC_PATHS) {
    for (const locale of locales) {
      const p = pathForLocale(path, locale);
      const loc = `${base}${p === '/' ? '/' : p}`;
      const changefreq = path === '/' ? 'daily' : 'weekly';
      const priority = path === '/' ? '1.0' : '0.85';
      urls.push(
        `  <url>\n` +
        `    <loc>${loc}</loc>\n` +
        `    <changefreq>${changefreq}</changefreq>\n` +
        `    <priority>${priority}</priority>\n` +
        `  </url>`
      );
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join('\n') +
    `\n</urlset>\n`
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = url.host;
  const protocol = host.startsWith('localhost') || host.includes(':') ? 'http' : 'https';
  const base = `${protocol}://${host}`;

  return new Response(buildSitemapXml(base), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}

export const dynamic = 'force-dynamic';
