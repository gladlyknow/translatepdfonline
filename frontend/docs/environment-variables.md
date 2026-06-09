# 环境变量说明（本地 / CI 构建 / Cloudflare Workers）

> **为什么 `.env.development` 配满了线上还是没有？** → 必读 **[cloudflare-env-真相.md](./cloudflare-env-真相.md)**（`.env.*` 被 gitignore，不进 Worker）。

## 1. 本地开发（`.env.development`）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | **直连** Postgres（Neon/Supabase/本地），不要用 Hyperdrive 代理串 |
| `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | **可选**。`pnpm dev` 使用 OpenNext + `wrangler.toml` 里 **`[[hyperdrive]]`** 时，Wrangler 需要此变量指向本地要连的 Postgres。**未设置时** `next.config.mjs` 会自动用上面的 **`DATABASE_URL`**（须为直连串），否则报错 `no local hyperdrive connection string` 且 dev 无法启动。 |
| `DB_SCHEMA` | 非 `public` 时与库一致 |
| `R2_BUCKET` | 与 `R2_BUCKET_NAME` / 后台一致 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API 凭证 |
| `R2_ENDPOINT` | `https://<账户ID>.r2.cloudflarestorage.com` |
| `AUTH_SECRET` | Better Auth |
| `NEXT_PUBLIC_APP_URL` | 如 `http://localhost:3000` |

翻译、预签名、后台里存的 `r2_*` 可与上面并存；代码会合并 **环境变量 + 数据库 `config` 表**。

---

## 2. CI / Cloudflare Pages「构建」阶段（`next build`）

构建在 **Node** 里跑，**不能**用 `*.hyperdrive.cloudflare.com` 当 `DATABASE_URL`（会 DNS 失败）。

任选其一：

- **`DATABASE_URL`** = 与生产相同的 **源库**连接串（推荐），或  
- **不设** `DATABASE_URL`：静态生成阶段会跳过读库（依赖默认配置）。

### 构建日志里反复出现 `[db] DATABASE_URL is a Hyperdrive proxy…` / `[auth-db] hasPostgresRuntimeConfig: false`？

| 现象 | 含义 |
|------|------|
| **Hyperdrive 提示** | CI 的 `DATABASE_URL` 填的是 **Hyperdrive 代理串**（`*.hyperdrive.cloudflare.com`）。Node 在 `next build` 里不能解析该主机名，因此 **`envConfigs.database_url` 在构建时被置空**，避免静态生成去连库报错。 |
| **`hasPostgresRuntimeConfig: false`** | 构建阶段跑在 **Node**，不是 Worker：`getCloudflareContext().env` 里没有 **HYPERDRIVE** 绑定，`isCloudflareWorker` 也是 false。这在 **SSG 时是正常的**，不代表线上 Worker 坏了。 |
| **线上真实请求** | Worker 里会绑定 **HYPERDRIVE**，`hasPostgresRuntimeConfig` 应为 true，数据库照常使用。 |

若要 **减少构建日志噪音**：在 Cloudflare 里为 **Build** 环境单独设 **`DATABASE_URL` = 源库直连串**，或构建阶段 **不注入** `DATABASE_URL`（仅生产 Worker 保留 Hyperdrive Secret）。

---

## 2.1 `wrangler.toml` / `wrangler.toml.template` 会不会覆盖控制台变量？

**一般不会。** 本仓库里 `[vars]` 只有注释、没有写死键值；CI 用 `scripts/generate-wrangler.js` 从 **`wrangler.toml.template`** 生成 **`wrangler.toml`**，同样不往 `[vars]` 里注入密钥。

- **控制台**里配的 **Variables / Secrets** 仍由 Cloudflare 在运行时注入 Worker（与空的 `[vars]` 并存）。
- 若你在本地改过 `wrangler.toml` 并写了具体 `[vars] = { ... }`，`wrangler deploy` 时可能与控制台合并策略冲突——**推荐 `[vars]` 留空，只用控制台**（与模板一致）。

---

## 2.2 ⚠️ 为什么「构建」里配满了变量，Worker 里 `process.env` 还是空的？

Cloudflare 文档写明：**「Build variables and secrets」只在构建过程可用，不会在运行时可用**；运行时变量要在 **Worker → Settings → Variables and secrets**（与 Git/构建页 **不是同一处**）。

因此：你把 `TRANSLATE_FC_URL` 等写在 **Git 集成 / 构建配置** 的「变量和机密」里时，**`--keep-vars` 也帮不上**——`keep-vars` 保留的是 **运行时** 控制台里已有的变量，**不是**把「构建变量」搬进 Worker。

