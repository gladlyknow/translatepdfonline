---
name: Preview polling translation fix
overview: 解决 PDF 预览译文重复展示、前端轮询过于频繁、以及列表项漏译三个问题：通过后端只输出已翻译页、降低轮询或接入 SSE、并优化 BabelDOC/提示以保留列表结构。
todos: []
isProject: false
---

# PDF 预览、轮询与漏译修复计划

## 问题与结论

1. **Translation 重复展示源页**：当前 BabelDOC 未开启“仅包含已翻译页”，输出 PDF 与原文同结构（如 495 页），右侧预览用同一页码展示，未翻译页会显示为原文或空白，造成“译文区又展示了一遍源页”的观感。
2. **轮询过于频繁**：前端每 2 秒同时请求 `GET /api/tasks/{id}` 与完成时 `GET /api/tasks/{id}/view`，导致日志里请求密集。
3. **漏句/合并列表项**：BabelDOC 按“段落”送翻，若 “Why subscribe?” 与三条列表被识别为一个段落，或 LLM 未严格按条翻译，会出现合并/漏译。

---

## 1. Translation 只展示已翻译的页

**目标**：右侧“译文”仅显示翻译后的页，不再出现与左侧相同的整份源 PDF 结构。

**后端**

- 在 [backend/app/babeldoc_adapter.py](backend/app/babeldoc_adapter.py) 创建 `TranslationConfig` 时增加参数：
  - `only_include_translated_page=True`
- 效果：BabelDOC 输出的 PDF 只包含用户选择的页（例如只选第 7 页则输出为 1 页），不再输出与原文等长的文档。

**前端**

- 在 [frontend/app/[locale]/page.tsx](frontend/app/[locale]/page.tsx) 中修正译文 PDF 页码与“仅已翻译页”输出一致：
  - 当前逻辑：`targetPageInPdf = pageRange == null ? currentPage : (isPageTranslated ? currentPage : 1)`，适用于“译文 PDF 与源同结构”。
  - 改为：当存在 `pageRange` 且译文为“仅已翻译页”时，译文 PDF 的页码应为“在译文中的序号”：
    - `targetPageInPdf = pageRange == null ? currentPage : (isPageTranslated ? (currentPage - pageRange[0] + 1) : 1)`
  - 即：左侧选第 7 页时，右侧显示译文 PDF 的第 1 页（也是唯一一页）；未在翻译范围内的源页仍用现有“未翻译”占位，不显示译文 PDF。

**可选**：若后端将来在 TaskView 中返回“译文 PDF 页数”，前端可据此做边界校验（例如 `targetPageInPdf` 不超过该页数）。

---

## 2. 降低前端访问后端频率 / 用 SSE 替代轮询

**目标**：减少轮询次数，或改为事件驱动（SSE），任务完成时再拉取 view。

**方案 A（优先落地）：拉长轮询间隔**

- 在 [frontend/app/[locale]/page.tsx](frontend/app/[locale]/page.tsx) 中：
  - 将轮询间隔从 `2000` 改为 `5000` 或 `10000`（建议先 5s，可做成常量便于后续改为 10s）。
  - 处理中用于“阶段提示”的 `setTick` 的 `setInterval` 也改为相同间隔，避免同一周期内多轮请求。
- 效果：同一任务下，GET `/api/tasks/{id}` 与完成后的 GET `/api/tasks/{id}/view` 请求频率明显降低（例如从每 2s 变为每 5s），直到任务结束再拉一次 view。

**方案 B（推荐长期）：用 SSE 推送进度与完成事件**

- 后端已有占位 [backend/app/routes/tasks.py](backend/app/routes/tasks.py) 的 `GET /api/tasks/{task_id}/events`，目前返回假数据。
- 实现思路：
  - **后端**：实现真正的 SSE 流：在循环中从 Redis 读取该任务的进度（与 [backend/app/task_progress.py](backend/app/task_progress.py) 一致），按固定间隔（如 2–3s）推送 `status`、`progress_percent`、`progress_stage` 等；当检测到任务状态变为 `completed` 或 `failed`（可查 DB 或 Celery 结果），推送一次最终状态事件后结束流。
  - **前端**：当存在 `taskId` 且状态为 `queued` 或 `processing` 时，使用 `EventSource(`/api/tasks/${taskId}/events`)` 订阅；在 onmessage 中更新 `taskStatus` 与进度展示；收到 `completed`/`failed` 时关闭 EventSource，并**只在此刻**请求一次 `getTaskView(taskId)` 拉取 view，不再对该任务轮询。
  - 轮询可作为降级：SSE 不可用或出错时，回退到 5s 或 10s 轮询，且完成时只拉一次 view。

