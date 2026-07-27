import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/core/i18n/navigation';

// FC 翻译流程已移除，/translate 重定向到 OCR 翻译工作台
export default async function TranslatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: '/ocrtranslator', locale });
}
