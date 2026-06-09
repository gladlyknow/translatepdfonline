---
name: OCR enqueue异常生产修复
overview: 定位到 OCR 阶段推进依赖 `q.send`，但在 consumer/cron 上下文持续抛异常且被吞掉，导致任务只能回落 dispatcher 但 dispatcher 又使用 enqueueOnly 再次失败。方案将改为可观测、可恢复、可持续推进的生产模式，并保持同一 queue。
todos:
  - id: add-enqueue-error-observability
    content: 增强 sendOcrPipelineQueueMessage 异常日志，输出可诊断错误分类与关键信息
    status: completed
  - id: switch-cron-direct-dispatch
    content: 将 scheduled dispatcher 从 enqueueOnly=true 改为 enqueueOnly=false，打破 enqueue 失败死循环
    status: completed
  - id: harden-fallback-policy
    content: 标准化 enqueue fallback 行为与退避策略，避免热循环和噪声日志
    status: completed
  - id: verify-production-path
    content: 按阶段推进与取消/重试/超时场景执行回归并验收日志指标
    status: completed
isProject: false
---

# OCR enqueue_exception 生产修复方案

## 现状与根因（已确认）
- 在 [D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts](D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts) 中，`sendOcrPipelineQueueMessage()` 捕获异常后只打固定日志 `enqueue_exception`，没有输出真实错误信息，导致不可诊断。
- 阶段推进时 `enqueueNextStage()` 先尝试 `q.send`，失败后 fallback 到 dispatcher；但 [D:/imppro/translatepdfonline/frontend/workers/ocr-pipeline-consumer/src/index.ts](D:/imppro/translatepdfonline/frontend/workers/ocr-pipeline-consumer/src/index.ts) 的 `scheduled()` 当前调用 `dispatchPendingOcrJobs(..., { enqueueOnly: true })`，会再次走 `q.send`，形成“反复 enqueue 失败 -> 永不推进”的闭环。
- 你提供的连续日志完全符合该闭环：`enqueue_exception` + `enqueue_only_failed` + `cron_dispatch processed=0`。

## 修复目标
- 保持同一 queue（不拆分新 queue）。
- 任务在 `q.send` 异常时仍可持续推进，不会卡住。
- 提供可诊断日志（必须能看到 Cloudflare 抛出的具体错误）。
- 保持 20 分钟超时与取消/重试能力。

## 实施方案

### 1) 先修复可观测性（必须）
- 文件：[D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts](D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts)
- 修改点：
  - `sendOcrPipelineQueueMessage()` 的 `catch` 改为记录 `error_name / error_message / stack_head`（脱敏、限长）。
  - 区分日志类型：`binding_unavailable`、`enqueue_runtime_error`、`enqueue_rate_limited`（按 message 关键词归类）。
- 目的：确认究竟是“consumer 上下文限制 / 限流 / 队列状态”中的哪一类。

### 2) 打破卡死闭环（核心）
- 文件：[D:/imppro/translatepdfonline/frontend/workers/ocr-pipeline-consumer/src/index.ts](D:/imppro/translatepdfonline/frontend/workers/ocr-pipeline-consumer/src/index.ts)
- 修改点：
  - `scheduled()` 将 `dispatchPendingOcrJobs(limit, { enqueueOnly: true })` 改为 `dispatchPendingOcrJobs(limit, { enqueueOnly: false })`。
- 预期：
  - 即使 `q.send` 在阶段衔接失败，cron 也能直接 `invokeOcrPipelineForTask()` 推进 queued 任务，不再依赖再次 enqueue。
  - 消除 `processed:0` 持续为 0 的卡死模式。

### 3) 降噪并标准化阶段衔接策略（生产化）
- 文件：[D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts](D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts)
- 修改点：
  - `enqueueNextStage()` 在失败 fallback 时，补充 `fallback_reason`（含错误分类）。
  - 为 dispatcher 路径增加轻量退避（如 `fcNextAttemptAt = now + 2~5s`）避免热循环。
  - 保留现有 `status=queued + progressStage=nextStage` 语义，确保 UI 可见阶段推进。

### 4) 配置与运行策略对齐
- 文件：[D:/imppro/translatepdfonline/frontend/wrangler.consumer.develop.jsonc](D:/imppro/translatepdfonline/frontend/wrangler.consumer.develop.jsonc)、[D:/imppro/translatepdfonline/frontend/wrangler.consumer.jsonc](D:/imppro/translatepdfonline/frontend/wrangler.consumer.jsonc)
- 检查项：
  - 继续保持 `max_batch_size=1`、`max_retries=5`。
  - `max_batch_timeout` 保持较小值（当前 5s）即可，避免单次批处理持有太久。
  - `OCR_DISPATCH_BATCH_SIZE=2`、`OCR_ACCOUNT_MAX_CONCURRENCY=2` 维持不变。

### 5) 验收标准（上线门槛）
- 日志不再出现连续 `enqueue_only_failed + processed:0`。
- 同一任务可从 `ocr_submit_poll -> ocr_parse_persisted -> translate_markdown -> export_outputs -> completed` 持续推进。
- 出现 enqueue 失败时，下一次 cron 至少推进 1 个 stage，而非原地打转。
- 取消/重试/20 分钟超时回归通过。

## 风险与回滚
- 风险：cron 改为 direct invoke 后，单次 cron 负载增加。
- 控制：`limit=2` + `max_batch_size=1` + 现有 CPU 限额 + 20m timeout。
- 回滚：仅需把 `scheduled()` 的 `enqueueOnly` 改回 `true`（不建议，因会恢复卡死路径）。