import { setRequestLocale } from 'next-intl/server';

import { getMetadata } from '@/shared/lib/seo';
import { OcrTranslatePageClient } from './OcrTranslatePageClient';

export const generateMetadata = getMetadata({ canonicalUrl: '/ocrtranslator' });

export default async function OcrTranslatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OcrTranslatePageClient />;
}
