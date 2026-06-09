# translatepdfonline Cloudflare 双项目部署手册（主项目 + translatepdfonline_quenues）

> 目标：给出可直接执行的部署说明，覆盖主项目 `translatepdfonline` 与从项目 `translatepdfonline_quenues`（同仓库多 Worker），重点包含 Queue、环境变量、构建命令、部署命令、版本管理、回滚与排障。

## 1. 现网基线（你当前给定）

- Queue（已手工创建）  
  - 名称：`translatepdfonline`  
  - ID：`4b1221db1d184e8d93d1b329cbb6c2f1`
- 主项目（Workers Git）  
  - Git 仓库：`gladlyknow/translatepdfonline`  
  - 根目录：`/frontend`  
  - 构建命令：`pnpm run build:opennext:ci`  
  - 部署命令：`npx wrangler deploy --keep-vars`  
  - 版本命令：`npx wrangler versions upload`  
  - 生产分支：`master`
- 双项目模式  
- 主项目 Worker 名：`translatepdfonline`  
- 从项目 Worker 名：`translatepdfonline-quenues`  
  - 队列绑定名统一：`OCR_PIPELINE_QUEUE`
- **DEV 预发（develop 分支，与生产完全隔离）**  
  - 队列名：`translatepdfonline-dev`（须先在 Dashboard 或 `wrangler queues create` 创建）  
  - 主 Worker 名：`translatepdfonline-dev`（`wrangler.toml` 的 `[env.develop]`）  
  - Consumer Worker 名：`translatepdfonline-quenues-dev`（`wrangler.consumer.develop.jsonc`）

---

## 2. 双项目职责与数据流

```mermaid
flowchart LR
  subgraph mainProject [MainProject_translatepdfonline]
    webApi[WebAndApi_FetchWorker]
  end

  subgraph queueSystem [QueueSystem]
    ocrQueue[Queue_translatepdfonline]
    queueConsumer[Worker_translatepdfonline_quenues]
  end

  subgraph externalDeps [ExternalDependencies]
    pg[Postgres_Hyperdrive]
    r2[R2Storage]
    baidu[BaiduOCR]
    deepseek[DeepSeek]
  end

  webApi -->|send taskId| ocrQueue
  ocrQueue -->|consume| queueConsumer
  webApi --> pg
  queueConsumer --> pg
  queueConsumer --> r2
  queueConsumer --> baidu
  queueConsumer --> deepseek
```

- 主项目负责 Web/API、创建 OCR 任务、推送 Queue。
- 从项目仅负责消费 Queue，执行 OCR pipeline，更新 DB 与 R2。
- 两个 Worker 变量隔离，`--keep-vars` 仅作用于当前 Worker，不会跨项目同步。
- **OCR Workbench 的 PDF/HTML 导出**：用户在浏览器里生成的 **Workbench DOM 矢量快照 HTML** 经主站 API 写入 R2（`translations/{taskId}/staging/ocr-export-{exportId}.html`）后，由 **OCR 导出队列** 触发 Consumer 处理。**Cloudflare Browser Rendering 绑定 `BROWSER`** 配置在 **`wrangler.consumer*.jsonc`（Consumer Worker）**，与 OpenNext 主站 Worker **分离**；Consumer 从 R2 读取 staging HTML，再 `setContent` → `page.pdf`（或写出最终 HTML）。主站 Next 运行时 **不**承担最终 Chromium 打 PDF。

---

## 2.5 分支与环境：master 生产 / develop 预发（两套独立 Worker）

**原则**：生产与 DEV 使用**不同 Git 分支、不同 Cloudflare Worker 名称、不同队列名**；在 Cloudflare「连接到 Git」上建议拆成 **4 条 Workers Build**（生产主站、生产 Consumer、DEV 主站、DEV Consumer），每条只部署对应的一个 Worker，避免一条流水线误覆盖另一个 Worker 或把 consumer 绑到主站触发 11001。

### 2.5.1 对应关系总表

| 环境 | Git 分支 | 主 Worker（OpenNext） | Consumer Worker | 队列名 | 主站 Wrangler | Consumer Wrangler |
|------|----------|----------------------|-----------------|--------|---------------|---------------------|
| **生产** | `master` | `translatepdfonline` | `translatepdfonline-quenues` | `translatepdfonline` | 默认：`wrangler.toml`（根 `name`） | `wrangler.consumer.jsonc` |
| **DEV** | `develop` | `translatepdfonline-dev` | `translatepdfonline-quenues-dev` | `translatepdfonline-dev` | `wrangler.toml` + `--env develop` | `wrangler.consumer.develop.jsonc` |

工作目录：仓库内 **`frontend/`**（下文命令均假定已 `cd` 到该目录）。  
本地 / CI 需已登录 Cloudflare：`npx wrangler login`，或设置 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`。

**说明**：`wrangler versions upload` **不支持** CLI `--keep-vars`；Consumer 配置里已设 `keep_vars: true`（见 `wrangler.consumer*.jsonc`）。主站 `wrangler.toml` 含 `keep_vars = true`，与 `deploy --keep-vars` 对齐。

---

### 2.5.2 生产（master）— 构建、部署、版本

**适用**：`translatepdfonline` + `translatepdfonline-quenues`，队列 `translatepdfonline`。

#### A. 一次性构建（主站与消费者共用同一份 OpenNext 产物）

在仓库根检出 **`master`** 后：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm run build:opennext:ci
```

