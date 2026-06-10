import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';

export default defineCloudflareConfig({
  // R2 持久化 ISR 缓存 — Worker 冷启动后缓存不丢失
  // 复用已有的 translatepdfonline 桶，与文档存储共用一个桶
  // 无需额外创建 bucket
  incrementalCache: r2IncrementalCache,
});
