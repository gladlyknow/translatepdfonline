# 项目初始化、启动与环境变量配置

本文档说明前端项目（ShipAny 基底 + PDF 翻译/预览）的初始化、本地启动、环境变量配置，以及**如何调用阿里云 FC 函数**的完整流程。

---

## 一、项目结构概览

- **根目录**：`D:\imppro\translatepdfonline\frontend`（即当前前端仓库）
- **技术栈**：Next.js（App Router）、React、next-intl、Drizzle ORM、PostgreSQL、Cloudflare R2、阿里云 FC
- **路线**：路线 A —— 前端 + Next API + Postgres + R2，翻译由 **Next 调 FC，FC 回调 Next** 更新任务状态，无 Python 后端、无 Celery Worker

---

## 二、项目初始化与依赖安装

### 2.1 环境要求

- **Node.js**：建议 18.x 或 20.x（LTS）
- **包管理器**：`pnpm`（推荐，与 ShipAny 一致）

若未安装 pnpm：

```bash
npm install -g pnpm
```

### 2.2 国内网络：使用代理安装依赖

若国内网络不稳定，可使用本地代理（如 Clash 监听 `127.0.0.1:7890`）：

**PowerShell（临时，仅当前终端）：**

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:NO_PROXY="localhost,127.0.0.1"

cd D:\imppro\translatepdfonline\frontend
pnpm install
```

**或写入项目 `.npmrc`（长期）：**

在 `frontend` 根目录创建或编辑 `.npmrc`：

```ini
proxy=http://127.0.0.1:7890
https-proxy=http://127.0.0.1:7890
strict-ssl=false
```

然后执行：

```bash
cd D:\imppro\translatepdfonline\frontend
pnpm install
```

### 2.3 安装完成后

- 依赖安装在 `node_modules/`
- 首次安装会执行 `postinstall`（如 fumadocs-mdx）
- 若有 lockfile 冲突，可使用 `pnpm install --no-frozen-lockfile`

---

## 三、环境变量配置

在 `frontend` 根目录下使用 `.env.local`（本地开发，不提交）或 `.env.development`（开发默认）。生产环境在部署平台配置同名变量。

### 3.1 应用与站点

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `NEXT_PUBLIC_APP_URL` | 是（生产） | 站点根 URL，用于 FC 回调地址拼接 | `http://localhost:3000`（开发）/ `https://your-domain.com`（生产） |
| `NEXT_PUBLIC_APP_NAME` | 否 | 应用名称 | `onlinepdftranslator` |
| `NEXT_PUBLIC_THEME` | 否 | 主题 | `default` |
| `NEXT_PUBLIC_APPEARANCE` | 否 | 外观 | `system` |

### 3.2 数据库（PostgreSQL）

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `DATABASE_PROVIDER` | 是 | 固定为 `postgresql` | `postgresql` |
| `DATABASE_URL` | 是 | Postgres 连接串 | `postgres://user:password@host:5432/dbname` |
| `DB_SINGLETON_ENABLED` | 否 | 是否复用连接 | `false`（Serverless 建议）/ `true` |
| `DB_MAX_CONNECTIONS` | 否 | 最大连接数 | `2` |
| `DB_SCHEMA` | 否 | Postgres schema | `public` |

### 3.3 鉴权（Better Auth）

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `AUTH_SECRET` | 是 | 会话加密密钥 | `openssl rand -base64 32` 生成 |

### 3.4 R2（PDF 存储与预览 URL）

翻译功能用 R2 存原文/译文 PDF，并签发 presigned URL 供前端预览/下载。  
**变量名**：代码只读取 **`R2_BUCKET`**、**`R2_ENDPOINT`**（与 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY）。若你现有配置为 `R2_BUCKET_NAME`、`R2_ENDPOINT_URL`，请在本地或部署环境中**同时**设置 `R2_BUCKET`、`R2_ENDPOINT`（取值与 R2_BUCKET_NAME、R2_ENDPOINT_URL 相同即可），否则上传会返回 503（Upload storage not configured）。

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `R2_BUCKET` | 是（翻译） | R2 桶名（代码读取此名） | `translatepdfonline` |
| `R2_ACCOUNT_ID` | 是 | Cloudflare 账户 ID | 32 位十六进制 |
| `R2_ACCESS_KEY_ID` | 是 | R2 API 访问密钥 ID | |
| `R2_SECRET_ACCESS_KEY` | 是 | R2 API 访问密钥 | |
| `R2_ENDPOINT` | 否 | 不填则用 `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`（代码读取此名） | `https://xxx.r2.cloudflarestorage.com` |

