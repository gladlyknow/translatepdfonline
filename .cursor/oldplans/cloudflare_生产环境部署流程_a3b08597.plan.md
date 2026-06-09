---
name: Cloudflare 生产环境部署流程
overview: 基于现有 OpenNext for Cloudflare 与 wrangler 配置，给出从准备 wrangler.toml、环境变量、构建到部署的完整生产部署流程；生产环境使用 Hyperdrive 连接 PostgreSQL，敏感变量通过 Secrets 配置。
todos: []
isProject: false
---

# Cloudflare 生产环境完整部署流程

## 一、前置条件

- 已完成本地依赖安装（`pnpm install`）与数据库迁移（`pnpm run db:push`）。
- 已具备 Cloudflare 账号、PostgreSQL 生产库、R2 桶、阿里云 FC 地址（若使用翻译）。
- 生产域名已确定（用于 `NEXT_PUBLIC_APP_URL`，FC 回调必须可访问该域名）。

---

## 二、准备 wrangler 配置

当前仓库仅有 [wrangler.toml.example](frontend/wrangler.toml.example)，需在 **frontend 根目录** 新增 **wrangler.toml**（不要提交敏感信息，或仅提交非敏感部分并用 Secrets 补全）。

**必改项：**

- **name**：Cloudflare 上的项目名（如 `translatepdfonline`）。
- **main**：保持 `".open-next/worker.js"`（OpenNext 构建产出）。
- **[assets]**：保持 `directory = ".open-next/assets"`。
- **[vars]**：填入**非敏感**环境变量（见下「环境变量」）。敏感项用 **wrangler secret** 配置，不要写在 wrangler.toml 里。

**数据库（生产使用 Hyperdrive）：**

- **生产环境**必须使用 **Hyperdrive** 连接 PostgreSQL，不要在生产 Secrets 中配置 `DATABASE_URL`；Worker 在运行时使用 `env.HYPERDRIVE.connectionString`（见 [postgres.ts](frontend/src/core/db/postgres.ts)）。
- **在 Cloudflare Dashboard 创建 Hyperdrive：**
  1. 进入 **Workers & Pages → Hyperdrive**，点击 **Create**。
  2. 填写名称（如 `translatepdf-prod`），**Connection string** 填入生产 Postgres 连接串（如 `postgres://user:pass@host:5432/dbname?sslmode=require`）。
  3. 创建后复制 **Hyperdrive ID**（形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）。
- **在 wrangler.toml 中配置：**
  - 添加 `[[hyperdrive]]` 块，`id = "<上一步复制的 Hyperdrive ID>"`。
  - `localConnectionString` 仅用于本地 `pnpm run cf:preview`（可填本地 Postgres 或占位，生产部署不依赖此项）。
- **可选（仅非生产/调试）：** 若不使用 Hyperdrive，可不配置 `[[hyperdrive]]`，改为在 Secrets 中设置 `DATABASE_URL` 直连；生产不推荐。

---

## 三、环境变量清单（生产）

以下与 [PROJECT_SETUP_AND_FC.md 第三节](frontend/docs/PROJECT_SETUP_AND_FC.md) 一致。可在 **wrangler.toml** 中配置，也可在 **Cloudflare Dashboard（Workers 界面）** 中填写。

**在 Dashboard 中填写时：** 登录 Cloudflare → **Workers & Pages** → 选中你的 Worker（与 wrangler.toml 的 `name` 一致）→ **Settings** → **Variables and Secrets**。  

- **Variables**：填非敏感变量（与下面「Variables」清单一致）。  
- **Encrypted (Secrets)**：填敏感项（与下面「Secrets」清单一致）。  
保存后下次部署或新版本会生效；若已部署，仅改此处即可生效，无需重新 `cf:deploy`。

---

**Variables（非敏感，可写进 wrangler.toml [vars] 或在 Dashboard → Variables）：**

- `NEXT_PUBLIC_APP_URL` = 生产站点根 URL（如 `https://www.translatepdfonline.com`）
- `NEXT_PUBLIC_APP_NAME` = 应用名（如 `Translate PDF Online`）
- `NEXT_PUBLIC_THEME`、`NEXT_PUBLIC_APPEARANCE`（可选）
- `DATABASE_PROVIDER` = `postgresql`
- `DB_SINGLETON_ENABLED` = `true`、`DB_MAX_CONNECTIONS` = `1`
- R2：`R2_BUCKET`、`R2_ACCOUNT_ID`、`R2_ENDPOINT`
- 翻译 FC：`TRANSLATE_FC_URL`

**Secrets（敏感，用 wrangler secret 或在 Dashboard → Encrypted）：**

- `AUTH_SECRET`
- `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`
- `TRANSLATE_FC_SECRET`（或 `BABELDOC_FC_SECRET`，若 FC 需鉴权）
- `CRON_SECRET`（若需调用 cleanup-expired）
- `DATABASE_URL`：仅在不使用 Hyperdrive 时配置；**生产使用 Hyperdrive 时不填**。

**若用命令行配置 Secrets**（在 frontend 目录）：

```bash
pnpm wrangler secret put AUTH_SECRET
pnpm wrangler secret put R2_ACCESS_KEY_ID
pnpm wrangler secret put R2_SECRET_ACCESS_KEY
pnpm wrangler secret put TRANSLATE_FC_SECRET
pnpm wrangler secret put CRON_SECRET
```

---

## 四、构建与部署命令（均在 frontend 目录）

**在 Dashboard 部署配置界面（构建命令 / 部署命令 / 环境变量）：**

