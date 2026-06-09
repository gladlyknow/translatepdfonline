---
name: Hyperdrive 优先与 wrangler
overview: 当前 Worker 同时配置 DATABASE_URL（Supabase pooler）与 HYPERDRIVE 时，代码仍优先直连 pooler，导致 CONNECT_TIMEOUT；改为在 Cloudflare 请求上下文中优先使用 Hyperdrive connectionString，并恢复 wrangler 模板中的 [[hyperdrive]] 与文档说明。
todos:
  - id: postgres-prefer-hyperdrive
    content: postgres.ts：Worker 上下文优先 hyperUrl，可选 FORCE_DIRECT_DATABASE_URL_ON_WORKER；更新注释
    status: completed
  - id: wrangler-hyperdrive-block
    content: wrangler.toml.template 恢复 [[hyperdrive]] + localConnectionString/ env 说明；可选 generate-wrangler 注入 HYPERDRIVE_CONFIG_ID
    status: completed
  - id: docs-env-example
    content: .env.example + generate-wrangler 头注释：Hyperdrive 源库、Worker 双配置与运行时优先级
    status: completed
isProject: false
---

# Worker 优先 Hyperdrive + wrangler 配置计划

## 根因（与当前代码的关系）

`[getPostgresDb()](frontend/src/core/db/postgres.ts)` 约 178–192 行逻辑为：**先**用 `process.env.DATABASE_URL` / `envConfigs.database_url`，**仅当二者皆空**才用 `getHyperdriveConnectionString()`。

因此你在 Worker 的 `[vars]` 里同时放了 Supabase pooler 的 `DATABASE_URL` 并绑定了 `HYPERDRIVE` 时，**实际仍直连** `aws-*.pooler.supabase.com:6543`，Hyperdrive **不会生效**，与「通过 Hyperdrive 加速」的部署文档目标相反；日志里的 `CONNECT_TIMEOUT` 仍指向 pooler 即属此类。

## 目标行为


| 运行环境                                                                                                                       | 期望使用的连接串                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Cloudflare Worker / OpenNext 请求内（`hasCloudflareRuntimeContext()` 或 `isCloudflareWorker`）且 `HYPERDRIVE.connectionString` 非空 | **优先 Hyperdrive 代理 URL**                                                        |
| 上述若 Hyperdrive 为空                                                                                                          | 回退 `DATABASE_URL`                                                               |
| 本地 `next dev` / `next build`（无 CF context）                                                                                 | **仅用** `DATABASE_URL`（与现有 `config/index.ts` 剥离 Hyperdrive 代理 host 的 build 逻辑一致） |


可选（建议写入注释）：新增 `**FORCE_DIRECT_DATABASE_URL_ON_WORKER=1`** 时即使在 Worker 也强制走 `DATABASE_URL`，便于对比排错。

## 代码改动

**文件 `[frontend/src/core/db/postgres.ts](frontend/src/core/db/postgres.ts)`**

- 重写 `databaseUrl` / `usedHyperdrive` 判定块（约 178–192 行）为：
  1. `hyperUrl = getHyperdriveConnectionString()`
  2. 若 `(hasCloudflareRuntimeContext() || isCloudflareWorker) && hyperUrl` → `databaseUrl = hyperUrl`，`usedHyperdrive = true`，`console.log('[db] using Hyperdrive connection')`
  3. 否则若 `fromProcess || fromConfig` → 直连 URL
  4. 否则若 `hyperUrl` → Hyperdrive（无 DATABASE_URL 的 Worker 场景）
  5. 若实现 `FORCE_DIRECT_DATABASE_URL_ON_WORKER`，在步骤 2 前短路为直连
- 更新文件头注释与 `hasPostgresRuntimeConfig` 旁注释：说明 **Worker 上 Hyperdrive 优先**。
- `warnIfSupabasePoolerMissingPgbouncer` 仅对 **最终** `databaseUrl` 含 `pooler.supabase.com` 生效；走 Hyperdrive 时 host 为 `*.hyperdrive.cloudflare.com`，**不会误报**，无需改函数逻辑。

## Wrangler / 模板与脚本

**文件 `[frontend/wrangler.toml.template](frontend/wrangler.toml.template)`**

- 在 `[vars]` 块后增加 `[[hyperdrive]]` 示例：
  - `binding = "HYPERDRIVE"`
  - `id`：使用占位符（见下）或文档要求用户替换为 Dashboard 中 Hyperdrive 配置 ID
  - `localConnectionString`：可选占位或注释说明——本地勿提交密码，推荐官方方式使用环境变量 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`（见 [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)）

**文件 `[frontend/scripts/generate-wrangler.js](frontend/scripts/generate-wrangler.js)`**（可选但推荐）

- 增加占位符替换：例如构建环境变量 `HYPERDRIVE_CONFIG_ID`，生成时写入 `wrangler.toml` 的 `id`；未设置则保留 `REPLACE_ME` 或留注释提醒，避免误提交真实 ID 到仓库时可只配 CI。

部署后执行 `node scripts/generate-wrangler.js` 重新生成 `[frontend/wrangler.toml](frontend/wrangler.toml)`。

## 文档与示例

**文件 `[frontend/.env.example](frontend/.env.example)`**

- 增加一小节：**生产 Worker**：在 Cloudflare 创建 Hyperdrive，**源库**填 Supabase 连接串（含 `sslmode` / `pgbouncer=true` 等以官方为准）；Worker 绑定 `HYPERDRIVE`；`DATABASE_URL` 可保留为 Supabase（用于直连回退、`FORCE_DIRECT_*` 或部分构建步骤），但**运行时连库以 Hyperdrive 为准**。

`**[frontend/scripts/generate-wrangler.js](frontend/scripts/generate-wrangler.js)`** 头部注释

- 一句说明：`DATABASE_PROVIDER` / `DATABASE_URL` 进 `[vars]` 与 Hyperdrive 并存时，**应用层优先 Hyperdrive**。

## 运维校验

- Cloudflare Dashboard：Hyperdrive 配置的 **Origin** 为 Supabase（建议与面板 Transaction pooler URI 一致）。
- 部署后日志应出现 `**[db] using Hyperdrive connection`**，`[db] resolved (once)` 里 `**hyperdrive_host=true`**（host 含 `hyperdrive.cloudflare.com`），且不应再对 pooler host 出现高频 `CONNECT_TIMEOUT`（除非回退直连）。

## 不在此计划内

- 修改 Supabase 官方文档原文；仅在仓库内对齐行为与说明。
- 重新引入已移除的 Hyperdrive 相关业务功能以外的重构。

