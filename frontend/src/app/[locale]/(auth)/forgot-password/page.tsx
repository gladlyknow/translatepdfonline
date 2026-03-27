import { getTranslations } from 'next-intl/server';

import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { ForgotPassword } from '@/shared/blocks/sign/forgot-password';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('common');

  return {
    title: `${t('sign.forgot_password_title')} - ${t('metadata.title')}`,
    alternates: {
      canonical:
        locale !== defaultLocale
          ? `${envConfigs.app_url}/${locale}/forgot-password`
          : `${envConfigs.app_url}/forgot-password`,
    },
  };
}

export default async function ForgotPasswordPage() {
  return <ForgotPassword />;
}

