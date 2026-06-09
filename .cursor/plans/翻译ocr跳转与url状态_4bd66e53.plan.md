---
name: 翻译OCR跳转与URL状态
overview: 在翻译页为 no_paragraphs 与扫描类失败提供统一可点击 OCR 入口（query 带 document + target_lang，并避免覆盖 OCR 自动恢复逻辑）；从 upload 进入 translate/OCR 时从 URL 恢复语言；修复翻译页与 OCR 页上传新文件后 URL 未更新导致仍加载旧文档与 Hist 列表不刷新的问题（两页一并修）。
todos:
  - id: translate-ocr-cta
    content: TranslatePageClient：合并 no_paragraphs + 扫描失败为整块 OCR 按钮；query document + target_lang
    status: completed
  - id: translate-url-langs
    content: TranslatePageClient：从 searchParams 同步 source_lang / target_lang
    status: completed
  - id: upload-goocr-lang
    content: UploadPageClient：goOcr 仅要求 target_lang，query 与 OCR 契约一致
    status: completed
  - id: translate-upload-url-sync
    content: handleUploaded + update URL document/langs；Hist useEffect 依赖 documentId
    status: completed
  - id: ocr-upload-url-sync
    content: OcrTranslatePageClient：与翻译页相同 URL 同步 + Hist 依赖 documentId
    status: completed
isProject: false
---

# 翻译页 OCR 入口、Upload 语言透传、上传后旧文件残留

## 1. 翻译页：统一「去 OCR」按钮（no_paragraphs + 扫描类）

**现状**（[`TranslatePageClient.tsx`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\translate\TranslatePageClient.tsx)）：

- `no_paragraphs`：仅琥珀色 **`<p>`** 文案（[`isNoParagraphsFailure`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\translate\TranslatePageClient.tsx)）。
- 扫描相关：另有一块 **`isScanLikelyFailure`** 时才显示「Preprocess with OCR」按钮。

**目标**：

- 在 **`taskStatus === 'failed'`** 且 **`documentId` 存在** 时，若 **`isNoParagraphsFailure` 或 `isScanLikelyFailure`**（可抽成 `shouldOfferOcrRedirect`），将 **整块 UI 改为单个 `<button type="button">`**（或 `role="button"` 的 `<a>`）：内嵌显眼图标（如 `Languages` / `Scan`）+ 主文案（`no_paragraphs` 用 `tErrors('no_paragraphs')`，扫描类用 `scan_detected_use_ocr` 或合并一句新 i18n key，避免重复两段文字）。
- `onClick`：`router.push` 到 **`/ocrtranslator`**，query 至少 **`document=<documentId>`**、**`target_lang=<UILang>`**（来自 `targetLang` 或 `taskView?.task?.target_lang`）；**不传 `source_lang`**（与「OCR 无 source」一致；[`OcrTranslatePageClient`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\ocrtranslator\OcrTranslatePageClient.tsx) 已从 URL 读 `target_lang`，`source_lang` 可选）。
- **自动恢复**：OCR 页在 **URL 带 `document`** 时会 `setDocumentId(qDoc)`（约 391–395 行）；带 `task` 时走任务恢复。跳转时 **不要带 `task`**，避免误绑旧 OCR 任务；若需更强隔离，可加 **`recent=0`** 或新 query（如 `from_translate=1`）并在 OCR 的「最近任务 bootstrap」`useEffect` 中 **若存在 `document` query 则跳过** 最近任务恢复（当前逻辑在 `!searchParams.get(DOC_PARAM)` 才跑，一般已满足；实现时复核依赖数组，避免与 `documentId` 竞态）。

- 移除或合并与旧按钮重复的 **`isScanLikelyFailure` 独立按钮**（避免双按钮）。

---

## 2. Upload → Translate / OCR：语言不必二次选择

**现状**：

- [`UploadPageClient.tsx`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\upload\UploadPageClient.tsx) 已在 `goTranslate` / `goOcr` 里把 **`source_lang`、`target_lang` 写入 query**（约 89–93、124–128 行）。

**根因**：

- [`TranslatePageClient.tsx`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\translate\TranslatePageClient.tsx) **从未**从 `searchParams` 读取 `source_lang` / `target_lang` 写入 `sourceLang` / `targetLang`（与 OCR 页 [`OcrTranslatePageClient` 391–400 行](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\ocrtranslator\OcrTranslatePageClient.tsx) 对比）。

**改动**：

