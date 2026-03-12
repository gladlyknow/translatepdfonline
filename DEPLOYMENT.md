# 生产环境部署说明

本文档说明如何将 translatepdfonline 部署到生产：**前端 → Cloudflare Pages**、**后端 → 阿里云 ECS**、**BabelDOC → 阿里云函数计算（FC）**，以及环境变量与注意事项。

---

## 一、当前代码对 FC 的适配情况

### 1.1 已完成的适配（无需再改代码）

- **后端**
  - `backend/app/config.py`：已增加 `BABELDOC_USE_FC`、`BABELDOC_FC_URL`、`BABELDOC_FC_SECRET`。
  - `backend/app/babeldoc_client.py`：已实现 `run_translate_remote()`，向 FC 的 `POST /translate` 发请求并传 `X-Fc-Secret`。
  - `backend/app/tasks_translate.py`：当 `BABELDOC_USE_FC=true` 时，会生成源 PDF 的 presigned URL（本地仅有文件时先上传到 R2 的 `temp/{task_id}/source.pdf`），再调用 FC，并将返回的 `output_object_key` 写库；FC 失败时错误码为 `fc_error`。
- **FC 服务**
  - `babeldoc_fc/`：已提供 FastAPI 应用，`POST /translate` 接收 presigned URL 与参数，下载 PDF → 调 BabelDOC → 上传结果到 R2，返回 `output_object_key`；可选 `X-Fc-Secret` 鉴权；`GET /health` 用于探活。
  - `babeldoc_fc/run_translate.py`：通过 `BABELDOC_PATH` 或默认 `项目根/tmp/BabelDOC` 加载 BabelDOC，与现有逻辑一致。

### 1.2 部署时需注意的代码/环境要点

- **FC 调用地址**：阿里云 FC HTTP 触发器可能带路径前缀（如 `/2016-08-15/proxy/default/函数名`）。配置 ECS 的 `BABELDOC_FC_URL` 时，应填**完整 URL，且路径以 `/translate` 结尾**，例如：
  - `https://123456789.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/default/babeldoc/translate`
  - 若只填域名，`babeldoc_client` 会自动追加 `/translate`。
- **FC 容器内路径**：FC 自定义容器内需保证 **BabelDOC 与 babeldoc_fc 同属一个“项目根”**（即 `项目根/tmp/BabelDOC`、`项目根/babeldoc_fc` 存在）。镜像构建时请把整份代码（或至少 `tmp/BabelDOC` 与 `babeldoc_fc`）按此结构 COPY 进去，并设置 **工作目录为该项目根**，再启动 uvicorn（见下文 FC 部署步骤）。
- **取消任务**：当前 FC 为同步调用，Worker 等待 FC 返回；用户点击「取消」时，仅 ECS 侧标记取消，FC 内 BabelDOC 会继续跑完。若需 FC 内也支持取消，需后续在 FC 内轮询 Redis 等，本期可不做。

结论：**现有代码已满足“ECS 调 FC、FC 跑 BabelDOC 并回写 R2”的流程，无需再改即可按下面步骤部署。**

---

## 二、部署顺序建议

建议按 **FC → 后端（ECS）→ 前端（Cloudflare）** 顺序部署，以便先打通「创建任务 → Worker 调 FC → 任务完成」再对外提供页面。

1. **FC**：先部署 BabelDOC 服务并拿到 HTTP 地址与鉴权密钥。
2. **ECS**：部署 API + Celery Worker，配置 R2、数据库、Redis 及 FC 地址与密钥。
3. **Cloudflare Pages**：连接 GitHub，配置构建与 `NEXT_PUBLIC_API_BASE_URL` 指向 ECS API。

---

## 三、环境变量汇总

### 3.1 前端（Cloudflare Pages）

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `NEXT_PUBLIC_API_BASE_URL` | 是 | 后端 API 公网地址（与 ECS CORS 一致） | `https://api.yourdomain.com` |

### 3.2 后端（ECS）

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `DATABASE_URL` | 是 | PostgreSQL 连接串 | `postgresql://user:pass@host:5432/dbname` |
| `REDIS_URL` | 是 | Redis 连接串（Celery broker） | `redis://host:6379/0` |
| `JWT_SECRET` | 是 | JWT 签名密钥 | 随机长字符串 |
| `FRONTEND_ORIGINS` | 是 | 前端域名，逗号分隔（CORS） | `https://xxx.pages.dev,https://yourdomain.com` |
| `R2_ACCOUNT_ID` | 是 | Cloudflare R2 Account ID | - |
| `R2_BUCKET_NAME` | 是 | R2 桶名 | `translatepdfonline` |
| `R2_ACCESS_KEY_ID` | 是 | R2 API 密钥 ID | - |
| `R2_SECRET_ACCESS_KEY` | 是 | R2 API 密钥 Secret | - |
| `R2_ENDPOINT_URL` | 是 | R2 S3 兼容 endpoint | `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_PUBLIC_URL` | 否 | 桶公网访问 URL（若配置） | - |
| `BABELDOC_USE_FC` | 生产建议 | 设为 `true` 走 FC | `true` |
| `BABELDOC_FC_URL` | 当 USE_FC 时 | FC 的 /translate 完整 URL | 见上文 |
| `BABELDOC_FC_SECRET` | 建议 | 与 FC 内一致，请求头鉴权 | 随机字符串 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | 若用 Google 登录 | OAuth 配置 | 生产回调 URI 改为 ECS 域名 |
| `RESEND_API_KEY` / `RESEND_FROM` | 若用邮箱注册 | 发信配置 | - |

