---
name: Frontend upload and translation UI
overview: 前端调整：上传区说明与删除确认、翻译表单页码示例与对比强化；源/目标语言默认置空，仅可选从 PDF 首页检测源语言，未选语言时「开始翻译」禁用（灰）；全部适配中英西多语言。
todos: []
isProject: false
---

# 前端上传区与翻译表单调整

## 1. 文件上传栏：说明文案 + 删除确认

### 1.1 上传区下方增加文件说明

- **位置**：`[frontend/app/[locale]/page.tsx](frontend/app/[locale]/page.tsx)` 中，在 `UploadDropzone` 下方、当前文档行上方，新增一行说明文案。
- **文案**：🛡️ 您的文件将进行加密传输。默认保存 7 天供您下载，之后系统将永久物理删除。
- **实现**：
  - 在 [ UploadDropzone ] 与 `{documentId && filename && (...)}` 之间插入一个 `<p>`，使用 `useTranslations("upload")` 的新 key，例如 `fileNotice`。
  - 样式：小号字、次要色（如 `text-zinc-500 dark:text-zinc-400`），与当前文档行视觉区分。

### 1.2 文件列表操作项与删除确认

- **按钮文案**：将当前「删除文档」改为更明确的「立即彻底删除」类文案（新 key，如 `home.deleteDocumentPermanently`），在 [page.tsx](frontend/app/[locale]/page.tsx) 中沿用现有删除按钮结构。
- **确认提示**：在 `handleDeleteDocument` 中，在调用 `api.deleteDocument` 之前增加确认步骤：
  - 使用 `window.confirm(tHome("deleteDocumentConfirm"))`，或如需统一风格可做简单模态（优先 confirm 以缩小改动）。
  - 仅当用户确认后再执行删除与状态清理。
- **i18n**：
  - 在 [zh.json](frontend/messages/zh.json)、[en.json](frontend/messages/en.json)、[es.json](frontend/messages/es.json) 的 `upload` 下增加 `fileNotice`。
  - 在 `home` 下增加 `deleteDocumentPermanently`（按钮文案）、`deleteDocumentConfirm`（确认框文案：「此操作不可逆，文件将从服务器完全抹除」及英/西译文）。

---

## 2. Translation 页码输入：可见示例与尺寸

- **问题**：`aria-label` 仅对读屏可见，输入框 placeholder 或尺寸不足时，用户看不到「如 1-10」的说明。
- **修改文件**：`[frontend/components/TranslationForm.tsx](frontend/components/TranslationForm.tsx)`
  - **Compact 模式**（约 96–102 行）：
    - `placeholder` 改为**明显示例**：如 `1-10` 或 `1, 3, 5-10`，用翻译 key（如 `translate.pageRangeExample`）以便多语言，例如中文「例如 1-10」，英文 "e.g. 1-10"。
    - 将页码输入框宽度从 `w-24` 调整为更宽（如 `min-w-[8rem]` 或 `w-32`），确保示例和输入都可见。
  - **非 compact 模式**（约 137–144 行）：同样为 input 设置清晰的 `placeholder`（使用同一 `pageRangeExample` 或组合 `pageRange` + 示例）。
- **i18n**：在 `translate` 下增加 `pageRangeExample`（zh: "例如 1-10"，en: "e.g. 1-10"，es: "ej. 1-10"），保留原有 `pageRange` 作为标签/说明。

---

## 3. 源语言 / 目标语言默认置空 + 源语言可选检测 + 按钮禁用

### 3.1 默认状态与类型

- **源语言（source language）**：默认**置空**（不选）。类型改为 `UILang | ""`（或 `null`），下拉增加空选项（如「请选择源语言」）。
- **目标语言（target language）**：默认**置空**。同样增加空选项（如「请选择目标语言」），避免用户误用默认值选错。
- **实现**：在 [TranslationForm.tsx](frontend/components/TranslationForm.tsx) 中，`useState<UILang>` 改为可空（如 `useState<UILang | "">("")`）；[LanguageSelector](frontend/components/LanguageSelector.tsx) 支持 `value=""` 时显示占位 option，并增加 i18n key（如 `translate.selectSourceLang` / `translate.selectTargetLang`）。