### 3.5 翻译与 FC（阿里云函数计算）

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `TRANSLATE_FC_URL` | 是（翻译） | 阿里云 FC 的 HTTP 触发地址 | `https://xxx.cn-hangzhou.fc.aliyuncs.com/...` |
| `TRANSLATE_FC_SECRET` 或 `BABELDOC_FC_SECRET` | 否（若 FC 需鉴权则必填） | 调用 FC 时在请求头中带 `X-Babeldoc-Secret: <secret>`（与 babeldoc_fc 一致） | 与 FC 侧配置一致 |

- 创建翻译任务时，Next 会向该 URL 发 POST 请求，若配置了 `TRANSLATE_FC_SECRET` 或 `BABELDOC_FC_SECRET`，会在请求头中带上 `X-Babeldoc-Secret: <secret>`（与 babeldoc_fc 鉴权方式一致）。
- FC 执行完成后请求 Next 的 **回调 URL** 更新任务状态。
- 回调 URL 由 Next 根据 `NEXT_PUBLIC_APP_URL` 自动拼接为：`{NEXT_PUBLIC_APP_URL}/api/translate/callback`。

### 3.6 示例 `.env.development`（仅作参考，勿提交敏感信息）

```env
# app
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=onlinepdftranslator

# database
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgres://user:password@host:5432/dbname
DB_SINGLETON_ENABLED=false
DB_MAX_CONNECTIONS=2

# auth
AUTH_SECRET=your-auth-secret-base64

# R2（翻译上传/预览）
R2_BUCKET=your-bucket-name
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
# R2_ENDPOINT 可选，不填则用 https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com

# 阿里云 FC（翻译）
TRANSLATE_FC_URL=https://xxx.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/your-service/your-function
```

---

## 四、数据库迁移

首次运行或 schema 变更后，需执行 Drizzle 迁移（含翻译用表 `documents`、`translation_tasks`）：

```bash
cd D:\imppro\translatepdfonline\frontend
pnpm run db:push
# 或生成迁移后执行
# pnpm run db:generate
# pnpm run db:migrate
```

确保 `DATABASE_URL` 已配置且数据库可访问。

---

## 五、本地启动

```bash
cd D:\imppro\translatepdfonline\frontend
pnpm run dev
```

- 默认：<http://localhost:3000>
- 翻译页：<http://localhost:3000/translate>（或 `/zh/translate`、`/en/translate`）

生产构建与启动：

```bash
pnpm run build
pnpm run start
```

---

## 六、FC 函数调用完整流程

翻译采用 **路线 A**：Next 创建任务后 **HTTP 调用阿里云 FC**，FC 执行完毕后 **回调 Next** 更新任务状态并写入 R2。无 Python 后端、无 Celery Worker。

### 6.1 流程概览

```
用户提交翻译 → Next POST /api/translate
  → 写入 translation_tasks（status=queued）
  → 生成源 PDF 的 R2 presigned GET URL
  → HTTP POST 调用 TRANSLATE_FC_URL（阿里云 FC）
  → 返回 task_id 给前端
FC 异步执行
  → 从 source_pdf_url 拉取 PDF，翻译，写入 R2（output_object_key）
  → POST 请求 Next 的 callback_url（/api/translate/callback）
Next /api/translate/callback
  → 根据 task_id 更新 translation_tasks（status=completed/failed, output_object_key 等）
前端轮询 GET /api/tasks/:id 或 /api/tasks/:id/view
  → 获得 primary_file_url（presigned）后渲染 PdfViewerPane
```

### 6.2 Next 调用 FC：请求体约定

**触发位置**：`src/app/api/translate/route.ts`，在插入 `translation_tasks` 且 R2 已配置、拿到 `sourcePdfUrl` 后：

```ts
const callbackUrl = `${base}/api/translate/callback`;
await fetch(FC_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    task_id: taskId,
    source_pdf_url: sourcePdfUrl,
    output_object_key: `translations/${taskId}/output.pdf`,
    source_lang: sourceLang,
    target_lang: targetLang,
    callback_url: callbackUrl,
  }),
});
```

