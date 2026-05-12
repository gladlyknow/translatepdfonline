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
}: {
  children: ReactNode;
  footer?: ReactNode;
  /** 与落地页 Header 一致的用户菜单（含退出登录） */
  userNav?: UserNav;
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
                'flex flex-col bg-zinc-50 dark:bg-zinc-950',
                // OCR：锁视口高度，避免 body 滚动把侧栏+portal 整块卷走（仅 main overflow-hidden 不够）
                shellVariant === 'ocr'
                  ? 'h-[100dvh] max-h-[100dvh] overflow-hidden'
                  : 'min-h-screen'
              )}
            >
              <TranslateShellHeader userNav={userNav} variant={shellVariant} />
              <main
                className={cn(
                  'flex min-h-0 flex-1 flex-col',
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
