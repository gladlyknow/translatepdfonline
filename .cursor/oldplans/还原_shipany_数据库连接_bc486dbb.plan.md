---
name: 还原 Shipany 数据库连接
overview: 将 [frontend/src/core/db/postgres.ts](frontend/src/core/db/postgres.ts) 恢复为与 [frontend/src/core/db_bak/postgres.ts](frontend/src/core/db_bak/postgres.ts) 等价的 Shipany 原始逻辑（Worker 每次新建 postgres 客户端、固定少量选项），并收敛 wrangler / env 中与 Worker 调优相关的改动；仅保留 OpenNext 所必需的最小运行时判定，否则生产 Worker 上 `isCloudflareWorker` 常为 false，Hyperdrive 不会生效。
todos:
  - id: rewrite-postgres-ts
    content: 用 db_bak/postgres.ts 为蓝本重写 postgres.ts，并加入 OpenNext 用的 getCloudflareContext try/catch + 保留 hasPostgresRuntimeConfig / getHyperdriveConnectionString 薄实现
    status: completed
  - id: strip-config-wrangler
    content: 从 config/index.ts、generate-wrangler.js、.env.example、wrangler.toml(.template) 移除 Worker PG 调优与 no_handle_cross_request 标志
    status: completed
  - id: verify-references-build
    content: grep 清理残留引用；跑 build / 必要 wrangler dev 冒烟
    status: completed
isProject: false
---

# 还原 Shipany 风格 Postgres / Hyperdrive 连接

## 目标与依据

- **代码基准**：[frontend/src/core/db_bak/postgres.ts](frontend/src/core/db_bak/postgres.ts)（你提供的「原始」实现）。
- **文档基准**：Shipany 保存页中要点——`wrangler.toml` 配 `[[hyperdrive]]` + `DATABASE_URL` 填 Supabase（如 pooler `:6543`）；Worker 上 `DB_SINGLETON_ENABLED = false`；连接参数可在 `postgres.ts` 调整（见 Supabase / Cloudflare 文档 HTML 片段）。

## 备份版行为摘要（将恢复）


| 场景       | 行为                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker   | `databaseUrl` 先取 `envConfigs.database_url`，若 `env` 含 `HYPERDRIVE` 则改为 `hyperdrive.connectionString`，打日志 `using Hyperdrive connection`                     |
| Worker   | **每次** `getPostgresDb()`：`postgres(url, { prepare: false, max: 1, idle_timeout: 10, connect_timeout: 5, ...search_path })` → `drizzle(client)`，**无模块级单例** |
| 非 Worker | 仍走 `DB_SINGLETON_ENABLED` 单例分支与非单例分支（与备份一致）                                                                                                               |
| 关闭连接     | `closePostgresDb` **仅**在单例模式下 `end` 全局 `client`（备份无 Worker 客户端清理）                                                                                         |


**刻意删除的「特殊处理」**（相对当前 [frontend/src/core/db/postgres.ts](frontend/src/core/db/postgres.ts)）：Hyperdrive 优先于 `DATABASE_URL` 的分支、`FORCE_DIRECT_*`、TLS 分支、`fetch_types`/`onnotice`/`onclose`、Supabase pooler 告警、`idle`/`connect_timeout`/`max` 环境变量调优、Worker 单例与 `workerDatabaseUrlCache`、一次性 `resolved` 诊断日志、`no_handle_cross_request_promise_resolution`（若你希望与 Shipany 模板完全一致）。

## 唯一必要的与备份差异（OpenNext）

备份仅用 `isCloudflareWorker`（`[globalThis.Cloudflare](frontend/src/shared/lib/env.ts)`）。OpenNext 生产 Worker 上该值**常为 false**，但请求内 `[getCloudflareContext()](https://opennext.js.org/cloudflare)` 仍可用。

- **建议**：用「**处于 Cloudflare 请求上下文**」作为 Worker 分支条件：`isCloudflareWorker === true` **或** `getCloudflareContext()` 不抛错且存在 `env`。
- **实现要点**：用 `try/catch` 包裹 `getCloudflareContext()`，在 Node/本地 `next dev` 中 catch 后走非 Worker 分支；在 Worker 请求内进入与备份相同的 Hyperdrive + `postgres` 选项逻辑。

