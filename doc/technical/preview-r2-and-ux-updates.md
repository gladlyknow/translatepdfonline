# 预览、R2 存储与前端体验技术更新

本文档记录「译文 PDF 走 R2 消除 404」「预览加载与分片优化」「前端简约大气重设计」「首排折叠」等已落地的技术更新。

---

## 1. 译文 PDF 走 R2 彻底消除 404

### 背景

- Worker 正确写入 `output_primary_path`（含中文路径），但 API 的 GET `/file` 在部分环境下仍 404。
- 根因：API 进程用 DB 中的路径做 `Path(...).exists()` 时，可能因编码/路径格式/进程间路径解析差异无法访问同一文件。

### 方案

- **翻译完成后主 PDF 上传 R2**：Worker 在设置 `output_primary_path` 后、`status=completed` 前，若 R2 已配置则调用 `storage_r2.upload_file(primary_pdf_path, f"translations/{task_id}/output.pdf")`，并写入 `task.output_object_key`。
- **TaskView 优先返回 R2 公网 URL**：若 `task.output_object_key` 非空且 `settings.r2_public_url` 非空，则 `primary_file_url = f"{r2_public_url}/{output_object_key}"`；前端用该 URL 直接加载 PDF，不再请求后端 `/file`。
- **GET /file 有 R2 则 302 重定向**：若存在 `output_object_key` 与 `r2_public_url`，返回 `RedirectResponse` 到 R2 公网 URL；否则走本地路径或 fallback，兼容未配置 R2 或旧任务。

### 相关文件

- `backend/app/storage_r2.py`：`upload_file`
- `backend/app/models.py`：`TranslationTask.output_object_key`
- `backend/app/tasks_translate.py`：完成后上传 R2 并写 `output_object_key`
- `backend/app/routes/tasks.py`：view 中 `primary_file_url` 逻辑、get_task_primary_file 中 302

---

## 2. 预览加载与分片优化

### 背景

- 预览时左侧加载整份源 PDF（R2），右侧加载整份译文，几十 MB 导致十几秒等待。

### 目标与实现

#### 2.1 源文件按任务页切片（单页/多页翻译）

- **Worker**：当任务有 `page_range` 时，使用 **PyMuPDF** 从本地源 PDF 按页范围提取，生成临时 `source_pages.pdf`，上传 R2：`translations/{task_id}/source_pages.pdf`，并写入 `task.source_slice_object_key`。
- **数据模型**：`TranslationTask.source_slice_object_key`（可选）。
- **TaskView**：若 `source_slice_object_key` 存在，则 `source_pdf_url = "/api/tasks/{task_id}/source-file"`，预览左侧只请求该切片；否则保持整份文档 R2 公网 URL。
- **新接口**：GET `/api/tasks/{task_id}/source-file` 从 R2 流式返回源切片，支持 Range。

#### 2.2 译文与源接口支持 Range（分片加载）

- **R2 层**：`storage_r2.get_object_stream_range(object_key, range_header)` 支持 `Range` 请求，返回 206 所需元数据（content_type、stream、content_length、content_range）。
- **GET /file 与 GET /source-file**：读取请求头 `Range`，合法时用 R2 Range 取流，响应 206 Partial Content，设置 `Content-Range`、`Accept-Ranges: bytes`；无 Range 时 200 全量流。
- **Next 代理**：`/api/tasks/[taskId]/file` 与 `/api/tasks/[taskId]/source-file` 转发 Range 头并透传 206 与 `Content-Range` 等。PDF.js 会自动发 Range 请求，实现按需分片加载。

#### 2.3 依赖与配置

- **PyMuPDF**：`backend/requirements.txt` 增加 `pymupdf`，用于按页范围生成 `source_pages.pdf`。
- **Alembic**：迁移添加 `translation_tasks.source_slice_object_key`。

#### 2.4 用户提示

- 文案：`home.translationPatience`（如「因翻译多页、加载 AI 大模型需要一点时间，请多点儿耐心」）。
- 展示时机：任务状态为 `queued` 或 `processing` 时在进度区域展示。

