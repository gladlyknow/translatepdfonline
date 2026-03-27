import { betterAuth, BetterAuthOptions } from 'better-auth';

// get auth instance in server side
export async function getAuth() {
  const { getAllConfigs } = await import('@/shared/models/config');
  const configs = await getAllConfigs();

  const { getAuthOptions } = await import('./config');
  const authOptions = await getAuthOptions(configs);

  return betterAuth(authOptions as BetterAuthOptions);
}
