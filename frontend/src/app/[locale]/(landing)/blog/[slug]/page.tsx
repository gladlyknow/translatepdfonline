import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import Link from 'next/link';

import { envConfigs } from '@/config';
import { findPost, PostStatus } from '@/shared/models/post';
import { MarkdownContent } from '@/shared/blocks/common/markdown-content';

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const post = await findPost({ slug: slug as string, status: PostStatus.PUBLISHED });
  if (!post) {
    return { title: 'Not Found' };
  }

  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/blog/${slug}`
      : `${envConfigs.app_url}/${locale}/blog/${slug}`;

  return {
    title: post.title || 'Blog Post',
    description: post.description || undefined,
    openGraph: post.image
      ? { images: [{ url: post.image }] }
      : undefined,
    alternates: {
      canonical,
    },
    robots: { index: true, follow: true },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'pages.blog' });
  const post = await findPost({ slug: slug as string, status: PostStatus.PUBLISHED });

  if (!post) {
    return notFound();
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    image: post.image || undefined,
    datePublished: post.createdAt ? new Date(post.createdAt).toISOString() : undefined,
    dateModified: post.updatedAt ? new Date(post.updatedAt).toISOString() : undefined,
    author: post.authorName
      ? { '@type': 'Person', name: post.authorName }
      : undefined,
  };

  const formattedDate = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-dvh w-full bg-background pt-14 lg:pt-18">
        <article className="mx-auto w-full max-w-4xl px-6 md:px-8 py-16 md:py-24">
          {/* Back link */}
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            {t('backToBlog')}
          </Link>

          {/* Title */}
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {post.title}
          </h1>

          {/* Meta */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {post.authorName ? (
              <span>{t('by')} {post.authorName}</span>
            ) : null}
            {formattedDate ? (
              <span>{t('publishedOn')} {formattedDate}</span>
            ) : null}
          </div>

          {/* Categories */}
          {post.categories ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {post.categories.split(',').filter(Boolean).map((cat: string) => (
                <span
                  key={cat}
                  className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {cat.trim()}
                </span>
              ))}
            </div>
          ) : null}

          {/* Cover image */}
          {post.image ? (
            <div className="mt-8 overflow-hidden rounded-2xl border border-border">
              <img
                src={post.image}
                alt={post.title || ''}
                className="w-full object-cover"
              />
            </div>
          ) : null}

          {/* Content */}
          {post.content ? (
            <div className="mt-10 rounded-2xl border border-border bg-card p-6 md:p-10">
              <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-a:text-primary prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-muted">
                <MarkdownContent content={post.content} />
              </div>
            </div>
          ) : null}

          {/* Back link bottom */}
          <div className="mt-12 border-t pt-8">
            <Link
              href="/blog"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('backToBlog')}
            </Link>
          </div>
        </article>
      </div>
    </>
  );
}
