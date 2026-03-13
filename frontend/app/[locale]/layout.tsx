import { hasLocale } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { locales } from "@/i18n/config";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import type { Metadata } from "next";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  title: "在线 PDF 翻译 | Online PDF Translation",
  description: "中英西互译的在线 PDF 翻译服务",
};

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

async function loadMessages(locale: string) {
  const dict = {
    zh: (await import("@/messages/zh.json")).default,
    en: (await import("@/messages/en.json")).default,
    es: (await import("@/messages/es.json")).default,
  };
  return (dict as Record<string, Record<string, unknown>>)[locale] ?? dict.zh;
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await loadMessages(locale);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {children}
      </div>
      <PrivacyFooter />
    </NextIntlClientProvider>
  );
}
