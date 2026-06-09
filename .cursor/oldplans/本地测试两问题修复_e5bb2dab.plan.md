---
name: 本地测试两问题修复
overview: 解决本地测试中「回调成功但 PDF 预览不显示」的问题，并为翻译页实现页头/页脚（或顶部控制区）默认隐藏、鼠标滑过时显现的布局。
todos: []
isProject: false
---

# 本地测试两问题修复计划

## 问题 1：Callback 返回 true 但页面上 PDF 预览不显示

### 现状与可能原因

- 回调接口 [frontend/src/app/api/translate/callback/route.ts](frontend/src/app/api/translate/callback/route.ts) 已正确更新 DB：`status`、`outputObjectKey` 等。
- 前端在 [TranslatePageClient.tsx](frontend/src/app/[locale]/(landing)/translate/TranslatePageClient.tsx) 中每 **5 秒** 轮询 `getTask`；当 `detail.status === 'completed'` 时再请求 `getTaskView` 并 `setTaskView(view)`。
- 预览链路：`taskView?.primary_file_url` 存在后，useEffect 会请求 `getTaskOutputPreviewUrl(taskId, targetPage)`，得到 `targetSliceUrl`，最终 `targetPdfUrl = taskStatus === 'completed' && targetSliceUrl ? targetSliceUrl : ''` 用于右侧 PDF 预览。

可能导致「不显示」的原因：

1. **未等到下一次轮询**：手动调 callback 后需最多等 5 秒才会拉取到 `completed` 并拉 view。
2. **view 接口失败**：[view/route.ts](frontend/src/app/api/tasks/[taskId]/view/route.ts) 中 `primary_file_url` 仅在 `task.outputObjectKey && task.status === 'completed'` 时由 `createPresignedGet` 生成；本地 R2 若超时/未配置会导致 view 无 `primary_file_url`，前端不更新 `taskView`。
3. **output-preview-url 失败**：[output-preview-url/route.ts](frontend/src/app/api/tasks/[taskId]/output-preview-url/route.ts) 会 `getObjectBody(task.outputObjectKey)` 并切页；本地 R2 失败会返回 500，前端 catch 后 `setTargetSliceUrl('')`，预览为空。

### 建议改动（前端为主）

- **增加「刷新结果」按钮**（推荐）  
  - 在任务进行中或已完成时，在状态条旁增加「刷新」按钮。  
  - 点击后：先 `getTask(taskId)` 更新 `taskStatus`/`taskDetail`，若 `status === 'completed'` 或 `'failed'` 再 `getTaskView(taskId)` 并 `setTaskView`。这样用户手动调 callback 后不必等 5 秒，点一次刷新即可看到预览（前提是 view 与 output-preview-url 接口正常）。
- **可选：缩短轮询间隔**  
  - 当 `taskStatus === 'queued' || taskStatus === 'processing'` 时，将 `POLL_INTERVAL_MS` 从 5000 改为 2000，以便更快发现「已完成」状态。
- **可选：已完成但无预览时的提示**  
  - 当 `taskStatus === 'completed'` 且已有 `taskView` 但长时间无 `targetPdfUrl`（或 view 无 `primary_file_url`）时，显示「加载失败，请点击刷新重试」并再次暴露刷新按钮，便于排查本地 R2/网络问题。

不修改 callback 或 view/output-preview-url 的业务逻辑（已正确写库与返回字段），仅通过「刷新」与轮询策略改善体验。

---

## 问题 2：翻译页 layout 设为自动隐藏，鼠标滑过才显现

### 范围澄清

「页头、页尾」可能指：

- **A）站点级 Header/Footer**：来自 [themes/default/layouts/landing.tsx](frontend/src/themes/default/layouts/landing.tsx)（Header + main + Footer），translate 页的 `pt-16` 即为站点 header 预留。
- **B）翻译页内的「顶部控制区」**：上传区 + 翻译表单 + 历史 + 进度条（以及底部的状态条），即 [TranslatePageClient.tsx](frontend/src/app/[locale]/(landing)/translate/TranslatePageClient.tsx) 中 `topRowCollapsed` 控制的那一块。

