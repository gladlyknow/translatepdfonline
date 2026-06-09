---
name: 翻译OCR提示与OCR顶栏
overview: 翻译页在任意任务阶段（有文档即可）展示简洁温馨的 OCR 提示与跳转；OCR 侧栏 S|T|P 按产品 3.1 固定单行紧凑布局；对齐 OcrParseWorkbench 在「无解析 / 加载中 / 已加载」三态下的侧栏工具区结构；侧栏 Text edit / Font settings / File 分区固定不随滚动消失，且解析 JSON 未就绪前即挂载占位（与后续仅切换 disabled 一致）。
todos:
  - id: translate-ocr-always
    content: TranslatePageClient：有 documentId 即展示简洁 OCR 提示+Link（解耦 completed）；新短文案 10 语言 task.json；与 suggest_try_ocr 强调态合并策略
    status: completed
  - id: ocr-stp-row
    content: OcrTranslatePageClient：S|T|P 改为全宽 grid-cols-3 / flex 单行 min-w-0，行高约等于主 CTA，符合 plan §3.1
    status: completed
  - id: workbench-chrome-parity
    content: OcrParseWorkbench：左栏外置模式下空顶栏不渲染或补 disabled 顶栏占位；OcrTranslatePageClient 侧栏硬编码 focus 文案改 i18n
    status: completed
  - id: verify-tsc
    content: frontend tsc + 手测窄屏与任务各状态
    status: completed
  - id: ocr-toolbar-sticky-initial
    content: OCR 侧栏 #ocr-workbench-toolbar-host：Text edit / Font settings / File 固定（sticky 或侧栏内 flex 分区仅下方可滚）；解析加载前即渲染完整分区骨架（disabled），不依赖 loadState===ok 才 portal
    status: pending
isProject: false
---

# 翻译页常驻 OCR 提示 + OCR 顶栏 3.1 与控件一致性

## 背景与目标

- **需求 1**：翻译页**不论任务是否完成**（queued / processing / completed / failed 等），只要有可跳转上下文，就应展示**温馨、简洁、高效**的 OCR 提示 + 跳转按钮（沿用 [`buildOcrWorkbenchSearch`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx)：`document`、`source_lang`、`target_lang`、可选 `page_range` / `doc_pages`）。
- **需求 2**：与 [fc_完成提示与_ocr_页范围_73e2eaaf.plan.md](d:/imppro/translatepdfonline/.cursor/plans/fc_完成提示与_ocr_页范围_73e2eaaf.plan.md) **§3.1** 对齐，并消除 **OCR 任务开始后**（无/加载解析 JSON）与 **解析完成后**（画布可用）侧栏「控件集」观感不一致。

---

## 1. 翻译页：常驻 OCR 提示 + 文案

