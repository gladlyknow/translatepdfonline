# 生产环境部署说明

## 域名与服务

| 用途 | 域名 | 部署位置 |
|------|------|----------|
| **前端** | https://www.translatepdfonline.com | Cloudflare Pages |
| **后端 API** | https://www.backend.translatepdfonline.com | ECS + Nginx 反代 FastAPI |

---

## 一、前端（Cloudflare Pages）

### 必须完成的配置（否则会出现 /api/auth/session 404 或域名打不开）

1. **Build configuration**
   - **Root directory**: `frontend`
   - **Build command**: `npm run build:export`
   - **Build output directory**: **`out`**

2. **Environment variables（Production）—— 必须在这里添加，构建时才会生效**
   - 进入 Pages 项目 → **Settings** → **Environment variables** → 选择 **Production**，添加：
   - `OUTPUT_EXPORT` = `1`
   - `NEXT_PUBLIC_API_BASE_URL` = `https://www.backend.translatepdfonline.com`（无尾部斜杠）
   - `NEXT_PUBLIC_STATIC_DEPLOY` = `1`（**必须**，否则会请求 /api/auth/session 导致 404）
   - 添加或修改环境变量后，需要 **重新部署**（Deployments → 最新一次 → Redeploy），新的构建才会带上这些变量。

3. **Custom domain**
   - 在 Pages 项目 **Custom domains** 中添加：**www.translatepdfonline.com**
   - 若希望 **translatepdfonline.com**（无 www）也能打开：在 Custom domains 中同时添加 **translatepdfonline.com**，按 Cloudflare 提示在 DNS 做 CNAME 或 A 记录；或在该域名所在 DNS 设置“根域名重定向到 www”。
   - DNS：`www` 的 CNAME 指向 Pages 给出的地址（如 `xxx.pages.dev`）。

说明：静态部署下界面会一直显示“未登录”（Sign in），但登录后接口鉴权仍通过 localStorage 中的 token 正常调用。

4. **多语言**：直接访问 `/register`、`/login`、`/privacy` 时，构建生成的落地页会按浏览器语言重定向到 `/zh/...`、`/en/...` 或 `/es/...`（无 JS 时回退到 `/en/...`）。

---

## 二、后端（ECS）

1. **Nginx**
   - 使用 `scripts/deploy/translatepdfonline.conf`，监听 **www.backend.translatepdfonline.com**（及 backend.translatepdfonline.com），反代到本机 FastAPI。
   - 为 **www.backend.translatepdfonline.com** 配置 SSL 证书（路径见 conf 内注释）。

2. **DNS**
   - **www.backend.translatepdfonline.com**（及可选 **backend.translatepdfonline.com**）A 记录指向 ECS 公网 IP。

3. **环境变量**
   - **`FRONTEND_ORIGINS`**（必填，否则前端请求会被 CORS 拦截）：允许的前端来源，逗号分隔，**必须包含**前端实际访问的域名，例如：
     - `https://translatepdfonline.pages.dev`（Cloudflare Pages 默认域名）
     - `https://www.translatepdfonline.com`（自定义域名）
     - 示例：`FRONTEND_ORIGINS=https://translatepdfonline.pages.dev,https://www.translatepdfonline.com`（无空格）
   - `GOOGLE_REDIRECT_URI` = `https://www.backend.translatepdfonline.com/api/auth/google/callback`（若使用 Google 登录）
   - **使用阿里云 FC 做翻译时**（见 [docs/FC_DEPLOY_GUIDE.md](docs/FC_DEPLOY_GUIDE.md)）：
     - `BABELDOC_USE_FC` = `true`
     - **BABELDOC_FC_URL 示例**：`https://translate-cpu-xxx.us-east-1.fcapp.run/translate`（FC HTTP 触发器完整 URL，需能 POST 到容器内 `/translate`）。也可按 CPU/GPU 分开配置：
     - `BABELDOC_FC_SPEC` = `cpu` 或 `gpu`（默认 `cpu`；后期切 GPU 只需改此处并重启 Worker）
     - `BABELDOC_FC_URL_CPU` = CPU 版 FC 的完整 URL（如 `https://translate-cpu-xxx.fcapp.run/translate`）
     - `BABELDOC_FC_URL_GPU` = GPU 版 FC 的完整 URL（如 `https://translate-gpu-xxx.fcapp.run/translate`）
     - 若只配一个 FC，可只设 `BABELDOC_FC_URL`，不设 `BABELDOC_FC_URL_CPU`/`BABELDOC_FC_URL_GPU`
     - `BABELDOC_FC_SECRET` = 与 FC 函数内配置的 `BABELDOC_FC_SECRET` 相同，用于请求头鉴权
     - `BABELDOC_FC_TIMEOUT_SECONDS` = 调用 FC 的 HTTP 超时（秒），默认 600；大文件可改为 900 或 1200，且 FC 控制台「执行超时」需 ≥ 此值
   - 其余按现有后端配置（DATABASE_URL、REDIS_URL、JWT_SECRET 等）

