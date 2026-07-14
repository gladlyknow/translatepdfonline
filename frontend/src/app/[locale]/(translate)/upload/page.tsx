import { setRequestLocale } from 'next-intl/server';

import { getMetadata } from '@/shared/lib/seo';
import { UploadPageClient } from './UploadPageClient';

export const generateMetadata = getMetadata({
  canonicalUrl: '/upload',
  noIndex: true,
});

export default async function UploadPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <UploadPageClient />;
}

