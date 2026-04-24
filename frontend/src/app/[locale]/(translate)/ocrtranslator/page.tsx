import { setRequestLocale } from 'next-intl/server';
import { OcrTranslatePageClient } from './OcrTranslatePageClient';

export default async function OcrTranslatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OcrTranslatePageClient />;
}
