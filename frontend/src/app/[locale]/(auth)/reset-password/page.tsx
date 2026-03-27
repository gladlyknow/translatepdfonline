import { getTranslations } from 'next-intl/server';

import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { ResetPassword } from '@/shared/blocks/sign/reset-password';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('common');

  return {
    title: `${t('sign.reset_password_title')} - ${t('metadata.title')}`,
    alternates: {
      canonical:
        locale !== defaultLocale
          ? `${envConfigs.app_url}/${locale}/reset-password`
          : `${envConfigs.app_url}/reset-password`,
    },
  };
}

export default async function ResetPasswordPage() {
  return <ResetPassword />;
}