`build:opennext:ci` 会执行：`generate-wrangler` → Next `build` → `opennextjs-cloudflare build --skipNextBuild` → patch，产出 `.open-next/`（主站 `deploy` 需要）；Consumer 入口为独立 TS（`workers/ocr-pipeline-consumer/src/index.ts`），**不依赖** OpenNext 产物，但 CI 常仍与主站同流水线跑一遍 `build:opennext:ci` 以统一锁版本。

#### B. 主站 Worker `translatepdfonline`（默认环境，无 `--env`）

| 步骤 | 命令 |
|------|------|
| 部署 | `npx wrangler deploy --keep-vars` |
| 上传新版本（Gradual rollout / 控制台切流量） | `npx wrangler versions upload` |

#### C. Consumer Worker `translatepdfonline-quenues`

| 步骤 | 命令 |
|------|------|
| 部署 | `npx wrangler deploy -c wrangler.consumer.jsonc --keep-vars` |
| 上传新版本 | `npx wrangler versions upload -c wrangler.consumer.jsonc` |

#### D. 本地一条命令连续部署主站 + Consumer（同一 `frontend` 目录、建议已跑过构建）

```bash
pnpm run cf:deploy:workers:prod
```

等价于：`wrangler deploy --keep-vars && wrangler deploy -c wrangler.consumer.jsonc --keep-vars`。

#### E. Cloudflare Workers 连接 Git — 生产建议拆两条 Build

| Build 应用名（示例） | 分支 | 根目录 | 构建命令 | 部署命令 | 版本命令（可选） |
|---------------------|------|--------|----------|----------|------------------|
| `translatepdfonline`（主站） | `master` | `frontend` | `pnpm install --frozen-lockfile && pnpm run build:opennext:ci` | `npx wrangler deploy --keep-vars` | `npx wrangler versions upload` |
| `translatepdfonline-quenues`（Consumer） | `master` | `frontend` | `pnpm install --frozen-lockfile`（若与主站流水线共享产物可加 `&& pnpm run build:opennext:ci`，见团队习惯） | `npx wrangler deploy -c wrangler.consumer.jsonc --keep-vars` | `npx wrangler versions upload -c wrangler.consumer.jsonc` |