**请求体字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 本次任务唯一 ID，FC 回调时需原样带回 |
| `source_pdf_url` | string | 源 PDF 的临时下载地址（R2 presigned GET，约 1 小时有效） |
| `output_object_key` | string | FC 将译文 PDF 写入 R2 时使用的对象键，例如 `translations/{task_id}/output.pdf` |
| `source_lang` | string | 源语言代码：`zh` / `en` / `es` |
| `target_lang` | string | 目标语言代码：`zh` / `en` / `es` |
| `callback_url` | string | FC 完成（成功或失败）后应请求的 URL，即 Next 的 `/api/translate/callback` |

FC 侧需要：

1. 使用 `source_pdf_url` 下载 PDF；
2. 按 `source_lang` / `target_lang` 执行翻译；
3. 将结果 PDF 上传到 R2，键为 `output_object_key`；
4. 请求 `callback_url`，方法 POST，Body JSON，见下文。

#### 手动用 curl 调用 FC（POST /translate）

FC 的 HTTP 触发器地址即 `TRANSLATE_FC_URL`（如 `https://xxx.cn-hangzhou.fc.aliyuncs.com/...` 或自定义域名）。请求约定如下，可直接用 curl 测试。

**请求**

- **Method**：`POST`
- **URL**：FC 的 `/translate` 完整地址（即 `TRANSLATE_FC_URL`）
- **Headers**：
  - `Content-Type: application/json`
  - `X-Babeldoc-Secret: <BABELDOC_FC_SECRET>`（若 FC 配置了鉴权，必填，值为 FC 环境变量中的 secret）
- **Body**：JSON，字段与上表一致。

**curl 示例**（将 `FC_URL`、`SECRET`、`SOURCE_PDF_URL`、`CALLBACK_URL` 换成实际值）：

```bash
FC_URL="https://your-fc-host/translate"
SECRET="aGxVtWys6VzhRf1cl0NL30YQppGLbfdU"
SOURCE_PDF_URL="https://pub-xxx.r2.dev/path/to/source.pdf?X-Amz-..."
TASK_ID="test-task-$(date +%s)"
CALLBACK_URL="https://your-next-site.com/api/translate/callback"

curl -X POST "$FC_URL" \
  -H "Content-Type: application/json" \
  -H "X-Babeldoc-Secret: $SECRET" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"source_pdf_url\": \"$SOURCE_PDF_URL\",
    \"output_object_key\": \"translations/$TASK_ID/output.pdf\",
    \"source_lang\": \"en\",
    \"target_lang\": \"zh\",
    \"callback_url\": \"$CALLBACK_URL\"
  }"
```

**说明**

- `source_pdf_url` 必须是 FC 能公网访问的 PDF 下载地址（如 R2 的 presigned GET URL），FC 会 GET 该 URL 下载 PDF。
- `callback_url` 必须是 FC 能公网访问的 Next 回调地址；本地测试时需用 ngrok 等隧道 URL（见 6.8）。
- 若未配置 `X-Babeldoc-Secret` 或与 FC 环境变量不一致，会返回 **403 Forbidden**。
- 成功时 FC 返回 **200**，Body 为 `{"output_object_key":"translations/xxx/output.pdf"}`；完成后 FC 会再 POST 到 `callback_url` 通知 Next。

**可选字段**

- `page_range`：字符串，如 `"1-5"` 或 `null`，表示只翻译指定页。

### 6.3 FC 回调 Next：请求体约定

**接收位置**：`src/app/api/translate/callback/route.ts`。

FC 在**完成**（成功或失败）后，应向 `callback_url` 发送 **POST** 请求，Body 为 JSON：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 与调用 FC 时传入的 `task_id` 一致 |
| `status` | string | 是 | `completed` 或 `failed` |
| `output_object_key` | string | 否 | 成功时 FC 写入 R2 的对象键（若与调用时一致可省略） |
| `error_code` | string | 否 | 失败时的错误码 |
| `error_message` | string | 否 | 失败时的错误信息 |

**示例（成功）：**

```json
{
  "task_id": "abc123...",
  "status": "completed",
  "output_object_key": "translations/abc123.../output.pdf"
}
```

**示例（失败）：**

```json
{
  "task_id": "abc123...",
  "status": "failed",
  "error_code": "ocr_failed",
  "error_message": "OCR preprocessing failed"
}
```

Next 收到后会根据 `task_id` 更新表 `translation_tasks` 的 `status`、`outputObjectKey`、`errorCode`、`errorMessage` 等，并返回 `{ "ok": true }`。

### 6.4 小结

