---
name: frontend-ux-pdf-preview
overview: 改进 translatepdfonline 的前端上传与翻译体验：始终显示最近上传的 PDF、完善上传与翻译进度提示，并即时展示原文与译文预览。
todos:
  - id: upload-ux-persist-last-file
    content: 重构 UploadDropzone 与 HomePage 的状态管理，使最近上传文件始终显示在上传区域，并处理匿名额度用完的提示逻辑
    status: completed
  - id: wire-pdf-viewer-source-target
    content: 将 TaskView.source_pdf_url 和 outputs[0].download_url 对接到左右两个 PdfViewerPane，配合文案提示翻译完成状态
    status: completed
  - id: improve-task-progress-copy
    content: 基于任务状态和前端计时优化翻译进度和阶段提示文案
    status: completed
isProject: false
---

### 目标

- **上传体验**：用户一旦成功上传 PDF，“Drop PDF here...” 区域始终显示最近一次上传的文件（文件名 + 状态/进度），不再恢复成空白文案。
- **进度可视化**：上传、翻译两个阶段都要有清晰的进度与提示文案（上传进度条 + 翻译状态与进度）。
- **原文预览即时可用**：上传完成并选择页数后，左侧原文 PDF 立即可预览，不必等翻译完成。
- **译文预览有明确提示**：译文在翻译完成后右侧出现，并伴随“翻译完成，可预览/下载”的显式提示。

---

### 一、上传组件 UX 重构（`frontend/components/UploadDropzone.tsx`）

- **状态模型调整**
  - 保留现有 `uploadedInfo`，扩展为：`{ name, size, status }`，其中 `status` 取值如：`"idle" | "uploading" | "uploaded" | "failed"`。
  - 增加 `progress` 状态（0-100），用于展示上传进度条；R2 PUT 不返回进度时，可以采用“假进度条”（时间驱动）或简单的三阶段动画：开始 → 进行中 → 完成。
- **UI 行为**
  - 在有 `uploadedInfo` 时：
    - 替换掉中间的“Drop PDF here or click to select”文案，改为显示最近一次上传的文件卡片：
      - 文件名、大小（MB）、上传状态（上传中/已完成/失败）。
      - 上传中时，在卡片下方显示一条细进度条和“上传中...”文案。
    - 错误提示（如 R2 失败、403 额度用完）显示在卡片下方，不遮挡卡片本身。
  - 在匿名额度用完触发 `loginHint` 时：
    - 保留最近一次 `uploadedInfo`（不要清空），保证用户仍能看到上次的 PDF。
    - 黄色提示位于卡片下方，明确告诉用户“已用完匿名上传额度，请使用右上角 Google 登录后继续上传”，但不影响下面“翻译设置”区域使用当前文档。
- **逻辑细节**
  - 成功完成：
    - R2 `PUT` 成功 + `/api/upload/presigned/complete` 返回 200 后，将 `uploadedInfo.status` 设为 `"uploaded"`，进度条满格并淡出，卡片文案变成“上传成功 · X MB”。
  - 失败时：
    - `status = "failed"`，卡片标红并显示错误信息，同时允许用户重新选择文件。

---

### 二、原文/译文预览联动（`frontend/app/[locale]/page.tsx` + `PdfViewerPane`）

- **原文 PDF 预览**
  - 利用后端 `TaskView.source_pdf_url`（已在 `/api/tasks/{id}/view` 中返回），或在上传完成后直接构造 `R2_PUBLIC_URL + object_key`：
    - 在创建翻译任务成功时，前端就已经知道 `documentId` 与 `filename`，通过调用 `api.getTaskView(taskId)` 拿到 `source_pdf_url`。
  - 在 `HomePage` 组件中：
    - 定义 `sourcePdfUrl` 从 `taskView?.source_pdf_url` 读取；
    - 将其传给左侧 `PdfViewerPane` 的 `fileUrl` 属性，替换当前的空字符串；
    - 若还未翻译但已上传，可考虑在创建翻译任务前先基于 `documentId` 调用一个“文档详情/预览 URL”接口（如后续添加 `/api/documents/{id}` 返回原文 URL），让用户在翻译前就能浏览原文。
- **译文 PDF 预览**
  - 使用 `taskView.outputs[0].download_url` 作为右侧 `PdfViewerPane` 的 `fileUrl`：
    - 只在 `taskStatus === "completed" && taskView.outputs.length > 0` 时启用；
    - 否则右侧显示“译文生成中，请稍候...”占位文案。
- **提示文案**
  - 翻译未完成：
    - 在“3. 任务状态”区域展示当前状态 + 进度条（已实现）；
    - 在下方提示“译文生成中，完成后将在右侧自动展示”。
  - 翻译完成：
    - 状态行加上“翻译完成 ✅”（中英文可通过 `next-intl` 配置）；
    - 右侧 Pane 显示译文 PDF，顶部可加一行“小提示：可以通过左右区域同步翻页进行对比”。

---

### 三、始终显示最近上传的文件（匿名 + 登录用户通用）

- **后端接口复用**
  - 利用现有 `GET /api/documents` 接口，按当前用户（匿名临时或登录用户）返回最近的文档列表。
- **前端恢复逻辑**
  - `HomePage` 在首次加载时：
    - 若当前没有 `documentId`，自动调用 `api.listDocuments()`；
    - 若列表非空，取第一条作为“最近文件”：
      - 设置 `documentId`、`filename`；
      - 将 `UploadDropzone` 的 `uploadedInfo` 初始化为这条记录（可以通过 props 下发，例如 `initialFile={{ name, size }}`，由组件内部初始化状态）。
  - 这样即使刷新页面：
    - 上传区域仍显示最近的 PDF；
    - “2. 翻译设置 - {filename}” 区仍然可以直接发起新的翻译任务。

---

### 四、翻译进度提示的进一步优化

- **增加“阶段”提示**（参考 BabelDOC 日志）：
  - 虽然当前没有精细的进度 API，但可以按大致阶段给用户更多反馈：
    - `queued`：显示“任务排队中，等待开始处理”；
    - `processing` 初始几秒：显示“正在预处理 PDF（版面分析、模型加载）”；
    - 后续 20-60 秒：显示“正在调用 DeepSeek 翻译中...”；
    - 接近完成时：显示“正在生成译文 PDF...”。
  - 技术上可以通过前端计时 + 当前状态简单切换提示文案，无需改后端。
- **失败提示**
  - 当 `taskStatus === "failed"` 且 `taskView.task.error_message` 存在时，已经在 UI 中展示错误详情；
  - 可以补充一条“你可以稍后重试，或更换文档/页数范围”的引导文案。

---

### 五、后续可选增强（非本轮必做）

- **生成并使用 PDF 首页缩略图**：
  - 后端在 `preprocess_pdf` 里用 PyMuPDF 渲染第一页为 PNG，上传到 R2；
  - 在 `documents` 表增加 `preview_image_key` 字段，并在 `/api/documents` 返回对应的 `preview_image_url`；
  - 前端上传卡片改用缩略图代替纯文字“PDF”块，提升视觉层级。
- **任务历史视图**：
  - 基于 `GET /api/tasks` 和 `GET /api/tasks/{id}/view` 做一个简单的“文档历史 / 任务历史”页面，支持用户查看和重新下载既有译文 PDF。

