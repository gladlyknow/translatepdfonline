import type { MetadataRoute } from 'next';

import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';

/**
 * 动态站点地图：`/sitemap.xml`（Next MetadataRoute）。
 * 与 `robots.ts` 中的 `sitemap` 字段指向同一 URL；各语言前缀与 `config/locale` 一致。
 */
/** 面向搜索引擎的公开路径（与 robots 允许范围一致） */
const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/upload',
  '/ocrtranslator',
  '/docs',
  '/blog',
  '/updates',
  '/showcases',
  '/privacy-policy',
  '/terms-of-service',
] as const;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '') || url;
}

function pathForLocale(pathname: string, locale: string): string {
  if (pathname === '/') {
    return locale === defaultLocale ? '/' : `/${locale}`;
  }
  return locale === defaultLocale ? pathname : `/${locale}${pathname}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = stripTrailingSlash(envConfigs.app_url || 'http://localhost:3000');
  const entries: MetadataRoute.Sitemap = [];

  for (const path of PUBLIC_PATHS) {
    for (const locale of locales) {
      const p = pathForLocale(path, locale);
      const url = `${base}${p === '/' ? '/' : p}`;
      entries.push({
        url,
        changeFrequency: path === '/' ? 'daily' : 'weekly',
        priority: path === '/' ? 1 : 0.85,
      });
    }
  }

  return entries;
}
