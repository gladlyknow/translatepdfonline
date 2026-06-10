import '@/config/style/global.css';

import { JetBrains_Mono, Merriweather, Noto_Sans_Mono } from 'next/font/google';
import { getLocale, setRequestLocale } from 'next-intl/server';
import NextTopLoader from 'nextjs-toploader';

import { cacheBustedPublicPath, envConfigs } from '@/config';
import { locales } from '@/config/locale';
import { UtmCapture } from '@/shared/blocks/common/utm-capture';
import { ThirdPartyScripts } from '@/shared/blocks/common/third-party-scripts';

const notoSansMono = Noto_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
});

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-serif',
  display: 'swap',
  preload: false,
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

  const appUrl = envConfigs.app_url || '';

  return (
    <html
      lang={locale}
      className={`${notoSansMono.variable} ${merriweather.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
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

        {/* inject locales */}
        {locales ? (
          <>
            {locales.map((loc) => (
              <link
                key={loc}
                rel="alternate"
                hrefLang={loc}
                href={`${appUrl}${loc === 'en' ? '' : `/${loc}`}`}
              />
            ))}
          </>
        ) : null}

        <ThirdPartyScripts />
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
      </body>
    </html>
  );
}
