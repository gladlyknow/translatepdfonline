import { defaultLocale, locales } from '@/config/locale';

/** 面向搜索引擎的公开路径（与 robots 允许范围一致） */
const PUBLIC_PATHS: { path: string; priority: string; changefreq: string }[] = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  // 核心工具页
  { path: '/pdf-to-text', priority: '0.9', changefreq: 'weekly' },
  { path: '/image-to-text', priority: '0.9', changefreq: 'weekly' },
  { path: '/jpg-to-word', priority: '0.9', changefreq: 'weekly' },
  { path: '/photo-to-word', priority: '0.9', changefreq: 'weekly' },
  { path: '/pdf-to-word-doc', priority: '0.9', changefreq: 'weekly' },
  { path: '/pdf-to-excel', priority: '0.9', changefreq: 'weekly' },
  { path: '/ocrtranslator', priority: '0.9', changefreq: 'weekly' },
  { path: '/contract-comparison', priority: '0.9', changefreq: 'weekly' },
  // 次级内容页
  { path: '/pricing', priority: '0.8', changefreq: 'weekly' },
  { path: '/blog', priority: '0.8', changefreq: 'daily' },
  { path: '/docs', priority: '0.8', changefreq: 'weekly' },
  { path: '/docs/api', priority: '0.8', changefreq: 'weekly' },
  // 法务页
  { path: '/privacy-policy', priority: '0.5', changefreq: 'monthly' },
  { path: '/terms-of-service', priority: '0.5', changefreq: 'monthly' },
];

function pathForLocale(pathname: string, locale: string): string {
  if (pathname === '/') {
    return locale === defaultLocale ? '/' : `/${locale}`;
  }
  return locale === defaultLocale ? pathname : `/${locale}${pathname}`;
}

function buildSitemapXml(base: string): string {
  const urls: string[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (const entry of PUBLIC_PATHS) {
    for (const locale of locales) {
      const p = pathForLocale(entry.path, locale);
      const loc = `${base}${p === '/' ? '/' : p}`;
      urls.push(
        `  <url>\n` +
        `    <loc>${loc}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${entry.changefreq}</changefreq>\n` +
        `    <priority>${entry.priority}</priority>\n` +
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
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const revalidate = 3600;
