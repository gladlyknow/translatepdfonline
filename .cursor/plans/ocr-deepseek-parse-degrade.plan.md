---
name: OCR DeepSeek 批译空响应降级
overview: 在 `translate_parse_result` 阶段，仅当 DeepSeek 对某一批返回 HTTP 200 且助手 `content` 为空（无可用正文）时，对该批保留译前原文并 warn，不中断任务；`content` 非空但无法解析为合法 JSON 数组、或解析后条数与当批输入仍不一致时，**保持现有抛错**，整阶段失败。
todos:
  - id: degrade-runOneBatch
    content: 在 ocr-translate.ts 的 runOneBatch 中，仅当 res.ok 且 rawContent 为空时写回 plan.slice 并 warn；无效 JSON / 长度不匹配仍 throw
    status: completed
  - id: verify-parallel-waves
    content: 确认 Promise.all 并发路径在 runOneBatch 不 throw 后不再触发 firstError；必要时补全 out 未写入索引的断言或兜底
    status: completed
  - id: optional-finish-reason-log
    content: （可选）解析 choices[0].finish_reason 写入降级日志便于与上游对账
    status: completed
  - id: tsc-smoke
    content: frontend 下 pnpm exec tsc --noEmit
    status: completed
isProject: true
---

# OCR `translate_parse_result`：DeepSeek 空响应按批降级（不中断任务）

## 背景与根因

- 队列报错：`DeepSeek batch translate: empty content (200)` 出自 [`frontend/src/shared/lib/ocr-translate.ts`](d:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-translate.ts) 内 `translateStringListWithDeepSeek` → `runOneBatch`：HTTP 200 但 `choices[0].message.content` 去空白后为空。
- 当前逻辑在重试用尽后 **`throw new Error(...)`**，并行 `next()` 捕获后写入 `firstError`，最终整函数抛出，[`ocr-queue.ts`](d:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts) 将 `translate_parse_result` 记为失败；[`toPublicOcrErrorMessage`](d:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-public-error.ts) 把含 `deepseek` 的文案映射为「Translation service temporarily unavailable, please retry」。

## 目标行为（产品约定）

当且仅当 **单批** 在耗尽 `OCR_PARSE_TRANSLATE_RETRY_MAX` 次重试后满足：

- **`res.ok` 为真**，且
- **`choices[0].message.content` 去空白后为空**（含 `choices` 缺失、首条无 `message`、`content` 全空白等「无助手正文」情形）；

则对该批 **不做译文回填**：`out[plan.start + i] = plan.slice[i]`，打 **`console.warn`**（建议 `reason: empty_content`，并带 `task_id`、`batch`、`batches_total`），**不 `throw`**，其余批次继续。

**明确不降级（与现网一致，仍 `throw` 导致阶段失败）：**

- `content` **非空**，但 **JSON.parse 失败**、或 **无法从正文提取合法 JSON 数组**（现有 `invalid JSON array` 分支）；
- 解析得到数组但经 `normalizeDeepSeekBatchArrayOutput` 后 **条数仍与 `plan.slice.length` 不一致**（现有 length mismatch 文案）。

**边界（建议实现时写清）：** 若 `res.ok` 且 `content` 为空，但响应体含 **`error.message`**（或其它明确表示拒绝/错误的字段），视为 **上游明确错误**，**不降级**，沿用现有 `lastError` 并最终 `throw`（避免把真错误当成偶发空包）。

## 非目标（保持严格失败）

以下情况 **不改变** 现有行为（仍重试 / 仍抛错或置失败）：

- `DeepSeek API key missing`、HTTP **401/403** 等配置错误；
- **网络错误 / 超时 / 429 / 5xx**（沿用现有退避与 `firstError` 传播）；
- **`content` 非空** 时的 **无效 JSON / 条数不匹配**（见上）。

## 实现要点

1. **修改位置**：[`translateStringListWithDeepSeek`](d:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-translate.ts) 内 `runOneBatch` 末尾（约 771–777 行）拆成两支：

   - **仅当**「最后一次尝试结束」且 **`res.ok` 且 `!rawContent`**，且（可选）**无** `json.error?.message` 等明确错误 → 将 `plan.slice[i]` 写入 `out[plan.start + i]`，`console.warn`，`return`。
   - **否则**若 `!Array.isArray(parsedArr) || parsedArr.length !== plan.slice.length` → **保持** `throw new Error(lastError || ...)`。

2. **并发安全**：仅在「空 content 降级」分支不抛；无效 JSON 等仍会抛，`firstError` 与 `Promise.all(workers)` 行为与现网一致。

3. **与去重映射的关系**：`translateAndPersistParseResultTarget`（[`ocr-parse-result-target-translate.ts`](d:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-parse-result-target-translate.ts)）先对 `parts` 去重再调用 `translateStringListWithDeepSeek`；降级写回的 `plan.slice` 即为 **该批唯一词条的原文**，回写 slot 时逻辑不变，**同源多 slot 会一起保留原文**（符合「对应块儿不回填译文」）。

4. **（可选）** 若响应体含 `choices[0].finish_reason`，一并写入 warn JSON，便于与 DeepSeek 控制台对照。

5. **验收**：构造或 mock「200 + 空 content」单批，确认任务 `translate_parse_result` 成功完成、目标 JSON 中对应字段为原文、日志为 `warn` 而非 `error` 中断；另构造「200 + 非空但非法 JSON」确认阶段仍失败。

## 风险说明

- 某批静默保留原文后，**界面语种可能与正文不完全一致**；优于整任务失败。若将来需要提示用户，可再在 Workbench 增加「部分未翻译」标记（本计划不包含 UI）。