若生产主站 `wrangler deploy` 在 CI 中同样经 OpenNext 并报 **Hyperdrive 本地连接串** 类错误，在该主站 Build 的环境变量中同样配置 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`（与 Hyperdrive 源库一致的 Postgres URL），见下节 **2.5.3.1** 说明。

**发布顺序**：先部署 **Consumer**，再部署 **主站**（见 §6）。

---

### 2.5.3 DEV（develop）— 构建、部署、版本

**适用**：`translatepdfonline-dev` + `translatepdfonline-quenues-dev`，队列 `translatepdfonline-dev`。

#### A. 构建

```bash
git checkout develop
git pull
cd frontend
pnpm install --frozen-lockfile
pnpm run build:opennext:ci
```

#### B. 主站 Worker `translatepdfonline-dev`（`wrangler.toml` 的 `[env.develop]`）

| 步骤 | 命令 |
|------|------|
| 部署 | `npx wrangler deploy --env develop --keep-vars` |
| 上传新版本 | `npx wrangler versions upload --env develop` |

#### C. Consumer Worker `translatepdfonline-quenues-dev`

| 步骤 | 命令 |
|------|------|
| 部署 | `npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars` |
| 上传新版本 | `pnpm run cf:versions:consumer:dev` |

`cf:versions:consumer:dev` 等价于：`npx wrangler versions upload -c wrangler.consumer.develop.jsonc`。

#### D. 本地一条命令连续部署 DEV 主站 + DEV Consumer

```bash
pnpm run cf:deploy:workers:dev
```

等价于：`wrangler deploy --env develop --keep-vars && wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars`。

#### E. Cloudflare Workers 连接 Git — DEV 建议拆两条 Build

| Build 应用名（示例） | 分支 | 根目录 | 构建命令 | 部署命令 | 版本命令（可选） |
|---------------------|------|--------|----------|----------|------------------|
| `translatepdfonline-dev`（主站） | `develop` | `frontend` | `pnpm install --frozen-lockfile && pnpm run build:opennext:ci` | 见下 **§2.5.3.0**（`develop` 走「非生产分支部署命令」） | **留空**（推荐）或见 §2.5.3.2 |
| `translatepdfonline-quenues-dev`（Consumer） | `develop` | `frontend` | `pnpm install --frozen-lockfile`（或与主站同构建） | 同上：非生产分支须单独配置 **非生产分支部署命令** | **留空**（推荐） |

#### 2.5.3.0 develop 推送后：为什么「构建详细信息」里的部署命令是 `versions upload`，而不是 `wrangler deploy`？

这是 **Cloudflare Workers Builds 的预期行为**，不是你把「部署命令」配错了被系统改掉。

官方说明（[Configuration · Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)）要点：

1. **生产分支**（你配置的 `master`）：推送后执行你在面板里填的 **Deploy command（部署命令）**，默认 `npx wrangler deploy`。  
2. **非生产分支**（如 `develop`，且已打开「非生产分支构建」）：构建完成后，**不会**再跑上面的生产「部署命令」；而是改为执行 **Non-production branch deploy command（非生产分支部署命令）**。该项 **默认** 为 **`npx wrangler versions upload`**，用于生成 **预览版本 / 预览 URL**，**不会**等价于一次带 `--keep-vars` 的完整 `deploy`。

因此你在 **构建详细信息** 里看到 **部署命令** 一栏显示为 `npx wrangler versions upload --env develop`，通常是因为：**当前这次构建来自 `develop`**，平台实际跑的是 **「非生产分支部署命令」**；你在设置页上半部分填的 **`npx wrangler deploy --env develop --keep-vars`** 主要作用于 **生产分支** 的部署步骤，**不会自动套到 `develop` 上**。

**你要让 `develop` 也像全量发版一样执行 `deploy --keep-vars`（自动部署且默认路由到最新代码）**，请在 Cloudflare 控制台：

**Workers → 该 Worker → Settings → Build** 中找到 **「非生产分支部署命令」**（英文：**Non-production branch deploy command**），改为：

```bash
npx wrangler deploy --env develop --keep-vars
```

（若需要 Workers 运行时最新兼容线，可再加 `--latest`。）

**「版本命令」**一栏：若仅用于生产或易与上述行为混淆，对 **develop 全量 dev 环境** 建议 **留空**；否则 `develop` 仍可能只在上传版本、而不做你想要的 `deploy`。

**Consumer** 的第二个 Worker 应用同理：若 `develop` 构建也走非生产分支逻辑，必须把 **非生产分支部署命令** 设为：

```bash
npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars
```

---

#### 2.5.3.1 DEV 主站：Workers 连接 Git 常见报错与必配 Build 变量

**1）`Unexpected fields found in env.develop field: "keep_vars"`**  
`[env.develop]` 内**不要**写 `keep_vars`（Wrangler / OpenNext 的 schema 不允许嵌套环境带该字段）。仓库已在顶层保留 `keep_vars = true`；部署时继续用 `npx wrangler deploy --env develop --keep-vars` 即可在 deploy 时保留 Dashboard 已有 vars。

**2）`UserError: ... CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`（OpenNext 调起 `opennextjs-cloudflare deploy` 时）**  
`wrangler deploy` 在检测到 OpenNext 项目时会走 `opennextjs-cloudflare deploy`，内部会解析 Hyperdrive 绑定并走 Miniflare 代理逻辑，**在 CI 非交互环境**要求提供「本地」Postgres 连接串变量名（与运行时 Hyperdrive 不是同一概念，仅为满足 CLI 解析）。

在 Cloudflare **Workers 该 Build → Settings → Variables and secrets → Build**（或「Build variables」）中增加：

| 变量名 | 说明 |
|--------|------|
| `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | 填与 Hyperdrive 源库**同一套** Postgres 的直连 URL（例如 `postgresql://user:pass@host:5432/dbname?sslmode=require`）。Build 容器需能访问该 host；仅用于构建/部署阶段解析配置，**不替代** Worker 运行时 Hyperdrive 绑定。 |

未配置时会出现 `telemetryMessage: 'no local hyperdrive connection string'` 并导致 deploy 失败。

**3）「版本命令」不要写成第二次 `deploy`**  
错误示例：`版本命令: npx wrangler deploy --env develop --keep-vars`（与部署重复）。  
若 Cloudflare 面板**允许留空**：**版本命令请留空**（见 **§2.5.3.2**，推送后默认流量已是新部署 =「最新」）。  
若**必须**填且你要用 Workers **Versions / 渐进发布**：再使用 `npx wrangler versions upload --env develop`，并务必配合 **§2.5.3.2** 把 **100% 流量** 指到新版本，否则线上仍可能打到旧版。

#### 2.5.3.2 自动部署，且线上「始终最新」（develop / 主站 + Consumer）

**目标**：`develop` 推送后 **自动构建并发布**；用户访问的 **默认流量** 始终指向 **本次流水线刚部署的 Worker**（代码/配置最新）。不要求手工点控制台切版本。

**推荐架构（Workers 连接 Git，两条 Build：主站 + Consumer）**

1. **分支**：主站与 Consumer 两个应用均绑定 **`develop`**，打开 **Automatic deployments on push**（推送即触发构建+部署）。
2. **主站 `translatepdfonline-dev`**  
   - **构建**：`pnpm install --frozen-lockfile && pnpm run build:opennext:ci`  
   - **部署**：`npx wrangler deploy --env develop --keep-vars`  
   - **可选**：在部署命令末尾加 **`--latest`**，表示使用 **Workers 运行时** 的最新兼容线（与「Versions 渐进发布」无关，见 `wrangler deploy --help`）。  
   - **版本命令**：**留空**（推荐）。`wrangler deploy` 成功后，**默认路由**即指向本次新部署，无需再跑 `versions upload`。  
