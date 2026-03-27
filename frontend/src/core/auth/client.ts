import { oneTapClient } from 'better-auth/client/plugins';
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

// create default auth client, without plugins
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

// export default auth client methods
export const { useSession, signIn, signUp, signOut } = authClient;

// get auth client with plugins
export function getAuthClient(configs: Record<string, string>) {
  const authClient = createAuthClient({
    baseURL: authBaseURL,
    plugins: getAuthPlugins(configs),
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

  return authClient;
}

// get auth plugins with configs
function getAuthPlugins(configs: Record<string, string>) {
  const authPlugins = [];

  // 服务端在 getPublicConfigs 中下发 google_one_tap_server_ready（不暴露 secret）
  if (
    configs.google_client_id &&
    configs.google_one_tap_enabled === 'true' &&
    configs.google_one_tap_server_ready === 'true'
  ) {
    authPlugins.push(
      oneTapClient({
        clientId: configs.google_client_id,
        autoSelect: false,
        cancelOnTapOutside: false,
        context: 'signin',
        // GIS 已弃用 use_fedcm_for_prompt（浏览器侧 FedCM 由 Chrome 策略决定）。
        // 显式关闭 FedCM「按钮」路径；One Tap prompt 仍可能走 FedCM，故在 app 层延迟调用并支持关闭自动弹出。
        additionalOptions: {
          use_fedcm_for_button: false,
        },
        promptOptions: {
          baseDelay: 1000,
          maxAttempts: 1,
        },
      })
    );
  }

  return authPlugins;
}
