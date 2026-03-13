import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Geist, Geist_Mono } from "next/font/google";
import { Link } from "@/i18n/navigation";
import { AuthProvider } from "@/components/AuthProvider";
import { FingerprintPreloader } from "@/components/FingerprintPreloader";
import "./globals.css";

async function PrivacyFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="shrink-0 border-t border-zinc-200 bg-white py-3 text-center text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <Link href="/privacy" className="hover:underline">
        {t("privacyPolicy")}
      </Link>
    </footer>
  );
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "在线 PDF 翻译 | Online PDF Translation",
  description: "中英西互译的在线 PDF 翻译服务",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [messages, locale] = await Promise.all([getMessages(), getLocale()]);
  return (
    <html lang={locale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col h-screen overflow-hidden`}
      >
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>
            <FingerprintPreloader />
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {children}
            </div>
            <PrivacyFooter />
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