- **谁调 FC**：Next 的 `POST /api/translate` 在创建任务并拿到源 PDF 的 presigned URL 后，用 `TRANSLATE_FC_URL` 调用阿里云 FC。
- **FC 做什么**：下载 `source_pdf_url`、翻译、上传到 R2（`output_object_key`），然后 POST `callback_url` 通知 Next。
- **谁接回调**：Next 的 `POST /api/translate/callback` 根据 `task_id` 更新数据库，前端通过 `/api/tasks/:id` 与 `/api/tasks/:id/view` 轮询或拉取预览/下载 URL。

按上述约定实现阿里云 FC 与配置好 `TRANSLATE_FC_URL`、`NEXT_PUBLIC_APP_URL` 后，即可完成「创建任务 → FC 执行 → 回调更新 → 前端预览」的闭环。

**异步流程（babeldoc_fc）**：Next 调用 FC 后**不等待** FC 返回，立即返回 `task_id` 给前端；FC 在**完成**（成功或失败）后请求 Next 的 `callback_url`（POST `task_id`、`status`、`output_object_key`/`error_message`），Next 的 `/api/translate/callback` 更新任务状态。大文件或长耗时翻译不会导致 Next 请求超时，前端通过轮询任务状态即可。

### 6.5 前端任务状态与文案配置（Queued、20%、耐心提示）

- **「Queued」与进度条 20%**  
  - 状态文案来自 **`translate.task`** 命名空间：`frontend/src/config/locale/messages/{en,zh}/translate/task.json` 中的 `queued`、`processing`、`completed`、`failed`。  
  - 页面用 `statusLabel(taskStatus)` 显示当前状态（见 `TranslatePageClient.tsx` 中 `useTranslations('translate.task')` 与 `statusLabel`）。  
  - 进度条数值：`taskStatus === 'queued'` 时固定为 **20%**，`processing` 时用接口返回的 `progress_percent`（默认 50），`completed` 为 100%。逻辑在 `TranslatePageClient.tsx` 的 `taskProgress` 变量。

- **「Translation and AI model loading may take a moment...」**  
  - 当 `taskStatus` 为 `queued` 或 `processing` 时显示。  
  - 文案来自 **`translate.home`**：`frontend/src/config/locale/messages/{en,zh}/translate/home.json` 的 **`translationPatience`**。  
  - 同义文案也存在于 `translate.task`（如 `task.json` 的 `translationPatience`），页面实际使用的是 **home** 下的 `tHome('translationPatience')`（见 `TranslatePageClient.tsx` 任务状态区域）。

### 6.6 为何日志没有调用 FC？完整调用步骤与排查

**现象**：前端显示「Queued 20%」和耐心提示，但服务端日志里没有向阿里云 FC 发请求。

**原因**：Next 只有在**同时满足**以下条件时才会调用 FC（见 `src/app/api/translate/route.ts` 第 56 行）：

```ts
if (FC_URL && sourcePdfUrl) {
  await fetch(FC_URL, { ... });
}
```

即：

1. **`TRANSLATE_FC_URL` 已配置且非空**（否则 `FC_URL` 为空，不请求 FC）。  
2. **`sourcePdfUrl` 能成功生成**：依赖 R2 已配置（`isR2Configured()` 为 true），且对当前文档的 `objectKey`（或 `sourceSliceObjectKey`）能调用 `createPresignedGet` 得到 URL。任一失败则 `sourcePdfUrl` 为 null，不会调 FC。

若未配置 `TRANSLATE_FC_URL` 或 R2 未配置/生成 presigned 失败，任务仍会创建并写入数据库（status=queued），但**不会向 FC 发请求**，任务会一直停在 Queued，前端轮询只会看到 `queued` 和 20%。

**完整调用步骤（从点击「翻译」到任务完成）**：