若希望**尽量少占空间**，两种都可以做；建议先做 **B**（仅翻译页内部），再视需要做 **A**。

---

### 方案 B：仅翻译页「顶部控制区」自动隐藏（推荐先做）

- **行为**：默认不显示完整的上传/表单/历史/进度区域，仅保留一条**细条**（例如 32–40px 高）在顶部；鼠标移入该顶部区域（或靠近视口顶部的一小条）时，完整控制区展开；移出后延迟若干秒再收起。
- **实现位置**：仅在 [TranslatePageClient.tsx](frontend/src/app/[locale]/(landing)/translate/TranslatePageClient.tsx) 内实现，不改 layout。
- **实现要点**：
  - 用 state 控制「是否展开」（例如 `topRowHoverExpanded`），与现有 `topRowCollapsed` 可共存：例如默认 `topRowCollapsed === true` 或新状态默认为「仅显示细条」。
  - 顶部保留一条可 hover 的窄条（如 32px），`onMouseEnter` 展开完整控制区，`onMouseLeave` 加短延时（如 500ms）后收起。
  - 展开时渲染现有上传区、表单、历史、进度条；收起时只渲染窄条（可带「展开」图标或文案），保证 PDF 预览区域获得更多垂直空间。
- **可选**：在细条上保留「固定展开」小按钮，点击后保持展开直到再次点击，方便需要长时间操作表单的用户。

---

### 方案 A：站点 Header/Footer 在翻译页自动隐藏

- **行为**：仅在「翻译页」上，站点 Header 与 Footer 默认隐藏（或收起到很窄），鼠标滑近视口顶部/底部时再显示。
- **实现思路**：在 [themes/default/layouts/landing.tsx](frontend/src/themes/default/layouts/landing.tsx) 中，用**客户端组件**包裹 `<Header />` 和 `<Footer />`（或整页外壳），该组件内部用 `usePathname()` 判断当前是否为翻译页（如 pathname 包含 `'/translate'`）。
  - 若是翻译页：对 Header/Footer 应用「默认隐藏、悬停显示」的样式与逻辑（例如固定定位 + opacity/transform + 顶部/底部 hover 区域）。
  - 若否：保持原有展示，不影响首页等其他 landing 页。
- **注意**：landing 布局当前为服务端组件，需抽离「带 pathname 判断 + 悬停逻辑」的部分为客户端组件（例如 `LandingChrome.tsx`），在 layout 中引用并传入 `header`/`footer` 数据；Header/Footer 组件本身可仍由 theme 按原样加载。

---

## 建议实施顺序

1. **问题 1**：在 [TranslatePageClient.tsx](frontend/src/app/[locale]/(landing)/translate/TranslatePageClient.tsx) 增加「刷新结果」按钮并调用 `getTask` + 若完成则 `getTaskView`；可选缩短轮询间隔与「已完成但无预览」的提示。
2. **问题 2**：先做 **方案 B**（翻译页顶部控制区默认收起、悬停展开）；若需进一步省空间，再做 **方案 A**（站点 Header/Footer 在翻译页悬停显示）。

---

## 涉及文件小结


| 问题                        | 主要文件                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1. 预览不显示                  | [TranslatePageClient.tsx](frontend/src/app/[locale]/(landing)/translate/TranslatePageClient.tsx)（轮询、刷新、可选提示）       |
| 2B. 顶部控制区自动隐藏             | 同上（状态、顶部细条、hover 展开/收起）                                                                                            |
| 2A. 站点 Header/Footer 自动隐藏 | [themes/default/layouts/landing.tsx](frontend/src/themes/default/layouts/landing.tsx) + 新建客户端包装组件（pathname + 悬停样式） |


