'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { useLocale } from 'next-intl';

import { usePathname, useRouter } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { localeNames, locales } from '@/config/locale';
import { Button } from '@/shared/components/ui/button';
import { cacheGet, cacheSet } from '@/shared/lib/cache';
import { getTimestamp } from '@/shared/lib/time';

const DISMISSED_KEY = 'locale-suggestion-dismissed';
const DISMISSED_EXPIRY_DAYS = 1; // Expiry in days
const PREFERRED_LOCALE_KEY = 'locale';

function LocaleDetectorInner() {
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showBanner, setShowBanner] = useState(false);
  const [browserLocale, setBrowserLocale] = useState<string | null>(null);

  const detectBrowserLocale = (): string | null => {
    if (typeof window === 'undefined') return null;

    const browserLang = navigator.language || (navigator as any).userLanguage;
    const langCode = browserLang.split('-')[0].toLowerCase();

    // Check if the detected language is in our supported locales
    if (locales.includes(langCode)) {
      return langCode;
    }

    return null;
  };

  const isDismissed = (): boolean => {
    const dismissedData = cacheGet(DISMISSED_KEY);
    if (!dismissedData) return false;

    return true;
  };

  const setDismissed = () => {
    const expiresAt = getTimestamp() + DISMISSED_EXPIRY_DAYS * 24 * 60 * 60;
    cacheSet(DISMISSED_KEY, 'true', expiresAt);
  };

  const switchToLocale = useCallback(
    (locale: string) => {
      const query = searchParams?.toString?.() ?? '';
      const href = query ? `${pathname}?${query}` : pathname;
      router.replace(href, { locale });
      cacheSet(PREFERRED_LOCALE_KEY, locale);
      cacheSet('user-locale-preference', locale);
      setShowBanner(false);
    },
    [router, pathname, searchParams]
  );

  useEffect(() => {
    // Get browser locale
    const detectedLocale = detectBrowserLocale();
    setBrowserLocale(detectedLocale);

    // Check if user has dismissed the banner or already set a preference
    const dismissed = isDismissed();
    // Check both keys for backward compatibility
    const preferredLocale =
      cacheGet(PREFERRED_LOCALE_KEY) || cacheGet('user-locale-preference');

    // If user has previously clicked to switch locale, auto-switch to that preference
    if (
      preferredLocale &&
      preferredLocale !== currentLocale &&
      locales.includes(preferredLocale)
    ) {
      switchToLocale(preferredLocale);
      return;
    }

    // Show banner if:
    // 1. Browser locale is different from current locale
    // 2. User hasn't dismissed the banner (or dismissal has expired)
    // 3. Browser locale is supported
    // 4. User hasn't set a preference yet (no auto-switch, only show banner)
    if (
      detectedLocale &&
      detectedLocale !== currentLocale &&
      !dismissed &&
      !preferredLocale
    ) {
      setShowBanner(true);
    }
  }, [currentLocale, switchToLocale]);

  const handleSwitch = () => {
    if (browserLocale) {
      switchToLocale(browserLocale);
    }
  };

  const handleDismiss = () => {
    setDismissed();
    setShowBanner(false);
  };

  const targetLocaleName =
    localeNames[browserLocale as keyof typeof localeNames] || browserLocale;

  if (!showBanner || !browserLocale) {
    return null;
  }

  return (
    <div className="bg-background/95 text-foreground border-border fixed right-4 bottom-4 z-[60] hidden max-w-lg rounded-lg border shadow-lg backdrop-blur-sm md:block">
      <div className="container py-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-3">
            <span className="text-foreground text-sm">
              {browserLocale === 'zh'
                ? `检测到浏览器语言是: ${targetLocaleName}，是否切换？`
                : `We detected your browser language is ${targetLocaleName}. Switch to it?`}
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button
              onClick={handleSwitch}
              variant="secondary"
              size="sm"
              className="bg-background text-xs"
            >
              {browserLocale === 'zh' ? '切换到中文' : 'Switch'}
            </Button>
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex-shrink-0 rounded-md p-1 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LocaleDetector() {
  if (envConfigs.locale_detect_enabled !== 'true') {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LocaleDetectorInner />
    </Suspense>
  );
}