说明：ECS 上**可不配置** `DEEPSEEK_API_KEY`（仅 FC 需要）；不配置 `BABELDOC_STAGING_DIR` / `BABELDOC_OUTPUT_DIR` 也可（Worker 不写本地 BabelDOC 目录）。

### 3.3 FC（阿里云函数计算）

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API Key | - |
| `DEEPSEEK_BASE_URL` | 否 | 默认 `https://api.deepseek.com` | - |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-chat` | - |
| `R2_BUCKET_NAME` | 是 | 与 ECS 同一 R2 桶 | 同上 |
| `R2_ENDPOINT_URL` | 是 | R2 S3 endpoint | 同上 |
| `R2_ACCESS_KEY_ID` | 是 | R2 密钥 | 同上 |
| `R2_SECRET_ACCESS_KEY` | 是 | R2 密钥 | 同上 |
| `BABELDOC_FC_SECRET` | 建议 | 与 ECS 一致，校验请求头 | 同上 |
| `BABELDOC_PATH` | 否 | 镜像内 BabelDOC 根目录（若与默认不同） | 如 `/code/tmp/BabelDOC` |

---

## 四、前端部署（Cloudflare Pages）

### 4.1 仓库与分支

- 仓库：`https://github.com/gladlyknow/translatepdfonline.git`
- 使用分支：如 `main` 作为生产构建分支。

### 4.2 创建 Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Pages** → **Create application** → **Connect to Git**。
2. 选择 **gladlyknow/translatepdfonline**，授权后继续。
3. **Build configuration**：
   - **Root directory**：`frontend`（项目根为 monorepo，必填）。
   - **Framework preset**：Next.js（若自动识别则保持）。
   - **Build command**：`npm run build`。
   - **Build output directory**：Next.js 默认使用 `.next`；若使用静态导出（`output: 'export'`）则填 `out`。

### 4.3 环境变量

在 **Settings** → **Environment variables** 中为 **Production**（及可选 Preview）添加：

- **NEXT_PUBLIC_API_BASE_URL**：`https://api.yourdomain.com`（替换为你的 ECS API 公网地址）。

保存后重新部署一次使变量生效。

### 4.4 构建与发布

- 推送到所配置分支会触发自动构建。
- 构建成功后可通过 `*.pages.dev` 或已绑定的自定义域名访问。
- 若使用 Next.js 服务端能力（SSR/API 路由），请确认 Cloudflare 对 Next.js 的兼容方式（必要时使用 `@cloudflare/next-on-pages` 或改为静态导出）。

### 4.5 后端 CORS

ECS 的 `FRONTEND_ORIGINS` 必须包含该前端域名，例如：

- `https://your-project.pages.dev`
- `https://yourdomain.com`（若已绑定自定义域名）

---

## 五、后端部署（阿里云 ECS）

### 5.1 资源准备

- ECS 实例（建议 2 核 4G 起）、安全组放行 80/443 及 SSH。
- RDS（PostgreSQL）、Redis（与 ECS 同 VPC 或可访问）。
- 可选：SLB + 域名，为 API 配置 HTTPS（如 `api.yourdomain.com`）。

### 5.2 代码与依赖

- 从 GitHub 拉取代码：`git clone https://github.com/gladlyknow/translatepdfonline.git`，或通过 CI 构建 Docker 镜像推送到阿里云 ACR，ECS 拉取运行。
- 若直接在 ECS 上运行（非 Docker）：
  - 安装 Python 3.10+，在项目根目录：`pip install -r backend/requirements.txt`（**不要**在 ECS 上执行 `pip install -e tmp/BabelDOC`，BabelDOC 仅在 FC 运行）。

### 5.3 环境变量

在 ECS 上配置本节「3.2 后端（ECS）」中的变量，重点包括：

