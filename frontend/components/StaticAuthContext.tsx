"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, clearSessionTokenCache, setBackendToken, type UserMeResponse } from "@/lib/api";

const BACKEND_TOKEN_STORAGE_KEY = "backend_access_token";

type StaticAuthContextValue = {
  user: UserMeResponse | null;
  loading: boolean;
  setToken: (token: string | null) => void;
  refreshUser: () => Promise<void>;
};

const StaticAuthContext = createContext<StaticAuthContextValue | null>(null);

export function useStaticAuth(): StaticAuthContextValue | null {
  return useContext(StaticAuthContext);
}

export function StaticAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      const token = localStorage.getItem(BACKEND_TOKEN_STORAGE_KEY);
      if (!token || typeof token !== "string") {
        setUser(null);
        return;
      }
      const me = await api.getMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const setToken = useCallback((token: string | null) => {
    setBackendToken(token);
    if (!token) {
      clearSessionTokenCache();
      setUser(null);
      return;
    }
    setLoading(true);
    api.getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const value: StaticAuthContextValue = {
    user,
    loading,
    setToken,
    refreshUser,
  };

  return (
    <StaticAuthContext.Provider value={value}>
      {children}
    </StaticAuthContext.Provider>
  );
}
