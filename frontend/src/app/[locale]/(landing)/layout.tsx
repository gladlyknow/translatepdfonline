import { Fragment, ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getThemeLayout } from '@/core/theme';
import { TRANSLATE_PRIMARY_PRICE_GRADIENT_CLASSNAME } from '@/config/translate-ui';
import { LocaleDetector, TopBanner } from '@/shared/blocks/common';
import { cn } from '@/shared/lib/utils';
import { getAllConfigs } from '@/shared/models/config';
import {
  Footer as FooterType,
  Header as HeaderType,
} from '@/shared/types/blocks/landing';

function landingTopBannerPromoText(
  t: {
    (key: string, values?: Record<string, string | number>): string;
    has: (key: string) => boolean;
  },
  initialCredits: number
) {
  if (!t.has('header.topbanner.promoBefore') || initialCredits <= 0) {
    return null;
  }
  const grad = cn(TRANSLATE_PRIMARY_PRICE_GRADIENT_CLASSNAME, 'font-semibold');
  return (
    <Fragment>
      {t('header.topbanner.promoBefore')}
      <span className={grad}>
        {t('header.topbanner.promoCredits', { credits: initialCredits })}
      </span>
      {t('header.topbanner.promoMiddle')}
      <span className={grad}>{t('header.topbanner.promoFree')}</span>
      {t('header.topbanner.promoAfter')}
    </Fragment>
  );
}

function getEnabledInitialCredits(configs: Record<string, string>): number {
  if (configs.initial_credits_enabled !== 'true') {
    return 0;
  }
  const amount = Number.parseInt(configs.initial_credits_amount || '', 10);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export default async function LandingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'landing' });
  const configs = await getAllConfigs();
  const initialCredits = getEnabledInitialCredits(configs);

  const Layout = await getThemeLayout('landing');

  const header: HeaderType = t.raw('header');
  const footer: FooterType = t.raw('footer');

  const top = header.topbanner as
    | (Record<string, unknown> & {
        text?: string;
        buttonText?: string;
        href?: string;
        target?: '_self' | '_blank';
        dismissedExpiryDays?: number;
        id?: string;
      })
    | undefined;

  const promoNode = landingTopBannerPromoText(t, initialCredits);
  const legacyText =
    typeof top?.text === 'string' && top.text.trim() ? top.text : '';
  const showTopBanner = Boolean(top && (promoNode || legacyText));

  const bannerText = promoNode ?? legacyText;
  const bannerId = promoNode
    ? `topbanner-signup-bonus-${initialCredits}`
    : typeof top?.id === 'string' && top.id.trim()
      ? top.id
      : 'topbanner';

  return (
    <Layout header={header} footer={footer}>
      <LocaleDetector />
      {showTopBanner ? (
        <TopBanner
          id={bannerId}
          text={bannerText}
          buttonText={top?.buttonText}
          href={top?.href}
          target={top?.target}
          closable
          rememberDismiss
          dismissedExpiryDays={top?.dismissedExpiryDays ?? 1}
        />
      ) : null}
      {children}
    </Layout>
  );
}
