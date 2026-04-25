import { getCloudflareContext } from '@opennextjs/cloudflare';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { envConfigs } from '@/config';
import { isCloudflareWorker } from '@/shared/lib/env';
import { tryGetAlsCfEnv } from '@/shared/lib/worker-runtime-env';

// Global database connection instance (singleton pattern) — non-Worker only
let dbInstance: ReturnType<typeof drizzle> | null = null;
let client: ReturnType<typeof postgres> | null = null;

/** OpenNext 生产 Worker 常无 `globalThis.Cloudflare`，但 fetch 内仍有 `getCloudflareContext()`。 */
function tryGetCfEnv(): Record<string, unknown> | undefined {
  const fromAls = tryGetAlsCfEnv();
  if (fromAls) return fromAls;
  try {
    const ctx = getCloudflareContext() as unknown as {
      env?: Record<string, unknown>;
    };
    return ctx?.env;
  } catch {
    return undefined;
  }
}

function isShipanyWorkersRuntime(): boolean {
  if (isCloudflareWorker) return true;
  return tryGetCfEnv() != null;
}

export function getHyperdriveConnectionString(): string | undefined {
  const env = tryGetCfEnv();
  const hyper = env?.HYPERDRIVE as { connectionString?: string } | undefined;
  const s = hyper?.connectionString?.trim();
  return s || undefined;
}

export function hasPostgresRuntimeConfig(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      envConfigs.database_url?.trim() ||
      getHyperdriveConnectionString()
  );
}

export function getPostgresDb() {
  let databaseUrl = envConfigs.database_url;

  const schemaName = (envConfigs.db_schema || 'public').trim();
  const connectionSchemaOptions =
    schemaName && schemaName !== 'public'
      ? { connection: { options: `-c search_path=${schemaName}` } }
      : {};

  const cfEnv = tryGetCfEnv();
  const onWorkers = isShipanyWorkersRuntime();

  if (onWorkers && cfEnv && 'HYPERDRIVE' in cfEnv) {
    const hyperdrive = cfEnv.HYPERDRIVE as { connectionString?: string };
    if (hyperdrive?.connectionString) {
      databaseUrl = hyperdrive.connectionString;
      console.log('using Hyperdrive connection');
    }
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  // Shipany：Cloudflare Workers 每次新建连接，不做单例
  if (onWorkers) {
    console.log('in Cloudflare Workers environment');
    const workerClient = postgres(databaseUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 10,
      connect_timeout: 5,
      ...connectionSchemaOptions,
    });

    return drizzle(workerClient);
  }

  if (envConfigs.db_singleton_enabled === 'true') {
    if (dbInstance) {
      return dbInstance;
    }

    client = postgres(databaseUrl, {
      prepare: false,
      max: Number(envConfigs.db_max_connections) || 1,
      idle_timeout: 30,
      connect_timeout: 10,
      ...connectionSchemaOptions,
    });

    dbInstance = drizzle({ client });
    return dbInstance;
  }

  const serverlessClient = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ...connectionSchemaOptions,
  });

  return drizzle({ client: serverlessClient });
}

export async function closePostgresDb() {
  if (envConfigs.db_singleton_enabled && client) {
    await client.end();
    client = null;
    dbInstance = null;
  }
}
