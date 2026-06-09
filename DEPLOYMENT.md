# 生产环境部署说明

## 部署拓扑

| 用途 | 域名 | 部署位置 |
|------|------|----------|
| **前端** | https://www.translatepdfonline.com | Cloudflare Workers (OpenNext) |
| **后端 API** | 同上（Next.js API Routes 内嵌于 Worker） | 同上 |
| **翻译执行** | 阿里云 FC HTTP 触发器 | 阿里云函数计算 |
| **数据库** | PostgreSQL（Hyperdrive 代理） | Cloudflare Hyperdrive |
| **对象存储** | Cloudflare R2 | Cloudflare |
| **队列** | Cloudflare Queues（OCR 流水线） | Cloudflare |

---

## 分支与环境隔离

项目采用 **develop → master** 分支策略，通过 Cloudflare Workers Builds（Git 连接）+ GitHub Actions 实现自动部署。

### 环境对照表

| | 开发环境 | 生产环境 |
|---|---------|---------|
| **Git 分支** | `develop` | `master` |
| **主 Worker 名** | `translatepdfonline-dev` | `translatepdfonline` |
| **队列 Consumer** | `translatepdfonline-quenues-dev` | `translatepdfonline-quenues` |
| **队列名** | `translatepdfonline-dev` | `translatepdfonline` |
| **域名** | `*.workers.dev` 默认子域 | `www.translatepdfonline.com` |
| **数据库** | 与生产共享或独立 Hyperdrive | 生产 Hyperdrive 绑定 |
| **触发方式** | push develop → 自动部署 | push master → 手动/CD 触发 |

### Cloudflare Workers Builds 配置

在 Cloudflare Dashboard → Workers & Pages → 项目 → Settings → Build 中配置：

**两个分支共用：**

- **构建根目录**：`frontend`
- **构建命令**：`pnpm run build:opennext:ci`

**生产分支（master）部署命令：**

```bash
npx wrangler deploy --keep-vars && npx wrangler deploy -c wrangler.consumer.jsonc --keep-vars
```

**非生产分支（develop）部署命令：**

```bash
npx wrangler deploy --env develop --keep-vars && npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars
```

> ⚠️ **严禁在 develop 分支执行不带 `--env develop` 的 `wrangler deploy`**——会与 master 同名，直接覆盖生产 Worker。

### GitHub Actions

push develop 后通过 Git 连接触发 Cloudflare Workers Builds 自动构建部署。GitHub Actions 辅助执行额外的检查或部署步骤（workflow 配置在 `.github/workflows/`，该目录被 gitignore 保护）。

### 四种 Worker 的变量维护

部署后需在 Cloudflare Dashboard 分别为以下 Worker 配置 Variables and secrets：

| Worker | 环境 | 关键变量 |
|--------|------|---------|
| `translatepdfonline` | 生产主站 | `TRANSLATE_FC_URL`、`TRANSLATE_FC_SECRET`、`NEXT_PUBLIC_APP_URL`、R2 系列、`AUTH_SECRET`、`CRON_SECRET`、积分/支付系列 |
| `translatepdfonline-quenues` | 生产队列 | `OCR_DISPATCH_URL`、`OCR_DISPATCH_SECRET`、`DATABASE_URL`、R2 系列 |
| `translatepdfonline-dev` | 开发主站 | 同上但值指向开发资源（FC 可用同一函数、R2 可用同一 bucket 或独立） |
| `translatepdfonline-quenues-dev` | 开发队列 | `OCR_DISPATCH_URL`（指向 dev）、`OCR_DISPATCH_SECRET` |

### 合并 develop → master 之后

1. 走 master 的 Workers Builds 部署命令（无 `--env` 那条）
2. 开发 Worker（`*-dev`）可保留为长期预发环境
3. 若 develop 上 `translatepdfonline-dev` 已配置好变量，合并前对照清单把缺失项补到生产 Worker

### 环境变量生效机制

本项目通过三步确保变量在 Worker 运行时可用：

1. **构建注入**：`build:opennext:ci` → `scripts/generate-wrangler.js` 从构建环境 `process.env` 读取白名单键 → 写入 `wrangler.toml` `[vars]`
2. **运行时保留**：部署命令始终带 `--keep-vars`，保留 Dashboard 中已有的 Variables and secrets
3. **OpenNext 补丁**：`scripts/patch-opennext-deploy-keep-vars.js` 在 build 后补上 OpenNext 生成配置中的 `keep_vars`

> Cloudflare 文档明确：Git 集成中的「Build variables」仅在构建过程可用，**默认不进 Worker 运行时**。本项目的 `generate-wrangler.js` 绕过了这个限制。

---

## 一、前端（Cloudflare Workers / Pages）

### 构建与部署

```bash
cd frontend

# CI / 自动部署用（完整流程：生成 wrangler → 构建 → 部署）
pnpm run build:opennext:ci

# 本地手动部署
pnpm run cf:deploy                    # 部署到生产
pnpm run cf:deploy:workers:prod       # 仅更新 Worker（主站 + 队列）
pnpm run cf:deploy:workers:dev        # 仅更新开发 Worker
```