3. **Consumer `translatepdfonline-quenues-dev`**  
   - **构建**：至少 `pnpm install --frozen-lockfile`（可与主站共用同一流水线产物时再加 `build:opennext:ci`）。  
   - **部署**：`npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars`  
   - **版本命令**：**留空**（推荐）。  
4. **Build 变量**：主站 Build 仍须配置 **`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`**（§2.5.3.1）；Consumer Build 按需配置与运行时一致的 Secrets/vars。

**若你误用了 `versions upload` 且启用了渐进发布**

- 仅 `versions upload` **不会**自动把 **100%** 流量切到新版本；需在流水线追加例如：  
  `npx wrangler versions deploy <version-id>@100 -e develop -y`（`<version-id>` 来自 upload 输出或 API），或在控制台手动把新版本拉到 100%。  
- **没有灰度需求时，不要走 versions 路径**：只保留 **`deploy --keep-vars`** 即可同时满足「自动部署」与「线上始终最新」。

**队列**：若尚未创建 DEV 队列，在任意已登录环境执行：`npx wrangler queues create translatepdfonline-dev`。Consumer 绑定异常时见 **§6.5**。

---

### 2.5.4 运维 tail（按环境）

| 环境 | Consumer tail 命令 |
|------|----------------------|
| 生产 | `npx wrangler tail translatepdfonline-quenues --format=pretty` |
| DEV | `npx wrangler tail translatepdfonline-quenues-dev --format=pretty` |

主站 tail：`npx wrangler tail translatepdfonline` / `npx wrangler tail translatepdfonline-dev`。

---

## 3. 关键配置统一（必须先做）

你当前模板中 Queue 可能仍是旧名（如 `ocr-pipeline-queue`），部署前必须统一为 `translatepdfonline`：

1. `wrangler.toml.template` 中：
   - `[[queues.producers]] queue = "translatepdfonline"`
   - `[[queues.consumers]] queue = "translatepdfonline"`
2. 绑定名保持：`binding = "OCR_PIPELINE_QUEUE"`
3. 代码里的文档/注释若有 `ocr-pipeline-queue`，统一改为 `translatepdfonline`，避免运维误判。

---

## 4. 主项目部署（translatepdfonline）

**生产与 DEV 的完整分支、Worker 名、队列与命令矩阵见 §2.5。** 本节为生产主站默认环境的浓缩写法。

## 4.1 主项目命令（标准，生产 master / 默认 `name`）

在 `frontend` 目录、`master` 分支执行：

```bash
pnpm install --frozen-lockfile
pnpm run generate-wrangler
pnpm run build:opennext:ci
npx wrangler deploy --keep-vars
npx wrangler versions upload
```

**DEV（develop）主站**请改用：`npx wrangler deploy --env develop --keep-vars` 与 `npx wrangler versions upload --env develop`（见 §2.5.3）。

Cloudflare Workers Git（生产主站）可保持：

- 构建命令：`pnpm run build:opennext:ci`
- 部署命令：`npx wrangler deploy --keep-vars`
- 版本命令：`npx wrangler versions upload`

## 4.2 主项目环境变量（建议分组）

### A. Build Variables（构建阶段）

至少建议配置：

- `WRANGLER_NAME=translatepdfonline`
- `NEXT_PUBLIC_APP_URL`
- `DATABASE_URL`（构建期建议源库直连串，不建议 Hyperdrive 代理域名）

可按项目白名单注入（`scripts/generate-wrangler.js`）：

- 认证：`AUTH_SECRET`, `AUTH_URL`, `JWT_SECRET`
- R2：`R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`
- 翻译/调度：`TRANSLATE_FC_URL`, `TRANSLATE_FC_SECRET`, `TRANSLATE_DISPATCH_SECRET`, `TRANSLATE_DISPATCH_BATCH_SIZE`
- DeepSeek：`DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`

### B. Runtime Variables/Secrets（Worker 运行时）

主项目必填建议：

- `AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `DATABASE_URL`（若依赖 DB 直连）或 Hyperdrive 绑定 `HYPERDRIVE`
- `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `TRANSLATE_FC_URL`, `TRANSLATE_FC_SECRET`
- `CRON_SECRET`（及可选 `TRANSLATE_DISPATCH_SECRET`）

---

## 5. 从项目部署（translatepdfonline_quenues）

**当前仓库实际使用**：`frontend/wrangler.consumer.jsonc`（生产 Consumer）与 `frontend/wrangler.consumer.develop.jsonc`（DEV Consumer）。下文 **§5.2** 以二者为准；**§5.1** 内 `wrangler.queues.toml` 仅为历史 TOML 示例，新建项目不必再抄。

## 5.1 推荐目录与配置文件（历史 TOML 示例，可选）

在 `frontend` 下从项目独立 wrangler 配置（若团队仍用 TOML 命名）：

