import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';

import { envConfigs } from '@/config';
import { locales } from '@/config/locale';
import { HomeFaqJsonLd } from '@/shared/blocks/seo/home-faq-json-ld';
import { ExploreMoreLinks } from '@/shared/blocks/explore-more-links';
import { buildAlternates } from '@/shared/lib/hreflang';

import { PdfToWordClient } from './PdfToWordClient';

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
  const t = await getTranslations({ locale, namespace: 'pages.pdf-to-word-doc' });
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/pdf-to-word-doc`
      : `${envConfigs.app_url}/${locale}/pdf-to-word-doc`;

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    keywords: t('keywords') || undefined,
    alternates: {
      canonical,
      languages: buildAlternates('/pdf-to-word-doc', locale).languages,
    },
  };
}

export default async function PdfToWordDocPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.pdf-to-word-doc' });

  const heroTitle = t('heroTitle');
  const heroText = t('heroText');
  const geoDescription = t('geoDescription');
  const features = [1, 2, 3]
    .map((n) => t(`seoFeature${n}` as any))
    .filter((f: string) => f);
  const howItWorksTitle = t('howItWorks');
  const whyHeading = t('whyHeading');
  const exploreHeading = t('exploreMoreHeading');

  const faqItems = [1, 2, 3, 4, 5]
    .map((n) => {
      const q = t(`seoFaq.q${n}` as any);
      const a = t(`seoFaq.a${n}` as any);
      return q && a ? { question: q, answer: a } : null;
    })
    .filter(Boolean) as { question: string; answer: string }[];

  const whyItems = [1, 2, 3]
    .map((n) => ({
      title: t(`why${n}Title` as any),
      desc: t(`why${n}Desc` as any),
    }))
    .filter((w) => w.title);

  // Split heroTitle on  " — " or  " | " for two-line display
  const titleParts = heroTitle.split(/ (?:—|\|) /);
  const mainTitle = titleParts[0] || heroTitle;
  const subTitle = titleParts.slice(1).join(' — ');

  return (
    <>
      <HomeFaqJsonLd items={faqItems} />
      <div className="min-h-dvh w-full bg-background pt-14 lg:pt-18">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          {/* Hero + Upload Area */}
          <PdfToWordClient>
            <section className="text-center pb-2 pt-4 sm:pt-8">
              <h1 className="mx-auto max-w-4xl text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
                {mainTitle}
              </h1>
              {subTitle ? (
                <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
                  {subTitle}
                </p>
              ) : null}
              <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground leading-relaxed sm:text-base">
                {heroText}
              </p>
              {geoDescription ? (
                <p className="mx-auto mt-2 max-w-2xl text-xs text-muted-foreground/60 leading-relaxed">
                  {geoDescription}
                </p>
              ) : null}
              {features.length > 0 ? (
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  {features.map((f: string) => (
                    <span
                      key={f}
                      className="inline-flex items-center rounded-full border border-border bg-muted px-4 py-1.5 text-sm font-medium text-foreground"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          </PdfToWordClient>
        </div>

        {/* How It Works — no production images yet; clean numbered steps */}
        <section className="mx-auto w-full max-w-5xl mt-16 px-4">
          <h2 className="text-2xl font-bold text-center mb-8 text-foreground">
            {howItWorksTitle}
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { step: '1', title: t('howStep1Title'), desc: t('howStep1Desc') },
              { step: '2', title: t('howStep2Title'), desc: t('howStep2Desc') },
              { step: '3', title: t('howStep3Title'), desc: t('howStep3Desc') },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-2xl border-2 border bg-card p-6 text-center"
              >
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold">
                  {s.step}
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">
                  {s.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Why */}
        {whyItems.length > 0 ? (
          <section className="mx-auto w-full max-w-5xl mt-16 px-4">
            <h2 className="text-2xl font-bold text-center mb-8 text-foreground">
              {whyHeading}
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              {whyItems.map((w, i) => (
                <div
                  key={i}
                  className="rounded-2xl border-2 border bg-card p-6 text-center"
                >
                  <h3 className="text-base font-semibold text-foreground mb-2">
                    {w.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {w.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* FAQ */}
        {faqItems.length > 0 ? (
          <section className="mx-auto max-w-5xl px-4 mt-16 border-t pt-8 pb-8">
            <h2 className="text-2xl font-bold text-center mb-8 text-foreground">
              {t('faqHeading')}
            </h2>
            <div className="mx-auto max-w-3xl space-y-6">
              {faqItems.map((item, i) => (
                <div key={i}>
                  <h3 className="text-base font-semibold text-foreground mb-2">
                    {item.question}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Explore More */}
        <ExploreMoreLinks
          heading={exploreHeading}
          links={[
            {
              href: '/jpg-to-word',
              icon: 'generalocr.svg',
              label: t('exploreJpgToWordLabel') || 'JPG to Word',
              desc: t('exploreJpgToWordDesc'),
            },
            {
              href: '/photo-to-word',
              icon: 'generalocr.svg',
              label: t('explorePhotoToWordLabel') || 'Photo to Word',
              desc: t('explorePhotoToWordDesc'),
            },
            {
              href: '/image-to-text',
              icon: 'generalocr.svg',
              label: t('exploreImageToTextLabel') || 'Image to Text',
              desc: t('exploreImageToTextDesc'),
            },
            {
              href: '/pdf-to-text',
              icon: 'pdf.png',
              label: t('explorePdfToTextLabel') || 'PDF to Text',
              desc: t('explorePdfToTextDesc'),
            },
            {
              href: '/translate',
              icon: 'pdf.png',
              label: t('exploreTranslateLabel') || 'PDF Translation',
              desc: t('exploreTranslateDesc'),
            },
            {
              href: '/contract-comparison',
              icon: 'pdf.png',
              label: t('exploreContractCompareLabel') || 'AI Contract Comparison',
              desc: t('exploreContractCompareDesc'),
            },
          ]}
        />
      </div>
    </>
  );
}