4. 重启 API 与 Nginx 使 CORS、OAuth 回调生效。**修改 FC 相关环境变量后必须重启 Celery Worker**，否则仍使用旧配置。

---

## 三、自检

- 打开 https://www.translatepdfonline.com 应为前端页面。
- 前端请求应发往 https://www.backend.translatepdfonline.com（无 CORS 报错）。
- 登录、上传、翻译流程正常。

---

## 四、后端日志与 FC 500 排错

### 4.1 后端 / Worker 日志怎么查看

- **API（FastAPI）**：若用 systemd 托管，`journalctl -u <api-service-name> -f`；若用 gunicorn/uvicorn 直接跑，日志在终端或你配置的 log 文件中。
- **Celery Worker**：同上，`journalctl -u <celery-worker-service-name> -f` 可实时看任务日志。Worker 将 INFO 打到 stdout（见 [backend/app/celery_app.py](backend/app/celery_app.py)），包括 `run_translation_task`、`run_translate_remote` 等；异常会打 `logger.exception` 含堆栈。
- 需要更细的 HTTP 请求日志时，可在 Nginx 或应用层加 access log；后端当前无单独「请求体/响应体」日志，可临时在路由里加 `logger.info` 或开 `DEEPSEEK_LOG_REQUESTS=1` 看 DeepSeek 请求。

### 4.2 「500 Internal Server Error」来自 FC 是什么意思、怎么改

该 500 是**阿里云 FC 函数内部报错**（容器内 BabelDOC/翻译或 R2/DeepSeek 等抛异常），不是 ECS 后端本身。

- **查看详细原因**：登录 [阿里云函数计算控制台](https://fcnext.console.aliyun.com) → 选择地域与函数（如 translate-cpu）→ **日志查询** / **调用日志** / **实例日志**，查看该次调用的错误堆栈与打印。
- **常见原因**：FC 内 R2 或 DeepSeek 环境变量未配/错误、源 PDF 下载失败（presigned URL 过期或跨域）、内存不足、BabelDOC 依赖缺失等。按 FC 日志中的异常信息逐项核对 [docs/FC_DEPLOY_GUIDE.md](docs/FC_DEPLOY_GUIDE.md) 中的环境变量与规格。

### 4.3 FC 翻译完成之后的后端逻辑

FC 返回 200 后，Worker 的后续步骤（[backend/app/tasks_translate.py](backend/app/tasks_translate.py)）：

1. **写入任务结果**：`task.output_object_key = fc_output_object_key`（如 `translations/{task_id}/output.pdf`），`task.output_primary_path = ""`，提交 DB。
2. **若有 page_range**：用 PyMuPDF 从源 PDF 切出对应页，上传到 R2 的 `translations/{task_id}/source_pages.pdf`，写入 `task.source_slice_object_key`，供前端预览用。
3. **标记完成**：`_update_task_status(db, task, "completed")`，进度 100%。  
译文已在 FC 内上传到 R2，后端不再做本地压缩或二次上传；前端通过现有接口用 `output_object_key` 取译文 PDF。

### 4.4 前端 `/api/tasks/.../events` 404

若前端部署在静态站点（如 Cloudflare Pages）且请求发到 **前端域名**（如 translatepdfonline.pages.dev），会因没有 `/api` 路由而 404。应让前端请求发到**后端域名**：配置 `NEXT_PUBLIC_API_BASE_URL=https://www.backend.translatepdfonline.com`，且任务 events 的 EventSource URL 使用该 base（已改为使用 `resolveApiUrl`，重新构建部署前端即可）。
