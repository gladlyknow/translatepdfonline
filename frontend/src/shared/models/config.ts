import { revalidateTag, unstable_cache } from 'next/cache';

import { db } from '@/core/db';
import { hasPostgresRuntimeConfig } from '@/core/db/postgres';
import { envConfigs } from '@/config';
import { config } from '@/config/db/schema';
import { tryGetAlsCfEnv } from '@/shared/lib/worker-runtime-env';
import {
  getAllSettingNames,
  publicSettingNames,
} from '@/shared/services/settings';

export type Config = typeof config.$inferSelect;
export type NewConfig = typeof config.$inferInsert;
export type UpdateConfig = Partial<Omit<NewConfig, 'name'>>;

export type Configs = Record<string, string>;

export const CACHE_TAG_CONFIGS = 'configs';

function formatDbErrorChain(e: unknown, maxDepth = 8): string {
  const parts: string[] = [];
  let cur: unknown = e;
  let d = 0;
  while (cur != null && d < maxDepth) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = cur.cause;
    } else if (typeof cur === 'object') {
      const o = cur as Record<string, unknown>;
      const code = o.code;
      const msg = o.message ?? o.detail;
      if (typeof msg === 'string') {
        parts.push(
          typeof code === 'string' ? `${code}: ${msg}` : msg
        );
      } else {
        parts.push(JSON.stringify(cur));
      }
      break;
    } else {
      parts.push(String(cur));
      break;
    }
    d++;
  }
  return parts.join(' → ');
}

export async function saveConfigs(configs: Record<string, string>) {
  const result = await db().transaction(async (tx: any) => {
    const configEntries = Object.entries(configs);
    const results: any[] = [];

    for (const [name, configValue] of configEntries) {
      const [upsertResult] = await tx
        .insert(config)
        .values({ name, value: configValue })
        .onConflictDoUpdate({
          target: config.name,
          set: { value: configValue },
        })
        .returning();

      results.push(upsertResult);
    }

    return results;
  });

  revalidateTag(CACHE_TAG_CONFIGS);

  return result;
}

export async function addConfig(newConfig: NewConfig) {
  const [result] = await db().insert(config).values(newConfig).returning();
  revalidateTag(CACHE_TAG_CONFIGS);

  return result;
}

/** 直读 `config` 表；无 Next incremental cache，供 Queues consumer 等与 `unstable_cache` 不兼容的运行时使用。 */
export async function loadConfigsFromDatabase(): Promise<Configs> {
  const configs: Record<string, string> = {};

  if (!hasPostgresRuntimeConfig()) {
    return configs;
  }

  const result = await db().select().from(config);
  if (!result) {
    return configs;
  }

  for (const row of result) {
    configs[row.name] = row.value ?? '';
  }

  return configs;
}

export const getConfigs = unstable_cache(loadConfigsFromDatabase, ['configs'], {
  revalidate: 3600,
  tags: [CACHE_TAG_CONFIGS],
});

function isIncrementalCacheMissingError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('incrementalCache');
}

export async function getAllConfigs(): Promise<Configs> {
  let dbConfigs: Configs = {};

  // only get configs from db in server side
  if (typeof window === 'undefined' && hasPostgresRuntimeConfig()) {
    try {
      if (tryGetAlsCfEnv()) {
        dbConfigs = await loadConfigsFromDatabase();
      } else {
        try {
          dbConfigs = await getConfigs();
        } catch (e) {
          if (isIncrementalCacheMissingError(e)) {
            dbConfigs = await loadConfigsFromDatabase();
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      console.error(
        '[db] get configs from db failed:',
        formatDbErrorChain(e)
      );
      dbConfigs = {};
    }
  }

  const settingNames = await getAllSettingNames();
  settingNames.forEach((key) => {
    const upperKey = key.toUpperCase();
    // use env configs if available
    if (process.env[upperKey]) {
      dbConfigs[key] = process.env[upperKey] ?? '';
    } else if (process.env[key]) {
      dbConfigs[key] = process.env[key] ?? '';
    }
  });

  const configs: Configs = {
    ...envConfigs,
    ...dbConfigs,
  };

  // 本地/CI 无数据库或未在后台写入 adsense_code 时：用 NEXT_PUBLIC_ADSENSE_CLIENT 补齐，
  // 使 /ads.txt 与 layout 中 AdSense 与 ADSENSE_CODE 覆盖逻辑一致（均需 ca-pub-… 前缀）。
  const adsFromPublic = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim();
  if (!String(configs.adsense_code ?? '').trim() && adsFromPublic) {
    configs.adsense_code = adsFromPublic;
  }

  return configs;
}

export async function getPublicConfigs(): Promise<Configs> {
  let allConfigs = await getAllConfigs();

  const publicConfigs: Record<string, string> = {};

  // get public configs
  for (const key in allConfigs) {
    if (publicSettingNames.includes(key)) {
      publicConfigs[key] = String(allConfigs[key]);
    }
  }

  return publicConfigs;
}
