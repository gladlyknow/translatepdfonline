import { setRequestLocale } from 'next-intl/server';

import { redirect } from '@/core/i18n/navigation';

import { TranslatePageClient } from './TranslatePageClient';

export default async function TranslatePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ task?: string; document?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const task = sp.task?.trim();
  const document = sp.document?.trim();
  if (!task && !document) {
    redirect({ href: '/translate/upload', locale });
  }

  return <TranslatePageClient />;
}
