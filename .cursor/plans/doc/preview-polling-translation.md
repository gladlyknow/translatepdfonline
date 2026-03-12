# 预览、轮询与翻译配置说明

本文档记录「预览仅已翻译页、轮询/SSE、漏句与列表」相关的**技术要求**、**实现计划**与**当前实现说明**。

---

## 技术要求（归纳）

1. **Translation 只展示已翻译页**
   - 译文 PDF 不与 Source 一样整份输出，只包含用户选择的已翻译页。
   - 选翻译页（如第 7 页）时，默认从该页开始预览；左右页码同步，未翻译页用占位。

2. **轮询频率与进度推送**
   - 前端原为每 2 秒请求 `/api/tasks/{id}` 和完成时 `/api/tasks/{id}/view`，日志过密。
   - 要求：改为 5s/10s 轮询，或使用 WebSocket/SSE 推进度，**完成时再拉一次 view**。

3. **漏句与列表**
   - 英文列表（如 "Why subscribe?" 下多条）翻译成中文后出现合并/漏句。
   - 要求：保留列表结构和条数（通过 `custom_system_prompt`、可选 `split_short_lines` 等配置）。

4. **其它约定**
   - 后端统一使用项目根目录 `.env` 配置；前端任务状态优先 SSE，失败时回退轮询。

---

## 实现计划（已执行）

| 步骤 | 内容 |
|------|------|
| 1 | **Translation 只展示已翻译页**：后端 `TranslationConfig` 增加 `only_include_translated_page=True`；前端 `targetPageInPdf` 改为 `pageRange == null ? currentPage : (isPageTranslated ? currentPage - pageRange[0] + 1 : 1)`，任务完成时若未手动翻页则把当前页设为 `pageRange[0]`。 |
| 2 | **轮询 5s**：前端两处 `setInterval(..., 2000)` 改为 5000（常量 `POLL_INTERVAL_MS`）。 |
| 3 | **SSE 替代轮询**：后端 `GET /api/tasks/{task_id}/events` 实现真实 SSE（循环读 Redis/DB 进度并定时推送；completed/failed 时推送最终事件并结束流）；前端在存在 taskId 且状态为 queued/processing 时用 `EventSource` 订阅，onmessage 更新状态与进度，收到 completed/failed 时关闭 EventSource 并只请求一次 getTaskView；SSE 失败时回退到 5s 轮询。 |
| 4 | **漏句**：`TranslationConfig` 传入 `custom_system_prompt`（强调保留列表结构、条数一致、不合并不遗漏），可选 `split_short_lines=True`。 |
| 5 | **技术文档**：在 doc/ 或 README 中补充预览规则、轮询/SSE 行为、漏句与列表配置说明（本文档）。 |

---

## 当前实现说明

### 预览规则

#### 译文 PDF 仅包含已翻译页

- 后端使用 BabelDOC 的 `only_include_translated_page=True`，生成的译文 PDF **只包含用户选择的翻译页**，而不是整份文档。
- 例如：用户选择「第 7 页」翻译时，译文 PDF 只有 1 页；选择「1–5」时，译文 PDF 共 5 页。

#### 左右页码与 targetPageInPdf

- **Source（左侧）**：始终为整份 PDF，页码为文档中的真实页码。
- **Translation（右侧）**：仅展示已翻译页，页码为「在译文 PDF 中的序号」。
- 公式：`targetPageInPdf = pageRange == null ? currentPage : (isPageTranslated ? currentPage - pageRange[0] + 1 : 1)`  
  - 未选页范围时与源文同结构，页码一致。  
  - 有页范围且当前页在范围内时，右侧显示该页在译文中的序号；当前页未在范围内时显示第 1 页（占位）。
- 任务完成且存在翻译页范围时，若用户未手动翻页，默认从该范围起始页开始预览。

#### 译文预览用 mono（仅译文）

- BabelDOC 会生成两种输出：**dual**（左右对照：原文+译文）、**mono**（仅译文）。
- 为满足「仅展示翻译页」、避免 dual 的左右对照或交替页带来多页，适配层设置 **`no_dual=True`**，仅输出 mono。
- 右侧「译文」预览使用 mono 文件；前端优先选择文件名含 `.mono.` 的输出，若无则退化为 `outputs[0]`。

### 轮询与 SSE

