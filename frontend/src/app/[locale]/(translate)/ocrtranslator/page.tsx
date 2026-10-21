import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getMetadata } from '@/shared/lib/seo';

import { OcrTranslatePageClient } from './OcrTranslatePageClient';

export const generateMetadata = getMetadata({
  metadataKey: 'pages.ocr-translator.metadata',
  canonicalUrl: '/ocrtranslator',
});

export default async function OcrTranslatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({
    locale,
    namespace: 'pages.ocr-translator',
  });

  return (
    <>
      <section className="border-border bg-background border-b px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <p className="text-primary text-sm font-semibold">{t('eyebrow')}</p>
          <h1 className="text-foreground mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {t('h1')}
          </h1>
          <p className="text-muted-foreground mt-3 max-w-3xl text-base leading-7">
            {t('intro')}
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="border-border bg-card rounded-xl border p-4">
              <h2 className="text-foreground font-semibold">
                {t('useCasesTitle')}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {t('useCases')}
              </p>
            </div>
            <div className="border-border bg-card rounded-xl border p-4">
              <h2 className="text-foreground font-semibold">
                {t('limitsTitle')}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {t('limits')}
              </p>
            </div>
          </div>
        </div>
      </section>
      <OcrTranslatePageClient />
    </>
  );
}
