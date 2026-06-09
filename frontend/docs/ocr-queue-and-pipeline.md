# OCR 管线、Cloudflare Queue 与持久化 JSON

本文描述 **OCR 专用** 任务（`preprocess_with_ocr = true`）从提交到 R2 产物的路径，与 BabelDOC（普通翻译）派发的区别，以及 Queues 与 OpenNext Worker 的接入方式。

## 1. 架构总览

1. 用户在前端 **OCR Translator** 页提交 → `POST /api/ocr/tasks` 写入 `translation_tasks`（状态 `queued`，`preprocessWithOcr: true`），并 `enqueueOcrTask` 更新进度字段。
2. **主路径（Cloudflare）**：若运行时存在绑定 `OCR_PIPELINE_QUEUE`，则向队列 `translatepdfonline` 发送 `{ "taskId": "<id>" }`（见 `sendOcrPipelineQueueMessage`）。
3. **兜底**：若未配置 Queue 绑定（本地 Node、或未建队），则仍通过 `waitUntil(dispatchPendingOcrJobs)` 或自调 `dispatchPendingOcrJobs` 在同一 Worker/进程内消费（与历史行为兼容）。
4. 消费端调用 `invokeOcrPipelineForTask` → `runOcrTranslatePipeline`：Baidu OCR →（可选 `parse_result_url`）→ DeepSeek 翻译 Markdown → `pdf-lib` 导出 PDF → `putObject` 写入  
   `translations/{taskId}/ocr-output.pdf`、`ocr-output.md`、`ocr-parse-result.json`。
5. 任务完成：`outputObjectKey` / `outputPrimaryPath` 指向 PDF / MD；`GET /api/tasks/[id]/view` 对 OCR 任务额外返回 `ocr_parse_result_url`（parse JSON 的 presigned GET）。

**与 BabelDOC 对比**：普通翻译走 `invoke-fc`、独立回调与 FC 队列；OCR **禁止** 与 BabelDOC 共用同一 Cloudflare Queue。幂等与防双跑依赖 `translation_tasks` 上的租约字段（`fcInvokeLeaseUntil`、`fcNextAttemptAt` 等）。

## 2. Cloudflare 资源与 wrangler

1. 在 Dashboard **Queues** 创建队列：`translatepdfonline`（名称需与 `wrangler.toml.template`/`wrangler.queues.toml` 中一致，或改模板后重新 `pnpm run generate-wrangler`）。
2. 主 Worker（`wrangler.toml`）仅保留 Producer 绑定：  
   - `[[queues.producers]]`：`binding = "OCR_PIPELINE_QUEUE"`，`queue = "translatepdfonline"`。
3. 独立 Consumer Worker 使用 `wrangler.queues.toml`：  
   - `main = "worker-queue.ts"`（包装 OpenNext `fetch`，并导出 `queue` + `scheduled`）  
   - `[[queues.consumers]]`：`queue = "translatepdfonline"`，`max_batch_size = 1`。  
   - `[triggers].crons = ["*/2 * * * *"]`，作为 `/api/ocr/dispatch-pending` 兜底触发。
4. **Producer**：`POST /api/ocr/tasks` 在入库成功后调用 `sendOcrPipelineQueueMessage`；消息由独立队列 Worker 消费并触发派发。
5. **Secrets / Vars**：队列 Worker 需配置  
   - `OCR_DISPATCH_URL=https://<main-worker-domain>/api/ocr/dispatch-pending`  
   - `OCR_DISPATCH_SECRET`（与主 Worker `CRON_SECRET` 或 `OCR_DISPATCH_SECRET` 一致）。  
   OCR 管线本身不新增 DB 列（**无迁移**）。

## 3. 测试建议

- 单任务：`POST /api/ocr/tasks` → 队列深度下降 → 任务 `completed` → `view` 返回 PDF/MD/JSON 链接。
- 积压：连续提交多任务，观察 `max_batch_size=1` 时顺序完成与消费者错误率。
- 重试：人为制造 Baidu 超时，确认 `ocr_retry_scheduled` 与队列重试语义。
- 租约：并发下同一 `taskId` 不应双跑（`invokeOcrPipelineForTask` 开头 claim）。
- 隔离：普通翻译任务不应进入 OCR consumer（consumer 内仅处理 `preprocessWithOcr` 任务；`invokeOcrPipelineForTask` 已按条件 claim）。

## 4. 持久化 parse JSON 与 Workbench

- R2 键：`translations/{taskId}/ocr-parse-result.json`（与 `ocr-output.*` 并列）。
- 前端 **Workbench** 通过 `ocr_parse_result_url` 拉取 JSON；保存：`PATCH /api/tasks/[taskId]/ocr-parse-result` 写回 R2 并刷新 `updatedAt`。

## 5. DeepSeek 与旧站对齐（规划）

当前实现为 **整篇 Markdown 单次** `translateMarkdownWithDeepSeek`。旧站 `onlinepdftranslator` 中 `deepseek-translate.ts` / `pipeline.ts` 提供按 layout、表格分段、跳过公式/图、批大小与重试等能力。建议后续在具备稳定 `ocr-parse-result.json` 后：

- 引入前缀环境变量 **`OCR_DEEPSEEK_*`**（如 `OCR_DEEPSEEK_MODEL`、`OCR_DEEPSEEK_MAX_CONCURRENCY`）与现网键映射表；或封装调用 `translateOcrDocument` 一类逻辑。
- 短期：仅文档与配置层对齐，避免与全站 `DEEPSEEK_*` 混淆。

## 6. 本地开发

- 未配置 `OCR_PIPELINE_QUEUE` 时，创建任务后走 `dispatchPendingOcrJobs` 兜底，本地 `next dev` 可完成端到端。
- `wrangler dev` 需本地队列模拟时，以当前 Wrangler 文档为准；无绑定时 `sendOcrPipelineQueueMessage` 返回 `false`，行为同上。

## 7. develop 日志排障（主 Worker + 队列 Worker）

- 主 Worker（HTTP/API）：
  - `npx wrangler tail translatepdfonline --format pretty`
- 队列 Worker（OCR consumer）：
  - `npx wrangler tail translatepdfonline-quenues --config wrangler.queues.toml --format pretty`
- 常见关键词：
  - Producer：`[ocr/queue] enqueued`
  - Consumer：`[ocr/dispatch-pending]`、`[ocr/consumer] completed|retry_scheduled|failed`
