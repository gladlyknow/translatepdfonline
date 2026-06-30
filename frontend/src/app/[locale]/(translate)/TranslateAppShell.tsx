'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/core/i18n/navigation';

import { TranslateShellHeader } from '@/shared/components/translate/TranslateShellHeader';
import type { UserNav } from '@/shared/types/blocks/common';

import { TranslateFooterWorkbenchProvider } from '@/shared/contexts/translate-footer-workbench';
import { TranslateHistoryDrawerProvider } from '@/shared/contexts/translate-history-drawer';
import { TranslateHeaderAppearanceProvider } from '@/shared/contexts/translate-header-appearance';
import { TranslateShellChromeProvider } from '@/shared/contexts/translate-shell-chrome';
import { cn } from '@/shared/lib/utils';

export function TranslateAppShell({
  children,
  footer,
  userNav,
  header,
}: {
  children: ReactNode;
  footer?: ReactNode;
  userNav?: UserNav;
  header?: ReactNode;
}) {
  const pathname = usePathname();
  const shellVariant = pathname.includes('/ocrtranslator') ? 'ocr' : 'translate';

  return (
    <TranslateHeaderAppearanceProvider defaultAppearance="onDark">
      <TranslateFooterWorkbenchProvider>
        <TranslateShellChromeProvider>
          <TranslateHistoryDrawerProvider>
            <div
              className={cn(
                'flex flex-col bg-background',
                // OCR：锁视口高度，避免 body 滚动把侧栏+portal 整块卷走（仅 main overflow-hidden 不够）
                shellVariant === 'ocr'
                  ? 'h-[100dvh] max-h-[100dvh] overflow-hidden'
                  : 'min-h-screen'
              )}
            >
              {header ?? <TranslateShellHeader userNav={userNav} variant={shellVariant} />}
              <main
                className={cn(
                  'flex min-h-0 flex-1 flex-col pt-16 lg:pt-20',
                  shellVariant === 'ocr'
                    ? 'overflow-hidden'
                    : 'min-h-[calc(100vh-3.5rem)] overflow-auto'
                )}
              >
                {children}
              </main>
              {footer}
            </div>
          </TranslateHistoryDrawerProvider>
        </TranslateShellChromeProvider>
      </TranslateFooterWorkbenchProvider>
    </TranslateHeaderAppearanceProvider>
  );
}