**本仓库对策**：`build:opennext:ci` 第一步的 **`scripts/generate-wrangler.js`** 会从 **构建环境** `process.env` 读取一份 **白名单键名**（与常见生产控制台一致），写入生成的 **`wrangler.toml` → `[vars]`**，再随 **`wrangler deploy`** 打进 Worker，这样 **只维护「构建」里那一套** 即可在运行时读到（构建日志里应出现 `Injected N keys into [vars]`）。

**若仍要两套都配**：在 **Worker → Settings → Variables and secrets** 再配一份运行时变量，并继续使用 `wrangler deploy --keep-vars`。

**另**：若 `[vars]` 为空且未用 `keep-vars`，`wrangler deploy` 也可能清空仅存在于运行时的变量——见 Cloudflare Wrangler 文档。

### 2.2.1 日志里 `process_env_keys_matching: []` 且只有 `worker_env_keys: ["HYPERDRIVE","ASSETS"]`

说明 **运行时 `process.env` 里没有业务变量**（只有 Hyperdrive / ASSETS 绑定）。常见原因是你把变量只配在 **Git/Build 的「变量和机密」**——按 Cloudflare 设计它们 **本就不会** 出现在运行时；**不是** `keep-vars` 没生效。

部署成功后看 **构建日志**：应有 **`[generate-wrangler] Injected N keys into [vars]`**（N>0）。没有则说明构建机没带上你的构建变量，或脚本白名单缺键（可到 `scripts/generate-wrangler.js` 的 `WRANGLER_VARS_FROM_BUILD` 补名）。

**或**：到 **Worker → Settings → Variables and secrets**（运行时）再配一遍，并保留 `wrangler deploy --keep-vars`。

---

## 3. Cloudflare Workers「运行」阶段（Dashboard / wrangler Secrets）

| 变量 / 绑定 | 说明 |
|-------------|------|
| **`HYPERDRIVE`** 绑定 | 绑定名为 **`HYPERDRIVE`**；运行时 Postgres 优先走此连接串 |
| `DATABASE_URL`（可选） | 可为 Hyperdrive 代理 URL 或源库 URL；仅 Hyperdrive 时可为空，但需绑定 `HYPERDRIVE` |
| **`R2_*`（可选）** | `R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_ENDPOINT`；不配则使用数据库 **`config` 表** 中的 `r2_*`（需能连上库） |
| `AUTH_SECRET`、`TRANSLATE_*` 等 | 按功能按需配置 |

要点：**只有 Hyperdrive、没有 `DATABASE_URL` Secret 时**，应用仍会通过 `HYPERDRIVE` 连库并读取 `config` 表（含 R2）。

---

## 3.1 防止运行时变量被覆盖（本项目强约束）

本项目存在 **主 Worker** 与 **队列 Worker** 两个部署对象，变量分别独立保存。发布时必须同时遵守：

- 主 Worker：`npx wrangler deploy --keep-vars`
- 队列 Worker：`npx wrangler deploy -c wrangler.queues.toml --keep-vars`
- 禁止使用无 `--keep-vars` 的部署路径（`package.json` 中 `cf:deploy:no-keep` 已封禁）。

发布前后请核对：

1. Worker 名称是否正确（主：`translatepdfonline`；队列：`translatepdfonline-quenues`）  
2. 环境是否正确（develop / production）  
3. 运行时 Variables and secrets 的键集合是否保持不变  
4. 队列 Worker 是否配置 `OCR_DISPATCH_URL` 与 `OCR_DISPATCH_SECRET`

---

## 4. 命名对照（易混）

| 环境变量（代码里 `translate-r2` 等） | 后台/数据库 `config` 表 |
|-------------------------------------|-------------------------|
| `R2_ACCESS_KEY_ID` | `r2_access_key` |
| `R2_SECRET_ACCESS_KEY` | `r2_secret_key` |
| `R2_BUCKET` | `r2_bucket_name` |

---

## 5. 翻译 FC（`POST /api/translate`）

Worker 上需同时满足才会 **向 FC 发 HTTP 请求**：

1. **FC URL** 已配置（非空），变量名须为下列之一（代码会读）：
   - **`TRANSLATE_FC_URL`**（推荐），或
   - **`BABELDOC_FC_URL`**（别名），或
   - 后台 **设置 → General → PDF translate (FC) → Translate FC URL**（`translate_fc_url` 入库）。
2. **FC Secret**（若 FC 需要）：**`TRANSLATE_FC_SECRET`** 或 **`BABELDOC_FC_SECRET`**，或后台 **Translate FC Secret**。环境变量优先，缺省再读库。

