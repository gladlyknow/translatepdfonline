import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import createIntlMiddleware from 'next-intl/middleware';

import { routing } from '@/core/i18n/config';
import { isCloudflareWorker } from '@/shared/lib/env';

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  // Cloudflare Workers：将 Dashboard 的 Variables/Secrets 合并进 process.env，使全站只生效控制台配置
  if (isCloudflareWorker) {
    try {
      const ctx = getCloudflareContext() as unknown as { env?: Record<string, unknown> };
      const env = ctx?.env;
      if (env && typeof env === 'object') {
        for (const [k, v] of Object.entries(env)) {
          if (k && v != null && typeof v === 'string') {
            process.env[k] = v;
          }
        }
      }
    } catch {
      // 非 Worker 或未注入时忽略
    }
  }

  const { pathname } = request.nextUrl;

  // API 路由仅做 env 合并，不经过 intl/auth；开发环境打印请求日志
  // 生产环境确保 API 响应不被 CDN 缓存
  if (pathname.startsWith('/api')) {
    if (process.env.NODE_ENV === 'development') {
      const method = request.method;
      console.log(`${method} ${pathname}`);
    }
    const apiResponse = NextResponse.next();
    apiResponse.headers.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
    apiResponse.headers.set('CDN-Cache-Control', 'no-store');
    apiResponse.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    return apiResponse;
  }

  // 已删除的历史路径（旧版 landing 页）一律返回 410 Gone。
  // 否则 next-intl 会重定向到字面量 `/:locale*`（→404）或 locale 首页（Google 判软 404）
  const segments = pathname.split('/').filter(Boolean);
  const headPath =
    segments.length > 0 && routing.locales.includes(segments[0])
      ? segments[1]
      : segments[0];
  if (headPath === 'showcases' || headPath === 'updates') {
    return new NextResponse(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>410 Gone</title></head><body><h1>410 Gone</h1><p>This page has been permanently removed.</p></body></html>',
      { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // Handle internationalization first
  const intlResponse = intlMiddleware(request);

  // Extract locale from pathname
  const locale = pathname.split('/')[1];
  const isValidLocale = routing.locales.includes(locale as any);
  const pathWithoutLocale = isValidLocale
    ? pathname.slice(locale.length + 1)
    : pathname;

  // Only check authentication for admin routes
  if (
    pathWithoutLocale.startsWith('/admin') ||
    pathWithoutLocale.startsWith('/settings') ||
    pathWithoutLocale.startsWith('/activity')
  ) {
    // Check if session cookie exists
    const sessionCookie = getSessionCookie(request);

    // 搜索引擎爬虫访问 settings/activity 时放行渲染（页面输出 200 + noindex meta），
    // 使 Google 能读到期 noindex 标签并移出历史收录；普通用户仍 302 到 sign-in。
    const userAgent = request.headers.get('user-agent') ?? '';
    const isSearchCrawler =
      /Googlebot|Bingbot|AdsBot-Google|DuckDuckBot|YandexBot|Baiduspider/i.test(
        userAgent
      );
    const allowCrawlerThrough =
      isSearchCrawler &&
      (pathWithoutLocale.startsWith('/settings') ||
        pathWithoutLocale.startsWith('/activity'));

    // If no session token found, redirect to sign-in
    if (!sessionCookie && !allowCrawlerThrough) {
      const signInUrl = new URL(
        isValidLocale ? `/${locale}/sign-in` : '/sign-in',
        request.url
      );
      // Add the current path (including search params) as callback - use relative path for multi-language support
      const callbackPath = pathWithoutLocale + request.nextUrl.search;
      signInUrl.searchParams.set('callbackUrl', callbackPath);
      return NextResponse.redirect(signInUrl);
    }

    // For admin routes, we need to check RBAC permissions
    // Note: Full permission check happens in the page/API route level
    // This is a lightweight session check to prevent unauthorized access
    // The detailed permission check (admin.access and specific permissions)
    // will be done in the layout or individual pages using requirePermission()
  }

  intlResponse.headers.set('x-pathname', request.nextUrl.pathname);
  intlResponse.headers.set('x-url', request.url);

  // Remove Set-Cookie from public pages to allow caching
  // We exclude admin, settings, activity, and auth pages from this behavior
  // Preserve NEXT_LOCALE cookie so locale detection works across page navigations
  if (
    !pathWithoutLocale.startsWith('/admin') &&
    !pathWithoutLocale.startsWith('/settings') &&
    !pathWithoutLocale.startsWith('/activity') &&
    !pathWithoutLocale.startsWith('/sign-') &&
    !pathWithoutLocale.startsWith('/auth')
  ) {
    const setCookieHeaders = intlResponse.headers.getSetCookie();
    intlResponse.headers.delete('Set-Cookie');
    for (const cookie of setCookieHeaders) {
      if (cookie.startsWith('NEXT_LOCALE=')) {
        intlResponse.headers.append('Set-Cookie', cookie);
      }
    }

    // Cache-Control header for public pages
    // Landing page (root) ISR 1h, CDN 24h; other public pages: CDN 24h
    const isRoot =
      pathWithoutLocale === '' || pathWithoutLocale === '/';
    const cacheControl = isRoot
      ? 'public, s-maxage=86400, stale-while-revalidate=86400, stale-if-error=86400'
      : 'public, s-maxage=86400, stale-while-revalidate=14400, stale-if-error=86400';

    intlResponse.headers.set('Cache-Control', cacheControl);
    intlResponse.headers.set('CDN-Cache-Control', cacheControl);
    intlResponse.headers.set('Cloudflare-CDN-Cache-Control', cacheControl);
  }

  // For all other routes (including /, /sign-in, /sign-up, /sign-out), just return the intl response
  return intlResponse;
}

export const config = {
  // 包含 /api 以便 Cloudflare env 在 API 路由中生效
  // 排除静态资源目录，减少中间件开销
  matcher: [
    '/((?!_next|_vercel|trpc|imgs|brand|fonts|favicon|.*\\..*).*)',
  ],
};
