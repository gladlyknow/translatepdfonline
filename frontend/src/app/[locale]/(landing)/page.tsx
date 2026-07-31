import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getThemePage } from '@/core/theme';
import { locales } from '@/config/locale';
import { getMetadata } from '@/shared/lib/seo';
import { DynamicPage } from '@/shared/types/blocks/landing';
import { HomeFaqJsonLd } from '@/shared/blocks/seo/home-faq-json-ld';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/shared/blocks/seo/organization-json-ld';

// Landing 页内容完全来自 i18n JSON，无数据库查询。
// dynamic='auto' + revalidate=3600：首次请求动态生成（获取正确的 canonical/OG/hreflang URL），
// 后续走 ISR 缓存。CF Worker 运行时变量在动态生成时可见，不再受 force-static 构建期限制。
export const revalidate = 3600;

// 首页使用 pages.index.metadata（含 "with AI" 等页面专属关键词），
// 而非 common.metadata 通用回退值。
export const generateMetadata = getMetadata({ metadataKey: 'pages.index.metadata' });

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
      <OrganizationJsonLd />
      <WebSiteJsonLd />
      <HomeFaqJsonLd items={faqItems} />
      <Page locale={locale} page={page} />
    </>
  );
}
