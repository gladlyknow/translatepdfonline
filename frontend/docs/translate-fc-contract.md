# 翻译 FC（babeldoc_fc）与 Next 契约

## 请求 `POST /translate`（Next → FC）

JSON 字段与 [`babeldoc_fc/main.py`](../../babeldoc_fc/main.py) 中 `TranslateRequest` 一致，其中 Next 会发送：

| 字段 | 说明 |
|------|------|
| `task_id` | 与 `translation_tasks.id` 一致 |
| `source_pdf_url` | R2 预签名 GET |
| `output_object_key` | 如 `translations/{task_id}/output.pdf` |
| `source_lang` / `target_lang` | 语言代码（经 FC 归一化后须落在与 UI 一致的允许集合，见下节 **语言**） |
| `callback_url` | 站点 `.../api/translate/callback` |
| `page_range` | 与任务一致，可选（如 `1-10`）。创建任务时若用户页范围超出文档页数，Next 会与文档取交集后写入（超出部分不译）；扣费以实际成功页数 / 回调为准。 |

鉴权：请求头 `X-Babeldoc-Secret`（或环境变量 `TRANSLATE_FC_AUTH_HEADER` 指定），值为 **`TRANSLATE_FC_AUTH_SCHEME` + Secret**（scheme 常为空）。`babeldoc_fc` 入口与回调 POST 均与此一致。

## 异步调用（推荐：Cloudflare Worker → 阿里云 FC）

为消除 **「Invocation canceled by client」**（Worker 子请求/连接无法长时间占用），Next 默认对 FC 使用 **阿里云 HTTP 异步调用**：

| 项 | 说明 |
|----|------|
| 请求头 | **`X-Fc-Invocation-Type: Async`**（由 `invoke-fc.ts` 在默认模式下自动添加） |
| 请求体大小 | 异步模式平台限制约 **128KB**；Next 在超过 **120KB**（UTF-8 字节）时直接置任务 `failed`（`fc_payload_too_large`） |
| Worker 侧超时 | **`TRANSLATE_FC_ASYNC_ACK_TIMEOUT_MS`**（默认 25s，上限 120s），只等待 **网关接受任务**，不等待翻译完成 |
| 同步调试 | 环境变量 **`TRANSLATE_FC_INVOCATION_TYPE=sync`** 时**不**加异步头，使用 **`TRANSLATE_FC_FETCH_TIMEOUT_MS`** 长超时等完整 HTTP 响应（本地/排错） |
| 成功判定 | **异步模式下 HTTP 2xx 仅表示「已提交 FC」**；`output_object_key` 仍以 **`callback_url`** 的 `completed` 为准 |
| DB 阶段名 | 异步 ACK 成功：`progress_stage=fc_async_submitted`；同步 200 成功：`fc_accepted`（与历史一致） |

相关环境变量（Worker / Node）：`TRANSLATE_FC_SUBMIT_MAX_ATTEMPTS`（向 FC **提交**失败或 429/502/503/500 时 Cron 侧最大尝试次数，默认 5）、`TRANSLATE_FC_INVOCATION_TYPE`、`TRANSLATE_FC_ASYNC_ACK_TIMEOUT_MS`。

## 语言（与 UI 对齐）

FC 对 `source_lang` / `target_lang` 做与 [`run_translate._normalize_lang`](../../babeldoc_fc/run_translate.py) 相同的归一化后，**必须**属于集合 **`en`, `zh_cn`, `es`, `fr`, `it`, `el`, `ja`, `ko`, `de`, `ru`**（与 `frontend/src/shared/lib/translate-langs.ts` 一致；UI 的 `zh` 对应归一化后的 `zh_cn`）。源语与目标语归一化后不得相同，否则 **HTTP 400**。

## 回调 `POST callback_url`（FC → Next）

Next 会校验与调用 FC 时相同的 Secret 头（若已配置 `TRANSLATE_FC_SECRET`）。

