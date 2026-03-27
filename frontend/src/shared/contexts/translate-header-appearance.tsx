'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type TranslateHeaderAppearance = 'onDark' | 'onLight';

type Ctx = {
  appearance: TranslateHeaderAppearance;
  setAppearance: (v: TranslateHeaderAppearance) => void;
};

const TranslateHeaderAppearanceContext = createContext<Ctx | null>(null);

export function TranslateHeaderAppearanceProvider({
  children,
  defaultAppearance = 'onDark',
}: {
  children: ReactNode;
  defaultAppearance?: TranslateHeaderAppearance;
}) {
  const [appearance, setAppearanceState] =
    useState<TranslateHeaderAppearance>(defaultAppearance);

  const setAppearance = useCallback((v: TranslateHeaderAppearance) => {
    setAppearanceState(v);
  }, []);

  const value = useMemo(
    () => ({ appearance, setAppearance }),
    [appearance, setAppearance]
  );

  return (
    <TranslateHeaderAppearanceContext.Provider value={value}>
      {children}
    </TranslateHeaderAppearanceContext.Provider>
  );
}

export function useTranslateHeaderAppearance() {
  const ctx = useContext(TranslateHeaderAppearanceContext);
  if (!ctx) {
    throw new Error(
      'useTranslateHeaderAppearance must be used within TranslateHeaderAppearanceProvider'
    );
  }
  return ctx;
}