若在 Cloudflare 的 Workers 项目配置页填写「构建命令」「部署命令」和「环境变量」，可按下述设置，与当前界面一致：

- **根目录 / 路径（必填）：** 本仓库的应用在 `**frontend`** 子目录，必须在 Cloudflare 项目设置里把 **根目录（Root directory）** 或 **路径（Path）** 设为 `**frontend`**。否则构建会在仓库根目录执行，出现 `ENOENT: no such file or directory, open '.../package.json'`（根目录没有 package.json）。
- **构建命令（Git 部署必填）：** 因 **wrangler.toml 未提交到仓库**（在 .gitignore 中），云端构建前需根据模板生成。请填 `**pnpm run build:opennext:ci`**（会先执行 `scripts/generate-wrangler.js` 用环境变量生成 wrangler.toml，再执行 OpenNext 构建）。若仅本地构建再上传，可用 `pnpm run build:opennext`（需本地已有 wrangler.toml）。
- **部署命令：** `npx wrangler deploy`（与界面一致）。
- **环境变量（构建阶段）：** 为生成 wrangler.toml，在「环境变量」中至少配置：`**HYPERDRIVE_ID`**（在 Dashboard 创建的 Hyperdrive 的 ID）；建议同时设置 `NEXT_PUBLIC_APP_URL`、`NEXT_PUBLIC_APP_NAME`。可选：`WRANGLER_NAME`（默认 translatepdfonline）、`HYPERDRIVE_LOCAL_CS`（仅本地 preview 用，生产可空）。脚本见 [scripts/generate-wrangler.js](frontend/scripts/generate-wrangler.js)，模板见 [wrangler.toml.template](frontend/wrangler.toml.template)。敏感项（Secrets）在项目部署后到 **Settings → Variables and Secrets → Encrypted** 中配置，不要写在构建环境变量里。

**本地命令行方式：**


| 步骤      | 命令                    | 说明                                               |
| ------- | --------------------- | ------------------------------------------------ |
| 1. 本地预览 | `pnpm run cf:preview` | 先执行 OpenNext 构建，再本地用 wrangler 跑 Worker，用于验证配置与路由 |
| 2. 正式部署 | `pnpm run cf:deploy`  | 构建后部署到 Cloudflare Workers（由 wrangler 上传）         |


对应脚本见 [package.json](frontend/package.json)：

- `cf:preview` = `opennextjs-cloudflare build && opennextjs-cloudflare preview`
- `cf:deploy` = `opennextjs-cloudflare build && opennextjs-cloudflare deploy`

构建产物在 `.open-next/`（worker.js + assets），由 wrangler 上传。

**若出现「Command failed: pnpm build」：** OpenNext 内部会执行 `pnpm build`（即 Next.js 构建）。当前 `package.json` 的 `build` 已改为带 `--max-old-space-size=4096`，以降低内存不足导致的中断。若仍失败，请查看构建日志**更靠上**的 Next.js 报错（类型错误、缺少依赖等）；必要时在 Dashboard 环境变量中增加 `NODE_OPTIONS=--max-old-space-size=8192`。

---

## 五、推荐部署顺序

1. **创建并绑定 Hyperdrive（生产必做）**
  在 Dashboard 创建 Hyperdrive，绑定生产 Postgres 连接串，复制 Hyperdrive ID。
2. **复制并编辑 wrangler.toml**
  从 `wrangler.toml.example` 复制为 `wrangler.toml`，修改 `name`、[vars]；在 `[[hyperdrive]]` 中填写 `id = "<Hyperdrive ID>"`，以及 `localConnectionString`（仅本地 preview 用）。若使用 Dashboard 连接 Git 部署，在项目设置中把 **根目录 / 路径** 设为 `**frontend`**，否则会报错找不到 `package.json`。
3. **配置环境变量与 Secrets**
  可在 **Workers 控制台**（Workers & Pages → 该 Worker → Settings → Variables and Secrets）中填写 Variables 与 Encrypted；或用本地 `wrangler secret put ...`。**生产不配置 DATABASE_URL**，由 Hyperdrive 提供连接串。
4. **（可选）本地预览**
  `pnpm run cf:preview`，在本地访问打印的 URL，确认翻译页、上传、API 正常。
5. **部署**
  `pnpm run cf:deploy`，按提示完成登录/授权（若未登录 Cloudflare）。
6. **绑定自定义域名**
  在 Cloudflare **Workers** 该项目中绑定生产域名，并确保 DNS 已指向 Cloudflare。
7. **验证**
  - 访问 `https://你的域名/translate`，测试上传、翻译、预览。  
  - 确认 `NEXT_PUBLIC_APP_URL` 为该域名，以便阿里云 FC 回调 `https://你的域名/api/translate/callback` 可访问。

---

## 六、与现有文档的对应关系

- 环境变量与 R2/FC 说明：[PROJECT_SETUP_AND_FC.md 第三节](frontend/docs/PROJECT_SETUP_AND_FC.md)（3.1–3.5）。
- 部署到 Cloudflare 简述：[PROJECT_SETUP_AND_FC.md 第七节](frontend/docs/PROJECT_SETUP_AND_FC.md)。
- 7 天过期与 cleanup：同文档第八节；若需定时清理，在外部 cron 中带 `x-cron-secret` 调用 `POST /api/documents/cleanup-expired`。

按上述流程即可完成从零到生产环境的 Cloudflare 部署；若使用 CI/CD，可在流水线中执行 `pnpm install`、`pnpm run cf:deploy`，并将 Secrets 配置在 Cloudflare 的流水线或 Dashboard 中。