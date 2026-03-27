import { getCloudflareContext } from '@opennextjs/cloudflare';

export type WorkerBindingSource = 'process_env' | 'cloudflare_env' | null;

/**
 * Read Dashboard Variables / Secrets at runtime.
 *
 * OpenNext 文档：生产环境变量在 Cloudflare 控制台配置后，运行时走 **`process.env`**。
 * `getCloudflareContext().env` 更偏向 **绑定**（KV、R2、Hyperdrive 等）；纯字符串变量未必在上面。
 *
 * 使用 `process.env[key]`（动态 key）避免部分打包器对固定 `process.env.FOO` 的错误内联。
 */
export function getWorkerBindingMeta(key: string): {
  value: string;
  from: WorkerBindingSource;
} {
  try {
    const pe = process.env as Record<string, string | undefined>;
    const fromProcess = typeof pe[key] === 'string' ? pe[key]!.trim() : '';
    if (fromProcess) return { value: fromProcess, from: 'process_env' };
  } catch {
    /* */
  }

  try {
    const wrapped = getCloudflareContext() as unknown as {
      env?: Record<string, unknown>;
    };
    const raw = wrapped?.env?.[key];
    if (typeof raw === 'string' && raw.trim()) {
      return { value: raw.trim(), from: 'cloudflare_env' };
    }
  } catch {
    /* outside a Cloudflare request */
  }

  return { value: '', from: null };
}

/** Convenience: resolved string only. */
export function getWorkerBindingString(key: string): string {
  return getWorkerBindingMeta(key).value;
}

/** 仅 key 名，用于排错（不输出值）。 */
export function getWorkerEnvDebugKeyHints(): {
  process_env_keys_matching: string[];
  worker_env_keys: string[];
} {
  const process_env_keys_matching = Object.keys(process.env).filter((k) =>
    /TRANSLATE|BABELDOC|FC_|^FC$/i.test(k)
  );
  let worker_env_keys: string[] = [];
  try {
    const wrapped = getCloudflareContext() as unknown as {
      env?: Record<string, unknown>;
    };
    if (wrapped?.env && typeof wrapped.env === 'object') {
      worker_env_keys = Object.keys(wrapped.env);
    }
  } catch {
    /* */
  }
  return { process_env_keys_matching, worker_env_keys };
}
