'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type TranslateFooterWorkbenchContextValue = {
  /** True when /translate has an open document (workbench + preview). */
  workbenchOpen: boolean;
  setWorkbenchOpen: (next: boolean) => void;
};

const TranslateFooterWorkbenchContext =
  createContext<TranslateFooterWorkbenchContextValue | null>(null);

export function TranslateFooterWorkbenchProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [workbenchOpen, setWorkbenchOpenState] = useState(false);
  const setWorkbenchOpen = useCallback((next: boolean) => {
    setWorkbenchOpenState(next);
  }, []);

  const value = useMemo(
    () => ({ workbenchOpen, setWorkbenchOpen }),
    [workbenchOpen, setWorkbenchOpen]
  );

  return (
    <TranslateFooterWorkbenchContext.Provider value={value}>
      {children}
    </TranslateFooterWorkbenchContext.Provider>
  );
}

export function useTranslateFooterWorkbenchOptional() {
  return useContext(TranslateFooterWorkbenchContext);
}