**常见误区：** 控制台里 **`BABELDOC_USE_FC=true`**、**`BABELDOC_FC_TIMEOUT_SECONDS`** 等 **不会**被当前 Next 应用读取；它们不等于已配置 FC 地址。必须单独增加 **`TRANSLATE_FC_URL`**（或 **`BABELDOC_FC_URL`** / 后台 URL）。
3. **`source_pdf_url` 能生成**：R2 已配置且预签名 GET 成功（`sourcePdfUrl` 非空）。

否则接口仍 **200** 并写入 `translation_tasks`，但 **不会调用 FC**（任务会一直 `queued`）。

**说明：** OpenNext 部署到 Cloudflare 时，控制台变量会注入 Worker 的 **`env` 对象**（与 `getCloudflareContext().env` 一致）。Next 打包后的路由里 **`process.env.TRANSLATE_FC_URL` 在运行时经常是空的**（构建阶段未内联到 bundle），因此本仓库的 **`/api/translate` 已改为优先从 Worker `env` 读取**，再回退 `process.env` 与数据库。

若你已在网页控制台配置 `TRANSLATE_FC_URL` 仍不生效，请先 **重新部署** 含该改动的版本，并在日志中查看 **`fc_url_trace`**：期望为 **`TRANSLATE_FC_URL@cloudflare_env`**。

部署后可在日志中搜索 **`[translate] fc_env`**（看 `fc_url_source` 是 `worker_env` 还是 `database`）、**`fc.request`** / **`fc.response`**。

| 变量 | 说明 |
|------|------|
| `TRANSLATE_FC_URL` 或 `BABELDOC_FC_URL` | FC / babeldoc 入口 URL（**须出现在 Worker 变量里**） |
| `TRANSLATE_FC_SECRET` 或 `BABELDOC_FC_SECRET` | 对应头默认 `X-Babeldoc-Secret`；**本仓库 babeldoc_fc** 同时读取 `TRANSLATE_FC_SECRET`（优先）与 `BABELDOC_FC_SECRET` |
| `TRANSLATE_FC_AUTH_HEADER` / `TRANSLATE_FC_AUTH_SCHEME` | 与调用 FC、回调验签一致（scheme 常为空字符串） |
| `NEXT_PUBLIC_APP_URL` | 生成 **`callback_url`**，须为线上可访问的站点（如 `https://xxx.workers.dev`），否则 FC 回调失败 |
| **`CRON_SECRET`** | 用于 **`POST /api/documents/cleanup-expired`** 与 **`POST /api/translate/dispatch-pending`** 的 `x-cron-secret` |
| **`TRANSLATE_DISPATCH_SECRET`**（可选） | 若设置，则 **仅** `dispatch-pending` 校验此值；未设置时与 `CRON_SECRET` 共用 |
| **`TRANSLATE_DISPATCH_BATCH_SIZE`**（可选） | `dispatch-pending` 单次最多处理任务数，默认 `8`，上限 `20` |
| **`TRANSLATE_BILLING_REQUIRE_FC_PAGE_COUNT`**（可选） | `true`/`1`/`yes`：成功回调 **必须** 含 FC 回传页数（`translated_page_count` 等），否则记 `billing_error`、不扣积分 |

### 5.1 翻译积分扣费（Creem 充值 + `credit` 表）

| 变量 | 说明 |
|------|------|
| **`TRANSLATE_CREDITS_ENABLED`** | 设为 `true` / `1` / `yes` 时：仅**登录用户**可发起翻译；创建任务前校验余额；**FC 成功回调**后按页扣积分（与 Shipany `consumeCredits` 一致）。未开启时行为与旧版相同。 |
| **`TRANSLATE_CREDITS_PER_PAGE`** | 每翻译页消耗积分，默认 `10`。 |
| **`TRANSLATE_BILLING_REQUIRE_FC_PAGE_COUNT`** | 见上表；与 **[translate-fc-contract.md](./translate-fc-contract.md)** 中成功回调字段一致。 |

开启积分后，**不填页范围**时需要已知 PDF 总页数：服务端使用 **`documents.page_count`**；客户端会合并 **`GET /api/documents/{id}` 的 `page_count`** 与预览接口的 `total_pages`，减少「仅预览未就绪」时的误拦。

**数据库**：对 `translation_tasks` 执行一次迁移（见 `docs/migrations/translation_tasks_billing.sql`），增加 `credit_consume_id`、`credits_estimated`、`credits_charged`、`billing_error`。

