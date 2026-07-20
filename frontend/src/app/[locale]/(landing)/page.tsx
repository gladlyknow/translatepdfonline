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

  // LCP 图预加载：hero 改为原生 <img srcset> 后，需在 <head> 显式 preload
  // （用 imagesrcset/imagesizes 匹配 srcset，让浏览器按视口选最优尺寸尽早下载）。
  const heroImg =
    (page as any).sections?.hero?.image_invert?.src ||
    (page as any).sections?.hero?.image?.src ||
    '';
  const heroSrcset = (() => {
    if (!heroImg || heroImg.startsWith('http')) return undefined;
    const m = heroImg.match(/^(.*?)(\.\w+)$/);
    if (!m) return undefined;
    return `${m[1]}-672${m[2]} 672w, ${heroImg} 1000w, ${m[1]}-1344${m[2]} 1344w`;
  })();
  // preload 的 href 用 672 变体（移动端默认尺寸）。若用基图 1000px 作 href，
  // 浏览器会预加载 1000px 并被 <img src=1000> 复用，绕过 srcset 的 672w 选择。
  const heroImg672 = (() => {
    if (!heroImg || heroImg.startsWith('http')) return heroImg;
    const m = heroImg.match(/^(.*?)(\.\w+)$/);
    if (!m) return heroImg;
    return `${m[1]}-672${m[2]}`;
  })();

  // load page component
  const Page = await getThemePage('dynamic-page');

  return (
    <>
      {heroSrcset ? (
        <link
          rel="preload"
          as="image"
          href={heroImg672}
          imageSrcSet={heroSrcset}
          imageSizes="(max-width: 768px) 100vw, 1200px"
          fetchPriority="high"
        />
      ) : null}
      <HomeFaqJsonLd items={faqItems} />
      <Page locale={locale} page={page} />
    </>
  );
}
