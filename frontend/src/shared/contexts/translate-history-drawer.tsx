'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from '@/core/i18n/navigation';

import { TranslateHistoryDrawerPanel } from '@/shared/components/translate/TranslateHistoryDrawerPanel';

type TranslateHistoryDrawerContextValue = {
  openHistory: () => void;
  closeHistory: () => void;
  isOpen: boolean;
};

const TranslateHistoryDrawerContext =
  createContext<TranslateHistoryDrawerContextValue | null>(null);

export function TranslateHistoryDrawerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const openHistory = useCallback(() => setOpen(true), []);

  const clearHistoryHash = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#translate-history') return;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`
    );
  }, []);

  const closeHistory = useCallback(() => {
    setOpen(false);
    clearHistoryHash();
  }, [clearHistoryHash]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) clearHistoryHash();
    },
    [clearHistoryHash]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#translate-history') return;
    setOpen(true);
  }, [pathname]);

  const value = useMemo(
    () => ({
      openHistory,
      closeHistory,
      isOpen: open,
    }),
    [open, openHistory, closeHistory]
  );

  return (
    <TranslateHistoryDrawerContext.Provider value={value}>
      {children}
      <TranslateHistoryDrawerPanel open={open} onOpenChange={handleOpenChange} />
    </TranslateHistoryDrawerContext.Provider>
  );
}

export function useTranslateHistoryDrawerOptional() {
  return useContext(TranslateHistoryDrawerContext);
}

export function useTranslateHistoryDrawer(): TranslateHistoryDrawerContextValue {
  const v = useContext(TranslateHistoryDrawerContext);
  if (!v) {
    throw new Error('useTranslateHistoryDrawer must be used within TranslateHistoryDrawerProvider');
  }
  return v;
}
