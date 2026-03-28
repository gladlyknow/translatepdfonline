import { createAuthClient } from 'better-auth/react';

import { envConfigs } from '@/config';

function createGetSessionThrottledFetch({
  minIntervalMs,
}: {
  minIntervalMs: number;
}): typeof fetch {
  const inFlight = new Map<string, Promise<Response>>();
  let lastStartedAt = 0;

  function isGetSessionRequest(input: RequestInfo | URL, init?: RequestInit) {
    const method =
      (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      )?.toUpperCase?.() ?? 'GET';

    if (method !== 'GET') return false;

    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const base =
      typeof window !== 'undefined' ? window.location.origin : 'http://local';
    const url = new URL(rawUrl, base);
    return url.pathname.endsWith('/get-session');
  }

  function getDedupeKey(input: RequestInfo | URL) {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const base =
      typeof window !== 'undefined' ? window.location.origin : 'http://local';
    const url = new URL(rawUrl, base);
    // Drop query/hash: session endpoint should be safe to dedupe across params.
    return `GET ${url.origin}${url.pathname}`;
  }

  return async (input, init) => {
    if (!minIntervalMs || !isGetSessionRequest(input, init)) {
      return fetch(input, init);
    }

    const key = getDedupeKey(input);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const now = Date.now();
    const waitMs = Math.max(0, lastStartedAt + minIntervalMs - now);

    const promise = (async () => {
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
      lastStartedAt = Date.now();
      return fetch(input, init);
    })().finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, promise);
    return promise;
  };
}

// Client-side throttle to avoid get-session request storms in browser.
// Note: must be NEXT_PUBLIC_* to be inlined into client bundles.
const AUTH_GET_SESSION_MIN_INTERVAL_MS =
  Number(process.env.NEXT_PUBLIC_AUTH_GET_SESSION_MIN_INTERVAL_MS) || 2000;

const isBrowser = typeof window !== 'undefined';
// On the client, always talk to the same-origin auth route with an absolute URL.
// Better Auth 要求 baseURL 为完整 URL，不能是相对路径。
const authBaseURL = isBrowser
  ? `${window.location.origin}/api/auth`
  : envConfigs.auth_url;

// Google 登录：仅用弹窗内 signIn.social → OAuth 重定向，不加载 accounts.google.com/gsi/client（无 One Tap）。
export const authClient = createAuthClient({
  baseURL: authBaseURL,
  fetchOptions: {
    // Avoid amplifying request storms (e.g. during env/db switching in dev).
    // IMPORTANT: auth mutations (sign-in/sign-up) must be non-retriable,
    // otherwise we may send verification emails multiple times.
    retry: 0,
    customFetchImpl: createGetSessionThrottledFetch({
      minIntervalMs: AUTH_GET_SESSION_MIN_INTERVAL_MS,
    }),
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;
