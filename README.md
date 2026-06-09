# translatepdfonline

在线 PDF 翻译平台 — 上传 PDF、选择语言，获得保留原始版式的译文文件。支持 10 种语言互译，包含扫描件 OCR 预处理流水线。

**生产地址**：[translatepdfonline.com](https://www.translatepdfonline.com)

## 核心功能

- **PDF 翻译**：上传 PDF，选择源语言/目标语言和页码范围，通过 DeepSeek AI 翻译并保留版式
- **扫描件 OCR**：对扫描版/图片型 PDF 先做 OCR 文字识别，再进行翻译
- **原文/译文对照预览**：浏览器内并排预览源文与译文，支持分页浏览
- **多语言 UI**：网站界面支持中文、英文、西班牙文（`zh`/`en`/`es`）
- **积分计费**：免费额度 + 按页消耗积分，支持 Creem 在线充值（月付/年付/一次性）
- **历史任务**：登录后查看所有翻译历史，随时重新下载或预览

## 架构速览

```
浏览器 → Cloudflare Pages/Worker → Next.js API Routes → PostgreSQL
                                      ↓ POST /translate
                                   阿里云 FC (babeldoc_fc)
                                      ↓ callback
                                   Next.js /api/translate/callback
                                      ↕
                                   Cloudflare R2 (源文件 + 译文)
```

- **前端**：Next.js 15 + React 19 + next-intl，基于 OpenNext 部署到 Cloudflare
- **翻译引擎**：Python FastAPI 服务（`babeldoc_fc`），部署在阿里云函数计算
- **存储**：Cloudflare R2（S3 兼容对象存储）
- **数据库**：PostgreSQL + Drizzle ORM
- **支付**：Creem 订阅/一次性支付

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)

## 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Next.js 15 (App Router)、React 19、TypeScript |
| UI | Tailwind CSS 4、Radix UI、Framer Motion |
| 多语言 | next-intl |
| 数据库 | PostgreSQL + Drizzle ORM + Hyperdrive |
| 认证 | Better Auth（邮箱 + Google OAuth） |
| 存储 | Cloudflare R2（S3 兼容） |
| 翻译 AI | DeepSeek API（通过 BabelDOC 编排） |
| 翻译服务 | Python FastAPI + 阿里云函数计算 |
| OCR | 百度 OCR + OCRmyPDF + Cloudflare Queues + Puppeteer |
| 支付 | Creem |
| 部署 | Cloudflare Workers/Pages (OpenNext) |
| 构建 | pnpm + ESLint + Prettier |

## 快速开始

### 前置依赖

- **Node.js** 18.x 或 20.x（LTS）
- **pnpm**（`npm install -g pnpm`）
- **PostgreSQL** 数据库实例（本地或云端）
- （可选）Python 3.10+，用于本地运行 babeldoc_fc

### 1. 克隆并安装

```bash
git clone https://github.com/gladlyknow/translatepdfonline.git
cd translatepdfonline/frontend
pnpm install
```

### 2. 配置环境变量

在 `frontend/` 下创建 `.env.development`：

```env
# 数据库（直连串，不要用 Hyperdrive 代理串）
DATABASE_URL=postgres://user:password@host:5432/dbname

# 认证
AUTH_SECRET=your-auth-secret-base64

# R2 存储
R2_BUCKET=your-bucket
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

# 站点
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> 完整变量列表见 [frontend/docs/environment-variables.md](frontend/docs/environment-variables.md)

### 3. 初始化数据库

```bash
pnpm run db:push
```

### 4. 启动开发服务器

```bash
pnpm run dev
```

访问 http://localhost:3000

## 文档导航

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 完整架构、数据模型、API 路由表、环境变量全集、排错指南 |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 生产部署说明（Cloudflare + ECS + FC）、分支隔离部署 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 分支策略、提交流程、本地开发、代码规范 |
| [CLAUDE.md](./CLAUDE.md) | AI 助手指引（供 Claude Code 使用） |

### 技术存档（`doc/`）

| 文档 | 内容 |
|------|------|
| [doc/ARCHIVE_INDEX.md](./doc/ARCHIVE_INDEX.md) | 全部文档索引与链接勘误 |
| [doc/TECHNICAL_OVERVIEW.md](./doc/TECHNICAL_OVERVIEW.md) | 技术总览（含架构图） |
| [doc/REQUIREMENTS.md](./doc/REQUIREMENTS.md) | 产品需求摘要 |

### 领域文档（`frontend/docs/`）

| 领域 | 文档 |
|------|------|
| 环境变量与 Hyperdrive | [frontend/docs/environment-variables.md](frontend/docs/environment-variables.md) |
| Cloudflare 构建 vs 运行时 | [frontend/docs/cloudflare-env-真相.md](frontend/docs/cloudflare-env-真相.md) |
| Next ↔ FC 请求回调契约 | [frontend/docs/translate-fc-contract.md](frontend/docs/translate-fc-contract.md) |
| 项目初始化与 FC 流程 | [frontend/docs/PROJECT_SETUP_AND_FC.md](frontend/docs/PROJECT_SETUP_AND_FC.md) |
| Creem 支付接入 | [frontend/docs/creem-checkout-setup.md](frontend/docs/creem-checkout-setup.md) |
| OCR 队列与流水线 | [frontend/docs/ocr-queue-and-pipeline.md](frontend/docs/ocr-queue-and-pipeline.md) |
| 数据库迁移 | [frontend/docs/migrations/](frontend/docs/migrations/) |
| BabelDOC FC 服务 | [babeldoc_fc/README.md](babeldoc_fc/README.md) |

### 部署

```bash
# 生产分支（master）
cd frontend
pnpm run build:opennext:ci
npx wrangler deploy --keep-vars && npx wrangler deploy -c wrangler.consumer.jsonc --keep-vars

# 开发分支（develop）
npx wrangler deploy --env develop --keep-vars && npx wrangler deploy -c wrangler.consumer.develop.jsonc --keep-vars
```

## 分支与环境隔离

| 分支 | Worker（主站） | 队列 Consumer | 自动部署 |
|------|----------------|---------------|----------|
| **master** | `translatepdfonline` | `translatepdfonline-quenues` | 手动 / CD |
| **develop** | `translatepdfonline-dev` | `translatepdfonline-quenues-dev` | push 触发 |

`develop` 分支推送后通过 GitHub Actions + Cloudflare Workers Builds 自动部署到 dev 环境。详见 [DEPLOYMENT.md](./DEPLOYMENT.md) 和 [frontend/scripts/DEPLOY-DEVELOP-VS-MASTER.md](frontend/scripts/DEPLOY-DEVELOP-VS-MASTER.md)。

## 遗留后端

仓库根目录 `backend/` 包含一套 FastAPI + Celery + Redis + SQLAlchemy 技术栈，是翻译功能的早期实现（路线 B）。当前主线为 Next.js + 阿里云 FC（路线 A），详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

若需使用 Python 后端：

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## 许可证

本项目基于 ShipAny Template Two 构建。ShipAny 模板代码的版权与许可证见 [frontend/LICENSE](frontend/LICENSE)。
