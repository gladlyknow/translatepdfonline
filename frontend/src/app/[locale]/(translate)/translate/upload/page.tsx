import { setRequestLocale } from 'next-intl/server';

import { TranslateUploadPageClient } from './TranslateUploadPageClient';

export default async function TranslateUploadPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <TranslateUploadPageClient />;
}
