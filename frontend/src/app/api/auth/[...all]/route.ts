import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/core/auth';
import { isCloudflareWorker } from '@/shared/lib/env';
import { enforceMinIntervalRateLimit } from '@/shared/lib/rate-limit';

function maybeRateLimitGetSession(request: Request): Response | null {
  const url = new URL(request.url);
  // better-auth session endpoint is served under this catch-all route.
  if (isCloudflareWorker || !url.pathname.endsWith('/api/auth/get-session')) {
    return null;
  }

  const intervalMs =
    Number(process.env.AUTH_GET_SESSION_MIN_INTERVAL_MS) ||
    // default: 800ms (enough to stop request storms but still responsive)
    800;

  return enforceMinIntervalRateLimit(request, {
    intervalMs,
    keyPrefix: 'auth-get-session',
  });
}

export async function POST(request: Request) {
  const limited = maybeRateLimitGetSession(request);
  if (limited) {
    return limited;
  }

  try {
    const auth = await getAuth(request);
    const handler = toNextJsHandler(auth.handler);
    return await handler.POST(request);
  } catch (e) {
    console.error(
      '[api/auth] POST',
      new URL(request.url).pathname,
      e instanceof Error ? e.message : e,
      e instanceof Error ? e.stack : ''
    );
    throw e;
  }
}

export async function GET(request: Request) {
  const limited = maybeRateLimitGetSession(request);
  if (limited) {
    return limited;
  }

  try {
    const auth = await getAuth(request);
    const handler = toNextJsHandler(auth.handler);
    return await handler.GET(request);
  } catch (e) {
    console.error(
      '[api/auth] GET',
      new URL(request.url).pathname,
      e instanceof Error ? e.message : e,
      e instanceof Error ? e.stack : ''
    );
    throw e;
  }
}
