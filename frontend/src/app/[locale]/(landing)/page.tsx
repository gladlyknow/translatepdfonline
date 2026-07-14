import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getThemePage } from '@/core/theme';
import { locales } from '@/config/locale';
import { DynamicPage } from '@/shared/types/blocks/landing';
import { HomeFaqJsonLd } from '@/shared/blocks/seo/home-faq-json-ld';

// Landing 页内容完全来自 i18n JSON，无数据库查询 → 构建时静态生成，直接从 CDN 提供
// 绕过 Cloudflare Worker，TTFB 从 >10s 降到 <100ms
export const dynamic = 'force-static';
export const revalidate = 3600;

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'pages.index' });

  // get page data
  const page: DynamicPage = t.raw('page');

  // FAQ 结构化数据：从首页 faq 区块取问答，输出 schema.org FAQPage 富摘要
  const faqItems = ((page as any).sections?.faq?.items ?? [])
    .map((it: any) => ({ question: it?.question, answer: it?.answer }))
    .filter((it: any) => it.question && it.answer);

  // load page component
  const Page = await getThemePage('dynamic-page');

  return (
    <>
      <HomeFaqJsonLd items={faqItems} />
      <Page locale={locale} page={page} />
    </>
  );
}