### 生产环境变量（Worker → Settings → Variables and secrets）

**必须配置：**

| 变量 | 说明 | 示例 |
|------|------|------|
| `TRANSLATE_FC_URL` | 阿里云 FC HTTP 触发器地址 | `https://xxx.fcapp.run/translate` |
| `TRANSLATE_FC_SECRET` / `BABELDOC_FC_SECRET` | FC 鉴权密钥 | 与 FC 侧一致 |
| `NEXT_PUBLIC_APP_URL` | 站点根 URL（生成 callback_url） | `https://www.translatepdfonline.com` |
| `AUTH_SECRET` | Better Auth 会话加密 | `openssl rand -base64 32` |
| `R2_BUCKET` | R2 桶名 | `translatepdfonline` |
| `R2_ACCESS_KEY_ID` | R2 API 密钥 ID | |
| `R2_SECRET_ACCESS_KEY` | R2 API 密钥 | |
| `R2_ENDPOINT` | R2 endpoint | `https://<account>.r2.cloudflarestorage.com` |
| `CRON_SECRET` | 清理/派发 Cron 鉴权 | |

**按需配置：**

- `DATABASE_URL`：仅当不依赖 Hyperdrive 绑定时设置
- `TRANSLATE_CREDITS_ENABLED`、`TRANSLATE_CREDITS_PER_PAGE`、`CREEM_*`：付费功能
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google OAuth
- `RESEND_API_KEY` / `RESEND_FROM`：邮箱验证码发信
- `TRANSLATE_DISPATCH_SECRET`、`TRANSLATE_DISPATCH_BATCH_SIZE`：调优 Cron 派发

### Hyperdrive 绑定（PostgreSQL）

1. 在 Cloudflare Dashboard 创建 Hyperdrive 配置（PostgreSQL）
2. 在 Worker → Settings → Bindings → Hyperdrive 添加绑定
3. **Variable name 必须填 `HYPERDRIVE`**（全大写）
4. 使用 Hyperdrive 时不必再设 `DATABASE_URL`（代码优先用 `env.HYPERDRIVE.connectionString`）

> ⚠️ CI 构建阶段 `DATABASE_URL` 不能使用 Hyperdrive 代理串（Node 无法解析 `*.hyperdrive.cloudflare.com`）。应使用直连数据库串或不设置。

### 队列绑定（OCR 流水线）

OCR 使用 Cloudflare Queues，需在 Dashboard 创建队列并绑定：

- 队列名：`translatepdfonline`（生产）/ `translatepdfonline-dev`（开发）
- 绑定名：`OCR_PIPELINE_QUEUE`（Producer）/ 同队列名（Consumer）
- Consumer 配置文件：`wrangler.consumer.jsonc`（生产）/ `wrangler.consumer.develop.jsonc`（开发）

### Cron 定时任务

在 Worker → Triggers → Cron 中配置：

| Cron 表达式 | 调用的路径 | 说明 |
|------------|-----------|------|
| 建议每小时 | `POST /api/translate/dispatch-pending` | 重派未完成的翻译任务 |
| 建议每天 | `POST /api/documents/cleanup-expired` | 清理 7 天前过期的文档 |

两个接口均需请求头 `x-cron-secret: <CRON_SECRET>`。

### DNS

- `www.translatepdfonline.com` CNAME 指向 Cloudflare 分配的 Worker 地址
- 如需根域名重定向，在 DNS 配置 URL 转发规则

---

## 二、阿里云 FC（babeldoc_fc）

### 镜像构建

```bash
# CPU 版
docker build -f docker/Dockerfile.babeldoc-fc -t babeldoc-fc:latest .

# GPU 版
docker build -f docker/Dockerfile.babeldoc-fc.gpu -t babeldoc-fc:gpu .
```

### FC 控制台配置

1. 创建函数计算服务 → Web 函数（或自定义容器）+ HTTP 触发器
2. 推送镜像到阿里云容器镜像服务（ACR）
3. 配置超时时间：建议 ≥600 秒（大文件可调至 900–1200）
4. 配置内存：建议 ≥2GB；GPU 函数另需选择 GPU 规格
5. HTTP 触发器认证方式选择「无需认证」（鉴权走请求头 `X-Babeldoc-Secret`）

### FC 环境变量

| 变量 | 说明 | 必填 |
|------|------|:----:|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 是 |
| `DEEPSEEK_MODEL` | 模型 ID（推荐 `deepseek-chat`） | 是 |
| `DEEPSEEK_BASE_URL` | API 地址 | 否 |
| `R2_BUCKET_NAME` | R2 桶名 | 是 |
| `R2_ENDPOINT_URL` | R2 endpoint | 是 |
| `R2_ACCESS_KEY_ID` | R2 密钥 ID | 是 |
| `R2_SECRET_ACCESS_KEY` | R2 密钥 | 是 |
| `BABELDOC_FC_SECRET` / `TRANSLATE_FC_SECRET` | 鉴权密钥 | 推荐 |
| `BABELDOC_PATH` | BabelDOC 根目录 | 否 |
| `BABELDOC_SKIP_SCANNED_DETECTION` | 关闭扫描检测 | 否 |