1. **环境变量**（必须）  
   - `TRANSLATE_FC_URL`：阿里云 FC 的 HTTP 触发地址（如 `https://xxx.cn-hangzhou.fc.aliyuncs.com/...`）。  
   - `NEXT_PUBLIC_APP_URL`：Next 站点根 URL，用于拼回调地址（本地开发可为 `http://localhost:3000`；FC 需能访问该 URL 才能回调）。  
   - R2 相关：`R2_BUCKET`、`R2_ENDPOINT`（或 R2_ACCOUNT_ID）、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`，保证上传与 presigned 可用。

2. **前端**：用户点击翻译 → 前端请求 **POST /api/translate**（body：`document_id`、`source_lang`、`target_lang` 等）。

3. **Next POST /api/translate**：  
   - 校验用户与文档归属，创建任务（status=queued）；  
   - 若 R2 已配置，用文档的 objectKey 生成 `sourcePdfUrl`（presigned GET）；  
   - **仅当** `TRANSLATE_FC_URL` 非空且 `sourcePdfUrl` 非空时，向 `TRANSLATE_FC_URL` 发 **POST**，body 含 `task_id`、`source_pdf_url`、`output_object_key`、`source_lang`、`target_lang`、`callback_url`。

4. **阿里云 FC**：  
   - 接收请求，用 `source_pdf_url` 下载 PDF，按语言翻译，将结果上传到 R2（`output_object_key`）；  
   - 完成后向 **callback_url**（即 `{NEXT_PUBLIC_APP_URL}/api/translate/callback`）发 **POST**，body 含 `task_id`、`status`（completed/failed）、可选 `output_object_key`、`error_code`、`error_message`。

5. **Next POST /api/translate/callback**：根据 `task_id` 更新 `translation_tasks` 的 status、outputObjectKey 等。

6. **前端**：轮询 **GET /api/tasks/:id** 或 **GET /api/tasks/:id/view**，当 status 变为 completed 后展示译文与下载。

**排查清单**：

- 未调 FC：检查 `.env` 中 **`TRANSLATE_FC_URL`** 是否已设且与 FC HTTP 触发地址一致；检查 R2 是否配置正确、presigned 是否生成成功（可看 Next 日志是否有 `FC invoke failed`）。  
- 一直 Queued：多为未配置 `TRANSLATE_FC_URL` 或 `sourcePdfUrl` 为空，导致未发 FC 请求；或 FC 已执行但未回调（检查 `NEXT_PUBLIC_APP_URL` 是否可被 FC 访问，如本地需内网穿透）。  
- 回调失败：确认 FC 请求的 `callback_url` 可公网访问，且 Next 的 `/api/translate/callback` 返回 200。

**FC 返回 403 Forbidden**

Next 调用 FC 时若配置了 `TRANSLATE_FC_SECRET`（或 `BABELDOC_FC_SECRET`），会在请求头中带鉴权信息，**默认为 `X-Babeldoc-Secret: <secret>`**（与 babeldoc_fc 一致）。若 FC 返回 403，请按下面排查：

1. **FC 侧鉴权与 Next 一致**：FC 函数（如 babeldoc_fc）校验请求头 `X-Babeldoc-Secret`，Next 的 `TRANSLATE_FC_SECRET` 需与 FC 环境变量 `BABELDOC_FC_SECRET` 完全一致（注意空格、复制遗漏）。
2. **自定义请求头**：若 FC 期望其他鉴权方式，可在 Next 环境变量中配置：
   - `TRANSLATE_FC_AUTH_HEADER`：请求头名，默认 `X-Babeldoc-Secret`。若 FC 用 `Authorization`，可设为 `Authorization`。
   - `TRANSLATE_FC_AUTH_SCHEME`：前缀，默认空。若 FC 期望 `Authorization: Bearer <secret>`，可设为 `Bearer `（注意空格）。
3. **FC 入口**：确认 FC HTTP 触发器允许来自 Next 部署域的请求（若 FC 有 IP 或 Referer 校验，需放行）。
4. **FC 是否把“允许的域名”写死（本地测试 403）**：若你在**本地**跑 Next（`http://localhost:3000`）调 FC，而 FC 里只允许固定域名（如只允许 `https://translatepdfonline.gladlyknow.workers.dev`），请求的 `Origin` / `Referer` / 或自定义校验会变成 `http://localhost:3000`，FC 返回 403。**Next 没有写死域名**，callback 的 base 来自 `NEXT_PUBLIC_APP_URL`（本地可设为 `http://localhost:3000`）。解决方式二选一：
   - **在 FC 侧**：把本地来源加入白名单（如允许 `Origin: http://localhost:3000` 或关闭/放宽域名校验）以便本地联调；
   - **或** 直接部署到 Cloudflare Workers，用线上域名（`NEXT_PUBLIC_APP_URL` = 你的 workers.dev 或正式域名）测 FC，此时请求来源是线上域名，FC 若只放行该域即可通过。

**预览接口 document preview-url 报错 ETIMEDOUT (172.64.66.1:443)**

该错误来自文档预览 `GET /api/documents/:id/preview-url`：从 R2 拉取 PDF 时连接超时（`$metadata` 表明走的是 Node 下的 AWS SDK 连接 R2）。处理方式：

