import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import Image from 'next/image';
import { Link } from '@/core/i18n/navigation';

import { envConfigs } from '@/config';
import { locales } from '@/config/locale';
import { HomeFaqJsonLd } from '@/shared/blocks/seo/home-faq-json-ld';
import { buildAlternates } from '@/shared/lib/hreflang';

import { JpgToWordClient } from './JpgToWordClient';

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
  const t = await getTranslations({ locale, namespace: 'pages.jpg-to-word' });
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/jpg-to-word`
      : `${envConfigs.app_url}/${locale}/jpg-to-word`;

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    keywords: t('keywords') || undefined,
    alternates: {
      canonical,
      languages: buildAlternates('/jpg-to-word', locale).languages,
    },
  };
}

export default async function JpgToWordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.jpg-to-word' });

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

  return (
    <>
      <HomeFaqJsonLd items={faqItems} />
      <div className="min-h-dvh w-full bg-background pt-14 lg:pt-18">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          {/* Hero + Upload Area */}
          <JpgToWordClient>
            <section className="text-center pb-2">
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
                {heroTitle}
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground leading-relaxed sm:text-lg">
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
          </JpgToWordClient>
        </div>

        {/* How It Works */}
        <section className="mx-auto w-full max-w-5xl mt-10 px-4">
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
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary text-lg font-bold">
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
          <section className="mx-auto w-full max-w-5xl mt-10 px-4">
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
          <section className="mx-auto max-w-5xl px-4 mt-10 border-t pt-8 pb-8">
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
        <section className="mx-auto max-w-5xl px-4 border-t pt-8 pb-16">
          <h3 className="text-lg font-semibold text-center mb-4 text-foreground">
            {exploreHeading}
          </h3>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              {
                href: '/image-to-text',
                icon: 'pdf.png',
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
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex items-center gap-3 rounded-lg border border bg-card px-4 py-3 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Image
                  src={`/brand/icons/${link.icon}`}
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 shrink-0"
                />
                <div className="flex flex-col items-start">
                  <span className="font-medium text-foreground">
                    {link.label}
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5">
                    {link.desc}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
