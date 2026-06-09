---
name: Online对齐彻底修复
overview: 按你的要求仅参照 onlinepdftranslator 实现，集中修复首页 History 交互、OCR workbench 控件移植与固定、以及 export_outputs exceededCpu 的根因（内联导出迁移为独立导出队列流程）。
todos:
  - id: landing-history-drawer-align
    content: 首页 Header History 对齐抽屉交互并接入 history drawer context
    status: completed
  - id: ocr-workbench-remove-placeholder-panel
    content: 移除 OCR 侧栏伪控件入口，统一以真实 workbench 工具栏作为唯一控件入口
    status: completed
  - id: ocr-workbench-fixed-toolbar-online-style
    content: 按 online 风格固定 OCR workbench 工具栏并按类型划分左侧区域，删除重复 Document 文件名展示
    status: completed
  - id: ocr-export-queue-model-migration
    content: 将 OCR 内联 export_outputs 迁移为 online 风格独立导出队列与状态模型
    status: completed
  - id: ocr-export-download-api-alignment
    content: 对齐 online 的导出状态查询与下载签名链路，前端改为导出就绪后下载
    status: completed
  - id: disable-cron-empty-scan
    content: 彻底取消 consumer 的空扫 cron，改为仅队列/API 触发并加部署后校验
    status: completed
  - id: regression-and-observability
    content: 完成类型检查、UI 回归与队列日志验收，确认 exceededCpu 消失
    status: completed
isProject: false
---

# Online 对齐彻底修复计划

## 目标
- 首页页首 `History` 点击行为改为“展开历史选择框/抽屉”，不再直接跳转 `upload`。
- OCR 页移除“仅文字提示”的伪控件入口，按 `onlinepdftranslator` 的 workbench 控件集落地并固定展示。
- OCR 左侧控件区按类型重新分区（Credits / Pages / File / Language+Submit / Task），并删除重复的 `Document 文件名` 展示。
- 彻底解决 OCR `export_outputs` 阶段 `exceededCpu`：停止在 OCR 阶段内联 pdf-lib 导出，迁移到 online 风格的独立导出队列 + 下载链路。
- 彻底取消 `translatepdfonline-quenues-dev` 的空扫行为（`* * * * *` 定时查库）。

## 根因确认
- 首页 Header 与翻译壳层 Header 是两套体系；首页未接 `TranslateHistoryDrawerProvider`，`History` 仅是普通链接。
- OCR 页同时存在“侧栏文字入口块”和真实 workbench 工具栏，用户视觉上只见文字；且任务未完成时工具栏未挂载导致按钮无效。
- `export_outputs` 当前在 `ocr-queue` 中直接调用 `markdownToSimplePdfBytes`（pdf-lib + fontkit + 字体子集 + 全文排版循环），CPU 密集；并且存在主 Worker 回退执行路径，导致 `exceededCpu` 反复出现。

## 实施步骤

### 1) 首页 History 行为对齐（抽屉优先）
- 在落地页布局树引入与翻译壳相同的历史抽屉上下文：
  - [D:/imppro/translatepdfonline/frontend/src/themes/default/layouts/landing.tsx](D:/imppro/translatepdfonline/frontend/src/themes/default/layouts/landing.tsx)
  - [D:/imppro/translatepdfonline/frontend/src/shared/contexts/translate-history-drawer.tsx](D:/imppro/translatepdfonline/frontend/src/shared/contexts/translate-history-drawer.tsx)
- 首页 Header 的 `History` 从 `Link` 改为按钮逻辑：优先 `openHistory()`，无上下文再 fallback。
  - [D:/imppro/translatepdfonline/frontend/src/themes/default/blocks/header.tsx](D:/imppro/translatepdfonline/frontend/src/themes/default/blocks/header.tsx)
- 清理 landing 导航中 `History` 的跳转依赖，避免再次直跳 `/upload#translate-history`：
  - [D:/imppro/translatepdfonline/frontend/src/config/locale/messages/en/landing.json](D:/imppro/translatepdfonline/frontend/src/config/locale/messages/en/landing.json)
  - [D:/imppro/translatepdfonline/frontend/src/config/locale/messages/zh/landing.json](D:/imppro/translatepdfonline/frontend/src/config/locale/messages/zh/landing.json)

### 2) OCR workbench 控件“真移植 + 固定 + 去伪入口”
- 删除 OCR 左栏“Editing and font controls / Open Text edit / Open Font settings”伪入口块，避免与真实控件重复：
  - [D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx)
- 以 online 的 workbench 布局对齐：让真实 `ParseResultEditorToolbar` 成为唯一入口，并固定在工作台左侧（不随源预览/JSON 区滚动）。
  - [D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/OcrParseWorkbench.tsx](D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/OcrParseWorkbench.tsx)
  - [D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/parse-result-editor-toolbar.tsx](D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/parse-result-editor-toolbar.tsx)
- 文案与可用性收口：未选块时显示明确可操作提示，禁用态不再“像没渲染”。
  - [D:/imppro/translatepdfonline/frontend/src/config/locale/messages/zh/translate/ocrWorkbench.json](D:/imppro/translatepdfonline/frontend/src/config/locale/messages/zh/translate/ocrWorkbench.json)
  - [D:/imppro/translatepdfonline/frontend/src/config/locale/messages/en/translate/ocrWorkbench.json](D:/imppro/translatepdfonline/frontend/src/config/locale/messages/en/translate/ocrWorkbench.json)
