import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import Link from 'next/link';

import { envConfigs } from '@/config';
import { locales } from '@/config/locale';
import { buildAlternates } from '@/shared/lib/hreflang';
import { getPosts, getPostsCount, PostStatus, PostType } from '@/shared/models/post';

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.blog' });
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/blog`
      : `${envConfigs.app_url}/${locale}/blog`;

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: {
      canonical,
      languages: buildAlternates('/blog', locale).languages,
    },
  };
}

export default async function BlogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.blog' });

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const limit = 12;

  const [posts, total] = await Promise.all([
    getPosts({ type: PostType.ARTICLE, status: PostStatus.PUBLISHED, page, limit }),
    getPostsCount({ type: PostType.ARTICLE, status: PostStatus.PUBLISHED }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const heroTitle = t('heroTitle');
  const heroText = t('heroText');

  return (
    <div className="min-h-dvh w-full bg-background pt-14 lg:pt-18">
      {/* Hero */}
      <section className="text-center pb-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
          {heroTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground leading-relaxed sm:text-lg">
          {heroText}
        </p>
      </section>

      {/* Posts grid */}
      <section className="mx-auto w-full max-w-5xl mt-10 px-4">
        {posts.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-muted-foreground">{t('noPosts')}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <Link
                  key={post.id}
                  href={`/blog/${post.slug}`}
                  className="group rounded-2xl border-2 border bg-card overflow-hidden transition-shadow hover:shadow-md"
                >
                  {post.image ? (
                    <div className="aspect-video w-full overflow-hidden">
                      <img
                        src={post.image}
                        alt={post.title || ''}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    </div>
                  ) : null}
                  <div className="p-5">
                    {post.categories ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {post.categories.split(',').filter(Boolean).slice(0, 3).map((cat) => (
                          <span
                            key={cat}
                            className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                          >
                            {cat.trim()}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <h2 className="text-base font-semibold text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2">
                      {post.title}
                    </h2>
                    {post.description ? (
                      <p className="mt-2 text-sm text-muted-foreground leading-relaxed line-clamp-2">
                        {post.description}
                      </p>
                    ) : null}
                    <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                      {post.authorName ? (
                        <span>{post.authorName}</span>
                      ) : null}
                      {post.createdAt ? (
                        <span>{new Date(post.createdAt).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 ? (
              <div className="mt-10 flex items-center justify-center gap-4">
                {page > 1 ? (
                  <Link
                    href={`/blog?page=${page - 1}`}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    ← {t('previousPage')}
                  </Link>
                ) : (
                  <span className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground/40">
                    ← {t('previousPage')}
                  </span>
                )}
                <span className="text-sm text-muted-foreground">
                  {page} / {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={`/blog?page=${page + 1}`}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    {t('nextPage')} →
                  </Link>
                ) : (
                  <span className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground/40">
                    {t('nextPage')} →
                  </span>
                )}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