- `wrangler.queues.toml`（与当前仓库的 `wrangler.consumer.jsonc` 二选一即可，勿重复维护两套）

核心建议字段：

- `name = "translatepdfonline-quenues"`
- `main = ".open-next/worker.js"`（若同构建产物）
- `[[queues.consumers]] queue = "translatepdfonline"`
- 仅保留消费侧必须绑定与变量，减少攻击面

参考模板（`frontend/wrangler.queues.toml`）：

```toml
name = "translatepdfonline-quenues"
main = ".open-next/worker.js"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[[queues.consumers]]
queue = "translatepdfonline"
max_batch_size = 1
max_batch_timeout = 30
max_retries = 5

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "1f0a3251f43343c3872e5f882ff3d879"
```

## 5.2 从项目部署命令（当前仓库：jsonc）

**生产（master）** — Worker `translatepdfonline-quenues`，在 `frontend` 目录：

```bash
pnpm install --frozen-lockfile
pnpm run build:opennext:ci
npx wrangler deploy -c wrangler.consumer.jsonc --keep-vars
npx wrangler versions upload -c wrangler.consumer.jsonc
```

**DEV（develop）** — Worker `translatepdfonline-quenues-dev`：

```bash
pnpm install --frozen-lockfile
pnpm run build:opennext:ci
npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars
pnpm run cf:versions:consumer:dev
```

常用运维命令：

```bash
npx wrangler tail translatepdfonline-quenues --format=pretty
npx wrangler tail translatepdfonline-quenues-dev --format=pretty
npx wrangler queues list
```

若仍使用 TOML 配置文件，将上面 `-c` 换成 `-c wrangler.queues.toml` 即可。

## 5.3 从项目环境变量（最小必填清单）

从项目运行时建议至少有：

- DB：
  - `DATABASE_URL`（或 Hyperdrive 绑定 `HYPERDRIVE`）
- R2：
  - `R2_BUCKET`
  - `R2_ENDPOINT`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
- OCR：
  - `BAIDU_AUTHORIZATION`  
    或组合 `BAIDU_OCR_API_KEY` + `BAIDU_OCR_SECRET_KEY`
- 翻译模型：
  - `DEEPSEEK_API_KEY`
  - `OCR_DEEPSEEK_MODEL`（可选，未设置时回退 `DEEPSEEK_MODEL` / 代码默认 `deepseek-v4-flash`）
- **`translate_parse_result` 阶段性能（可选）** — Consumer 内版面 JSON 槽位批量译 DeepSeek；代码已默认关闭 V4 Thinking、并行批次与小批策略，以下仅在有运维调参需求时配置：
  - **DeepSeek 官方 Rate Limit**（并发由服务端负载动态限制，触顶返回 **HTTP 429**；非流式长等待时可能仅收到空行 keep-alive；若 **10 分钟内未开始推理**服务端会断开连接）：<https://api-docs.deepseek.com/quick_start/rate_limit>。实现侧对 429/5xx 已做指数退避重试；若线上 429 明显增多，应略降 `OCR_PARSE_TRANSLATE_CONCURRENCY` 或 `OCR_PARSE_TRANSLATE_CONCURRENCY_MAX`。
  - `OCR_PARSE_TRANSLATE_CONCURRENCY`（默认 `24`，有效范围 **1–`OCR_PARSE_TRANSLATE_CONCURRENCY_MAX`**）
  - `OCR_PARSE_TRANSLATE_CONCURRENCY_MAX`（默认 `32`，clamp **1–64**；用于限制 `OCR_PARSE_TRANSLATE_CONCURRENCY` 上界，避免误配占满 Worker）
  - `OCR_PARSE_TRANSLATE_CHUNK_ITEMS`（默认 `8`，下限 4）
  - `OCR_PARSE_TRANSLATE_CHUNK_CHARS`（默认 `2000`，下限 1000）
  - `OCR_PARSE_TRANSLATE_TEMPERATURE`（默认 `1.3`）
  - `OCR_PARSE_TRANSLATE_FETCH_TIMEOUT_MS`（默认 `90000`，单批 fetch 截断时间，超时后按指数退避重试 `OCR_PARSE_TRANSLATE_RETRY_MAX` 次）
  - `OCR_PARSE_TRANSLATE_RETRY_MAX`（默认 `3`）
  - `OCR_PARSE_TRANSLATE_MAX_TOKENS_BUDGET`（可选，覆盖动态计算的 `max_tokens`；默认按 `slice_chars * 4 + 256` 自适应，硬上限 8000；设过低会导致输出 JSON 被截断 → 重试浪费）
  - **注 1**：该阶段已在请求体中显式 `extra_body.thinking.type = disabled`；不要在 Worker 环境变量里指望用 `OCR_DEEPSEEK_REASONING_EFFORT` / `DEEPSEEK_REASONING_EFFORT` 影响本阶段（实现中不传 `reasoning_effort`）。**`translate_markdown` 独立阶段已移除**：流水线不再整本调用 `translateMarkdownWithDeepSeek`；导出 MD/PDF 所需 Markdown 由 `buildMarkdownWithR2ImageUrls` 从 `ocr-parse-result(-target).json` 实时重建；`/api/tasks/:id/markdown` GET 同样从 parse JSON 重建。
  - **注 2**：同一任务内 `system` prompt 已固定（不再嵌入随 batch 变化的 `slice.length`），第 2+ 批应在 `[ocr/deepseek_parse_batch] done` 日志看到 `prompt_cache_hit_tokens > 0`；若全程为 0 说明跨批 cache 失效，需排查请求体改动。
