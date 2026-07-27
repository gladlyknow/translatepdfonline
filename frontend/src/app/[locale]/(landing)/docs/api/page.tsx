import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';

import { envConfigs } from '@/config';
import { locales } from '@/config/locale';
import { HomeFaqJsonLd } from '@/shared/blocks/seo/home-faq-json-ld';
import { buildAlternates } from '@/shared/lib/hreflang';

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
  const t = await getTranslations({ locale, namespace: 'pages.docs-api' });
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/docs/api`
      : `${envConfigs.app_url}/${locale}/docs/api`;

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    keywords: t('keywords') || undefined,
    alternates: { canonical, languages: buildAlternates('/docs/api', locale).languages },
  };
}

export default async function DocsApiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.docs-api' });

  const faqItems = [1, 2, 3, 4, 5]
    .map((n) => {
      const q = t(`seoFaq.q${n}` as any);
      const a = t(`seoFaq.a${n}` as any);
      return q && a ? { question: q, answer: a } : null;
    })
    .filter(Boolean) as { question: string; answer: string }[];

  const curlCode = `curl -X POST https://www.translatepdfonline.com/api/v1/translate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "document_id": "doc_xxx",
    "source_lang": "en",
    "target_lang": "zh",
    "page_range": "1-10"
  }'`;

  const pythonCode = `import requests

url = "https://www.translatepdfonline.com/api/v1/translate"
headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
}
data = {
    "document_id": "doc_xxx",
    "source_lang": "en",
    "target_lang": "zh",
    "page_range": "1-10"
}

response = requests.post(url, json=data, headers=headers)
print(response.json())  # {"task_id": "...", "status": "queued"}`;

  const nodeCode = `const response = await fetch(
  "https://www.translatepdfonline.com/api/v1/translate",
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer YOUR_API_KEY",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      document_id: "doc_xxx",
      source_lang: "en",
      target_lang: "zh",
      page_range: "1-10"
    })
  }
);

const data = await response.json();
console.log(data); // { task_id: "...", status: "queued" }`;

  return (
    <>
      <HomeFaqJsonLd items={faqItems} />
      <div className="min-h-dvh w-full bg-background pt-14 lg:pt-18">
        <div className="mx-auto max-w-4xl px-4 py-12">
          {/* Hero */}
          <section className="text-center pb-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {t('heroTitle')}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground leading-relaxed sm:text-lg">
              {t('heroText')}
            </p>
          </section>

          {/* Authentication */}
          <section className="mt-10">
            <h2 className="text-2xl font-bold text-foreground mb-3">{t('authentication')}</h2>
            <p className="text-muted-foreground leading-relaxed">{t('authenticationDesc')}</p>
          </section>

          {/* Endpoint */}
          <section className="mt-10">
            <h2 className="text-2xl font-bold text-foreground mb-3">{t('endpoint')}</h2>
            <div className="rounded-2xl border-2 border bg-card p-6">
              <span className="inline-flex items-center rounded-md bg-primary/10 px-3 py-1 text-sm font-mono font-semibold text-primary">
                POST /api/v1/translate
              </span>
              <p className="mt-3 text-sm text-muted-foreground">https://www.translatepdfonline.com/api/v1/translate</p>

              <h3 className="mt-6 text-base font-semibold text-foreground">{t('requestBody')}</h3>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-4 text-sm font-mono text-foreground">
{`{
  "document_id": "string (required)",
  "source_lang": "string (required) — en|zh|es|fr|it|el|ja|ko|de|ru",
  "target_lang": "string (required) — en|zh|es|fr|it|el|ja|ko|de|ru",
  "page_range": "string (optional) — e.g. '1-10' or '5'"
}`}
              </pre>
            </div>
          </section>

          {/* Code Examples */}
          <section className="mt-10 grid gap-8 lg:grid-cols-3">
            <div className="rounded-2xl border-2 border bg-card p-6">
              <h3 className="text-base font-semibold text-foreground mb-3">{t('curlExample')}</h3>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs font-mono text-foreground leading-relaxed">
                {curlCode}
              </pre>
            </div>
            <div className="rounded-2xl border-2 border bg-card p-6">
              <h3 className="text-base font-semibold text-foreground mb-3">{t('pythonExample')}</h3>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs font-mono text-foreground leading-relaxed">
                {pythonCode}
              </pre>
            </div>
            <div className="rounded-2xl border-2 border bg-card p-6">
              <h3 className="text-base font-semibold text-foreground mb-3">{t('nodeExample')}</h3>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs font-mono text-foreground leading-relaxed">
                {nodeCode}
              </pre>
            </div>
          </section>

          {/* Rate Limiting */}
          <section className="mt-10">
            <h2 className="text-2xl font-bold text-foreground mb-3">{t('rateLimiting')}</h2>
            <p className="text-muted-foreground leading-relaxed">{t('rateLimitingDesc')}</p>
          </section>

          {/* Pricing */}
          <section className="mt-10">
            <h2 className="text-2xl font-bold text-foreground mb-3">{t('pricing')}</h2>
            <p className="text-muted-foreground leading-relaxed">{t('pricingDesc')}</p>
          </section>

          {/* FAQ */}
          {faqItems.length > 0 ? (
            <section className="mt-10 border-t pt-8">
              <h2 className="text-2xl font-bold text-center mb-8 text-foreground">
                {t('faqHeading')}
              </h2>
              <div className="mx-auto max-w-3xl space-y-6">
                {faqItems.map((item, i) => (
                  <div key={i}>
                    <h3 className="text-base font-semibold text-foreground mb-2">{item.question}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.answer}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