**建议**：先做方案 A（5s/10s），再在计划内实现方案 B（SSE + 完成时单次 getTaskView），并在文档中说明两种方式。

---

## 3. 翻译漏句（列表项被合并/遗漏）

**原因分析**

- 翻译按“段落”进行。若 “Why subscribe?” 与三条 “* Fully searchable…”、“* Copy and paste…”、“* On demand…” 被 BabelDOC 的 ParagraphFinder 识别为**一个段落**，则整块送翻，LLM 容易合并或漏掉其中一条。
- BabelDOC 的 [paragraph_finder.py](tmp/BabelDOC-main/babeldoc/format/pdf/document_il/midend/paragraph_finder.py) 支持在**子弹符**处切分（`is_bullet_point(char)`），但 `*` 是否被识别为 bullet 取决于 `layout_helper.is_bullet_point` 的规则；若未切分，则三条会在一起。

**可选措施（按优先级）**

1. **启用/调整 BabelDOC 短行与列表切分**
  在 [backend/app/babeldoc_adapter.py](backend/app/babeldoc_adapter.py) 的 `TranslationConfig` 中：
  - 若当前未设置，可显式开启 `split_short_lines=True`，并视情况设置 `short_line_split_factor`，以便在短行/列表项处切分为多段，减少整块送翻导致的合并与漏译。
  - 需注意：BabelDOC 默认可能已开启，需对照 [translation_config.py](tmp/BabelDOC-main/babeldoc/format/pdf/translation_config.py) 的默认值，只做必要覆盖。
2. **通过系统提示强调保留列表与条目**
  BabelDOC 的 `TranslationConfig` 支持 `custom_system_prompt`。在 adapter 中追加（或通过 custom_system_prompt 传入）简短说明，要求：
  - 保留列表结构，不合并、不遗漏任何一条；
  - 若输入为多条（如 bullet 列表），输出必须条数一致、一一对应。
  - 这样即使某页被识别成一大段，LLM 也有更高概率保留三条内容。
3. **排查与验证**
  - 对出现漏译的 PDF 页，可在本地或日志中确认：该页送翻的“段落”数量与内容（是否三条被合并成一段）。
  - 若确认是段落合并导致，以 1 为主；若段落已分开仍漏译，以 2 为主并考虑后续在 BabelDOC 上游提 issue（列表项识别/切分）。

**建议**：先做 2（custom_system_prompt 强调列表与条数一致），再视情况在 adapter 中微调 1，并在技术文档中记录“列表/漏句”的处理策略与配置项。

---

## 实现顺序建议


| 步骤  | 内容                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 后端 babeldoc_adapter：`only_include_translated_page=True`；前端 page.tsx：`targetPageInPdf` 按“仅已翻译页”计算。                                    |
| 2   | 前端：轮询间隔改为 5s（或 10s），并统一 tick 间隔。                                                                                                     |
| 3   | 后端：实现 `/api/tasks/{task_id}/events` SSE（从 Redis/DB 读进度与状态，完成时推送并结束）；前端：processing/queued 时用 EventSource，完成时只请求一次 getTaskView，并做轮询降级。 |
| 4   | 漏句：在 adapter 中增加 custom_system_prompt（保留列表、条数一致）；可选启用/调整 split_short_lines。                                                          |
| 5   | 技术文档更新：预览逻辑、轮询/SSE 行为、漏句与列表配置说明。                                                                                                     |


---

## 涉及文件一览

- [backend/app/babeldoc_adapter.py](backend/app/babeldoc_adapter.py)：`only_include_translated_page`、可选 `split_short_lines`、`custom_system_prompt`。
- [backend/app/routes/tasks.py](backend/app/routes/tasks.py)：SSE `task_events` 真实实现（读 Redis/DB，推送进度与完成）。
- [frontend/app/[locale]/page.tsx](frontend/app/[locale]/page.tsx)：`targetPageInPdf` 修正、轮询间隔、EventSource 订阅与完成时单次 getTaskView。
- 文档：记录预览规则、轮询/SSE、漏句与列表项配置。

