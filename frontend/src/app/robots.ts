import type { MetadataRoute } from 'next';

import { envConfigs } from '@/config';

/**
 * 生产环境请在 Worker / 构建变量中设置 NEXT_PUBLIC_APP_URL 为规范域名（如 https://translatepdfonline.com），
 * 以便 Sitemap 与 robots 中的绝对地址正确。
 *
 * Google Search Console、Bing Webmaster Tools：提交 `https://<您的域名>/sitemap.xml`（由 `app/sitemap.ts` 动态生成）。
 * 勿在 `public/` 放置静态 `sitemap.xml`，以免覆盖动态站点地图。
 *
 * Google、Bing 均遵循 robots.txt；以下对 * / Googlebot / Bingbot 使用相同规则，避免歧义。
 */
const DISALLOW = [
  '/api/',
  '/admin/',
  '/settings/',
  '/activity/',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/no-permission',
  '/chat',
  '/chat/',
];

function rule(userAgent: string | string[]) {
  return {
    userAgent,
    allow: '/',
    disallow: [...DISALLOW],
  } satisfies {
    userAgent: string | string[];
    allow: string;
    disallow: string[];
  };
}

export default function robots(): MetadataRoute.Robots {
  const base = envConfigs.app_url.replace(/\/+$/, '');
  const sitemapUrl = `${base}/sitemap.xml`;

  return {
    rules: [
      rule('*'),
      rule('Googlebot'),
      rule('Googlebot-Image'),
      rule('Bingbot'),
    ],
    sitemap: sitemapUrl,
  };
}