**现状**：提示块写在 [`TranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx) 的任务状态卡片内，且条件为 `taskStatus === 'completed' && documentId && !preprocess_with_ocr`（约 1278–1335 行），未完成时不会出现。

**调整**：

- **展示条件**：在「有 `documentId`」且用户已具备跳转意义时即展示，例如：
  - `documentId` 存在；
  - 语言：`sourceLang`/`targetLang` 或 `taskView?.task` 上的 `source_lang`/`target_lang` 能解析出合法 UI 语言（与现有 `buildOcrWorkbenchSearch` 一致）；
  - **可选**：若当前任务 `preprocess_with_ocr === true`，仍显示跳转但改用**更短**一句（避免与「译前已 OCR」矛盾），或按产品选择仍给同一入口（计划中可写死一种策略）。
- **位置**：建议放在 **「有文档」主工作区**（[`TranslationForm`](d:/imppro/translatepdfonline/frontend/src/shared/components/translate/TranslationForm.tsx) 附近或上传卡下方），与「仅在有 `taskId` 时显示的任务状态卡片」解耦，这样**无任务 / 排队中**也能看到 OCR 入口；若希望与进度同卡，也可保留在侧栏但去掉 `taskStatus === 'completed'` 限制。
- **样式**：单行或两行以内为主：**一行标题 + 一行说明 + 小按钮/链接**；色调统一柔和（如 zinc/sky 轻底），避免与 `failed` 琥珀警示抢层级。
- **文案**：在 [`frontend/src/config/locale/messages/*/translate/task.json`](d:/imppro/translatepdfonline/frontend/src/config/locale/messages/en/translate/task.json) 新增**更短**键（例如 `ocrJumpHintTitle` / `ocrJumpHintBody`，CTA 可复用 `suggestOcrHintCta` 或更短 `ocrJumpCta`），**十种语言**（en/zh/ja/ko/de/fr/es/it/ru/el）全部补齐；保留 `suggest_try_ocr` 时的略强调样式可选用现有 `suggestOcrHint*` 或单独一行「译后建议」以免与常驻条重复堆叠（若同时出现，可合并为一条：门闸时仅强调副文案）。

---

## 2. OCR 页 §3.1：S | T | P 单行顶栏

**规格来源**：[fc_完成提示与_ocr_页范围_73e2eaaf.plan.md](d:/imppro/translatepdfonline/.cursor/plans/fc_完成提示与_ocr_页范围_73e2eaaf.plan.md) §3.1 —— 在 Source/Target 区域**正下方**一行，高度约等于主 CTA；**三列 S | T | P**；P 使用原生 `placeholder`（多语言）。

**UI 落点（已钉死，避免歧义）**：S|T|P 放在 **左侧侧栏「上传 + 语言 + 页范围」卡片内**，作为与主 CTA 同卡的一行三列；**不**放在主区双栏（源 PDF / JSON）上方的全宽第二条顶栏。若未来产品改为主区全宽条，再改 [`OcrTranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx) 主网格布局。

**现状（与仓库同步，2026）**：[`OcrTranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx) 侧栏上传卡内已为 **`grid grid-cols-3`** + 各列 `min-w-0`，**全断点单行**，P 为 `min-h-[36px]` 与主按钮行高对齐；旧版「`grid-cols-2` + `col-span-2`」描述已废弃。

**调整**（已完成 / 维护时对照）：

- 保持 **全断点 `grid-cols-3`**（或等价 `flex` + `min-w-0 flex-1`），**禁止** `col-span-2` 导致折行。
- 文案键：[`ocrWorkbench.json`](d:/imppro/translatepdfonline/frontend/src/config/locale/messages/en/translate/ocrWorkbench.json) 的 `sourceColumnShort`/`targetColumnShort`/`pageRangeColumnShort` 与 `ocrPageRangePlaceholder`。

---

## 3. OCR 工作台：三态控件集对齐

**问题**：[`OcrParseWorkbench.tsx`](d:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/OcrParseWorkbench.tsx) 在 `!parseResultUrl` / `loading|idle` / `error` 时走 `renderStatusWithToolbar`（已含侧栏 portal 的 `toolbarContent`）；`loadState === 'ok'` 时走主 `return`，顶部有 `border-b` 工具条（`showTopPageControls` / `showTopFileActions`）。在 **`toolbarPosition="left"` + `hideSourcePanel`**（OCR 页用法）下，`showTopPageControls` 与 `showTopFileActions` 均为 false，主分支顶部条**为空但仍占 `pb-2` 边框槽**，与早期「仅中间状态 + 侧栏 portal」的垂直节奏不一致，且用户感知为「控件集变了」。

**调整方向**（按投入由小到大，实施时二选一或组合）：

1. **轻量**：当 `showLeftToolbar && hideSourcePanel` 且顶部条无任何子内容时，**不渲染**该 `border-b` 容器（或 `hidden`），使主区域与 `renderStatusWithToolbar` 的留白一致。
2. **中量**：抽一小段 **「外置左栏模式下的顶栏占位」**（disabled 的上一页/下一页/页码 + 与 `fileControls` 同高的占位导出按钮），在 `!parseResultUrl` 与 `loading` 时也通过 **同一 portal 或同一结构** 呈现，保证侧栏+主区与完成后结构一致（按钮一律 disabled 直至 `doc` 可用）。
3. **侧栏重复项**：[`OcrTranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx) 侧栏「Pages」里仍有 `JSON focus` / `Source focus` 等硬编码英文（约 1372–1373 行），应改为 `translate.ocrWorkbench` 的 i18n键，避免与主工作台术语不一致。

验收：上传后未出解析前，侧栏 `#ocr-workbench-toolbar-host` 内区块与解析完成后的 **边框、间距、分区标题** 一致；主区仅中间状态文案变化；**无解析完成前后侧栏控件「突然多出一整块」或「整块消失」的跳变**（允许按钮从 disabled 变为可用）。

---

## 4. 侧栏工具栏：Text edit / Font settings / File 固定 + 首屏即加载（新增）

**产品要求**（迭代补充）：

1. **固定**：「Text edit」「Font settings」「File」三块（[`ParseResultEditorToolbar`](d:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/parse-result-editor-toolbar.tsx) 内对应 `sectionIds` 分区）**不随右侧主区或侧栏其余内容滚动而滚出视口**。
2. **首屏即现**：控件集在 **JSON 解析尚未完成（loading / idle）时即应出现**（可为全 disabled 或与现有 `renderStatusWithToolbar` 中占位一致），**不要**等 `loadState === 'ok'` 才首次出现侧栏工具结构。

**现状要点**（便于实施时对照）：

- 工具栏通过 [`OcrParseWorkbench.tsx`](d:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/OcrParseWorkbench.tsx) 的 `createPortal` 注入 [`OcrTranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx) 的 `#ocr-workbench-toolbar-host`；`externalToolbarHost` 的 `useEffect` 依赖含 `loadState`、`parseResultUrl`（约 1047–1053 行），可能与「宿主节点查找时机」或侧栏 **`md:overflow-y-auto` / `max-h`** 组合导致 **滚动时整块工具栏跟着走** 或 **晚挂载** 的体感。
- `fileControls`（含导出等）在 `doc` 未就绪时可为 disabled，但 **分区标题与壳** 应一致存在。

**建议实现方向**（实施时择一或组合）：

- **布局**：侧栏改为 **上固定区（工具栏 host）+ 下可滚区**（上传、Pages、任务卡等），或给 `#ocr-workbench-toolbar-host` 增加 `sticky top-* shrink-0` 且限制其**自身**不进入可滚父级的滚动流（避免与 `order-last` 的 Pages 等挤在同一滚动容器内被一起卷走）。
- **挂载时机**：保证 `parseResultUrl` 一旦存在即 portal **loading 态也渲染** `ParseResultEditorToolbar`（已有 `toolbarContent` + `renderStatusWithToolbar` 路径时需核对：**主 return 分支**是否在 `loadState === 'ok'` 前未 portal，导致「只有 ok 后才有 File 区」）；必要时在 **父组件** 对 host 内预置静态壳，子组件仅 hydrate 行为。
- **验收**：解析请求进行中即可看到三区块标题与禁用控件；纵向滚动侧栏或缩放窗口时，三区块相对视口或侧栏顶部 **保持可见**（与右侧画布滚动解耦）。

---

## 5. 测试与回归

- 翻译页：无任务 / 排队 / 失败 / 完成四种状态下，OCR 条显示与链接 query 正确（含从 URL 恢复的 `document`）。
- OCR 页：窄视口（如 360px）下 S|T|P **仍一行**；`page_range` query 预填仍正常。
- OCR 页：解析 loading 时侧栏已显示 **Text edit / Font settings / File**；滚动侧栏时上述区域 **固定不消失**。
- `pnpm exec tsc --noEmit`（[`frontend`](d:/imppro/translatepdfonline/frontend)）与关键路径手测。
