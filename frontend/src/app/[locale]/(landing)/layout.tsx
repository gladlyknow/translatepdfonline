import { Fragment, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { TRANSLATE_PRIMARY_PRICE_GRADIENT_CLASSNAME } from '@/config/translate-ui';
import { getThemeLayout } from '@/core/theme';
import { LocaleDetector, TopBanner } from '@/shared/blocks/common';
import { cn } from '@/shared/lib/utils';
import {
  Footer as FooterType,
  Header as HeaderType,
} from '@/shared/types/blocks/landing';

function landingTopBannerPromoText(t: {
  (key: string): string;
  has: (key: string) => boolean;
}) {
  if (!t.has('header.topbanner.promoBefore')) {
    return null;
  }
  const grad = cn(TRANSLATE_PRIMARY_PRICE_GRADIENT_CLASSNAME, 'font-semibold');
  return (
    <Fragment>
      {t('header.topbanner.promoBefore')}
      <span className={grad}>{t('header.topbanner.promoCredits')}</span>
      {t('header.topbanner.promoMiddle')}
      <span className={grad}>{t('header.topbanner.promoFree')}</span>
      {t('header.topbanner.promoAfter')}
    </Fragment>
  );
}

export default async function LandingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = await getTranslations('landing');

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

  const promoNode = landingTopBannerPromoText(t);
  const legacyText =
    typeof top?.text === 'string' && top.text.trim() ? top.text : '';
  const showTopBanner = Boolean(top && (promoNode || legacyText));

  const bannerText = promoNode ?? legacyText;
  const bannerId =
    typeof top?.id === 'string' && top.id.trim()
      ? top.id
      : promoNode
        ? 'topbanner-signup-bonus'
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
