import '@/config/style/global.css';

import { JetBrains_Mono, Merriweather, Noto_Sans_Mono } from 'next/font/google';
import { getLocale, setRequestLocale } from 'next-intl/server';
import NextTopLoader from 'nextjs-toploader';

import { cacheBustedPublicPath, envConfigs } from '@/config';
import { UtmCapture } from '@/shared/blocks/common/utm-capture';
import { ThirdPartyConfigTag, ThirdPartyScripts } from '@/shared/blocks/common/third-party-scripts';
import { getAllConfigs } from '@/shared/models/config';

const notoSansMono = Noto_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  // preload 正文字体：避免首屏文字先 system-ui 回退、字体到达后回流（mono 字体宽度差异大）
  // 导致 CLS。实测 preload:false 时 CLS 0.235，preload:true 时 CLS 0.008。
  preload: true,
  fallback: ['system-ui', 'sans-serif'],
});

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-serif',
  display: 'swap',
  // font-serif 在首页 block 未使用，关闭 preload 避免阻塞首屏渲染。
  preload: false,
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  setRequestLocale(locale);

  // 服务端获取配置，通过 script 标签传递给客户端，避免客户端 import 触发 next/cache
  let embeddedConfigs: Record<string, string> = {};
  try {
    embeddedConfigs = await getAllConfigs();
  } catch {
    // 配置加载失败不阻塞渲染
  }

  return (
    <html
      lang={locale}
      className={`${notoSansMono.variable} ${merriweather.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* 标记 JS 可用：ScrollAnimation 等渐进增强组件据此启用初始隐藏态。
            无 JS 时内容直接展示，保证 SEO/可访问性。需在 head 最早执行。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.documentElement.classList.add('js')",
          }}
        />

        {/* 标签页图标：优先 logo.webp，附带 png 回退。 */}
        {/* <link
          rel="icon"
          href={cacheBustedPublicPath(envConfigs.app_favicon)}
          type={
            envConfigs.app_favicon.endsWith('.webp')
              ? 'image/webp'
              : envConfigs.app_favicon.endsWith('.svg')
                ? 'image/svg+xml'
              : undefined
          }
          sizes="any"
        /> */}
        
        <link
          rel="icon"
          type="image/png"
          sizes="64x64"
          href={cacheBustedPublicPath('/brand/logo.webp')}
        />
        <link rel="shortcut icon" href={cacheBustedPublicPath(envConfigs.app_favicon)} />
        <link
          rel="apple-touch-icon"
          href={cacheBustedPublicPath('/brand/tpdf.svg')}
        />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* Bing Webmaster Tools — keep after verification succeeds */}
        <meta
          name="msvalidate.01"
          content="6EBFE9DC98D628BCDAB6A9BBCF26C8D0"
        />

        {/* AdSense 验证 meta 标签（需在 head 中） */}
        {embeddedConfigs.adsense_publisher_id ? (
          <meta
            name="google-adsense-account"
            content={embeddedConfigs.adsense_publisher_id}
          />
        ) : null}

        <ThirdPartyConfigTag configs={embeddedConfigs} />
      </head>
      <body suppressHydrationWarning className="overflow-x-hidden">
        <NextTopLoader
          color="#0369a1"
          initialPosition={0.08}
          crawlSpeed={200}
          height={2}
          crawl={true}
          showSpinner={false}
          easing="ease"
          speed={200}
          shadow={false}
        />

        <UtmCapture />

        {children}

        <ThirdPartyScripts />
      </body>
    </html>
  );
}
