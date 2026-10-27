import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/core/i18n/navigation';
import { HomeFaqJsonLd } from '@/shared/blocks/seo/home-faq-json-ld';
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
  const workflowSteps = [1, 2, 3, 4].map((step) => ({
    title: t(`workflow.step${step}Title` as any),
    description: t(`workflow.step${step}Description` as any),
  }));
  const faqItems = [1, 2, 3, 4].map((item) => ({
    question: t(`faq.q${item}` as any),
    answer: t(`faq.a${item}` as any),
  }));

  return (
    <>
      <HomeFaqJsonLd items={faqItems} />
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
      <section className="border-border bg-background border-t px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-3xl">
            <h2 className="text-foreground text-2xl font-bold tracking-tight">
              {t('workflow.title')}
            </h2>
            <p className="text-muted-foreground mt-3 leading-7">
              {t('workflow.intro')}
            </p>
          </div>
          <ol className="mt-7 grid gap-4 md:grid-cols-2">
            {workflowSteps.map((step, index) => (
              <li
                key={step.title}
                className="border-border bg-card rounded-xl border p-5"
              >
                <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-full text-sm font-bold">
                  {index + 1}
                </div>
                <h3 className="text-foreground mt-4 font-semibold">
                  {step.title}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {(['review', 'outputs', 'privacy'] as const).map((section) => (
              <article
                key={section}
                className="border-border bg-card rounded-xl border p-5"
              >
                <h2 className="text-foreground font-semibold">
                  {t(`${section}.title`)}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {t(`${section}.description`)}
                </p>
              </article>
            ))}
          </div>

          <section className="border-border mt-10 border-t pt-10">
            <h2 className="text-foreground text-2xl font-bold tracking-tight">
              {t('faq.title')}
            </h2>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {faqItems.map((item) => (
                <article key={item.question}>
                  <h3 className="text-foreground font-semibold">
                    {item.question}
                  </h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-6">
                    {item.answer}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <div className="border-primary/20 bg-primary/5 mt-10 rounded-xl border p-5">
            <p className="text-muted-foreground text-sm leading-6">
              {t('reviewedLabel')}
            </p>
            <Link
              href="/docs/ocr-workbench"
              className="text-primary mt-2 inline-flex text-sm font-semibold underline-offset-4 hover:underline"
            >
              {t('guideLink')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