- **优先 SSE**：存在 `taskId` 且任务为 queued/processing 时，前端使用 `EventSource(/api/tasks/{taskId}/events)` 订阅进度。
- **后端**：`GET /api/tasks/{task_id}/events` 以 SSE 流循环读取 DB 与 Redis 中的任务状态与进度，按约 1.5s 间隔推送；当状态为 `completed` 或 `failed` 时推送最终事件并结束流。
- **完成时**：收到 completed/failed 后关闭 EventSource，并**只请求一次** `GET /api/tasks/{id}/view` 拉取输出列表与错误信息。
- **回退**：SSE 连接失败（如网络或后端不可用）时，自动回退为 **5 秒轮询** `GET /api/tasks/{id}`，完成时同样只拉取一次 view。
- 处理中时的阶段提示文案刷新间隔与轮询间隔一致（5s）。

### 漏句与列表配置

为避免列表项被合并或遗漏（如英文 "Why subscribe?" 下列表翻译成中文后条数不一致）：

- **custom_system_prompt**：在 BabelDOC 的 `TranslationConfig` 中设置系统提示，强调「保留列表结构：每条列表项单独翻译，条数与原文一致，不要合并或遗漏任何一条」。
- **split_short_lines**：在适配层中启用 `split_short_lines=True`，便于短行（如列表项）单独翻译，减少合并导致的漏句。

以上配置见 `backend/app/babeldoc_adapter.py` 中的 `TranslationConfig` 构造。

### 去重翻译

- 同一用户、同一文档、同一语言对、同一页范围，若已有 `completed` 任务且存在输出文件，再次点击「翻译」时**直接复用**该任务，不创建新任务、不消耗额度。
- 实现：`POST /api/translate` 在创建任务前查询匹配的已完成任务，`page_range` 做规范化比较（`"7"` 与 `"7-7"` 等价）。
- 见 `backend/app/routes/tasks.py` 中 `create_translation_task` 与 `_normalize_page_range`。

### 翻译失败联系提示

- 当任务状态为 `failed` 时，除错误信息与重试提示外，展示联系邮箱：**hello@translatepdfonline.com**，便于用户反馈问题。
- 实现：`frontend/messages` 中 `home.translationFailedContact`、`home.translationFailedContactEmail`；`page.tsx` 在 `taskStatus === "failed"` 时渲染可点击的 mailto 链接。

### DeepSeek API 请求日志位置

- **DeepSeek API 调用发生在 Celery Worker 进程中**，不在 FastAPI 后端进程内。
- 终端中若只看到 `[backend]`、`[frontend]` 日志，说明当前运行的是 FastAPI + Next.js；Celery Worker 需单独启动（如 `celery -A app.celery_app worker` 或通过 `npm run dev:all` 的 worker 子进程）。
- 查看 DeepSeek 相关日志：在 **Celery Worker 所在终端** 中查看；BabelDOC 内部通过 `OpenAITranslator` 调用 DeepSeek，通常不会有逐条 HTTP 请求日志，但会有 `run_translation_task started/completed` 及异常堆栈。
- 若需调试 API 调用，可在 BabelDOC 或 `babeldoc_adapter` 中增加日志，或使用 `httpx`/`openai` 的 debug 模式。

### 译文预览中文乱码修复

- **现象**：译文 PDF 预览显示为方框（口）或 X，但复制粘贴时文本正确（中文）。
- **原因**：PDF.js 渲染 CJK 字符时需正确加载 cMap（字符映射），否则无法将 PDF 内字符码解码为 Unicode 字形。
- **前端修复**（`frontend/components/PdfViewerPane.tsx`）：
  1. **cMap 配置**：`Document` 传入 `options={{ cMapUrl, cMapPacked: true }}`，从 jsDelivr CDN 加载 `pdfjs-dist/cmaps/`。
  2. **SVG 渲染**：`Page` 使用 `renderMode="svg"`，部分环境下对 CJK 字体渲染更稳定。
  3. **TextLayer 字体回退**：`globals.css` 中为 `.textLayer span` 设置 `font-family` 包含 `PingFang SC`、`Microsoft YaHei`、`Noto Sans CJK SC` 等，作为补充。
- 若仍乱码，可检查 BabelDOC 输出 PDF 是否嵌入了支持中文的字体；BabelDOC 的 `resfont_map` 已为 `zh`/`zh-cn` 配置 `china-ss` 字体。

---

## CHANGELOG

| 日期 | 变更 |
|------|------|
| 2025-03 | 去重翻译：同一用户/文档/页范围复用已完成任务；`no_dual=True` 仅输出 mono；翻译失败时增加联系提示。 |
| 2025-03 | DeepSeek 日志说明：API 调用在 Celery Worker 中；译文预览中文乱码修复：cMap、renderMode=svg、TextLayer 字体回退。 |