**FC 调度 / 重试**：对 `translation_tasks` 执行 **`docs/migrations/translation_tasks_fc_dispatch.sql`**（`fc_next_attempt_at`、`fc_last_invoked_at`、`fc_last_http_status`、`fc_dispatch_attempt_count`、`fc_invoke_lease_until`）。当 FC 返回 **429 / 502 / 503 / 500** 或网络错误时，应用会写入 **`fc_next_attempt_at`**，任务保持 **`queued`**；须由 **Cron** 周期性调用：

`POST https://<你的域名>/api/translate/dispatch-pending`  
Header：`x-cron-secret: <CRON_SECRET 或 TRANSLATE_DISPATCH_SECRET>`

与 **`/api/documents/cleanup-expired`** 相同模式。Cloudflare：**Worker → Triggers → Cron**，勿在 Worker 内长循环重试（见 **[cloudflare-env-真相.md](./cloudflare-env-真相.md)**）。**FC 与 Next 的 HTTP 契约**见 **[translate-fc-contract.md](./translate-fc-contract.md)**；FC 实现路径：**仓库根目录 `babeldoc_fc/`**。

**定价 / Creem**：`pages/pricing` 的 `en`/`zh` JSON 已配置月付 / 年付 / 加购（如一次性 500 积分、月付 600 积分、年付 7000 积分）；需在 Creem 控制台创建对应 Product，并在后台 **Creem Product IDs Mapping**（`creem_product_ids`）把定价里的 `product_id` 映射到 Creem Product ID，或在定价 JSON 中为每项填写 `payment_product_id`。完整步骤与排错见 **[creem-checkout-setup.md](./creem-checkout-setup.md)**。**积分入账数量以服务端定价 JSON / 订单为准，Creem 仅作收款与产品绑定**（详见该文档「积分发放以谁为准」与「订阅改权益与存量用户」）。

### 5.2 PDF 预览与 Worker 内存

- **`/api/documents/{id}/preview-url`**、**`/api/tasks/{id}/output-preview-url`** 在 **Cloudflare Worker** 上会对 **约大于 8MB** 的对象避免「整本下载 + `pdf-lib` 切页」（返回 **413**），以降低 `Worker exceeded memory limit`。
- 推荐配置 **`R2_PUBLIC_URL`**（或 **`NEXT_PUBLIC_R2_PUBLIC_URL`**，见 `translate-r2`）：**第 1 页**可走公网直链且 **不必**在 Worker 内加载全文件；翻页依赖 **已写入 R2 的单页切片**（命中则仅签发预签名 URL）。
- 上传流程应尽量写入 **`documents.page_count`**，便于首屏返回总页数、减少不必要的全本解析。

### 5.3 FC 回调鉴权（`POST /api/translate/callback`）

当配置了 **`TRANSLATE_FC_SECRET`**（或 `BABELDOC_FC_SECRET` / 后台 `translate_fc_secret`）时，回调请求须携带与 **`POST /api/translate` 调用 FC 时相同**的请求头：默认 **`X-Babeldoc-Secret`**，值为 **`TRANSLATE_FC_AUTH_SCHEME` + Secret**（`TRANSLATE_FC_AUTH_SCHEME` 常为空）。**本仓库 `babeldoc_fc` 已在回调 POST 中附带该头**；自研 FC 亦须对齐，否则回调会 **401**，任务无法变为 `completed`。

若**未配置**任何 FC Secret，则回调**不校验**（便于本地调试，生产务必配置 Secret）。

**Cloudflare 日志里可搜的关键字（`[translate]`）：**

| 关键字 | 含义 |
|--------|------|
| `fc_env` | FC URL/Secret 来自 `worker_env` 还是 `database` |
| `presign_source_pdf ok` | R2 预签名成功（含 `duration_ms`、`url_summary`，不含完整 URL） |
| `presign_source_pdf failed` | 预签名异常 |
| `presign skipped: R2 not configured` | 未配置 R2 |
| `fc.request` | 即将请求 FC（`fc_endpoint`、`callback_url`、`payload` 摘要） |
| `fc.wait_until_registered` | 已 `waitUntil`，子请求应在返回 200 后继续执行 |
| `fc.wait_until_missing` | 无 `waitUntil`，FC 请求可能被提前取消 |
| `fc.response` | FC 返回（`duration_ms`、`http_status`、`body_preview`） |
| `fc.fetch_failed` | 网络/抛错 |
| `fc.note_non_worker` | 本地 Node，无 `waitUntil` |

若日志出现 **`waitUntil() tasks did not complete... cancelled`**：属 Cloudflare 对子任务 **CPU/时长上限**；FC 调用可能未完成，须依赖 **`/api/translate/dispatch-pending` Cron** 继续派发。**FC 函数自身日志**在阿里云函数计算控制台查看，不在 Worker 日志中。
