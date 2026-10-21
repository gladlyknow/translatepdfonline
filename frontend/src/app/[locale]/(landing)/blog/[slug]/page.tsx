import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { defaultLocale } from '@/config/locale';
import { MarkdownContent } from '@/shared/blocks/common/markdown-content';
import { buildAlternates } from '@/shared/lib/hreflang';
import { findPost, PostStatus } from '@/shared/models/post';

export const revalidate = 3600;

function getPostImage(post: {
  image?: string | null;
  content?: string | null;
}) {
  if (post.image) return post.image;
  return post.content?.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/)?.[1];
}

function removeDuplicateMarkdownTitle(content: string) {
  return content.replace(/^\s*#\s+[^\n]+\r?\n+/, '');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  // 文章仅有默认语言版本；非默认 locale 的 /blog/<slug> 一律 404，
  // 避免「语言声明 ≠ 内容语言」被 Google 判为重复内容/软 404
  if (locale !== defaultLocale) {
    notFound();
  }

  const post = await findPost({
    slug: slug as string,
    status: PostStatus.PUBLISHED,
  });
  if (!post) {
    return { title: 'Not Found' };
  }

  // 文章仅有默认语言版本：canonical + hreflang 均只含默认 locale（与 sitemap 一致）
  const { canonical } = buildAlternates(`/blog/${slug}`, locale);
  const image = getPostImage(post);

  return {
    title: post.title || 'Blog Post',
    description: post.description || undefined,
    openGraph: {
      type: 'article',
      url: canonical,
      title: post.title || 'Blog Post',
      description: post.description || undefined,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title || 'Blog Post',
      description: post.description || undefined,
      images: image ? [image] : undefined,
    },
    alternates: {
      canonical,
      languages: { en: canonical, 'x-default': canonical },
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

  if (locale !== defaultLocale) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: 'pages.blog' });
  const post = await findPost({
    slug: slug as string,
    status: PostStatus.PUBLISHED,
  });

  if (!post) {
    return notFound();
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    image: getPostImage(post),
    datePublished: post.createdAt
      ? new Date(post.createdAt).toISOString()
      : undefined,
    dateModified: post.updatedAt
      ? new Date(post.updatedAt).toISOString()
      : undefined,
    author: post.authorName
      ? {
          '@type': 'Organization',
          name: post.authorName,
          url: 'https://translatepdfonline.com',
        }
      : undefined,
    publisher: {
      '@type': 'Organization',
      name: 'TranslatePDFOnline',
      url: 'https://translatepdfonline.com',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://translatepdfonline.com/blog/${slug}`,
    },
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
      <div className="bg-background min-h-dvh w-full pt-14 lg:pt-18">
        <article className="mx-auto w-full max-w-4xl px-6 py-16 md:px-8 md:py-24">
          {/* Back link */}
          <Link
            href="/blog"
            className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            {t('backToBlog')}
          </Link>

          {/* Title */}
          <h1 className="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">
            {post.title}
          </h1>

          {/* Meta */}
          <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-3 text-sm">
            {post.authorName ? (
              <span>
                {t('by')} {post.authorName}
              </span>
            ) : null}
            {formattedDate ? (
              <span>
                {t('publishedOn')} {formattedDate}
              </span>
            ) : null}
          </div>

          {/* Categories */}
          {post.categories ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {post.categories
                .split(',')
                .filter(Boolean)
                .map((cat: string) => (
                  <span
                    key={cat}
                    className="border-border bg-muted text-muted-foreground inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium"
                  >
                    {cat.trim()}
                  </span>
                ))}
            </div>
          ) : null}

          {/* Cover image */}
          {post.image ? (
            <div className="border-border mt-8 overflow-hidden rounded-2xl border">
              <img
                src={post.image}
                alt={post.title || ''}
                className="w-full object-cover"
              />
            </div>
          ) : null}

          {/* Content */}
          {post.content ? (
            <div className="border-border bg-card mt-10 rounded-2xl border p-6 md:p-10">
              <div className="prose prose-neutral dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-a:text-primary prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-muted max-w-none">
                <MarkdownContent
                  content={removeDuplicateMarkdownTitle(post.content)}
                />
              </div>
            </div>
          ) : null}

          {/* Back link bottom */}
          <div className="mt-12 border-t pt-8">
            <Link
              href="/blog"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
            >
              {t('backToBlog')}
            </Link>
          </div>
        </article>
      </div>
    </>
  );
}
