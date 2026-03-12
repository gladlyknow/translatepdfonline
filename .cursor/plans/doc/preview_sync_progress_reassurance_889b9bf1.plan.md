---
name: Preview sync progress reassurance
overview: 解决对比预览时译文默认页码与源文不同步、进度展示过于粗糙、以及长时间等待时缺少安抚文案三个问题。
todos: []
isProject: false
---

# 对比预览与翻译等待体验改进

## 现状简述

- **预览**：左侧 Source 与右侧 Translation 共用 `currentPage` 与 `targetPageInPdf`。当用户选择了翻译页（如 7-10）时，`currentPage` 初始为 1，且 `targetPageInPdf = currentPage - pageRange[0] + 1`，导致右侧显示的是译文 PDF 第 1 页（如封面），而不是与源文第 7 页对应的译文。
- **进度**：前端仅根据 `status` 做三段式进度（queued 20%、processing 65%、completed 100%），无阶段/页码信息；后端 [TaskDetail](backend/app/schemas.py) 无进度字段，Worker 也未上报细粒度进度。
- **等待安抚**：任务状态区只有“排队中/处理中”和阶段文案（预处理、翻译中、生成 PDF），缺少“后台正在处理、可先做别的事”类提示。

---

## 1. 翻译预览默认从「翻译页」开始，且左右页码一致

**目标**：选择翻译页时，默认预览从该范围起始页开始；选择「全部」时从第 1 页开始；左右 pane 在“已翻译页”上页码对应，能直接看到已翻译页。

**实现要点**：

- **[frontend/app/[locale]/page.tsx](frontend/app/[locale]/page.tsx)**  
  - **默认起始页**：在拿到 `taskView` 且任务为 `completed`、有 `page_range` 时，若当前为“首次完成”或希望重置到默认，将 `currentPage` 设为 `pageRange[0]`；无 `page_range`（全部数据）时保持 1。可用 `useEffect` 在 `taskStatus === "completed" && taskView?.task.page_range != null` 时设置一次初始 `currentPage = pageRange[0]`，并避免覆盖用户已手动翻过的页（例如用 ref 记录“是否已由用户改过页”，仅在不曾改过时设默认）。
  - **译文页码与源文一致**：BabelDOC 在指定 `page_range` 时仍输出与源文档同结构的全文 PDF（仅部分页被翻译），因此译文 PDF 的“第 N 页”对应源文“第 N 页”。将 `targetPageInPdf` 改为：在 `isPageTranslated` 时为 `currentPage`（与源文同页），而不是 `currentPage - pageRange[0] + 1`。这样当源文在 7/496 时，右侧也显示译文 7/495，用户能直接看到该页的翻译结果。
  - **右栏翻页**：`handleRightPageChange` 在全文模式下为 `setCurrentPage(p)`；在范围模式下，右栏显示的是“译文中的第 p 页”，应对应源文第 `pageRange[0] + p - 1` 页，即 `setCurrentPage(pageRange[0] + p - 1)`。当前逻辑已是这样，在把 `targetPageInPdf` 改为 `currentPage` 后，右栏页码与左栏一致，翻页仍用同一套 `currentPage` 即可（左改 currentPage，右用 targetPageInPdf=currentPage 显示同一页）。

**注意**：若未来 BabelDOC 对部分页翻译改为“只输出翻译页的 PDF”（页数=范围长度），则需后端告知输出类型，前端再在“全文输出”与“仅范围页”两种模式下分别用 `currentPage` 或 `currentPage - pageRange[0] + 1` 计算 `targetPageInPdf`。当前按全文输出实现即可。

---

## 2. 进度栏更详细（最好能体现「某页」进度）

**目标**：进度条不仅显示百分比，还能在“翻译中”阶段显示当前阶段名与“第 X/Y 页”或“第 X/Y 段”等，让用户知道正在处理哪一页/哪一阶段。

**实现要点**：

- **后端**  
  - **进度存储**：Worker 在运行 BabelDOC 时能拿到细粒度进度（阶段名、stage_current、stage_total、overall_progress）。建议用 **Redis** 存进度，key 如 `task_progress:{task_id}`，value 为 JSON：`{ "stage", "stage_current", "stage_total", "overall_progress" }`，TTL 与任务保留策略一致（如 1 天）。  
  - **Worker 上报**：BabelDOC 的 [ProgressMonitor](tmp/BabelDOC-main/babeldoc/progress_monitor.py) 支持 `progress_change_callback`；[high_level.translate](tmp/BabelDOC-main/babeldoc/format/pdf/high_level.py) 目前写死无 callback。需在 **tmp/BabelDOC-main** 中为同步 `translate()` 增加可选参数（如 `progress_callback`），在创建 `ProgressMonitor` 时传入，使 `progress_update` 等事件能回调出来。在 [babeldoc_adapter.run_translate](backend/app/babeldoc_adapter.py) 里传入一个 callback，在 callback 内将 `stage`、`stage_current`、`stage_total`、`overall_progress` 写入 Redis。  
  - **API**：在 [GET /tasks/{task_id}](backend/app/routes/tasks.py) 返回的 [TaskDetail](backend/app/schemas.py) 中增加可选字段，例如：`progress_percent: Optional[float]`、`progress_stage: Optional[str]`、`progress_current: Optional[int]`、`progress_total: Optional[int]`。处理请求时从 Redis 读取并填入；若 Redis 无则用 `status` 推导简单百分比（与现有逻辑一致）。  
  - **任务结束时**：Worker 在 `completed`/`failed` 后删除或过期该 Redis key，避免长期占用。
