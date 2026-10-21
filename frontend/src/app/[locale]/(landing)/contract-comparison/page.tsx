import { getTranslations, setRequestLocale } from 'next-intl/server';

import { envConfigs } from '@/config';
import { locales } from '@/config/locale';
import DocumentCompareClient from '@/shared/blocks/document-compare';
import { SoftwareApplicationJsonLd } from '@/shared/blocks/seo/software-json-ld';
import { getMetadata } from '@/shared/lib/seo';

export const dynamic = 'force-static';

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const generateMetadata = getMetadata({
  metadataKey: 'pages.contract-comparison',
  canonicalUrl: '/contract-comparison',
});

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

  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/contract-comparison`
      : `${envConfigs.app_url}/${locale}/contract-comparison`;

  return (
    <>
      <SoftwareApplicationJsonLd
        name={t('heroTitle')}
        description={t('metaDescription')}
        url={canonical}
      />
      <div className="bg-background min-h-dvh w-full pt-16 lg:pt-20">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          {/* Hero */}
          <section className="pb-6 text-center">
            <h1 className="text-foreground text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              {t('metaTitle')}
            </h1>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base leading-relaxed sm:text-lg">
              {t('heroText')}
            </p>
          </section>

          {/* Compare Tool */}
          <section className="w-full px-4 pb-8">
            <DocumentCompareClient />
          </section>
          <section className="mx-auto grid w-full max-w-5xl gap-4 border-t px-4 py-10 md:grid-cols-2">
            <div className="border-border bg-card rounded-xl border p-5">
              <h2 className="text-foreground text-lg font-semibold">
                {t('scopeTitle')}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {t('scopeBody')}
              </p>
            </div>
            <div className="border-border bg-card rounded-xl border p-5">
              <h2 className="text-foreground text-lg font-semibold">
                {t('reviewTitle')}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {t('reviewBody')}
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