### FC 验证

```bash
# 健康检查
curl https://<fc-host>/health

# 手动测试翻译（替换实际值）
curl -X POST "https://<fc-host>/translate" \
  -H "Content-Type: application/json" \
  -H "X-Babeldoc-Secret: <secret>" \
  -d '{
    "task_id": "test-001",
    "source_pdf_url": "<R2 presigned GET URL>",
    "output_object_key": "translations/test-001/output.pdf",
    "source_lang": "en",
    "target_lang": "zh",
    "callback_url": "<NEXT_PUBLIC_APP_URL>/api/translate/callback"
  }'
```

### FC 日志排错

- 登录 [阿里云函数计算控制台](https://fcnext.console.aliyun.com) → 选择地域与函数 → 日志查询
- FC 返回 500：一般为容器内 BabelDOC/DeepSeek/R2 抛异常，查看 FC 实例日志
- Common causes: R2/DeepSeek 环境变量未配、源 PDF presigned URL 过期、内存不足、BabelDOC 依赖缺失
- FC 回调 Next 时：需确保 `callback_url` 可被 FC 公网访问

---

## 三、首次部署准备清单

### Cloudflare 侧

- [ ] 创建 R2 bucket，生成 API 密钥
- [ ] 创建 Hyperdrive 配置（连接生产 PostgreSQL）
- [ ] 创建 OCR 队列 `translatepdfonline`（和开发 `translatepdfonline-dev`）
- [ ] 在 Worker Settings 配置所有运行时 Variables and secrets
- [ ] 在 Worker Triggers 配置 Cron 定时任务
- [ ] DNS：`www.translatepdfonline.com` CNAME 指向 Worker
- [ ] （可选）配置自定义域 SSL 证书

### 阿里云 FC 侧

- [ ] 构建并推送 Docker 镜像到 ACR
- [ ] 创建 FC 函数，配置 HTTP 触发器
- [ ] 配置 FC 环境变量（DeepSeek、R2、Secret）
- [ ] 设置超时 ≥600s，内存 ≥2GB
- [ ] 验证 `/health` 可访问

### 开发环境（develop）

- [ ] 在 Cloudflare 为 `translatepdfonline-dev` 创建同名 Worker
- [ ] 创建开发队列 `translatepdfonline-dev`
- [ ] 配置开发 Variable and secrets（可复用生产 R2 桶但用不同 FC 函数或同一函数）
- [ ] 在 Cloudflare Workers Builds 中为 develop 分支配置正确的部署命令

### 部署后验证

- [ ] 打开 https://www.translatepdfonline.com 前端正常加载
- [ ] 上传测试 PDF，创建翻译任务
- [ ] 任务从 queued → processing → completed 正常流转
- [ ] 译文 PDF 可预览和下载
- [ ] 登录/注册功能正常
- [ ] OCR 功能正常（上传扫描件测试）

---

## 四、本地测试 FC 回调

本地开发时 FC 无法访问 `localhost`，需用内网穿透：

### ngrok

```bash
ngrok http 3000
# 记下 HTTPS 地址，如 https://abc123.ngrok-free.app
```

在 `frontend/.env.development` 中设置：

```env
NEXT_PUBLIC_APP_URL=https://abc123.ngrok-free.app
```

### Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:3000
# 获得 *.trycloudflare.com URL
```

同样设置 `NEXT_PUBLIC_APP_URL` 为该 URL。

> 不做穿透时：创建任务正常，但 FC 回调失败，任务一直停留在 queued/processing。

---

## 五、配置文件索引

| 文件 | 用途 |
|------|------|
| `frontend/wrangler.toml` | 生产 Worker 配置（由 template 生成） |
| `frontend/wrangler.toml.template` | wrangler 模板（CI 中由 generate-wrangler.js 处理） |
| `frontend/wrangler.consumer.jsonc` | 生产队列 Consumer 配置 |
| `frontend/wrangler.consumer.develop.jsonc` | 开发队列 Consumer 配置 |
| `frontend/scripts/generate-wrangler.js` | CI 构建时从构建环境变量生成 wrangler.toml |
| `frontend/scripts/patch-opennext-deploy-keep-vars.js` | 补丁 OpenNext 生成配置以保留变量 |
| `frontend/scripts/DEPLOY-DEVELOP-VS-MASTER.md` | 分支隔离部署详细说明 |
| `scripts/deploy/translatepdfonline.conf` | Nginx 配置（ECS 后端使用） |
| `docker/Dockerfile.babeldoc-fc` | FC CPU 镜像 Dockerfile |
| `docker/Dockerfile.babeldoc-fc.gpu` | FC GPU 镜像 Dockerfile |
| `frontend/docs/FC_DEPLOY_GUIDE.md` | FC 部署逐步指南 |
| `frontend/docs/cloudflare-env-真相.md` | Cloudflare 变量机制详解 |