1. **部署在 Cloudflare Workers 时**：预览逻辑在 Worker 下应走 `fetch`（aws4fetch）而非 Node 的 S3Client，不会出现该 TCP 超时。请确认环境变量在 Worker 中已注入（middleware 合并 Dashboard 的 env），且 `isCloudflareWorker` 为真。
2. **在本地或非 Worker 的 Node 环境**：连接的是 R2 的 Cloudflare 出口（如 172.64.x.x），若本机或公司网络禁止访问 Cloudflare IP 或 443，会 ETIMEDOUT。可检查：本机/服务器能否访问 `R2_ENDPOINT`（如 `https://<account>.r2.cloudflarestorage.com`）；代理/VPN 是否拦截。
3. **临时规避**：若必须在本机跑 Next 且无法访问 R2，可暂时不测预览接口，或使用已部署到 Workers 的站点测预览。
4. **本地 vs Workers**：当前为本地环境时，预览走 Node 的 S3Client 连 R2，容易 ETIMEDOUT；**部署到 Cloudflare Workers 后**会走 `fetch`（aws4fetch），在 Cloudflare 内网访问 R2，一般不会再有该超时，可直接在 Workers 上验证预览。

### 6.7 线上测试环境（如 Cloudflare Workers）能否调通 FC？检查清单

当前线上测试环境**能调通 FC** 需同时满足以下条件（缺一不可）：

| 检查项 | 说明 | 线上（如 Workers）配置位置 |
|--------|------|---------------------------|
| **TRANSLATE_FC_URL** | FC 的 HTTP 触发地址，非空才会发起调用 | Cloudflare Dashboard → 项目 → Settings → Variables and Secrets |
| **TRANSLATE_FC_SECRET** 或 **BABELDOC_FC_SECRET** | FC 若需鉴权，需与 FC 侧一致；调用时会带 `X-Babeldoc-Secret: <secret>` | 同上，建议用 Secret |
| **NEXT_PUBLIC_APP_URL** | 必须为当前站点根 URL（如 `https://translatepdfonline.gladlyknow.workers.dev`），用于拼 `callback_url` | 同上；若未配置，会 fallback 到 Vercel 或 localhost，FC 回调会失败 |
| **R2 已配置** | `R2_BUCKET`、`R2_ENDPOINT`（或 R2_ACCOUNT_ID）、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`；否则 `sourcePdfUrl` 为空，不会调 FC | 同上 |
| **FC 能访问 callback** | FC 执行完成后需能公网访问 `{NEXT_PUBLIC_APP_URL}/api/translate/callback` | 确保 NEXT_PUBLIC_APP_URL 为公网可访问的线上域名 |
| **FC 侧 R2 与 Next 一致** | FC 写入的 R2 bucket/凭证需与 Next 使用的 R2 一致，否则 Next 无法用 `output_object_key` 生成预览/下载 | FC 环境变量与 Next 的 R2_* 对应同一桶与凭证 |

**结论**：若在 Cloudflare 上已配置上述变量（尤其是 `TRANSLATE_FC_URL`、`NEXT_PUBLIC_APP_URL` 和 R2 相关），且 FC 函数按 6.2/6.3 约定接收 body 并回调，则线上测试环境可以调通 FC。若任务一直停在 Queued，请按 6.6 排查：先确认 Dashboard 里 `TRANSLATE_FC_URL` 是否已填、R2 是否可用，再确认 FC 是否成功请求了 `callback_url`。

### 6.8 本地环境 (localhost) 怎么测试？

FC 跑在阿里云上，**无法访问你本机的 `http://localhost:3000`**。异步流程下 FC 完成后会 POST 到 Next 传来的 `callback_url`，若该 URL 是 localhost，FC 会连不到，任务状态就不会从「排队」变为「完成」。

**做法：用内网穿透把本机暴露成公网 URL，让 FC 能回调到本机。**

#### 方式一：ngrok（示例）