### 3.2 源语言：PDF 首页检测（可选填充）

- **有 File 时（刚上传）**：当 `sourceFileRef?.current` 存在且 `documentId` 已设置时，用 **pdf.js** 获取第 1 页文本，再用前端语言检测库（如 `franc`）得到语种代码，映射到 `UILang` 后 `setSourceLang`。检测放在 `useEffect` 中，异步执行。
- **检测难度过大时**：若文本过短、无法识别或置信度低，**不填充**，保持源语言为空。
- **仅 documentId（如刷新后）**：不做检测，源语言保持为空；用户必须手动选择。

### 3.3 「开始翻译」按钮：未选语言时禁用

- **规则**：仅当**源语言**与**目标语言**均已被用户选择（非空）时，才允许点击「开始翻译」。
- **实现**：`submitDisabled` 增加条件：`submitting || taskInProgress || !sourceLang || !targetLang`（此处 `sourceLang`/`targetLang` 为 falsy 即未选）。按钮样式保持灰色（`disabled:opacity-50` 等），未选时不可点击。
- **校验**：提交时若仍出现同语言等错误，保留现有 `sameLangError` 等提示；空语言已在按钮禁用层面拦截。

---

## 4. 对比强化：双向箭头 + 文案「从 [X] 翻译至 [Y]，确认无误？」

- **位置**：`[frontend/components/TranslationForm.tsx](frontend/components/TranslationForm.tsx)` 中两个 `LanguageSelector` 之间。
- **当前**：compact 模式为 `→`。
- **改动**：
  - 将 `→` 改为**双向箭头**（↔，Unicode 或 Lucide `ArrowLeftRight` 等），居中放在两个选择框之间。
  - 当**源语言与目标语言均已选择**时，显示文案：**从 [源语言名] 翻译至 [目标语言名]，确认无误？**（源/目标语言名用 `t("languages.zh")` 等）。若任一侧为空，可显示占位提示（如「请选择源语言与目标语言」）或不显示该句。
  - 在 `translate` 下新增 `confirmDirection`（带占位符），并在代码中传入当前语言名；可选 `translate.selectBothLanguages` 作为未选时的提示。
- **i18n**：在 zh / en / es 的 `translate` 中增加 `confirmDirection` 及可选 `selectBothLanguages`。

---

## 5. i18n 汇总


| 命名空间      | Key                       | 用途                          |
| --------- | ------------------------- | --------------------------- |
| upload    | fileNotice                | 上传区下方加密与 7 天保留说明            |
| home      | deleteDocumentPermanently | 按钮「立即彻底删除」                  |
| home      | deleteDocumentConfirm     | 确认框「此操作不可逆，文件将从服务器完全抹除」     |
| translate | pageRangeExample          | 页码输入 placeholder 示例（如 1-10） |
| translate | confirmDirection          | 从 [X] 翻译至 [Y]，确认无误？         |
| translate | selectSourceLang          | 源语言下拉空选项（如「请选择源语言」）         |
| translate | selectTargetLang          | 目标语言下拉空选项（如「请选择目标语言」）       |
| translate | selectBothLanguages       | （可选）未选时提示「请选择源语言与目标语言」      |


所有新增文案在 zh.json、en.json、es.json 中均需添加对应翻译。

---

## 6. 实现顺序建议

1. i18n：在三个 messages 文件中补全上述 key（含 selectSourceLang、selectTargetLang、selectBothLanguages）。
2. 上传区：说明文案 + 删除按钮文案 + 删除确认逻辑。
3. 翻译表单：源/目标语言默认置空（LanguageSelector 支持空 value + 占位 option）、「开始翻译」在未选语言时禁用（灰色）；页码 placeholder/宽度；双向箭头与确认文案（仅在双选后显示完整句）。
4. 源语言 PDF 首页检测：引入语言检测库 + 在存在 `sourceFileRef.current` 时用 pdf.js 取首页文本，仅在检测可行时填充源语言，否则保持为空。