### 相关文件

- `backend/app/storage_r2.py`：`get_object_stream_range`
- `backend/app/routes/tasks.py`：GET source-file、file/source-file 的 Range 处理、TaskView 中 source_pdf_url
- `backend/app/tasks_translate.py`：`_parse_page_range`、`_extract_source_pages_pdf`、有 page_range 时提取并上传 R2
- `frontend/app/api/tasks/[taskId]/file/route.ts`、`source-file/route.ts`：转发 Range 与 206
- `frontend/messages/*.json`：`translationPatience`
- `frontend/app/[locale]/page.tsx`：queued/processing 时展示耐心提示

---

## 3. 前端简约大气重设计

### 布局

- **顶部单行**：Upload PDF 与翻译设置（语言、页码、开始翻译）同一排，位于网站最上方；右侧为历史入口与折叠箭头。
- **主内容区**：占满剩余视口高度（`flex-1 min-h-0`），双栏 PDF 预览（左原文、右译文），仅预览区域内部滚动，页面本身无整体滚动条。
- **历史**：页面右侧，点击展开、失焦或鼠标离开后收起；展示任务列表，点击某项可切换任务并更新 URL（`?task=xxx`）。

### 顶部导航与用户态

- **未登录**：Sign in / Get started 等简化入口，语言切换为胶囊或 select，避免拥挤。
- **已登录**：显示用户头像与下拉（账户、Sign out）；Google 登录使用 Google 头像，Email 登录支持头像上传（≤500KB），匿名为随机头像。

### 下载与其它

- 登录用户、任务完成且 `can_download` 时，在译文预览区显示简约半透明下载按钮，使用 `primary_file_url?disposition=attachment` 或等效下载链接。

### 相关文件

- `frontend/app/[locale]/page.tsx`：布局、Upload+翻译同排、历史面板、下载按钮
- `frontend/components/Header.tsx`：简约导航
- `frontend/components/UserMenu.tsx`：头像与下拉
- `frontend/components/HistoryPanel.tsx`：右侧可展开/收起的历史列表
- 后端：User.avatar_url、GET /api/user/me、POST /api/user/avatar（见 auth 相关文档）

---

## 4. 首排折叠箭头

- 第一排（Upload + 翻译设置 + 历史）右侧增加向上折叠箭头；点击后首排收成一条细栏（约 40–48px），仅保留横条与向下箭头，点击可再次展开。
- 使用 `max-height` + `overflow-hidden` + `transition` 做高度动画；折叠后为预览区留出更多垂直空间。
- i18n：`home.collapse`、`home.expand` 用于 aria-label。

### 相关文件

- `frontend/app/[locale]/page.tsx`：`topRowCollapsed` 状态、可折叠容器与箭头按钮
- `frontend/messages/*.json`：collapse、expand

---

## 5. CORS 与 PDF 加载兜底

- 当译文或源使用 R2 公网 URL 且前端以 `credentials: 'include'` 请求时，若 R2 返回 `Access-Control-Allow-Origin: *`，浏览器会报错（credentials 模式下不允许 *）。
- 可选方案：Cloudflare R2 的 CORS 配置中为允许的 Origin 指定具体域名（如 `http://localhost:3000`、`https://translatepdfonline.com`），并避免返回 `*`；或前端对 PDF 请求使用不携带 credentials 的 fetch（根据 URL 同源/跨源选择）。
- 译文/源在有 `output_object_key` / `source_slice_object_key` 时优先使用 R2 公网 URL 或同源 `/api/tasks/:id/file`、`/api/tasks/:id/source-file` 代理，避免依赖本地路径，减少 404 与 socket hang up。

---

## 文档索引

- 技术文档总索引：[doc/README.md](README.md)
- 预览、轮询、SSE、漏句：[preview-polling-translation.md](preview-polling-translation.md)
- 指纹、下载限制、限流：[guest-fingerprint-download-ratelimit.md](guest-fingerprint-download-ratelimit.md)
- 认证与注册：[auth-and-registration.md](auth-and-registration.md)
