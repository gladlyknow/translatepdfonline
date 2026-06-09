---
name: 翻译任务恢复与OCR顶栏
overview: 修复「仅 task= URL 时长期 Loading、工作台（含 OCR 提示）不出现」的根因；澄清并落实 OCR 页 §3.1「S|T|P 单行」是指侧栏还是主区顶栏；同步更新计划文档以免与实现漂移。
todos:
  - id: fix-restoring-gate
    content: 调整 TranslatePageClient 中 restoringFromUrl / task URL 恢复逻辑：避免 documentId 未就绪时无限全屏 Loading；getTask 成功后尽早 setDocumentId 或展示错误终态
    status: completed
  - id: confirm-stp-placement
    content: 与产品确认 §3.1 S|T|P 放在侧栏上传卡还是主区双栏下方全宽顶栏；若主区则改 OcrTranslatePageClient 布局
    status: completed
  - id: sync-plan-doc
    content: 更新 .cursor/plans/翻译ocr提示与ocr顶栏_b9b7c8aa.plan.md §2 现状与 §3.1 落点，消除与仓库漂移
    status: completed
  - id: verify-dev-task-url
    content: 对问题 taskId 在 dev 验证 GET /api/tasks/:id 与 /view 与登录态；确认 Workers 部署 commit 含近期改动
    status: completed
isProject: false
---

# 翻译页 OCR 不显示 + OCR §3.1 反复对不齐

## 问题 1：带 `task=` 的已完成任务页没有 OCR 提示/按钮

### 现象与外链一致的原因

[`TranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx) 在约 **1068–1082** 行用 **`restoringFromUrl`** 直接 **return 整页「Loading task…」**，条件为：

```ts
!documentId && (URL 里有 task 或 document)
```

也就是说：**只要 URL 里还有 `task=`，而 `documentId` 仍是 `null`，侧栏、OCR 卡片、表单都不会渲染**——用户只会看到与 [dev 链接](https://translatepdfonline-dev.gladlyknow.workers.dev/translate?recent=1&task=-uRjxAXj55YFn8o-Zkywv) 一致的整页加载态。

`documentId` 依赖 **约 371–424 行** 的 `restore()`：`getTask` + `getTaskView` 成功后再 `setDocumentId(detail.document_id)`（或 `view` 分支里同样设置）。在以下任一情况 **`documentId` 会一直为 null**，从而 **永远卡在 `restoringFromUrl`**，自然 **不可能出现 OCR 条**：

- `getTask` / `getTaskView` **挂起、极慢或反复失败**（用户体感「一直是 Loading」）。
- `getTaskView` 失败且 **`detail.document_id` 在 JSON 里缺失/为 null**（与 [`TaskDetail`](d:/imppro/translatepdfonline/frontend/src/shared/lib/translate-api.ts) 类型假设不一致时，当前分支不会 `setDocumentId`）。
- **未登录或 Cookie 在 Workers 子域无效** 导致请求失败，catch 会改 URL；若仍停在 Loading，多半是 **请求未完成或逻辑未走到 setState**（需用 Network 确认）。

### 建议修复方向（实现时二选一或组合）

1. **收窄「全屏阻塞」条件（推荐）**  
   - 不要用「`!documentId` + URL 有 task」作为长期门闩。改为例如：**仅在「尚未拿到 `getTask` 结果」的短窗口内**全屏加载，或一旦 `getTask` 成功即 **`setDocumentId`（若存在）并退出全屏**，即使 `getTaskView` 仍失败也允许工作台 + OCR 条渲染（可另显「预览加载失败」）。  
   - 若 `document_id` 确实缺失，则 **结束 restoring** 并展示明确错误 + 可选「回上传页」，而不是无限 Spinner。

2. **验收与运维**  
   - 在 dev 对该 `taskId` 抓包：[`GET /api/tasks/:id`](d:/imppro/translatepdfonline/frontend/src/app/api/tasks/[taskId]/route.ts) 与 [`GET /api/tasks/:id/view`](d:/imppro/translatepdfonline/frontend/src/app/api/tasks/[taskId]/view/route.ts) 是否 200、响应里是否有 `document_id`。  
   - 确认 **Workers 部署的 frontend bundle** 已包含近期对 OCR 侧栏条与 `restoringFromUrl` 的修改（否则本地有、线上仍旧）。

---

## 问题 2：计划里「§3.1 S|T|P 单行顶栏」与现状为何对不齐

### 仓库当前实现（与计划文档不一致）

在 [`OcrTranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx) **约 1263–1301 行**，已是 **`grid grid-cols-3`** + 三列均 `min-w-0`，**不再是** [`.cursor/plans/翻译ocr提示与ocr顶栏_b9b7c8aa.plan.md`](d:/imppro/translatepdfonline/.cursor/plans/翻译ocr提示与ocr顶栏_b9b7c8aa.plan.md) 第 48–49 行所写的 **`grid-cols-2` + `col-span-2`**。  
因此：**若你以计划 PDF 为准，会觉得「没实现」；若以当前仓库为准，侧栏内 S|T|P 已是单行三列。**