若不保留这一点，仅机械粘贴备份代码，**Hyperdrive 在生产 OpenNext Worker 上可能永远不生效**（仍只用 `envConfigs.database_url`）。

## 需保留的薄封装（避免牵连 auth / config）

以下调用方仍依赖导出，应用**短实现**保留在同一文件末尾或极薄模块，避免再引入复杂逻辑：

- `[hasPostgresRuntimeConfig](frontend/src/core/db/postgres.ts)` — `[frontend/src/core/auth/config.ts](frontend/src/core/auth/config.ts)`、`[frontend/src/shared/models/config.ts](frontend/src/shared/models/config.ts)`
- `[getHyperdriveConnectionString](frontend/src/core/db/postgres.ts)` — `AUTH_DB_DIAG` 诊断（可选保留 try/catch 读 binding）

逻辑可简化为：`DATABASE_URL` / `envConfigs.database_url` 任一有值，或 Hyperdrive `connectionString` 可读 → `hasPostgresRuntimeConfig === true`。

## 配置文件收敛

- **[frontend/wrangler.toml.template](frontend/wrangler.toml.template)** 与生成后的 **[frontend/wrangler.toml](frontend/wrangler.toml)**：`compatibility_flags` 恢复为 **仅** `["nodejs_compat"]`（与 Shipany 示例一致）；保留 `[[hyperdrive]]` 块。
- **[frontend/scripts/generate-wrangler.js](frontend/scripts/generate-wrangler.js)**：从 `WRANGLER_VARS_FROM_BUILD` 移除仅用于旧调优的键：`WORKER_PG_CONNECT_TIMEOUT`、`WORKER_HYPERDRIVE_PG_SSL`、`WORKER_PG_IDLE_TIMEOUT`、`WORKER_PG_SOCKET_LOG`（若列表中已无其它用途）。
- **[frontend/src/config/index.ts](frontend/src/config/index.ts)**：删除 `worker_pg_connect_timeout`、`worker_hyperdrive_pg_ssl`、`worker_pg_idle_timeout` 等仅服务旧 `postgres.ts` 的字段。
- **[frontend/.env.example](frontend/.env.example)**：删除上述 Worker PG 调优相关注释/占位。

**关于 `effectiveDatabaseUrlFromEnv`（build 时剥离 Hyperdrive 代理 URL）**：Shipany 文档推荐 `DATABASE_URL` 用 **Supabase 直连串**，一般不需要剥离。若你确认 CI/本地 build **从不**把 `*.hyperdrive.cloudflare.com` 写进 `DATABASE_URL`，可一并简化为 `process.env.DATABASE_URL ?? ''`；否则建议**暂时保留**现有剥离逻辑，仅避免 `next build` 在 Node 里解析 Hyperdrive 主机名失败——此项可在实施时二选一并在注释中写清。

## 不需改动的文件

- **[frontend/src/core/db/index.ts](frontend/src/core/db/index.ts)**：与 [db_bak/index.ts](frontend/src/core/db_bak/index.ts) 一致，无需为本次还原改动。

## 实施顺序建议

1. 重写 `postgres.ts`（Shipany 主体 + OpenNext 判定 + 两个薄导出）。
2. 收敛 `config/index.ts`、`.env.example`、`generate-wrangler.js`、`wrangler.toml.template`（并重新生成/手改 `wrangler.toml` 与模板一致）。
3. 全局搜索 `worker_pg_`、`WORKER_HYPERDRIVE`、`FORCE_DIRECT_DATABASE_URL` 确认无残留引用。
4. 本地 `pnpm` build 与（如有）`wrangler dev` 冒烟：首页与 `/api/auth/get-session` 能连库。

## 风险说明（如实告知）

备份版在 Worker 上**每次** `getPostgresDb()` 新建客户端，连接压力大于单例；这是你明确选择的「还原简单行为」。若之后又出现 Hung/超时，应优先按 Shipany/Cloudflare 文档检查 **Hyperdrive 源串、Supabase pooler URI、`DB_SINGLETON_ENABLED=false`**，而不是再堆驱动层分支。