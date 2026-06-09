---
name: OCR translate_parse observability
overview: 在队列 Consumer 抢租失败、并发让路等路径补充结构化日志；并按 DeepSeek 官方 Rate Limit 说明与实测慢批，缩小 translate_parse_result 单批上限、可调高默认并发以缩短墙钟（遇 429 仍走现有退避）。
todos:
  - id: log-claim-skip
    content: "ocr-queue.ts: claimed.length===0 时 SELECT 当前行并 console.warn claim_skipped"
    status: completed
  - id: log-parse-enter
    content: "ocr-queue.ts runOneStage: translate_parse_result 调用前 translate_parse_result_enter 日志"
    status: completed
  - id: log-concurrency
    content: "ocr-queue.ts: deferTaskForConcurrency 若无明确日志则补 deferred_owner_concurrency"
    status: completed
  - id: deepseek-batch-defaults
    content: "ocr-translate.ts translateStringListWithDeepSeek: 缩小默认 OCR_PARSE_TRANSLATE_CHUNK_ITEMS/CHUNK_CHARS；并发默认与 clamp 上限按官方 429 策略可调高（如默认 24、clamp 1–32）；plan 日志带出 effective 值"
    status: completed
  - id: deploy-doc-deepseek
    content: 部署手册 OCR 小节引用 api-docs.deepseek.com Rate Limit，说明并发与 429、单批变小与 max_tokens 关系
    status: completed
  - id: verify
    content: tsc --noEmit + ReadLints 改动文件
    status: completed
isProject: false
---

# OCR translate_parse_result 排查与日志增强

## 为何「入队了」仍像翻译出问题

你提供的两行日志只覆盖：

1. 上一阶段成功，`markStageQueued` 把 DB 设为 `status=queued`、`progress_stage=translate_parse_result`。
2. `enqueueNextStage` 发送队列消息成功（`enqueue_ok` + `[ocr/queue] enqueued`）。

**之后**应由下一次队列消费调用 [frontend/src/shared/lib/ocr-queue.ts](frontend/src/shared/lib/ocr-queue.ts) 里的 `invokeOcrPipelineForTask`，并打出已有的：

```775:778:frontend/src/shared/lib/ocr-queue.ts
  console.log(
    '[ocr/stage] start',
    JSON.stringify({ task_id: taskId, stage, attempt: thisAttempt, at: nowIso() })
  );
```

若 Cloudflare 日志里**没有**同 `task_id` 的 `[ocr/stage] start` 且 `stage` 为 `translate_parse_result`，常见原因（按频率）：

1. **抢租静默失败**：`invokeOcrPipelineForTask` 第 692–708 行对 `translation_tasks` 的 `UPDATE ... RETURNING` 在 `status !== 'queued'`、`fc_next_attempt_at` 未到、`fc_invoke_lease_until` 仍有效等条件下 **0 行命中**，随后 **`if (!claimed.length) return` 无日志** —— 运维侧会误以为「翻译没跑」。
2. **同 owner 并发上限**（第 726–729 行）：`deferTaskForConcurrency` + `scheduleOcrDeferredRequeue`，任务被推迟；需搜 `owner_concurrency_limit` / `[ocr/stage] enqueue_failed`。
3. **阶段内 DeepSeek 失败**：会有 `[ocr/stage] failed` / `[ocr/stage] retry`；`translateAndPersistParseResultTarget` 内已有 `[ocr/parse_target_translate] start/done`（[ocr-parse-result-target-translate.ts](frontend/src/shared/lib/ocr-parse-result-target-translate.ts)）。

建议你在日志里用 `task_id=bZaz5sXQVeD0-PRfldPxm` 再搜：`[ocr/stage] start`、`translate_parse_result`、`[ocr/parse_target_translate]`、`[ocr/stage] failed`。

## 复盘（用户补充完整日志，task `bZaz5sXQVeD0-PRfldPxm`）

**结论：翻译未失败，流水线正常跑完。** 证据链：

