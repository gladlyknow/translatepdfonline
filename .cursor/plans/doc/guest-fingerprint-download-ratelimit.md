# 指纹、下载限制、限流与技术文档

本文档记录「防 R2 滥用与白嫖、浏览器指纹绑定临时账号、未登录禁止下载、翻译限流、Google 登录后数据迁移」的**技术要求**与**实现说明**。

---

## 1. 防 R2 滥用与白嫖

### 问题

- 恶意上传导致 R2 存储暴增。
- 用户清空浏览器 Cookie 后获得新临时账号，反复白嫖上传与翻译额度。

### 方案

- **浏览器指纹 + Redis 绑定临时账号**：同一设备指纹在 Redis 中固定对应一个临时用户；清 Cookie 无法获得新账号，上传与翻译额度绑定到该指纹。
- **临时用户限制**：临时用户仅允许上传 1 个文档、翻译页数受 `quota_pages_total`（默认 5 页）限制；单文件大小上限（如 50MB）在预签名上传接口已校验。
- **可选**：单 IP 上传频率限制、按 IP 的创建任务频率（与下节限流配合）。

---

## 2. 浏览器指纹与账号绑定

### 前端

- 使用 [FingerprintJS 开源版](https://github.com/fingerprintjs/fingerprintjs) 在浏览器端生成指纹哈希（不依赖 Cookie）。
- 所有请求后端 API 的 `fetch` 统一附加 Header：`X-Client-Fingerprint: <hash>`（见 `frontend/lib/api.ts`、`frontend/lib/fingerprint.ts`）。
- 指纹在首次需要时异步加载并缓存，仅在同源、本应用内使用。

### 后端

- **Redis 键**：`fp:{fingerprint_hash}` -> `user_id`（UUID），TTL 90 天。
- **解析顺序**（`get_current_user_or_temp`）：
  1. 优先 JWT -> 已登录用户。
  2. 若有 `guest_id` Cookie 且 DB 中存在且为临时用户 -> 该用户。
  3. 若有指纹 Header（或 Cookie `fp`），查 Redis `fp:{hash}`；若存在则用对应 `user_id` 加载用户，并回写 `guest_id` Cookie。
  4. 否则创建新临时用户，写 DB、写 Cookie，并写 Redis `fp:{hash}` -> `user_id`。
- **校验**：指纹哈希仅接受长度 16–64、字母数字与连字符，避免注入（见 `backend/app/fp_store.py`）。

### 隐私与合规

- 指纹仅用于防滥用与同一设备下的账号绑定，不用于跨站追踪。
- 不存储原始指纹，仅存储哈希及绑定的 user_id。

---

## 3. Google 登录后入库与数据迁移

- **临时用户与正式用户**：指纹/临时账号仅作访客凭证；Google 注册后以「正式用户」入库（按 email 查/建 User）。
- **回调扩展**（`GET /api/auth/google/callback`）：
  - 从 Cookie 中读取当前 `guest_id`（回调时浏览器会带上同站 Cookie）。
  - 若存在且该用户为 `is_temporary`，则将该用户下的 `Document`、`TranslationTask` 的 `user_id` 更新为本次 Google 登录得到的正式用户 ID。
  - 不删除临时用户记录，仅做数据迁移。
- **Redis 指纹**：登录成功后后续请求以 JWT 为准，不再依赖指纹解析；指纹键可保留或由 TTL 自然过期。

---

## 4. 下载策略（未登录可预览、不可下载）

### 规则

- **未登录**（临时用户 `is_temporary=True`）：可翻译、可在线预览译文 PDF，**不可下载**。
- **已登录**（正式用户）：可预览、可下载。

### 接口行为

- **`GET /api/tasks/{task_id}/files/{filename}`**
  - 依赖 `get_current_user_or_temp`，校验任务归属：`task.user_id == current_user.id`。
  - 查询参数 `disposition`：`inline`（预览）或 `attachment`（下载）。
  - `disposition=inline`：仅校验归属，通过则返回文件并 `Content-Disposition: inline`。
  - `disposition=attachment`：若 `user.is_temporary` 则返回 **403**，`detail="login_required_to_download"`；否则返回文件并 `Content-Disposition: attachment`。

### 前端

- **预览**：译文/原文 PDF 的 URL 使用 `?disposition=inline`。
- **下载**：仅当 `taskView.can_download === true` 时展示下载链接，链接为 `?disposition=attachment`；否则仅展示文件名并提示「登录后下载」（`taskView.can_download` 由后端根据当前用户是否临时用户返回）。

---

## 5. 限流与生产部署（阿里云 ECS）

### 策略：不拒绝用户，仅入队 + 前端排队提示

- **不在前端拒绝用户**：不返回 429/503；创建翻译任务时**始终接受请求并加入 Celery 队列**。
- **并发由 .env 与 worker 数量控制**：通过环境变量配置建议并发数，实际并发由 Celery worker 进程/线程数决定；任务在队列中排队，worker 按能力依次拉取。
- **前端展示**：当任务状态为「排队中」（queued）时，展示「您的任务已加入队列，当前可能有其他任务在处理中，请稍候。」等提示（见文案 `queuedWaitHint`）；进入 processing 后展示后台处理与长任务提示。

### 并发配置（.env）

- **TRANSLATION_MAX_CONCURRENT**：建议同时执行的翻译任务数（默认 4），用于部署时参考（如启动 Celery 时 `-c 4` 或启动多个 worker 实例）。实际并发 = worker 数量与机器能力。
- 可选 **RATE_LIMIT_TRANSLATE_PER_MINUTE**：当前未用于拒绝请求，可保留作后续监控或限流用。

### Celery

- 通过 worker 并发（如 `celery -c 4`）或 `run_translation_task` 的 `rate_limit` 控制单机负载；队列积压时用户仅看到「排队中」提示，无需前端报错。

---

## 6. 配置项

| 环境变量 | 说明 | 默认 |
|----------|------|------|
| `TRANSLATION_MAX_CONCURRENT` | 建议同时执行的翻译任务数（供部署参考，如 Celery `-c`） | 4 |
| `RATE_LIMIT_TRANSLATE_PER_MINUTE` | 预留，当前未用于拒绝请求 | 10 |

指纹 Redis 键前缀与 TTL 在代码中写死：`fp:`、90 天（见 `backend/app/fp_store.py`），可按需改为配置项。

---

## 实现文件索引

- 下载与归属：`backend/app/routes/tasks.py`（`download_task_file`、`get_task_view` 的 `can_download`）。
- 限流与并发：任务始终入队，并发由 .env `TRANSLATION_MAX_CONCURRENT` 与 Celery worker 数量控制；`backend/app/config.py`、`backend/app/routes/tasks.py`。
- 指纹绑定：`backend/app/fp_store.py`、`backend/app/auth_utils.py`（`get_current_user_or_temp`）。
- 前端指纹与下载展示：`frontend/lib/fingerprint.ts`、`frontend/lib/api.ts`、`frontend/app/[locale]/page.tsx`。
- Google 回调数据迁移：`backend/app/routes/auth.py`（`google_callback`）。