- **`mirror_baidu_images` 阶段（自动开启）** — Consumer pipeline 在 `ocr_submit_poll` 之后插入独立的图片镜像阶段：异步并发下载百度签名图片（默认 5 路）到 `translations/{taskId}/assets/`，并把 source ParseResult JSON 中的 `data_url` / 内嵌 markdown / HTML URL 改写为 R2 URL。失败可独立重试，不会回滚 OCR 主链路；新任务无任何百度外链，前端 / 导出不再触发 `/api/proxy/file`。
  - 单图下载内部已带重试（最多 3 次，指数退避 + jitter；401 / 403 / 404 / 410 fast-fail，避免百度签名过期场景下浪费阶段预算）
  - `OCR_IMAGE_MIRROR_CONCURRENCY`（默认 `5`，clamp `[1, 16]`）— 单 task 内图片下载并发上限
  - `OCR_IMAGE_MIRROR_STAGE_TIMEOUT_MS`（默认 `480000` = 8 min，clamp `[30s, 1h]`）— 阶段 wall-clock；触发后抛错由队列重试整阶段
  - `OCR_IMAGE_MIRROR_FETCH_TIMEOUT_MS`（默认 `90000`，clamp `[1s, 10min]`）— 单次 fetch 截断
  - `OCR_IMAGE_MIRROR_MAX_RETRIES`（默认 `3`，clamp `[0, 5]`）— 单图重试次数（不含首次）
  - `OCR_IMAGE_MIRROR_FAIL_RATIO_MAX`（默认 `0.5`，范围 `[0, 1]`）— `failed/total` 超过该比例时整阶段抛错重试；否则记 `mirror_partial=true` 并继续 pipeline
  - 日志关键字：`[ocr/stage] start stage=mirror_baidu_images`、`[ocr/parse_image_mirror] retry`（含 attempt / status / backoff_ms）、`[ocr/parse_image_mirror] give_up`（含 last_status / reason）、`[ocr/parse_image_mirror] done`（含 replaced / failed / total / mirror_partial / elapsed_ms）。URL 仅打 host，避免泄漏百度签名 querystring
  - 进度：`ocr_submit_poll=20%` → `mirror_baidu_images=35%` → `ocr_parse_persisted=45%` → `translate_parse_result=65%` → `export_outputs=90%` → `completed=100%`（前端阶段标签 `stageMirrorBaiduImages` 已加入 i18n；历史 `translate_markdown` 在 Consumer 内归并为 `translate_parse_result`，retry 无需手工改库）
- 其它：
  - `NEXT_PUBLIC_APP_URL`（用于绝对 URL 场景）

从项目构建变量建议：

- `WRANGLER_NAME=translatepdfonline-quenues`
- 与主项目相同的必要公共变量（至少 `NEXT_PUBLIC_APP_URL`、必要 DB/R2 配置）

### 旧任务一次性回填脚本：`ocr-mirror-baidu-images`

`mirror_baidu_images` 阶段只对**新任务**生效。`pipeline-stage` 上线之前已落库的 OCR 任务，其 `ocr-parse-result.json` / `ocr-parse-result-target.json` 中仍可能保留 `xmind-parser.bj.bcebos.com` 30 天签名 URL；待签名过期后，Workbench 的 `<img>` 与导出会失败。可用脚本一次性回填：

```bash
cd frontend

# 单个任务（dry-run 仅扫描不写）
pnpm run ocr:mirror-images -- --task=<taskId> --dry-run
pnpm run ocr:mirror-images -- --task=<taskId>

# 任务清单（一行一个 taskId，# 开头为注释）
pnpm run ocr:mirror-images -- --task-file=tasks.txt

# 批量近 N 条 OCR 任务（按 created_at desc，默认 200）
pnpm run ocr:mirror-images -- --all-recent=200 --concurrency=5
```

行为说明：

- 串行处理多个 task；单 task 内部图片下载并发 = `--concurrency`（默认 5，clamp `[1, 16]`），与 Consumer 阶段共用底层 `rewriteExternalImagesToR2` 实现，含「最多 3 次重试 + 401/403/404/410 fast-fail」语义
- 同一图片若 R2 已存在（按 sha256 短哈希命名）则跳过下载，幂等
- `source` 与 `target` JSON 都尝试改写；任一不存在静默跳过
- 百度签名已过期的图片只计入 `failed`，不抛错；`replaced > 0` 时把已替换部分写回 R2
- 完成后输出 `[ocr/mirror-script] summary { tasks, urls_scanned, urls_replaced, urls_failed, ... }`
- env 依赖与 Consumer 一致（`R2_*` + `DATABASE_URL` / Hyperdrive）；通过 `with-env.ts` 注入 `.env.<NODE_ENV>`，需在本地或 CI 中执行（不要在 Worker 运行时调用）

