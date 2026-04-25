import { AsyncLocalStorage } from 'node:async_hooks';

const cfEnvAls = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * 在非 OpenNext 的 Worker 入口（如独立 Queues consumer）中，`getCloudflareContext()` 往往不可用。
 * 在 `queue` / `scheduled` 等处理器内用本函数包裹业务逻辑，使 `postgres.ts` 的 Hyperdrive 解析能读到当前 `env`。
 */
export function runWithCloudflareEnv<T>(
  env: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  return cfEnvAls.run(env, fn);
}

export function tryGetAlsCfEnv(): Record<string, unknown> | undefined {
  return cfEnvAls.getStore();
}
