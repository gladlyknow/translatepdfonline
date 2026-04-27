'use client';

import { useEffect } from 'react';
import { usePathname } from '@/core/i18n/navigation';

import { useTranslateFooterWorkbenchOptional } from '@/shared/contexts/translate-footer-workbench';

export function FooterWithTranslateBehavior({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const workbenchCtx = useTranslateFooterWorkbenchOptional();
  const isTranslatePage =
    (pathname?.includes('/translate') ?? false) ||
    (pathname?.includes('/ocrtranslator') ?? false);
  const workbenchOpen = workbenchCtx?.workbenchOpen ?? false;
  const footerExpanded = workbenchCtx?.footerExpanded ?? false;

  useEffect(() => {
    if (workbenchOpen) {
      workbenchCtx?.setFooterExpanded(false);
    }
  }, [workbenchOpen, workbenchCtx?.setFooterExpanded]);

  if (!isTranslatePage) {
    return <>{children}</>;
  }

  if (!workbenchOpen) {
    return <>{children}</>;
  }

  if (!footerExpanded) return null;
  return <>{children}</>;
}
