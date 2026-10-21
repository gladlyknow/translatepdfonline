export type SeoLocalePolicy = 'all' | 'default-only';

export const canonicalSiteOrigin = 'https://translatepdfonline.com';

export function isCanonicalSiteHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  return (
    normalized === 'translatepdfonline.com' ||
    normalized === 'www.translatepdfonline.com'
  );
}

export function isCanonicalSiteUrl(value: string): boolean {
  try {
    return isCanonicalSiteHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export interface IndexableRoute {
  path: string;
  localePolicy: SeoLocalePolicy;
  locales?: readonly string[];
}

export const currentPricingLocales = [
  'en',
  'zh',
  'el',
  'fr',
  'it',
  'ja',
  'ko',
] as const;

/**
 * Canonical, indexable landing routes. Navigation, Sitemap and future SEO
 * contracts should consume this registry instead of maintaining separate
 * copies of the public route list.
 */
export const indexableLandingRoutes: readonly IndexableRoute[] = [
  { path: '/', localePolicy: 'all' },
  { path: '/pdf-to-text', localePolicy: 'all' },
  { path: '/image-to-text', localePolicy: 'all' },
  { path: '/jpg-to-word', localePolicy: 'all' },
  { path: '/photo-to-word', localePolicy: 'all' },
  { path: '/pdf-to-word-doc', localePolicy: 'all' },
  { path: '/pdf-to-excel', localePolicy: 'all' },
  { path: '/pdf-to-md', localePolicy: 'all' },
  { path: '/ocrtranslator', localePolicy: 'all' },
  { path: '/contract-comparison', localePolicy: 'all' },
  {
    path: '/pricing',
    localePolicy: 'all',
    locales: currentPricingLocales,
  },
  { path: '/blog', localePolicy: 'default-only' },
  { path: '/docs', localePolicy: 'all' },
  { path: '/docs/api', localePolicy: 'default-only' },
] as const;

export const indexableDocsSubPaths = [
  'pdf-to-text',
  'image-to-text',
  'contract-comparison',
  'ocr-workbench',
  'upload',
] as const;
