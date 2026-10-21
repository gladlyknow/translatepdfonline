import '@/config/style/global.css';

import { Suspense } from 'react';
import { JetBrains_Mono, Merriweather, Noto_Sans_Mono } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { routing } from '@/core/i18n/config';
import { ThemeProvider } from '@/core/theme/provider';
import { cacheBustedPublicPath, envConfigs } from '@/config';
import NextTopLoaderClient from '@/shared/blocks/common/next-top-loader-client';
import {
  ThirdPartyConfigTag,
  ThirdPartyScripts,
} from '@/shared/blocks/common/third-party-scripts';
import { UtmCapture } from '@/shared/blocks/common/utm-capture';
import { Toaster } from '@/shared/components/ui/sonner';
import { AppContextProvider } from '@/shared/contexts/app';
import { getMetadata } from '@/shared/lib/seo';
import { getPublicConfigs } from '@/shared/models/config';

const notoSansMono = Noto_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'sans-serif'],
});

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-serif',
  display: 'swap',
  preload: false,
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});

export const generateMetadata = getMetadata();

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages({ locale });

  let publicConfigs: Record<string, string> = {};
  try {
    publicConfigs = await getPublicConfigs();
  } catch {
    // Third-party scripts are optional and must never block rendering.
  }

  const adsenseCode = publicConfigs.adsense_code?.trim();

  return (
    <html
      lang={locale}
      className={`${notoSansMono.variable} ${merriweather.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="64x64"
          href={cacheBustedPublicPath('/brand/logo.webp')}
        />
        <link
          rel="shortcut icon"
          href={cacheBustedPublicPath(envConfigs.app_favicon)}
        />
        <link
          rel="apple-touch-icon"
          href={cacheBustedPublicPath('/brand/tpdf.svg')}
        />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="msvalidate.01" content="6EBFE9DC98D628BCDAB6A9BBCF26C8D0" />
        {adsenseCode ? (
          <meta name="google-adsense-account" content={adsenseCode} />
        ) : null}
        <ThirdPartyConfigTag configs={publicConfigs} />
      </head>
      <body suppressHydrationWarning className="overflow-x-hidden">
        <Suspense fallback={null}>
          <NextTopLoaderClient />
        </Suspense>
        <UtmCapture />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <AppContextProvider>
              {children}
              <Toaster position="top-center" richColors />
            </AppContextProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
        <ThirdPartyScripts />
      </body>
    </html>
  );
}
