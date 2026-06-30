import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';

import { envConfigs } from '@/config';
import { locales } from '@/config/locale';
import { HomeFaqJsonLd } from '@/shared/blocks/seo/home-faq-json-ld';
import { SoftwareApplicationJsonLd } from '@/shared/blocks/seo/software-json-ld';
import { SeoCarouselSection } from '@/shared/blocks/seo/seo-carousel-section';
import DocumentCompareClient from '@/shared/blocks/document-compare';
import { Link } from '@/core/i18n/navigation';

export const dynamic = 'force-static';

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({
    locale,
    namespace: 'pages.contract-comparison',
  });
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/contract-comparison`
      : `${envConfigs.app_url}/${locale}/contract-comparison`;

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    keywords: t.has('keywords') ? t('keywords') : undefined,
    alternates: { canonical },
  };
}

export default async function ContractComparisonPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({
    locale,
    namespace: 'pages.contract-comparison',
  });

  const faqItems = (t.has('seoFaq.q1')
    ? [1, 2, 3, 4, 5, 6, 7, 8]
        .map((n) => {
          const q = t(`seoFaq.q${n}` as any);
          const a = t(`seoFaq.a${n}` as any);
          return q && a ? { question: q, answer: a } : null;
        })
        .filter(Boolean)
    : []) as { question: string; answer: string }[];

  const hasSeoContent = t.has('section1Title');
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/contract-comparison`
      : `${envConfigs.app_url}/${locale}/contract-comparison`;

  return (
    <>
      <HomeFaqJsonLd items={faqItems} />
      <SoftwareApplicationJsonLd
        name="Contract Comparison Tool"
        description="AI-powered contract comparison for CLM — compare PDF, Word, and scanned documents with page-level precision."
        url={canonical}
      />
      <div className="min-h-dvh w-full bg-background pt-16 lg:pt-20">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          {/* Hero */}
          <section className="text-center pb-6">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {t('metaTitle')}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground leading-relaxed sm:text-lg">
              {t('heroText')}
            </p>
          </section>

          {/* Compare Tool */}
          <section className="w-full px-4 pb-8">
            <DocumentCompareClient />
          </section>

          {/* SEO Content Sections — only rendered when translations exist (English locale) */}
          {hasSeoContent && (
            <>
              {/* SEO Insights Carousel — all content server-rendered for SEO, carousel for UX */}
              <SeoCarouselSection
                title={t('section1Title' as any)}
                variant="section"
                className="mt-10 border-t pt-8 px-4"
                items={[
                  <div key="s1">
                    <h3 className="text-base font-semibold text-foreground mb-4">{t('section1Title' as any)}</h3>
                    <div className="prose prose-neutral dark:prose-invert max-w-none text-sm leading-relaxed space-y-3">
                      <p>{t('section1P1' as any)}</p>
                      <p>{t('section1P2' as any)}</p>
                      <p>{t('section1P3' as any)}</p>
                    </div>
                  </div>,
                  <div key="s2">
                    <h3 className="text-base font-semibold text-foreground mb-4">{t('section2Title' as any)}</h3>
                    <div className="prose prose-neutral dark:prose-invert max-w-none text-sm leading-relaxed space-y-3">
                      <p>{t('section2P1' as any)}</p>
                      <p>{t('section2P2' as any)}</p>
                      <p>{t('section2P3' as any)}</p>
                    </div>
                  </div>,
                  <div key="s3">
                    <h3 className="text-base font-semibold text-foreground mb-4">{t('section3Title' as any)}</h3>
                    <div className="prose prose-neutral dark:prose-invert max-w-none text-sm leading-relaxed space-y-3">
                      <p>{t('section3P1' as any)}</p>
                      <p>{t('section3P2' as any)}</p>
                    </div>
                  </div>,
                  <div key="matrix" className="overflow-x-auto">
                    <h3 className="text-base font-semibold text-foreground mb-3">{t('decisionMatrixTitle' as any)}</h3>
                    <table className="w-full border-collapse text-xs">
                    <thead><tr className="border-b-2 border-border"><th className="text-left py-2 px-2 font-semibold text-foreground">Feature</th><th className="text-left py-2 px-2 font-semibold text-sky-700">{t('matrixHeaderOurTool' as any)}</th><th className="text-left py-2 px-2 font-semibold text-muted-foreground">{t('matrixHeaderTraditionalCLM' as any)}</th></tr></thead>
                    <tbody>{[1,2,3,4,5].map((n)=>(<tr key={n} className="border-b border-border/50"><td className="py-2 px-2 font-medium text-foreground">{t(`matrixRow${n}Feature` as any)}</td><td className="py-2 px-2 text-sky-700">{t(`matrixRow${n}Our` as any)}</td><td className="py-2 px-2 text-muted-foreground">{t(`matrixRow${n}Traditional` as any)}</td></tr>))}</tbody>
                    </table>
                  </div>,
                ]}
              />

              <section className="mx-auto max-w-5xl px-4 py-10 border-t">
                <h2 className="text-lg font-semibold text-center text-foreground mb-4">{t('relatedSearchesHeading' as any)}</h2>
                <div className="flex flex-wrap justify-center gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                    const key = `relatedSearch${n}` as any;
                    if (!t.has(key)) return null;
                    return (
                      <Link key={n} href="/contract-comparison"
                        className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors">
                        {t(key as any)}
                      </Link>
                    );
                  })}
                </div>
              </section>

              <section className="mx-auto max-w-5xl px-4 py-10 border-t text-center">
                <h3 className="text-base font-semibold text-foreground mb-4">{t('geoFooterHeading' as any)}</h3>
                <div className="space-y-2 text-xs text-muted-foreground leading-relaxed max-w-2xl mx-auto">
                  <p>{t('geoFooterP1' as any)}</p>
                  <p>{t('geoFooterP2' as any)}</p>
                  <p>{t('geoFooterP3' as any)}</p>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
