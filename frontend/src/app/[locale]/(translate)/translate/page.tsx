import { setRequestLocale } from 'next-intl/server';

import { redirect } from '@/core/i18n/navigation';
import { getMetadata } from '@/shared/lib/seo';

import { TranslatePageClient } from './TranslatePageClient';

// 翻译工作台含用户私有 task/document 数据，且无参数时重定向到 /upload，无索引价值
export const generateMetadata = getMetadata({
  canonicalUrl: '/translate',
  noIndex: true,
});

export default async function TranslatePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ task?: string; document?: string; recent?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const task = sp.task?.trim();
  const document = sp.document?.trim();
  const recent = sp.recent?.trim();
  if (!task && !document && recent !== '1') {
    redirect({ href: '/upload', locale });
  }

  return <TranslatePageClient />;
}