- **前端**  
  - 轮询仍用现有 `getTask(taskId)`；若接口返回了 `progress_stage` / `progress_current` / `progress_total`，则：  
    - 进度条宽度用 `progress_percent ?? taskProgress`。  
    - 在进度条下方或右侧展示文案，如“正在翻译（第 12/50 页）”或“Layout 解析（第 3/10 页）”，具体文案可据 `progress_stage` 做 i18n 映射。
  - 若暂时不接 BabelDOC 回调（不改 tmp 或 Redis），可先做“阶段化”展示：根据已有时长与 `phaseMessage` 显示“预处理 / 翻译中 / 生成 PDF”，并配合安抚文案（见下），进度条仍用现有 20/65/100%。

**可选简化**：若不想改 BabelDOC 源码，可仅在后端用“阶段+时间”做估算（如 processing 前 15s 显示“预处理”，之后显示“翻译中…”），不提供真实“第 X/Y 页”，待后续再接 ProgressMonitor 回调。

---

## 3. 长时间等待的安抚提示（类似 Deep Search）

**目标**：在任务为 queued 或 processing 时，明确提示“任务已在后台处理，您可以先处理别的事”，减轻焦虑。

**实现要点**：

- **文案**（需加 i18n）：  
  - 在 [frontend/messages/zh.json](frontend/messages/zh.json)、[en.json](frontend/messages/en.json)、[es.json](frontend/messages/es.json) 的 `task` 或 `home` 下增加键，例如：  
    - `backgroundTaskHint`: "任务已在后台开始处理，您可以关闭此页或处理其他事项，完成后回来查看即可。"  
    - `longTaskHint`: "长文档翻译可能需要数分钟，请耐心等待。"
  - 在任务状态区块（[page.tsx](frontend/app/[locale]/page.tsx) 中展示进度条与阶段信息的同一区域），当 `taskStatus === "queued" || taskStatus === "processing"` 时，在进度条下方增加一两行小字：先显示 `backgroundTaskHint`，若 `elapsedSeconds > 30` 或 `taskStatus === "processing"` 再追加 `longTaskHint`（可按需调整阈值）。
- **视觉**：可用较柔和的颜色（如 `text-zinc-500`）与较小字号，与“当前状态 / 阶段”区分，不喧宾夺主。

---

## 依赖与顺序

- **1（预览）**：仅改前端，与 2/3 无依赖，可先做。  
- **2（进度）**：依赖后端 Redis + 可选 BabelDOC 修改；前端可先接 `progress`_* 字段并做展示，后端可先返回基于 status 的简单 progress，再逐步接入 BabelDOC 回调。  
- **3（安抚）**：仅文案 + 前端展示，与 1 可并行。

---

## 涉及文件一览


| 区域                   | 文件                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 预览默认页 + 译文页码         | [frontend/app/[locale]/page.tsx](frontend/app/[locale]/page.tsx)                                                                                                        |
| 进度 API + Redis       | [backend/app/routes/tasks.py](backend/app/routes/tasks.py)、[backend/app/schemas.py](backend/app/schemas.py)、[backend/app/config.py](backend/app/config.py)（若需 Redis 连接） |
| Worker 上报进度          | [backend/app/tasks_translate.py](backend/app/tasks_translate.py)、[backend/app/babeldoc_adapter.py](backend/app/babeldoc_adapter.py)                                     |
| BabelDOC 可选 callback | [tmp/BabelDOC-main/babeldoc/format/pdf/high_level.py](tmp/BabelDOC-main/babeldoc/format/pdf/high_level.py)                                                              |
| 进度展示 + 安抚文案          | [frontend/app/[locale]/page.tsx](frontend/app/[locale]/page.tsx)                                                                                                        |
| i18n                 | [frontend/messages/zh.json](frontend/messages/zh.json)、[en.json](frontend/messages/en.json)、[es.json](frontend/messages/es.json)                                        |