| 字段 | 说明 |
|------|------|
| `task_id` | 必填 |
| `status` | `completed` 或 `failed` |
| `output_object_key` | 成功时结果 PDF 的 R2 key |
| `error_message` / `error_code` | 失败时可选。`babeldoc_fc` 在 BabelDOC 报「无可提取段落」时会传 **`error_code`: `no_paragraphs`**（Next 也会根据 `error_message` 兜底识别） |
| **`translated_page_count`** | **成功时推荐必填**：本次计费的翻译页数（整数 ≥1）。用于按页扣积分；与 `page_count`、`pages` 三选一即可（Next 读取优先级见 `translate-billing.ts`） |

积分严格模式：环境变量 `TRANSLATE_BILLING_REQUIRE_FC_PAGE_COUNT=true` 时，成功回调 **若无**上述任一页数字段，则 **不扣积分** 并写 `billing_error`。

## HTTP 与排队

- FC 若因并发/容量拒绝，可返回 **429** 或 **503**，并尽量提供 **`Retry-After`**。**翻译流水线内部的瞬时失败（下载、上传、LLM、JSON 解析等）由 babeldoc_fc 内有限次重试**（环境变量如 `BABELDOC_DOWNLOAD_MAX_ATTEMPTS`、`BABELDOC_UPLOAD_MAX_ATTEMPTS`、`BABELDOC_TRANSLATE_MAX_ATTEMPTS`）。
- Next 通过 Cron **`/api/translate/dispatch-pending`** 仅负责 **再次提交** FC（提交次数上限见 `TRANSLATE_FC_SUBMIT_MAX_ATTEMPTS`），**不是** Cloudflare Queues。
- **成功完成翻译后**：FC 必须确认对 Next 的 `callback_url` 的 `POST` 返回 **HTTP 200**（失败时应重试）；**不得**在回调未成功时仍对「同步调用方」返回 **可误判为整单成功**的 2xx；实现上对 completed 回调仍失败时可返回 **422**（同步模式下 Next 会置 `failed`）。  
- Cron 侧 **`TRANSLATE_STALE_FC_ACCEPTED_MINUTES`**（默认 45，范围 5–1440）会清理长期停留在 **`fc_async_submitted` 或 `fc_accepted`** 仍无终态回调的任务（`stale_fc_accepted`）。

### 回调重试与「长时间翻译」误伤说明

- **babeldoc_fc** 对 `callback_url` 的有限次重试发生在 **整本 PDF 翻译与 R2 上传完成之后**，只重试短 HTTP POST，**不会**在 BabelDOC 执行中途因该重试而失败。
- **`reapStaleFcAcceptedTasks`** 匹配 **`fc_async_submitted` 或 `fc_accepted`**。正在排队、尚未被 FC 网关接受的任务 **不会**进入该状态，**不会**被误杀。

## 排错：`Invocation canceled by client`（FC 日志）

含义：调用方在函数跑完前断开了 HTTP 连接（同步长连接场景）。

| 检查项 | 说明 |
|--------|------|
| **推荐** | 生产环境使用 **`X-Fc-Invocation-Type: Async`** + Worker 短 ACK 超时（见上节），避免 Cloudflare 长连接触发 cancel |
| **阿里云 FC 控制台** | 函数 **超时时间** 需覆盖冷启动 + ONNX + 全量翻译（如 ≥ 300s） |
| **同步模式** | `TRANSLATE_FC_INVOCATION_TYPE=sync` 时须保证调用方 **`TRANSLATE_FC_FETCH_TIMEOUT_MS`** 足够大，且 Worker 使用 **`ctx.waitUntil(invokeTranslateFcForTask)`**（见 `route.ts`） |

## 排错：`NoneType` / `total_seconds`（BabelDOC）

旧版 BabelDOC 在 **仅翻译部分页** 且当前分片 **无可提取页面** 时，`_do_translate_single` 曾 **`return None`**，随后在 `do_translate` 里写 `result.total_seconds` 崩溃。本仓库内 **`tmp/BabelDOC`** 已改为 **`ExtractTextError`** 明确报错，并在合并空分片时 **`ValueError`**。部署 FC 镜像前请 **重新构建/安装** 当前 BabelDOC 源码。失败回调里 `error_message` 会包含说明；`error_code` 在可能时映射为 **`no_paragraphs`**。