- 左侧区域按类型重排并收口（与你给的目标分区一致）：
  - 分组顺序：`Credits` → `Pages` → `File(Upload/Delete/Size/UploadedAt)` → `Language+Submit` → `Task Status`
  - 删除上方重复 `Document 文件名` 行，仅保留上传区内文件名展示
  - 目标文件：  
    [D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx)  
    [D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx)

### 3) export_outputs 根治：严格按 online 导出/下载模型迁移
- 从 OCR 主流水线中移除“内联 PDF 导出”，`ocr`/`translate` 结束后只沉淀可导出输入（markdown / parse json），再进入导出子流程。
  - [D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts](D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts)
  - [D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-translate.ts](D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-translate.ts)
- 引入 online 风格导出作业链路（pending/processing/ready/failed、日志、重试、取消、stale）：
  - 新增/迁移导出模型与服务（参照 `online` 的 `translator_job_export` 与 `process-job-export`）
  - 新增导出 API（创建导出、轮询状态、下载 URL）
- 导出执行改为独立队列消息（类似 `export_generate`）在 consumer 中处理，避免 OCR queue invocation 内 CPU 峰值。
  - [D:/imppro/translatepdfonline/frontend/workers/ocr-pipeline-consumer/src/index.ts](D:/imppro/translatepdfonline/frontend/workers/ocr-pipeline-consumer/src/index.ts)
  - [D:/imppro/translatepdfonline/frontend/wrangler.consumer.develop.jsonc](D:/imppro/translatepdfonline/frontend/wrangler.consumer.develop.jsonc)
  - [D:/imppro/translatepdfonline/frontend/wrangler.consumer.jsonc](D:/imppro/translatepdfonline/frontend/wrangler.consumer.jsonc)
- 下载链路改为“导出就绪后签名下载”（online 同构），任务 view 仅承载任务态，不再假定 completed 即必有 PDF。
  - [D:/imppro/translatepdfonline/frontend/src/app/api/tasks/[taskId]/view/route.ts](D:/imppro/translatepdfonline/frontend/src/app/api/tasks/[taskId]/view/route.ts)
  - [D:/imppro/translatepdfonline/frontend/src/shared/lib/translate-api.ts](D:/imppro/translatepdfonline/frontend/src/shared/lib/translate-api.ts)
  - [D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx)

### 4) 彻底取消空扫 cron（项目级）
- 去除 consumer wrangler 的 `triggers.crons`，避免每分钟无任务查库：
  - [D:/imppro/translatepdfonline/frontend/wrangler.consumer.develop.jsonc](D:/imppro/translatepdfonline/frontend/wrangler.consumer.develop.jsonc)
  - [D:/imppro/translatepdfonline/frontend/wrangler.consumer.jsonc](D:/imppro/translatepdfonline/frontend/wrangler.consumer.jsonc)
- 在 consumer `scheduled()` 保留显式开关保护（默认禁用），确保误配 cron 时也不扫库：
  - [D:/imppro/translatepdfonline/frontend/workers/ocr-pipeline-consumer/src/index.ts](D:/imppro/translatepdfonline/frontend/workers/ocr-pipeline-consumer/src/index.ts)
- 部署后验收：日志中不再出现周期性 `cron_dispatch {"processed":0...}`。

### 5) 回归与验收
- 类型与静态检查：`pnpm tsc --noEmit`，改动文件 lint。
- 交互回归：
  - 首页 `History` 点击直接开抽屉（不跳 upload）。
  - OCR 工具栏为真实控件集，固定可见，不随源预览/JSON 区滚动；左侧分区按目标顺序展示。
  - OCR `Document` 上方重复文件名已移除，仅上传区展示文件名。
  - `Hist & Log` 默认每区块仅展示 `3` 条，容器不出现内部滚动条，仅通过分页 `Prev/Next` 查看更多。
- 队列回归：
  - OCR 阶段日志不再在 `export_outputs` 内触发 `exceededCpu`。
  - 导出日志独立可观测（queued/processing/ready/failed）。
  - 下载仅在导出 ready 后可用，失败可重试。
  - 不再出现 consumer 空扫日志（无任务时无周期性 `cron_dispatch processed=0`）。

## 补充实现约束（你本次新增）
- `Hist & Log` 三个区块（Runtime logs / Recent tasks / Uploaded files）统一采用“每页 3 条 + 无内部滚动 + 分页切换”。
- 分页控件保留在区块底部，不使用 `overflow-y-auto` 类滚动容器承载列表主体。
- `ocrtranslator` 左侧 `Pages` 区域保持在最下方，但与其上方分区保持紧凑排布，不保留视觉空白占位区（避免“底部大片留白”）。

## 风险与控制
- 本次是“严格对齐 online”的结构性迁移，涉及数据模型/API/前端状态机联动；先完成最小闭环（PDF 导出 + 下载），再补齐 html/docx/md。
- 迁移期间保持旧字段只读兼容一段时间，避免线上已有任务不可见。