### 仍可能「看起来不对」的两类原因

1. **产品语义偏差**：§3.1 原文写「在 Source/Target 区域**正下方**一行」——可能被理解为 **主区双栏（源 PDF / 工作台）上方的全宽顶栏**，而实现放在 **左侧窄侧栏上传卡内**。若产品要的是 **主区顶栏**，需要 **新增一条** 横跨 `md:grid-cols-2` 主网格的 S|T|P 行（或把现有块挪到主列顶部），而不是继续改侧栏 `grid-cols-*`。

2. **部署/缓存**：窄屏若仍见折行，需对比 **线上构建** 与本地是否同一 commit；并看父级 **`md:w-72`** 下 `LanguageSelector` 的 `compact` + `max-w-[130px]` 是否仍导致视觉换行（需实机 360px 截图）。

### 文档与流程建议

- 更新 [`.cursor/plans/翻译ocr提示与ocr顶栏_b9b7c8aa.plan.md`](d:/imppro/translatepdfonline/.cursor/plans/翻译ocr提示与ocr顶栏_b9b7c8aa.plan.md) §2「现状」为当前代码描述，并**写死** §3.1 的 UI 落点：**仅侧栏** 或 **主区全宽顶栏**，避免后续再次「改来改去对不齐」。

---

## 为何会显得「反反复复改不好」

| 因素 | 说明 |
|------|------|
| **门闩过粗** | `restoringFromUrl` 把整页工作台与 OCR 条一并隐藏，`documentId` 未就绪时用户永远看不到 OCR。 |
| **计划与代码漂移** | 计划仍写 `grid-cols-2`，仓库已 `grid-cols-3`，验收标准不一致。 |
| **「顶栏」歧义** | 侧栏内一行 vs 主区 Source/Target 下方全宽一行，未在规格里钉死。 |
| **环境与构建** | dev Workers 未带上最新 frontend 时，线上表现与本地/计划不一致。 |

---

## 建议实施顺序（确认计划后执行）

1. 改 [`TranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx) 的 **`restoringFromUrl` / 恢复流程**，避免在 `getTask` 已成功但 `documentId` 短暂为空时无限全屏阻塞；并处理 **`document_id` 缺失** 的终态 UI。  
2. 与产品确认 §3.1：**仅侧栏** 即满足，还是必须 **主区全宽 S|T|P**；若后者，在 [`OcrTranslatePageClient.tsx`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx) 主布局增加/迁移一行。  
3. 更新 [`.cursor/plans/翻译ocr提示与ocr顶栏_b9b7c8aa.plan.md`](d:/imppro/translatepdfonline/.cursor/plans/翻译ocr提示与ocr顶栏_b9b7c8aa.plan.md) 与（如需要）[fc 计划](d:/imppro/translatepdfonline/.cursor/plans/fc_完成提示与_ocr_页范围_73e2eaaf.plan.md) 中 §3.1 的落点描述。  
4. `pnpm exec tsc --noEmit` + 手测：`/translate?task=…`（仅 task）、`recent=1&task=…`、完成态与失败态下 OCR 条是否出现；OCR 页 360px S|T|P 是否一行。