1. **安装并启动隧道**（任选一种）  
   - 安装 [ngrok](https://ngrok.com/) 并登录，在终端执行：  
     `ngrok http 3000`  
   - 记下给出的 **HTTPS 公网地址**，例如：`https://abc123.ngrok-free.app`。

2. **让 Next 用隧道地址作为站点根 URL**  
   - 在 `frontend` 目录下 `.env.development`（或 `.env.local`）里设置：  
     `NEXT_PUBLIC_APP_URL=https://abc123.ngrok-free.app`  
   - 不要用 `http://localhost:3000`，否则 FC 收到的 `callback_url` 仍是 localhost，无法访问。

3. **启动 Next**  
   - `pnpm run dev`，保证 Next 在 3000 端口。

4. **用隧道 URL 访问页面**  
   - 浏览器打开：`https://abc123.ngrok-free.app/translate`（或你项目实际路径）。  
   - 上传 PDF、选择语言、点「开始翻译」。Next 会带 `callback_url=https://abc123.ngrok-free.app/api/translate/callback` 调 FC，FC 完成后会 POST 到这个地址，ngrok 把请求转到本机 3000，任务状态即可更新。

5. **注意**  
   - 每次重启 ngrok，免费版域名会变，需重新改 `NEXT_PUBLIC_APP_URL` 并重启 Next。  
   - 若 FC 有「允许的来源」校验，需放行该 ngrok 域名（或先关掉校验做本地联调）。

#### 方式二：Cloudflare Tunnel

- 安装 `cloudflared`，执行：`cloudflared tunnel --url http://localhost:3000`，会得到一个 `*.trycloudflare.com` 的 URL。  
- 把 `NEXT_PUBLIC_APP_URL` 设为该 URL（如 `https://xxx.trycloudflare.com`），用该 URL 访问前端，同上逻辑即可测 callback。

#### 不穿透时的局限

- 若**不**做内网穿透，仍把 `NEXT_PUBLIC_APP_URL` 设为 `http://localhost:3000`：  
  - Next 调 FC、创建任务、前端拿到 `task_id` 都正常；  
  - 但 FC 完成后无法访问 localhost，**callback 失败**，任务会一直停在「排队」或「处理中」。  
- 若只想验证「调 FC + 创建任务」是否正常，可以不穿透；要验证「FC 完成 → 状态变完成」的完整异步流程，必须让 FC 能访问到 Next，即使用隧道或直接部署到线上再测。

---

## 七、部署到 Cloudflare（可选）

- 本项目支持通过 **OpenNext for Cloudflare** 部署到 Cloudflare Pages/Workers。
- 在部署平台配置与第三节相同的环境变量（如 `R2_*`、`TRANSLATE_FC_URL`、`NEXT_PUBLIC_APP_URL` 等）；若使用 **Hyperdrive** 连接 Postgres，见下节，**无需**在 Dashboard 再配 `DATABASE_URL`。
- 构建与部署命令（见 `package.json`）：
  - `pnpm run cf:preview`：本地预览
  - `pnpm run cf:deploy`：部署到 Cloudflare

生产环境下 `NEXT_PUBLIC_APP_URL` 必须为线上域名，以便 FC 回调 `https://你的域名/api/translate/callback` 可被访问。

### 7.1 Hyperdrive 绑定（Postgres）— 为何没生效、怎么配

代码里通过 **绑定名 `HYPERDRIVE`** 使用 Hyperdrive（见 `src/core/db/postgres.ts`：`'HYPERDRIVE' in env` → `env.HYPERDRIVE.connectionString`）。**不需要也不要在 Dashboard 里为 Hyperdrive 再设环境变量**；只要绑定正确，运行时 `env.HYPERDRIVE` 会由 Cloudflare 注入。

**方式一：仅用 Dashboard 创建绑定（推荐先试）**

1. 在 Cloudflare Dashboard 创建 **Hyperdrive 配置**：Workers & Pages → Hyperdrive → Create → 选 PostgreSQL，填你的数据库地址/库名/用户/密码，保存，记下该配置的 **ID**（如 UUID）。
2. 打开你的 **Pages 或 Worker 项目** → **Settings** → **Functions**（或 **Settings** → **Bindings**）。
3. 找到 **Hyperdrive**，点 **Add**，选择上一步的 Hyperdrive 配置。
4. **Variable name 必须填：`HYPERDRIVE`**（全大写，与代码一致）。若填成 `Hyperdrive`、`hyperdrive` 或其它名字，代码拿不到绑定，就会退回到 `DATABASE_URL` 或报错。
5. 保存并重新部署。使用 Hyperdrive 时**不必**在 Variables 里再设 `DATABASE_URL`（代码优先用 `env.HYPERDRIVE.connectionString`）。

**方式二：在 wrangler.toml 里写死绑定（适合 CI/同一配置多环境）**

在 `wrangler.toml` 里增加（注意：`binding` 必须是 `HYPERDRIVE`，`id` 换成你在 Dashboard 里看到的 Hyperdrive 配置 ID）：

```toml
# 放在 [vars] 之后，避免部分环境下 binding 为 undefined
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "你的-Hyperdrive-配置-ID"
```

若用 `wrangler.toml.template` 生成 wrangler，可在模板里加上上述 `[[hyperdrive]]` 块，`id` 用占位或由 CI 注入。部署时生成的 `wrangler.toml` 里含有该块即可。

**排查「没生效」时重点看：**

- 绑定名是否为 **`HYPERDRIVE`**（全大写）。
- 若用 Dashboard：该项目的 Functions/Bindings 里是否真的添加了 Hyperdrive，且 Variable name = `HYPERDRIVE`。
- 若用 wrangler：`[[hyperdrive]]` 的 `binding = "HYPERDRIVE"` 和正确的 `id` 是否在最终参与部署的 `wrangler.toml` 里（例如 CI 是否覆盖了该文件）。
- 重新部署一次后再测（绑定变更后需重新部署才生效）。

**后台/数据不一致：用了 Hyperdrive 但数据对不上**

若已绑定 HYPERDRIVE 但后台看到的和预期数据库不一致，多半是 **Worker 实际没走到 Hyperdrive**，而是用了 **Dashboard 里的 `DATABASE_URL`**（可能指向本地/另一库）。处理方式：

1. **Cloudflare 日志**：在 Workers & Pages → 你的项目 → Logs（或 Real-time Logs）里看是否有 **`[db] using Hyperdrive connection`**。若没有、只有 **`[db] Cloudflare Worker but HYPERDRIVE not found...`**，说明运行时没拿到 HYPERDRIVE，在用 `DATABASE_URL`。
2. **统一数据源**：  
   - **只用 Hyperdrive**：在 Dashboard 的 Variables 里**删掉或清空 `DATABASE_URL`**（不设或留空）。这样若 HYPERDRIVE 未注入会直接报错，不会静默连到别的库。  
   - 或确保 **Hyperdrive 配置** 和 **Dashboard 里的 `DATABASE_URL`** 指向**同一库**，避免一个走绑定、一个走变量导致“两个库”的错觉。
3. **绑定名再确认**：Variable name 必须是 **`HYPERDRIVE`**（全大写），不能是 `Hyperdrive`、`hyperdrive` 等。
4. **重新部署**：改完绑定或变量后重新部署一次，再查看日志确认出现 `[db] using Hyperdrive connection`。

---

## 八、7 天保留与过期清理

- 上传的 PDF 文档在创建时会设置 **保留 7 天**（`documents.expires_at = 当前时间 + 7 天`），到期后应从存储与数据库中清理以节省空间。
- 服务端提供 **POST /api/documents/cleanup-expired** 接口：根据 `expires_at < 当前时间` 查询文档，先删除关联的 `translation_tasks`，再删除 `documents`；返回 `deleted_documents`、`deleted_tasks`。
- 该接口仅允许内部或定时任务调用，需在请求头中携带 **x-cron-secret**，且与环境变量 **CRON_SECRET** 一致；未配置 `CRON_SECRET` 时接口返回 503。
- 可配置 **Vercel Cron**（或其它 cron 服务）定期（如每日一次）请求该接口，实现 7 天后的自动删除。示例（Vercel）：在 `vercel.json` 中配置 cron 触发并携带 `CRON_SECRET` 的 header。

---

## 九、常见问题

- **依赖安装慢或超时**：使用代理（见 2.2），或配置 `.npmrc` 中的 `registry` 为国内镜像（如淘宝镜像）。
- **R2 上传/预览不可用**：检查 `R2_BUCKET`、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` 是否正确；若项目中原有 `R2_BUCKET_NAME`，请同时设置 `R2_BUCKET` 与之一致。
- **翻译一直排队不完成**：检查 `TRANSLATE_FC_URL` 是否配置、FC 是否可从公网访问；检查 FC 是否在完成后正确请求了 `callback_url`，以及 Next 的 `NEXT_PUBLIC_APP_URL` 在 FC 侧是否可访问（若 Next 在本地，FC 无法回调 localhost，需用内网穿透或部署到公网）。
- **管理后台 404**：确认已执行数据库迁移（`pnpm run db:push` 或 `db:migrate`），且 `src/app/[locale]/(admin)/admin` 路由存在；检查 middleware 是否将 `/admin` 正确转发到 App Router。