### Cloudflare 运行时 R2 配置优先级（重要）

- 本地 Node 开发：优先读取环境变量（`.env` / Runtime vars）。
- Cloudflare Worker 运行时：优先读取数据库 `config` 表中的 `r2_*`，仅当 DB 缺失时回退环境变量。
- 建议在 Cloudflare 中保留 env 作为兜底，但以 DB 为真实来源，避免多处配置漂移。

### R2 CORS（浏览器直传必配）

前端上传采用浏览器直传预签名 URL（`PUT` 到 R2），若 CORS 不完整会直接出现 `TypeError: Failed to fetch`。

R2 Bucket CORS 至少包含：

- Allowed Origins：你的站点域名（生产/预发都加）
- Allowed Methods：`PUT, GET, HEAD, OPTIONS`
- Allowed Headers：`Content-Type`
- Expose Headers：`ETag`（建议）
- Max Age：`86400`（建议）

---

## 6. 发布顺序（强烈建议）

1. **先部署从项目** `translatepdfonline_quenues`（确保 consumer 在线）
2. 再部署主项目 `translatepdfonline`（开始推消息到队列）
3. 验证 queue 深度与消费者日志
4. 如有问题优先回滚主项目，保留消费者观察

---

## 6.5 develop 消费者绑定兜底（OCR / 导出卡 processing 必读）

**症状**：主 Worker 日志看到 `[ocr] submit_and_enqueue_ok` / `[ocr/queue] enqueued` / `[ocr/export-queue] enqueued`，但任务长时间停在 `queued` 或导出停在 `pending`/`processing`，`wrangler tail translatepdfonline-quenues-dev` 几乎无 `queue()` 输出，Cloudflare Dashboard → Queues → `translatepdfonline-dev` → Consumers 列表看不到 `translatepdfonline-quenues-dev`。

**根因**：消费者 Worker 脚本部署成功，但队列「消费者绑定」没有同步建立——常见于先单独部署消费者前，主队列上还有同名旧绑定残留，或一次部署被跳过了 consumer 注册步骤。

**修复顺序（develop）**：

```bash
cd frontend

# Step 1：确认队列存在
npx wrangler queues list | findstr translatepdfonline-dev

# Step 2：清理悬挂或冲突的 consumer 绑定（11001 / 旧名残留时使用）
pnpm run cf:queues:consumer:remove:dev
# 等价：npx wrangler queues consumer remove translatepdfonline-dev translatepdfonline-quenues-dev

# Step 3：重新部署消费者（会按 wrangler.consumer.develop.jsonc 同步 consumer 绑定）
npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars

# Step 4：若 1–2 分钟后 Dashboard Consumers 仍为空，显式绑定
npx wrangler queues consumer add translatepdfonline-dev translatepdfonline-quenues-dev

# Step 5：tail 验证
npx wrangler tail translatepdfonline-quenues-dev --format=pretty
```

**11001 `Queue handler is missing`**：通常是 consumer 错误地绑到了主 Worker（`translatepdfonline-dev` 或 `translatepdfonline`）。先把错绑的清掉，再回到上面 Step 3：

```bash
# develop
npx wrangler queues consumer remove translatepdfonline-dev translatepdfonline-dev
# prod
npx wrangler queues consumer remove translatepdfonline translatepdfonline
```

**消费者运行时变量自检**（`--keep-vars` 不跨 Worker 拷贝；以下任一缺失都会让队列消息处理失败）：

- `BAIDU_AUTHORIZATION`，或 `BAIDU_OCR_API_KEY` + `BAIDU_OCR_SECRET_KEY`
- `DEEPSEEK_API_KEY`、可选 `OCR_DEEPSEEK_MODEL`
- R2 直连：`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` / `R2_BUCKET`（或在 DB `config` 表配 `r2_*`，运行时优先读 DB）
- `NEXT_PUBLIC_APP_URL`（PDF 导出回填图片时使用）
- 绑定：`HYPERDRIVE`（id 与主 Worker 一致）、`BROWSER`（PDF 导出依赖 Browser Rendering，账号需启用）

> 生产环境对应使用 `pnpm run cf:queues:consumer:remove:prod` 与 `wrangler.consumer.jsonc` / `translatepdfonline-quenues` / 队列 `translatepdfonline`，命令参数同上替换即可。

---

## 7. 验证清单（上线后必须逐条过）

- `wrangler queues list` 可看到队列 `translatepdfonline`
- 主项目发起 OCR 后，队列深度短时增加后回落
- `npx wrangler tail translatepdfonline-quenues`（生产）或 `npx wrangler tail translatepdfonline-quenues-dev`（DEV）可见消费日志与 taskId
- DB 中 OCR 任务状态从 `queued` -> `processing` -> `completed`/`failed`
- R2 下出现：
  - `translations/{taskId}/ocr-output.pdf`
  - `translations/{taskId}/ocr-output.md`
  - `translations/{taskId}/ocr-parse-result.json`

