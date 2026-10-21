import { defaultLocale, locales } from '@/config/locale';
import {
  canonicalSiteOrigin,
  indexableDocsSubPaths,
  indexableLandingRoutes,
} from '@/config/seo-routes';
import { buildSitemapUrlEntry, wrapSitemap } from '@/shared/lib/sitemap';
import { getPosts, PostStatus, PostType } from '@/shared/models/post';

async function getPublishedBlogPosts(): Promise<
  { slug: string; lastmod: string }[]
> {
  try {
    const posts = await getPosts({
      type: PostType.ARTICLE,
      status: PostStatus.PUBLISHED,
      limit: 100,
    });
    return posts.map((post) => ({
      slug: post.slug,
      lastmod: (post.updatedAt || post.createdAt).toISOString().slice(0, 10),
    }));
  } catch {
    return [];
  }
}

export async function buildSitemapXml(base: string): Promise<string> {
  const entries: string[] = [];

  for (const route of indexableLandingRoutes) {
    const routeLocales =
      route.locales ||
      (route.localePolicy === 'default-only' ? [defaultLocale] : locales);
    for (const locale of routeLocales) {
      entries.push(
        buildSitemapUrlEntry({
          base,
          pathname: route.path,
          locale,
          alternateLocales: routeLocales,
          defaultLocale,
        })
      );
    }
  }

  for (const subPath of indexableDocsSubPaths) {
    for (const locale of locales) {
      entries.push(
        buildSitemapUrlEntry({
          base,
          pathname: `/docs/${subPath}`,
          locale,
          alternateLocales: locales,
          defaultLocale,
        })
      );
    }
  }

  const blogPosts = await getPublishedBlogPosts();
  for (const post of blogPosts) {
    entries.push(
      buildSitemapUrlEntry({
        base,
        pathname: `/blog/${post.slug}`,
        locale: defaultLocale,
        alternateLocales: [defaultLocale],
        defaultLocale,
        lastmod: post.lastmod,
      })
    );
  }

  return wrapSitemap(entries);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = url.host;
  const isLocal = host.startsWith('localhost') || host.includes(':');
  const base = isLocal ? `${url.protocol}//${host}` : canonicalSiteOrigin;

  return new Response(await buildSitemapXml(base), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const revalidate = 3600;