- `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`FRONTEND_ORIGINS`
- 全部 R2 相关变量
- `BABELDOC_USE_FC=true`、`BABELDOC_FC_URL`、`BABELDOC_FC_SECRET`
- Google OAuth、Resend 等按需配置

可将变量写在 `/etc/environment`、systemd 的 `Environment=` 或 `.env`（注意权限与安全）。

### 5.4 进程管理

- **API**：建议使用 gunicorn + uvicorn，例如：
  - `cd backend && gunicorn -k uvicorn.workers.UvicornWorker app.main:app -b 0.0.0.0:8000`
  - 用 systemd 或 supervisor 管理，并配置重启与日志。
- **Celery Worker**：
  - `cd backend && celery -A app.celery_app worker -l info`
  - 与 API 同机或另机均可，需能访问同一 Redis、PostgreSQL、R2 及 FC URL。

### 5.5 健康检查

- 对 API 做 HTTP 探活：`GET /health` 返回 200。
- 创建一条翻译任务，在 Worker 日志中确认出现对 FC 的 HTTP 请求，且任务最终为 completed。

---

## 六、FC 部署（阿里云函数计算 · BabelDOC）

**从创建到部署的逐步操作**（镜像构建、ACR 推送、控制台创建函数、HTTP 触发器、环境变量、验证）：见 **[docs/FC_DEPLOY_GUIDE.md](docs/FC_DEPLOY_GUIDE.md)**。

### 6.1 运行时选择

- **推荐**：使用 **自定义容器** 运行 FC，镜像内预装 Python、BabelDOC 与 babeldoc_fc，避免代码包体积与依赖问题。
- **CPU 版**：创建时选 **Web 函数**（或自定义容器 + HTTP 触发器），使用 `docker/Dockerfile.babeldoc-fc` 构建镜像。
- **GPU 版**：创建时选 **GPU 函数**，使用 `docker/Dockerfile.babeldoc-fc.gpu` 构建镜像（基于 CUDA 11.8，BabelDOC 的 DocLayout ONNX 会使用 CUDAExecutionProvider 加速）。需在 FC 控制台选择 GPU 规格（卡型、显存）并配置 HTTP 触发器。
- 若使用代码包 + 层：需将 BabelDOC 及大依赖打成层，入口仅保留 babeldoc_fc 的薄 HTTP 层；注意冷启动与超时。

### 6.2 镜像构建（CPU 示例）

在**项目根目录**创建 Dockerfile（保证与 `babeldoc_fc`、`tmp/BabelDOC` 同层级），例如：

```dockerfile
# 建议在项目根（translatepdfonline）执行 docker build -f docker/Dockerfile.babeldoc-fc -t babeldoc-fc:latest .
FROM python:3.11-slim

WORKDIR /code

# 安装 BabelDOC 依赖（按 tmp/BabelDOC 的 pyproject.toml）
COPY tmp/BabelDOC /code/tmp/BabelDOC
RUN pip install --no-cache-dir -e /code/tmp/BabelDOC

# babeldoc_fc 与轻量依赖
COPY babeldoc_fc /code/babeldoc_fc
RUN pip install --no-cache-dir -r /code/babeldoc_fc/requirements.txt

# 工作目录保持项目根，便于 run_translate 解析 tmp/BabelDOC
WORKDIR /code
ENV PYTHONPATH=/code