- 在 Translate 页增加与 OCR 类似的 **`useEffect`**：从 `searchParams` 读取 `source_lang` / `target_lang`（常量名与 upload 一致），用 [`toSupportedUiLang`](d:\imppro\translatepdfonline\frontend\src\shared\lib\translate-langs.ts) 规范化后 `setSourceLang` / `setTargetLang`（仅在当前为空或 URL 显式提供时更新，避免覆盖用户已手动改的选项，可按「若 query 有值则覆盖」产品偏好二选一，默认 **query 优先于空初始状态**）。

**OCR 入口（upload）**：

- [`goOcr`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\upload\UploadPageClient.tsx) 当前要求 `sourceLang && targetLang`；若产品确认 OCR 仅需目标语：**改为仅要求 `targetLang`**，query 只传 **`document` + `target_lang`**（与第 1 点一致）。

---

## 3. 翻译页：上传新文件后仍显示旧文件 / Hist 仍旧

**根因**：

- [`handleUploaded`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\translate\TranslatePageClient.tsx)（约 703–718 行）更新了 **`documentId` 等 state**，并 **`updateTaskInUrl(null)`** 只删 **`task`**；**未把新 `documentId` 写入 URL 的 `document` 参数**。
- 若 URL 仍保留 **旧 `document=`**，[`useEffect` 358–388 行](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\translate\TranslatePageClient.tsx) 会在 `searchParams` 变化或刷新后 **用旧 `docParam` 再次 `getDocument` 覆盖 state**，表现为「刷新后还是老文件」。
- **Hist & Log**：[`loadRecent` 的 `useEffect`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\translate\TranslatePageClient.tsx) 依赖项含 `taskId` / `taskStatus`，**不含 `documentId`**；文档切换后若未重新打开面板，列表不会随新文档刷新。

**改动**：

- 抽取 **`updateTranslateUrlQuery`**（或扩展 `updateTaskInUrl`）：在维护 `task` 的同时，**对 `document`（及可选 `source_lang` / `target_lang`）** 与当前 state 同步：`handleUploaded` 里 **`params.set(DOCUMENT_PARAM, docId)`**，并保留/写入当前 `source_lang` / `target_lang`，再 `router.replace`。
- **`loadRecent` 的 `useEffect`**：依赖数组增加 **`documentId`**（必要时在打开 Hist 时 `setRecentTaskPage(0)`），保证换文档后列表与当前上下文一致。

---

## 3b. OCR 页：是否存在同样问题？

**结论：存在同类问题，实现时应与翻译页一并修。**

依据 [`OcrTranslatePageClient.tsx`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\ocrtranslator\OcrTranslatePageClient.tsx)：

- [`handleUploaded`](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\ocrtranslator\OcrTranslatePageClient.tsx)（约 727–744 行）同样只调用 **`updateTaskInUrl(null)`**（[`updateTaskInUrl` 340–348 行](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\ocrtranslator\OcrTranslatePageClient.tsx) 仅增删 **`task`**），**未写入 URL 的 `document`**。整页刷新或依赖 URL 的导航会以旧 `document=` 为准，新上传文档易丢。
- **Hist & Log**：[`loadRecent` 的 `useEffect` 699 行](d:\imppro\translatepdfonline\frontend\src\app\[locale]\(translate)\ocrtranslator\OcrTranslatePageClient.tsx) 依赖为 **`[historyLogOpen, taskId, taskStatus, recentTaskPage, recentDocumentPage]`**，**不含 `documentId`**，换文档后列表可能仍显示旧数据。

OCR 页无翻译页那种「`docParam` 与 `documentId` 不一致时 `getDocument(docParam)` 覆盖 state」的独立 effect（仅有 `qDoc && !documentId` 时 `setDocumentId`），但 **URL 与 state 不同步** 在 **刷新 / RSC 重载** 下仍会导致错误文档，故 **URL 同步 + Hist 依赖** 必须与翻译页一起做。

**改动**（与 §3 同构，可抽公共 `buildTranslateQueryParams` 或各页复制小函数）：

- `handleUploaded`：`router.replace` 时 **`params.set(DOC_PARAM, docId)`**，保留 `target_lang` / 可选 `source_lang`，清 `task`。
- `loadRecent`：`useEffect` 依赖增加 **`documentId`**。

---

## 4. 验证建议

- Upload 选语言 → Translate：地址栏含 `document`+语言，表单预选正确。
- Upload → OCR：仅 `target_lang`（若改 goOcr），OCR 页目标语正确、无强制 source。
- Translate 页失败 `no_paragraphs`：整卡可点，跳转后 OCR 为正确文档与目标语。
- 翻译页内二次上传：地址栏 `document` 更新，预览与 Hist 为新文件。
- OCR 页内二次上传：同上（地址栏、预览、Hist 与当前文档一致）。
