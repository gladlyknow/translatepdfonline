import { setRequestLocale } from 'next-intl/server';

import { UploadPageClient } from './UploadPageClient';

export default async function UploadPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <UploadPageClient />;
}

