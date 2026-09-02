import { defaultLocale, locales } from '@/config/locale';
import { getPosts, PostStatus, PostType } from '@/shared/models/post';

/**
 * 静态页 lastmod 基线：固定为内容发布/大改日期，避免「每天滚动」的假新鲜度信号。
 * 站点内容有实质更新时手动推进此日期。
 */
const STATIC_LASTMOD = '2026-08-24';

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
  { path: '/pdf-to-md', priority: '0.9', changefreq: 'weekly' },
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

/** docs 站点子文档（content/docs/*.mdx，index 即 /docs 本身，不重复列出） */
const DOCS_SUB_PATHS = [
  'pdf-to-text',
  'image-to-text',
  'contract-comparison',
  'ocr-workbench',
  'upload',
];

function pathForLocale(pathname: string, locale: string): string {
  if (pathname === '/') {
    return locale === defaultLocale ? '/' : `/${locale}`;
  }
  return locale === defaultLocale ? pathname : `/${locale}${pathname}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成某个 path 在指定 locale 集合下的 hreflang 条目（默认 10 locale + x-default）。
 * href 与 <loc> 同源（均基于 base），保证 sitemap 内部一致性。
 */
function buildHreflangLinks(
  base: string,
  pathname: string,
  hreflangLocales: string[] = locales
): string {
  const lines: string[] = [];
  for (const locale of hreflangLocales) {
    const href = `${base}${pathForLocale(pathname, locale)}`;
    lines.push(
      `    <xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(href)}"/>`
    );
  }
  const xDefault = `${base}${pathForLocale(pathname, defaultLocale)}`;
  lines.push(
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(xDefault)}"/>`
  );
  return lines.join('\n') + '\n';
}

function buildUrlEntry(
  base: string,
  pathname: string,
  lastmod: string,
  changefreq: string,
  priority: string,
  hreflangLocales: string[] = locales
): string {
  const loc = `${base}${pathname}`;
  return (
    `  <url>\n` +
    `    <loc>${escapeXml(loc)}</loc>\n` +
    `    <lastmod>${lastmod}</lastmod>\n` +
    `    <changefreq>${changefreq}</changefreq>\n` +
    `    <priority>${priority}</priority>\n` +
    buildHreflangLinks(base, pathname, hreflangLocales) +
    `  </url>\n`
  );
}

/** 从数据库取已发布文章；DB 不可用（构建期/连接失败）时降级为空数组。 */
async function getPublishedBlogPosts(): Promise<{ slug: string; lastmod: string }[]> {
  try {
    const posts = await getPosts({
      type: PostType.ARTICLE,
      status: PostStatus.PUBLISHED,
      limit: 100,
    });
    return posts.map((p) => ({
      slug: p.slug,
      lastmod: (p.updatedAt || p.createdAt).toISOString().slice(0, 10),
    }));
  } catch {
    return [];
  }
}

async function buildSitemapXml(base: string): Promise<string> {
  const urls: string[] = [];

  // 1. 静态公开路径 × 10 locale
  for (const entry of PUBLIC_PATHS) {
    for (const locale of locales) {
      urls.push(
        buildUrlEntry(
          base,
          pathForLocale(entry.path, locale),
          STATIC_LASTMOD,
          entry.changefreq,
          entry.priority
        )
      );
    }
  }

  // 2. docs 子文档 × 10 locale
  for (const sub of DOCS_SUB_PATHS) {
    for (const locale of locales) {
      urls.push(
        buildUrlEntry(
          base,
          pathForLocale(`/docs/${sub}`, locale),
          STATIC_LASTMOD,
          'weekly',
          '0.7'
        )
      );
    }
  }

  // 3. blog 已发布文章：仅默认 locale（文章无多语言版本，非默认 locale 的
  //    /blog/<slug> 由页面返回 404；hreflang 仅含默认 locale + x-default）
  const blogPosts = await getPublishedBlogPosts();
  for (const post of blogPosts) {
    urls.push(
      buildUrlEntry(
        base,
        pathForLocale(`/blog/${post.slug}`, defaultLocale),
        post.lastmod,
        'monthly',
        '0.6',
        [defaultLocale]
      )
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
    `xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    urls.join('') +
    `</urlset>\n`
  );
}

/** sitemap 规范域名：与页面 canonical（envConfigs.app_url）保持一致，不受请求 Host 影响 */
const SITE_BASE = 'https://translatepdfonline.com';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = url.host;
  // 本地开发保留请求 Host（便于本地预览）；生产一律输出规范 apex 域名
  const isLocal = host.startsWith('localhost') || host.includes(':');
  const base = isLocal ? `${url.protocol}//${host}` : SITE_BASE;

  return new Response(await buildSitemapXml(base), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const revalidate = 3600;
