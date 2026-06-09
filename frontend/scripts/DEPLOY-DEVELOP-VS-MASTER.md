# develop 与 master 隔离部署（不碰生产 + 尽量保留控制台变量）

## 目标

| 分支 | Worker（主站） | 队列 Consumer | 控制台变量 |
|------|----------------|---------------|------------|
| **master** | `translatepdfonline` | `translatepdfonline-quenues` | 各 Worker 独立配置；`keep_vars` + `--keep-vars` + build 后 patch |
| **develop** | `translatepdfonline-dev` | `translatepdfonline-quenues-dev` | 与上类似，**绝不**对生产同名 Worker 执行无 `--env develop` 的 `deploy` |

**禁止**：在 develop 上使用 `npx wrangler deploy --keep-vars`（不带 `--env develop`）——会与 master **同名**，直接覆盖生产。

**禁止**：develop 使用 `npx wrangler versions upload` 作为唯一发布手段——易与 `keep_vars`/控制台变量行为不一致；若必须用 versions，请接受变量策略与 `deploy` 不同。

---

## 一次性准备（Cloudflare Dashboard）

1. **创建开发队列**（与生产队列分离）  
   - 名称建议：`translatepdfonline-dev`  
   - 生产队列名保持：`translatepdfonline`（勿改生产）

2. **首次部署后**，在控制台分别为以下 **4 个脚本**（实为 2 个 Worker × 生产/开发）配置 **变量和机密**（或复制生产再改 dev 专用值）：  
   - `translatepdfonline`（生产主站）  
   - `translatepdfonline-dev`（开发主站）  
   - `translatepdfonline-quenues`（生产队列）  
   - `translatepdfonline-quenues-dev`（开发队列）

3. **Hyperdrive**：当前 `wrangler.toml` / `wrangler.consumer*.jsonc` 使用同一 `id` 时，**开发与生产连的是同一套数据库连接配置**。若不希望开发动生产数据，请在 Dashboard 为开发单独建 Hyperdrive 配置，并把 **仅 develop 使用** 的配置写入 `wrangler.toml` 的 `[env.develop]` 或单独 `wrangler.*.jsonc`（需自行改 id，本文档不代改）。

---

## Workers Builds（Git 连接）推荐命令

根目录：`/frontend`  
构建命令（两分支相同）：

```bash
pnpm run build:opennext:ci
```

### 生产分支（master）

**部署命令**（一条，顺序：主 Worker → 队列 Worker）：

```bash
npx wrangler deploy --keep-vars && npx wrangler deploy -c wrangler.consumer.jsonc --keep-vars
```

### 非生产分支（develop）

**非生产分支部署命令**（不要用默认的 `versions upload`，也不要用无 `--env` 的 `deploy`）：

```bash
npx wrangler deploy --env develop --keep-vars && npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars
```

说明：

- 第一段把 **OpenNext 产物** 部署到 **`translatepdfonline-dev`**（`wrangler.toml` 里 `[env.develop]`）。  
- 第二段部署 **开发队列 Consumer**，消费 **`translatepdfonline-dev`** 队列。

**「版本命令」**：若控制台仍要求填写，可与「非生产部署命令」保持一致（均为带 `--keep-vars` 的 `deploy`），或留空/按 Cloudflare 当前 UI 要求处理；**勿**在 develop 上单独跑会覆盖生产的命令。

---

## 本地 / 手动（与 CI 等价前提）

在 `frontend` 目录，且 **已** `pnpm run build:opennext:ci`（或等价 build）之后：

**仅更新生产两个 Worker（不要用于 develop 机器误操作）：**

```bash
pnpm run cf:deploy:workers:prod
```

**仅更新开发两个 Worker：**

```bash
pnpm run cf:deploy:workers:dev
```

**切勿**在未确认当前分支与目标 Worker 时执行上述任一条。

---

## 合并 develop → master 之后

1. 走 **master** 的 Workers Builds（部署命令里的 **无 `--env`** 那条）。  
2. 开发 Worker（`*-dev`）可保留作长期预发，或之后在控制台停用/删除（与业务决策一致即可）。  
3. 若 develop 上已在 **`translatepdfonline-dev`** 配好变量，合并前可 **对照清单** 把缺失项补到 **`translatepdfonline`**，减少上线后配置差。

---

## 注意点汇总

1. **隔离靠名字**：`--env develop` + `[env.develop] name` + 独立队列名 + 独立 consumer 配置；不是靠「分支名自动魔法」。  
2. **`keep_vars` + `--keep-vars` + `patch-opennext-deploy-keep-vars.js`**：减少控制台变量被空配置覆盖；develop 与 master **各自 Worker 各配一套** 控制台变量。  
3. **数据库 / R2 / 第三方**：同一 Hyperdrive 或同一 R2 bucket = 开发与生产 **共享资源**；要隔离请拆分绑定与密钥。  
4. **自定义域**：生产继续绑 `translatepdfonline.com`；开发一般用 `*.workers.dev` 上的 dev 子域，勿把生产域名指到 `translatepdfonline-dev`。  
5. **第一次建 dev 队列 / dev Worker**：若 `deploy` 报资源不存在，先在 Dashboard **创建队列**再重试。

---

## 仓库内对应文件

| 文件 | 作用 |
|------|------|
| `wrangler.toml`（由 `wrangler.toml.template` 生成） | 顶层 = 生产；`[env.develop]` = 开发主站名与开发队列 producer |
| `wrangler.consumer.jsonc` | 生产队列 Consumer |
| `wrangler.consumer.develop.jsonc` | 开发队列 Consumer |
| `scripts/patch-opennext-deploy-keep-vars.js` | build 后给 OpenNext 重定向生成配置补 `keep_vars` |