- `[ocr/parse_target_translate] start` → `[ocr/deepseek_parse_batches] plan`（46 个去重串、4 批、`waves_estimate: 1`）→ 4 条 `[ocr/deepseek_parse_batch] start/done` → `[ocr/parse_target_translate] done`（`target_key` 已写入 `ocr-parse-result-target.json`）。
- `[ocr/stage] done`：`stage=translate_parse_result`，`next_stage=export_outputs`，`enqueue_ok`。
- `[ocr/billing] settle_on_completed`：`charge_result=charged`，4 页计费正常。

**用户体感「出问题」主要来自耗时，而非静默失败：**

- `[ocr/parse_target_translate] done` 的 `elapsed_ms` ≈ **218584**（约 3 分 38 秒），与整段 `translate_parse_result` 阶段墙钟一致（`[ocr/stage] done` 同条里 `elapsed_ms` ≈ **219432**）。
- 单批 DeepSeek 极慢示例：`batch=1` 的 `done` 里 `elapsed_ms` ≈ **171769**，`completion_tokens` **6576**（接近 `max_tokens` 8000 上限）；`batch=3` 的 `elapsed_ms` ≈ **218288**，`completion_tokens` **2834**。在 `concurrency=16`、4 批并行时，**整体墙钟由最慢的一批决定**，因此会出现「入队后好几分钟才有下一跳日志」——这是 **API 生成延迟 + 大批输出 token**，不是队列丢消息。

**与「仅见 ocr_parse_persisted 入队」那条的关系：** 09:26:06 入队 `translate_parse_result` 后，约 **11 秒** 才出现 09:26:17 的 `parse_target_translate` start（中间可能为下一次 consumer 调度、抢租、或极短排队）；真正长的是 **09:26:17 → 09:29:56** 的 DeepSeek 批处理。

**本计划（claim_skipped / translate_parse_result_enter / 并发推迟日志）仍值得做：** 用于**另一类**问题（抢租静默失败、owner 并发推迟）时快速定界；对本 task 而言，现有日志已足够证明「翻译在跑」，补充日志主要服务后续运维。

## 计划改动（仅加日志，不改业务逻辑）

### 1. 抢租失败可观测 —— [frontend/src/shared/lib/ocr-queue.ts](frontend/src/shared/lib/ocr-queue.ts)

在 `if (!claimed.length) return` 之前：

- 对同一 `taskId` **只读** `select` 一行（`status`, `progressStage`, `fcNextAttemptAt`, `fcInvokeLeaseUntil`, `preprocessWithOcr`），打一条 **`console.warn('[ocr/pipeline] claim_skipped', JSON.stringify({...}))`**，便于区分「根本不是 queued」vs「lease 未过期」vs「时间未到」。
- 注意：仅在 `claimed.length === 0` 时执行该 SELECT，避免热路径额外 DB 负载。

### 2. translate_parse_result 阶段壳日志 —— 同上文件 `runOneStage`

在 `if (params.stage === 'translate_parse_result')` 调用 `translateAndPersistParseResultTarget` **之前**打一行：

- `[ocr/stage] translate_parse_result_enter`，包含 `task_id`、`source_lang`、`target_lang`（截断敏感信息无）。

（子过程已有 `[ocr/parse_target_translate]`，壳日志用于和「未进入 runOneStage」区分。）

### 3. 并发推迟已有路径 —— 同上文件

确认 `deferTaskForConcurrency` 附近已有可 grep 的日志；若没有，补一条 **`[ocr/pipeline] deferred_owner_concurrency`**，含 `task_id` 与 `limit`。

## 验证

- 本地或 CI：`pnpm exec tsc --noEmit`。
- 部署后人为制造「同用户两任务同时 processing」或短暂将 `fc_invoke_lease_until` 置未来，确认出现 `claim_skipped` 或 `deferred_owner_concurrency`，且日志中 `task_id` 可串联。

---

## translate_parse_result：缩小单批上限 + 并发（DeepSeek 官方文档对齐）

**用户意图说明：** 你提到「可增加并发降低处理速度」——在工程语境下按 **缩短墙钟总耗时** 理解（单批变小 + 并行度提高，使多批更早完成；若你本意是「限流降速」则应反向调低并发，可在实现前再确认）。

