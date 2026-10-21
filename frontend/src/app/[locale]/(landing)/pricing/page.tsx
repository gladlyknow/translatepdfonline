import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getThemePage } from '@/core/theme';
import { defaultLocale } from '@/config/locale';
import { currentPricingLocales } from '@/config/seo-routes';
import { getMetadata } from '@/shared/lib/seo';
import { getTranslateCreditsPerPage } from '@/shared/lib/translate-billing';
import { getCurrentSubscription } from '@/shared/models/subscription';
import { getUserInfo } from '@/shared/models/user';
import { DynamicPage } from '@/shared/types/blocks/landing';

export const revalidate = 3600;

export const generateMetadata = getMetadata({
  metadataKey: 'pages.pricing.metadata',
  canonicalUrl: '/pricing',
  indexLocales: currentPricingLocales,
});

function applyCurrentCreditRate<T>(value: T, creditsPerPage: number): T {
  if (typeof value === 'string') {
    return value.replaceAll('{creditsPerPage}', String(creditsPerPage)) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      applyCurrentCreditRate(item, creditsPerPage)
    ) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        applyCurrentCreditRate(item, creditsPerPage),
      ])
    ) as T;
  }
  return value;
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // get current subscription
  let currentSubscription;
  try {
    const user = await getUserInfo();
    if (user) {
      currentSubscription = await getCurrentSubscription(user.id);
    }
  } catch (error) {
    console.log('getting current subscription failed:', error);
  }

  // get pricing data
  const t = await getTranslations('pages.pricing');
  let pricingSection;
  if (t.has('page.sections.pricing')) {
    pricingSection = t.raw('page.sections.pricing');
  } else {
    // de/es/ru still use the legacy pricing schema. Keep those routes usable
    // with the current English product data while they remain noindex.
    const fallback = await getTranslations({
      locale: defaultLocale,
      namespace: 'pages.pricing',
    });
    pricingSection = fallback.raw('page.sections.pricing');
  }
  pricingSection = applyCurrentCreditRate(
    pricingSection,
    getTranslateCreditsPerPage()
  );

  // build page sections
  const page: DynamicPage = {
    title: t.raw('page.title'),
    sections: {
      pricing: {
        ...pricingSection,
        data: {
          currentSubscription,
        },
      },
    },
  };

  // load page component
  const Page = await getThemePage('dynamic-page');

  return <Page locale={locale} page={page} />;
}
