# OCR Queue 测试路径（Windows / Cloudflare）

本文档用于验证 `translatepdfonline` 的 OCR 队列化链路，覆盖：

- 当前代码下可立即执行的**本地替代触发**方案；
- 部署到 Cloudflare 后的**真实定时派发**方案。

## 1. 前提条件

- 已配置 OCR/翻译所需环境变量（Baidu / DeepSeek / R2）。
- 本地开发端口默认为 `http://localhost:3000`。
- OCR 任务创建接口：`POST /api/ocr/tasks`。
- OCR 派发接口：`POST /api/ocr/dispatch-pending`（需要 `x-cron-secret`）。

建议在 `.env.development` 配置：

- `CRON_SECRET=your_local_secret`
- `OCR_DISPATCH_SECRET=your_local_secret`（可选，未配置时复用 `CRON_SECRET`）
- `OCR_DISPATCH_BATCH_SIZE=6`（可选）
- `OCR_PIPELINE_MAX_ATTEMPTS=3`（可选）

## 2. 本地替代触发（可立即执行）

当前本地不依赖 Cloudflare 原生 Queue 也可完成 submit→enqueue→consumer 验证。

### 2.1 启动应用

```powershell
pnpm dev
```

### 2.2 创建 OCR 任务（submit）

```powershell
$body = @{
  document_id = "YOUR_DOCUMENT_ID"
  source_lang = "en"
  target_lang = "zh"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/ocr/tasks" `
  -ContentType "application/json" `
  -Body $body
```

返回示例：

```json
{ "task_id": "xxxxxxxxxxxxxxxxxxxxx" }
```

### 2.3 人工触发 consumer（dispatch）

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/ocr/dispatch-pending" `
  -Headers @{ "x-cron-secret" = "your_local_secret" }
```

返回示例：

```json
{ "ok": true, "processed": 1, "task_ids": ["..."] }
```

> 若有多任务排队，可重复调用该接口，或调大 `OCR_DISPATCH_BATCH_SIZE`。

### 2.4 结果校验

1. 轮询任务详情 / 历史列表，确认状态流转：
   - `queued` → `processing` → `completed`（或 `failed`）。
2. 在工作台确认输出：
   - `PDF` 下载可用；
   - `MD` 下载可用；
3. 检查服务日志关键事件：
   - `[ocr] submit_and_enqueue_ok`
   - `[ocr/consumer] completed` 或 `[ocr/consumer] failed`
   - `[ocr/pipeline] baidu_poll_completed`
   - `[ocr/pipeline] export_completed`

## 3. Cloudflare 真实派发路径（上线后）

当前仓库代码已具备“producer + dispatch consumer”结构；上线后建议通过 Cloudflare Cron 定时触发 `dispatch-pending`。

### 3.1 配置建议

- 在 Worker 环境变量设置：
  - `CRON_SECRET`
  - `OCR_DISPATCH_BATCH_SIZE`
  - `OCR_PIPELINE_MAX_ATTEMPTS`
- 在触发端（Cron / 外部任务）调用：
  - `POST https://<your-domain>/api/ocr/dispatch-pending`
  - Header: `x-cron-secret: <CRON_SECRET>`

### 3.2 线上 E2E 验收

1. 上传扫描件 PDF 并提交 OCR 任务；
2. 不手工触发 dispatch，等待定时器自动派发；
3. 确认任务完成并可下载 `PDF` / `MD`；
4. 抽样验证失败重试任务：
   - 能进入 `ocr_retry_scheduled`；
   - 达到上限后转 `ocr_failed`。

## 4. 回归检查（避免影响 BabelDOC 普通链路）

每次 OCR 队列改动后，至少执行一次普通翻译任务回归：

1. 提交非 OCR 普通翻译任务；
2. 触发 `POST /api/translate/dispatch-pending`；
3. 确认普通任务可正常完成；
4. 确认 OCR 任务不会被 `translate` 派发器错误处理（已通过 `preprocessWithOcr=false` 约束隔离）。

