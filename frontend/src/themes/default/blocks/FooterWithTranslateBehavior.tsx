'use client';

import { useEffect, useState } from 'react';
import { usePathname } from '@/core/i18n/navigation';
import { useTranslations } from 'next-intl';

import { useTranslateFooterWorkbenchOptional } from '@/shared/contexts/translate-footer-workbench';

export function FooterWithTranslateBehavior({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations('translate.home');
  const workbenchCtx = useTranslateFooterWorkbenchOptional();
  const isTranslatePage = pathname?.includes('/translate') ?? false;
  const [expanded, setExpanded] = useState(false);

  const workbenchOpen = workbenchCtx?.workbenchOpen ?? false;

  useEffect(() => {
    if (workbenchOpen) {
      setExpanded(false);
    }
  }, [workbenchOpen]);

  if (!isTranslatePage) {
    return <>{children}</>;
  }

  if (!workbenchOpen) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col">
      <div
        className={`flex shrink-0 items-center justify-center border-t border-zinc-200 bg-zinc-50/80 transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-900/80 ${
          expanded ? 'h-0 overflow-hidden border-0 opacity-0' : 'h-8 min-h-[2rem] opacity-100'
        }`}
        aria-hidden={expanded}
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[11px] text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          {t('showFooter')}
        </button>
      </div>
      <div
        className={`flex flex-col overflow-hidden transition-all duration-200 ${
          expanded ? 'max-h-[80vh] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        {children}
        {expanded && (
          <div className="flex shrink-0 items-center justify-center border-t border-zinc-200 bg-zinc-50/80 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/80">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[11px] text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            >
              {t('collapse')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
