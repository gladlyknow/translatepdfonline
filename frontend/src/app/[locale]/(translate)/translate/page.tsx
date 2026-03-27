import { setRequestLocale } from 'next-intl/server';
import { TranslatePageClient } from './TranslatePageClient';

export default async function TranslatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <TranslatePageClient />;
}