EXPOSE 9000
CMD ["uvicorn", "babeldoc_fc.main:app", "--host", "0.0.0.0", "--port", "9000"]
```

构建与推送（示例）：

```bash
docker build -f docker/Dockerfile.babeldoc-fc -t babeldoc-fc:latest .
# 推送到阿里云 ACR
docker tag babeldoc-fc:latest registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:latest
docker push registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:latest
```

### 6.2.1 镜像构建（GPU 版）

需要 GPU 加速时，使用 GPU 专用 Dockerfile（CUDA 11.8 + onnxruntime-gpu，与 BabelDOC 的 `[cuda]` 可选依赖一致）：

```bash
# 在项目根目录执行（需具备 NVIDIA 环境或于支持 GPU 的构建环境构建）
docker build -f docker/Dockerfile.babeldoc-fc.gpu -t babeldoc-fc:gpu .
docker tag babeldoc-fc:gpu registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:gpu
docker push registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:gpu
```

- 镜像基于 `nvidia/cuda:11.8.0-runtime-ubuntu22.04`，安装 BabelDOC 时使用 `pip install -e "/code/tmp/BabelDOC[cuda]"`，DocLayout 会优先使用 `CUDAExecutionProvider`（已在本项目 `tmp/BabelDOC/babeldoc/docvision/doclayout.py` 中支持）。
- 创建 FC 时选择 **GPU 函数**，镜像地址填上述 GPU 镜像；配置 GPU 规格、内存（建议 ≥2048 MB）、超时（建议 600 秒）及 HTTP 触发器。

### 6.3 在 FC 控制台创建函数

1. **函数计算** → **函数** → **创建函数**。
2. **函数类型**：CPU 选 **Web 函数**（或等价的自定义容器），GPU 选 **GPU 函数**；**运行时**均选 **自定义容器**，镜像地址填上一步推送的镜像（CPU 用 `babeldoc-fc:latest`，GPU 用 `babeldoc-fc:gpu`）。
3. **配置**：
   - **内存**：建议 ≥ 2048 MB（BabelDOC 占内存）。
   - **超时**：建议 600 秒（10 分钟）。
   - **GPU**（仅 GPU 函数）：选择所需卡型与显存（如 T4、A10 等，按阿里云控制台可选规格）。
   - **实例并发**：按成本与并发需求设置（如 1）。
4. **环境变量**：填写「3.3 FC」中的变量（DEEPSEEK_*、R2_*、BABELDOC_FC_SECRET、可选 BABELDOC_PATH）。

### 6.4 HTTP 触发器

1. 为函数创建 **HTTP 触发器**，方法包含 **POST**，路径建议包含 `/translate`（如 `/translate` 或 `/*` 由网关转发到 `/translate`）。
2. 若使用 FC 默认域名，完整 URL 通常形如：  
   `https://<account_id>.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/default/<函数名>/translate`  
   将该 URL 填到 ECS 的 `BABELDOC_FC_URL`。

### 6.5 鉴权与安全

- 在 FC 和 ECS 上设置相同的 **BABELDOC_FC_SECRET**；ECS 的 babeldoc_client 会在请求头中带 `X-Fc-Secret`，FC 的 `main.py` 会校验，避免接口被滥用。
- Presigned URL 有效期 1 小时，仅用于 FC 拉取源 PDF，不暴露 R2 主密钥。

### 6.6 本地验证 FC（可选）

在项目根目录：

```bash
pip install -e tmp/BabelDOC
pip install -r babeldoc_fc/requirements.txt
BABELDOC_PATH=tmp/BabelDOC PYTHONPATH=. uvicorn babeldoc_fc.main:app --host 0.0.0.0 --port 9000
```

用 curl 调 `POST /translate`（需有效 presigned URL 与参数）或 `GET /health` 验证。

---

## 七、部署检查清单

- [ ] FC 已部署，`GET <BABELDOC_FC_URL 基础地址>/health` 返回 200。
- [ ] ECS 已配置 `BABELDOC_USE_FC=true`、`BABELDOC_FC_URL`、`BABELDOC_FC_SECRET` 及全部 R2、DB、Redis 变量。
- [ ] ECS API `GET /health` 返回 200；创建翻译任务后 Worker 能调通 FC 且任务状态变为 completed。
- [ ] Cloudflare Pages 已配置 `NEXT_PUBLIC_API_BASE_URL` 指向 ECS API；`FRONTEND_ORIGINS` 包含前端域名。
- [ ] 前端能正常打开、登录、上传 PDF、创建翻译并查看结果。

---

## 八、故障排查

| 现象 | 可能原因 | 处理建议 |
|------|----------|----------|
| 任务一直 processing 或失败，错误码 fc_error | FC 未返回 200；网络或 FC 超时 | 查 Worker 日志中的 HTTP 状态码与 FC 返回内容；确认 FC 超时 ≥ 600s、内存足够。 |
| FC 返回 403 | ECS 与 FC 的 `BABELDOC_FC_SECRET` 不一致或未传 | 核对两端环境变量一致，且 ECS 请求头带 `X-Fc-Secret`。 |
| FC 报 “BabelDOC not installed” 或找不到模块 | 镜像内 BabelDOC 路径或 PYTHONPATH 不对 | 确认镜像中 `/code/tmp/BabelDOC` 存在且已执行 `pip install -e /code/tmp/BabelDOC`（GPU 镜像用 `pip install -e "/code/tmp/BabelDOC[cuda]"`）；工作目录为 `/code`。 |
| GPU 镜像报 CUDA/onnxruntime 相关错误 | CUDA 版本与 onnxruntime-gpu 不匹配或驱动不可用 | GPU 镜像使用 CUDA 11.8 与 BabelDOC `[cuda]` 可选依赖；确认 FC 实例已分配 GPU 且驱动可用。 |
| FC 报 “R2 not configured” 或上传失败 | FC 未配置 R2 环境变量或网络不通 | 在 FC 控制台补全 R2_* 变量；若 R2 在海外，确认 FC 可访问外网或配置 NAT。 |
| 前端请求 API 跨域或 404 | CORS 或 API 地址错误 | 检查 ECS `FRONTEND_ORIGINS` 包含前端域名；检查 `NEXT_PUBLIC_API_BASE_URL` 与 rewrites/代理一致。 |

---

以上为从**前端 → 后端 → FC** 的完整部署与环境变量说明；按顺序执行即可完成生产环境部署。
