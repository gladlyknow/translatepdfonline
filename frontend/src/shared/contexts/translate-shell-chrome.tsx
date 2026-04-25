'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type TranslateShellChromeContextValue = {
  headerCollapsed: boolean;
  setHeaderCollapsed: (next: boolean) => void;
};

const TranslateShellChromeContext =
  createContext<TranslateShellChromeContextValue | null>(null);

export function TranslateShellChromeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [headerCollapsed, setHeaderCollapsedState] = useState(false);
  const setHeaderCollapsed = useCallback((next: boolean) => {
    setHeaderCollapsedState(next);
  }, []);
  const value = useMemo(
    () => ({ headerCollapsed, setHeaderCollapsed }),
    [headerCollapsed, setHeaderCollapsed]
  );
  return (
    <TranslateShellChromeContext.Provider value={value}>
      {children}
    </TranslateShellChromeContext.Provider>
  );
}

export function useTranslateShellChromeOptional() {
  return useContext(TranslateShellChromeContext);
}