### DeepSeek 官方（Rate Limit）

来源：[Rate Limit | DeepSeek API Docs](https://api-docs.deepseek.com/quick_start/rate_limit)

- 并发由服务端负载 **动态限制**；达到上限时 **立即返回 HTTP 429**。
- 请求发出后可能长时间无 JSON body（非流式会间歇空行等）；**若 10 分钟内未开始推理，服务端会断开连接**。

**对实现的含义：** 客户端并发不宜「无限大」；应在 **429 + 现有指数退避** 前提下适度提高默认并发；单批过大易导致单次生成 token 多、墙钟长（你提供的 `batch=1` 约 172s、`completion_tokens=6576`），**缩小 `chunk_items` / `chunk_chars`** 可把负载拆成更多更小批，单批 `max_tokens` 随 `resolveBatchMaxTokens` 自动下降，有利于缩短**单批**最坏耗时（总批次数会增加，需靠更高 `concurrency` 与 waves 保持整体不劣化）。

### 建议改动的代码位置

[frontend/src/shared/lib/ocr-translate.ts](frontend/src/shared/lib/ocr-translate.ts) 内 `translateStringListWithDeepSeek`：

| 项 | 当前默认（代码） | 建议新默认（实现时） | 说明 |
| --- | --- | --- | --- |
| `OCR_PARSE_TRANSLATE_CHUNK_ITEMS` | `12`（`Math.max(4, …)` 下限 4） | **`8`** | 减小单批条数上限 |
| `OCR_PARSE_TRANSLATE_CHUNK_CHARS` | `3000`（下限 1000） | **`2000`** | 减小单批字符预算 |
| `OCR_PARSE_TRANSLATE_CONCURRENCY` | `16`，`Math.min(16, …)` | **默认 `24`，clamp 上限 `32`**（仍 `Math.max(1, …)`） | 与官方「动态并发 + 429」一致：略提高并行，依赖已有 429 重试；上限 32 避免 Worker 侧过多同时 `fetch` |
| `MAX_TOKENS_HARD_CAP`（parse 批） | `8000` | **可维持 8000 或降至 `6144`**（二选一写进变更说明） | 若仍出现单批接近 8000 的慢生成，可再降硬顶；需监控「输出被截断 → JSON 解析失败 → 重试」比例 |

`resolveParseTranslateConcurrency` 需把 **`Math.min(16, …)` 改为可配置上限**（如 `Math.min(resolveParseTranslateConcurrencyMax(), …)`，从 env `OCR_PARSE_TRANSLATE_CONCURRENCY_MAX` 读取，默认 32）。

`[ocr/deepseek_parse_batches] plan` 日志已含 `chunk_*`、`concurrency`；实现后在同条日志增加 **`concurrency_max`**（或 `effective_concurrency_cap`）便于线上核对。

### 部署手册

在 [.cursor/plans/translatepdfonline_cloudflare_双项目部署手册.md](.cursor/plans/translatepdfonline_cloudflare_双项目部署手册.md) 的 **`translate_parse_result` 阶段性能** 小节：

- 增加官方 Rate Limit 文档链接与 429 / 10 分钟断连一句摘要。
- 更新默认并发数字与新增 `OCR_PARSE_TRANSLATE_CONCURRENCY_MAX`（若实现）。
- 说明：批变小后 `batches_total` 可能上升，应结合日志 `waves_estimate` 与 CF 15min invocation 墙钟一起观察。

### 风险与回滚

- **429 增多**：略降默认并发或 `CONCURRENCY_MAX`。
- **输出截断**：若降低 `MAX_TOKENS_HARD_CAP`，需盯 `[ocr/deepseek_parse_batch]` 重试与 `invalid JSON` 类错误；必要时仅调 chunk 不调硬顶。

### 与上文「仅日志」todo 的关系

**日志 todo 与 DeepSeek 批默认 todo 可同一 PR 合并**，也可分 PR：先日志后调参，便于 A/B 对比 `elapsed_ms`。
