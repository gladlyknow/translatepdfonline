import { envConfigs } from '@/config';

/** Prevent `</script>`-style breaks inside inline JSON-LD. */
function safeJsonLdStringify(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

/** 与 canonical/hreflang/sitemap 保持同一域名（统一为 apex），避免结构化数据域名冲突。 */
const siteUrl = (envConfigs.app_url || '').replace(/\/$/, '');

export function OrganizationJsonLd() {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'TranslatePDFOnline',
    url: siteUrl,
    logo: `${siteUrl}/brand/logo.webp`,
    description:
      'Free online PDF translation service that preserves original document layout.',
    sameAs: [siteUrl],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: safeJsonLdStringify(payload),
      }}
    />
  );
}

export function WebSiteJsonLd() {
  // 注意：不输出 SearchAction —— 站点不存在 /search 页面，指向 404 的
  // 结构化数据会被 GSC 判为错误（曾列入问题清单）
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'TranslatePDFOnline',
    url: siteUrl,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: safeJsonLdStringify(payload),
      }}
    />
  );
}