---

## 8. 回滚与版本策略

主项目回滚（**生产**）：

```bash
npx wrangler versions upload
# 在 Cloudflare 控制台将流量切回上一稳定版本
```

主项目回滚（**DEV**，`[env.develop]`）：

```bash
npx wrangler versions upload --env develop
# 或：npx wrangler versions upload -e develop
# 在控制台将 translatepdfonline-dev 的流量切回上一版本
```

从项目回滚：

```bash
npx wrangler versions upload -c wrangler.consumer.jsonc
# DEV Consumer：
# pnpm run cf:versions:consumer:dev
# 在控制台切回上一个 consumer 版本
```

回滚原则：

- 如果是“主站误推消息”问题：先回滚主项目
- 如果是“消费逻辑异常”问题：先回滚从项目
- 两边都异常时，先停主项目新流量，再回滚从项目

---

## 9. 常见故障与快速排查

- 症状：主项目提交成功但队列无消息  
  - 检查主项目是否配置了 `OCR_PIPELINE_QUEUE` producer binding
  - 检查队列名是否写成旧值（`ocr-pipeline-queue`）

- 症状：队列有积压但不消费  
  - 检查从项目是否部署到了 `translatepdfonline-quenues`
  - 检查从项目 `wrangler.queues.toml` 是否包含 `[[queues.consumers]]`
  - `wrangler tail translatepdfonline-quenues` 查看是否有启动错误
  - **Dashboard → Queues → `translatepdfonline(-dev)` → Consumers 是否列出从项目脚本名**；空白即未绑定，按本手册 6.5 节兜底命令处理（`queues consumer remove` + `wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars`）

- 症状：R2 上传 `failed to fetch`  
  - 先看浏览器 Network 是否为 CORS/预检失败（OPTIONS/PUT）
  - 检查 R2 CORS 是否包含 `PUT, OPTIONS` 与 `Content-Type`
  - 检查预签名 URL host 是否为正确账号的 `*.r2.cloudflarestorage.com`
  - 检查 Worker 日志中的 `[r2/presign_put] config_resolved`（source/db/env、endpoint_host）

- 症状：消费者报 DB/R2 认证失败  
  - 逐项核对从项目运行时变量（不要只配主项目）
  - 注意 `--keep-vars` 不会把主项目变量复制到从项目

- 症状：Baidu/DeepSeek 调用失败  
  - 检查 `BAIDU_AUTHORIZATION` 或 `BAIDU_OCR_API_KEY/SECRET`
  - 检查 `DEEPSEEK_API_KEY` 和可选 `OCR_DEEPSEEK_MODEL`

---

## 10. 最终执行命令速查（可直接复制）

**统一前置**（在仓库根切到对应分支后）：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm run build:opennext:ci
```

---

### 10.1 生产（`master`）— 主站 `translatepdfonline` + Consumer `translatepdfonline-quenues`

```bash
cd frontend
# 主站
npx wrangler deploy --keep-vars
npx wrangler versions upload
# Consumer
npx wrangler deploy -c wrangler.consumer.jsonc --keep-vars
npx wrangler versions upload -c wrangler.consumer.jsonc
```

一键（先完成上面的 `build:opennext:ci`）：

```bash
pnpm run cf:deploy:workers:prod
```

Tail：

```bash
npx wrangler tail translatepdfonline-quenues --format=pretty
```

---

### 10.2 DEV（`develop`）— 主站 `translatepdfonline-dev` + Consumer `translatepdfonline-quenues-dev`

```bash
cd frontend
# 主站（须 wrangler.toml 中已配置 [env.develop]）
npx wrangler deploy --env develop --keep-vars
# 可选：Workers 运行时走最新兼容线
# npx wrangler deploy --env develop --keep-vars --latest
# 仅在做「Versions / 灰度」时需要；自动部署且要全量最新时勿执行下面两行
# npx wrangler versions upload --env develop
# npx wrangler versions deploy <version-id>@100 -e develop -y
# Consumer
npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars
# pnpm run cf:versions:consumer:dev
```

一键（先完成 `build:opennext:ci`）：

```bash
pnpm run cf:deploy:workers:dev
```

Tail：

```bash
npx wrangler tail translatepdfonline-quenues-dev --format=pretty
```

---

### 10.3 队列 consumer 应急（见 §6.5）

```bash
# DEV
pnpm run cf:queues:consumer:remove:dev
npx wrangler queues consumer add translatepdfonline-dev translatepdfonline-quenues-dev
# 生产
pnpm run cf:queues:consumer:remove:prod
npx wrangler queues consumer add translatepdfonline translatepdfonline-quenues
```

---

## 11. 变更记录建议

每次部署建议记录：

- 部署时间
- 主项目版本号
- 从项目版本号
- Queue 深度峰值
- 失败任务数与主要错误
- 回滚动作（若有）

可在 `.cursor` 下维护一个 `deploy-log.md` 作为操作审计。
