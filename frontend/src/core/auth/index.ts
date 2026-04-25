import { betterAuth, BetterAuthOptions } from 'better-auth';

// get auth instance in server side
export async function getAuth(request?: Request) {
  const { getAllConfigs } = await import('@/shared/models/config');
  const configs = await getAllConfigs();
  const requestOrigin = request ? new URL(request.url).origin : undefined;

  const { getAuthOptions } = await import('./config');
  const authOptions = await getAuthOptions(configs, { requestOrigin });

  return betterAuth(authOptions as BetterAuthOptions);
}
