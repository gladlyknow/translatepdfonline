'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { Button } from '@/shared/components/ui/button';
import { cacheSet } from '@/shared/lib/cache';
import { setCookie } from '@/shared/lib/cookie';
import { getTimestamp } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';

type TopBannerLinkTarget = '_self' | '_blank';

export const TOP_BANNER_DISMISSED_COOKIE = 'top_banner_dismissed';

export type TopBannerProps = {
  enabled?: boolean;
  /**
   * Used to build the dismiss cache key. Change it when you change the banner.
   */
  id?: string;
  /**
   * Banner main text.
   */
  text: ReactNode;
  /**
   * CTA button text. When omitted, the button is hidden.
   */
  buttonText?: string;
  /**
   * CTA link. When provided, clicking the button navigates to this URL.
   */
  href?: string;
  /**
   * Open the link in a new tab. Defaults to false.
   */
  target?: TopBannerLinkTarget;
  /**
   * Whether the banner can be dismissed. Defaults to true.
   */
  closable?: boolean;
  /**
   * Remember dismiss state in cache. Defaults to true.
   */
  rememberDismiss?: boolean;
  /**
   * Dismiss expiry in days. Defaults to 7.
   */
  dismissedExpiryDays?: number;
  /**
   * Extra class names for the banner wrapper.
   */
  className?: string;
  /**
   * Optional callback when user clicks the CTA and no `href` is provided.
   */
  onAction?: () => void;
};

function isExternalHref(href: string) {
  return (
    /^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^tel:/i.test(href)
  );
}

export function TopBanner({
  enabled = true,
  id = 'default',
  text,
  buttonText,
  href,
  target = '_self',
  closable = true,
  rememberDismiss = true,
  dismissedExpiryDays = 7,
  className,
  onAction,
}: TopBannerProps) {
  const dismissKey = useMemo(() => `top-banner-dismissed:${id}`, [id]);

  // Render the banner in the initial HTML so hydration never inserts a new
  // layout block. A tiny pre-paint script in the locale layout hides a
  // previously dismissed banner before the browser paints the page.
  const [showBanner, setShowBanner] = useState(enabled);

  const setDismissed = () => {
    if (!rememberDismiss) return;
    const expiresAt = getTimestamp() + dismissedExpiryDays * 24 * 60 * 60;
    cacheSet(dismissKey, 'true', expiresAt);
    setCookie(TOP_BANNER_DISMISSED_COOKIE, '1', dismissedExpiryDays);
  };

  const handleDismiss = () => {
    setDismissed();
    document.documentElement.classList.add('top-banner-dismissed');
    setShowBanner(false);
  };

  if (!enabled || !showBanner) {
    return null;
  }

  const showButton =
    Boolean(buttonText) && (Boolean(href) || Boolean(onAction));

  return (
    <div
      className={cn(
        'top-banner-slot bg-background/95 text-foreground border-border relative z-[51] block min-h-12 border-b py-1 shadow-sm backdrop-blur-sm',
        className
      )}
    >
      <div className="container py-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center justify-center gap-3 px-1">
            {typeof text === 'string' ? (
              <div
                className="text-foreground [&_a]:text-foreground [&_a]:decoration-foreground/30 hover:[&_a]:decoration-foreground text-center text-sm [&_a]:underline [&_a]:underline-offset-2 [&_a]:transition-colors"
                dangerouslySetInnerHTML={{ __html: text }}
              />
            ) : (
              <div className="text-foreground [&_a]:text-foreground [&_a]:decoration-foreground/30 hover:[&_a]:decoration-foreground text-center text-sm [&_a]:underline [&_a]:underline-offset-2 [&_a]:transition-colors">
                {text}
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {showButton ? (
              href ? (
                isExternalHref(href) ? (
                  <Button
                    asChild
                    variant="secondary"
                    size="sm"
                    className="bg-background text-xs"
                  >
                    <a
                      href={href}
                      target={target}
                      rel={
                        target === '_blank' ? 'noreferrer noopener' : undefined
                      }
                    >
                      {buttonText}
                    </a>
                  </Button>
                ) : (
                  <Button
                    asChild
                    variant="secondary"
                    size="sm"
                    className="bg-background text-xs"
                  >
                    <Link href={href}>{buttonText}</Link>
                  </Button>
                )
              ) : (
                <Button
                  onClick={onAction}
                  variant="secondary"
                  size="sm"
                  className="bg-background text-xs"
                >
                  {buttonText}
                </Button>
              )
            ) : null}

            {closable ? (
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex-shrink-0 rounded-md p-1 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
