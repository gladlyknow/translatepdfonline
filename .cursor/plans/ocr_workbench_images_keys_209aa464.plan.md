---
name: OCR Workbench images keys
overview: 对齐 view presign 与 parse-result 读键；图片字段归一化；Source 与 Workbench 纵向留白一致；Parse 资产外链优先 DB r2_domain 公网无签名 URL（与现有 r2_endpoint 签名链路梳理）。
todos:
  - id: resolve-read-key
    content: "ocr-parse-result-r2-keys.ts: 导出 resolveOcrParseResultReadKey；view 路由 presign 使用该 key + 文件名随 variant"
    status: completed
  - id: image-url-coalesce
    content: "translator-parse-result 或 normalize-ocr-parse-json: images[] 将 url/image_url/src 合并到 data_url"
    status: completed
  - id: optional-parse-route-dedupe
    content: parse-result GET 改用同一 resolver（可选，减少重复）
    status: completed
  - id: source-json-scroll-parity
    content: "OcrTranslatePageClient: Source 列与 Workbench 列首行留白/滚动容器 padding 对齐；核对 PdfViewerPane vs OcrParseWorkbench+ParseResultCanvas（unifiedMainScroll）"
    status: completed
  - id: r2-domain-public-urls
    content: "translate-r2 / ocr-parse-result-image-proxy: 公网读链接优先 DB r2_domain（与 storage R2Provider.publicDomain 一致）；无域名时再 presign；文档说明桶须对自定义域可匿名读"
    status: completed
  - id: verify-workbench
    content: tsc --noEmit；人工确认含图任务 workbench、view、export MD 中图片 URL 形态
    status: completed
isProject: false
---

# OCR Workbench 无图与 parse JSON 键不一致

## 根因分析

### 你看到的 `[r2/presign_get] ... ocr-parse-result.json` 是否「错了」？

**不一定。** 当前有两条路径：

| 路径 | 行为 |
|------|------|
| [frontend/src/app/api/tasks/[taskId]/parse-result/route.ts](frontend/src/app/api/tasks/[taskId]/parse-result/route.ts) `GET` | 使用 [frontend/src/shared/lib/ocr-parse-result-r2-keys.ts](frontend/src/shared/lib/ocr-parse-result-r2-keys.ts) 的 `getOcrParseResultBodyForRead`：需要翻译且 **target 文件可读** 时读 `ocr-parse-result-target.json`，否则回退 `ocr-parse-result.json`。Workbench 在完成态走同源 [`OcrTranslatePageClient.tsx`](frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx) 里 `ocrParseResultUrl = /api/tasks/${taskId}/parse-result`，**不经过** presign 整文件。 |
| [frontend/src/app/api/tasks/[taskId]/view/route.ts](frontend/src/app/api/tasks/[taskId]/view/route.ts) | 在 `task.preprocessWithOcr && completed` 时 **写死** `translations/${taskId}/ocr-parse-result.json` 调 `createPresignedGet`，写入 `ocr_parse_result_url` 与 `outputs` 下载项。轮询 task view 时就会打 `[r2/presign_get]`，键始终是 **source**，与「有 target 时用户心理预期」不一致，但与当前「下载附件 = 源 JSON」可并存。 |

结论：**日志里的 presign 来自 `view`，不是 Workbench 拉 JSON 的路径**；若希望日志/下载与「展示用」一致，应改 `view` 的 presign 键解析，而不是说 `parse-result` GET 读错了文件。

### 为何「有 target、即使应读 source」仍可能不显示图？

画布只认 [`parse-result-canvas.tsx`](frontend/src/shared/ocr-workbench/parse-result-canvas.tsx) 里 `findImageForLayout` → `im?.data_url`（[`translator-parse-result.ts`](frontend/src/shared/ocr-workbench/translator-parse-result.ts) 的 `parseImageSchema` 仅规范 `data_url`）。

若百度/中间 JSON 把可展示地址放在 **`url` / `image_url` / `src` 等** 而 `data_url` 为空，则 Zod 后 `data_url === ''`，画布不渲染 `<img>`（表现为「无图」）。`mirror_baidu_images` 的 `collectUrls` 只扫 JSON 里所有 **字符串**；若 URL 只在非 `data_url` 键上，镜像阶段同样**不会**把外链换成 R2，问题会同时影响 source 与 target（`translateAndPersistParseResultTarget` 只做文本槽位翻译并 `structuredClone`，不补图片字段）。

## 建议改动（按优先级）

### 1. 统一「展示/下载用」R2 键解析（修正 view 与日志语义）

在 [ocr-parse-result-r2-keys.ts](frontend/src/shared/lib/ocr-parse-result-r2-keys.ts) 抽取与 `getOcrParseResultBodyForRead` 一致的 **异步** 解析函数，例如 `resolveOcrParseResultReadKey(taskId, sourceLang, targetLang): Promise<{ key: string; variant: 'target' | 'source' }>`（实现上等价于：若 `languagesNeedTranslation` 且 `getObjectBody(targetKey)` 成功则 target，否则 source）。

- [view/route.ts](frontend/src/app/api/tasks/[taskId]/view/route.ts)：将第 79–90 行附近的固定 `parseKey` 改为调用上述 resolver；`outputs` 里 `filename` 可按 variant 区分（如 `ocr-parse-result-target.json` / `ocr-parse-result.json`），避免运维误判。
- （可选）[parse-result/route.ts](frontend/src/app/api/tasks/[taskId]/parse-result/route.ts) `GET`：在已有逻辑上改为调用同一 resolver，减少重复 try/catch，行为不变。

### 2. 图片 URL 字段归一化（修复「有 JSON 无图」）

在解析进入 Zod 之前或 `parseImageSchema` 上用 `z.preprocess`：对每个 image 对象，若 `data_url` 为空，则按顺序尝试 `url`、`image_url`、`src`、`image`（均为 string 时）填入 `data_url`，再进入现有 schema。

推荐落点：**[`translator-parse-result.ts`](frontend/src/shared/ocr-workbench/translator-parse-result.ts)** 的 `parseImageSchema`（或 [`normalize-ocr-parse-json.ts`](frontend/src/shared/ocr-workbench/normalize-ocr-parse-json.ts) 在 `coercePagesShape` 里对每个 `page.images[]` 做同样归一），保证 `parse-result` API 返回给前端的 JSON 与 mirror 收集到的字符串路径一致。

### 3. 验证与回归

- 本地：有 `target` 的任务调 `GET /api/tasks/:id/view`，确认 `ocr_parse_result_url` 对应键与 `GET /api/tasks/:id/parse-result` 内容一致（或刻意保留「仅下载 source」产品决策时在注释/手册写清）。
- 用一条含 `images` 的 parse JSON（`data_url` 空、`url` 有百度外链）确认 mirror + Workbench 能出图。

## 非本次范围（若仍无图再查）

- R2 桶 CORS / 仅 Worker 可读导致浏览器 `<img src=presigned>` 异常（较少见，img 通常不受 CORS 限制）。
- `collectUrls` 未覆盖的非百度图床域名（需再扩规则，单独评估）。

---

## 合并需求（2026-05-09）：Source 与 Workbench 垂直不一致

**现象**：同一主滚动区加载后，Source PDF 区域上方视觉上有「多一行」空行，Workbench 侧略紧，滚到底时两列内容水平/底边不齐。

**排查方向**（实现时逐项对比 computed 样式）：

- 外层结构：[`OcrTranslatePageClient.tsx`](frontend/src/app/[locale]/(translate)/ocrtranslator/OcrTranslatePageClient.tsx) 中 `OcrSourcePdfPanel`（标题 `px-3 py-2` + 内层 `p-2` + `PdfViewerPane`）与右侧 Workbench 卡片（标题 + `p-2` + [`OcrParseWorkbench`](frontend/src/shared/ocr-workbench/OcrParseWorkbench.tsx)）是否已对齐；Workbench 根节点 `flex flex-col gap-3`、条件渲染的 `selectBlockHint`、`showWorkbenchTopBar` 是否在 OCR 分栏模式下引入额外顶距。
- 内层滚动：Workbench 内 [`ParseResultCanvas`](frontend/src/shared/ocr-workbench/parse-result-canvas.tsx) 在 `scrollContainerMode="parent"` 时与 `PdfViewerPane` 的首页顶部 padding / 工具条占位是否一致。
- 目标：两列**可滚动内容区**首行基线与底部留白一致（优先调 tailwind，避免改 PDF 语义）。

---

## 合并需求：`data_url` 为何是 `r2.cloudflarestorage.com` 带签名，而不是 DB `r2_domain`？

**现状（代码事实）**：

- [`ocr-parse-result-image-proxy.ts`](frontend/src/shared/lib/ocr-parse-result-image-proxy.ts) 中 `publicUrlForAssetKey`：`getR2PublicBaseUrl()` 有值则拼公网路径；否则 `createPresignedGet`。
- [`translate-r2.ts`](frontend/src/shared/lib/translate-r2.ts) 的 `getR2PublicBaseUrl()` **仅**读取环境变量 `R2_PUBLIC_URL` / `NEXT_PUBLIC_R2_PUBLIC_URL`，**不读取**数据库 `r2_domain`。
- 管理端/上传链路里 [`storage.ts`](frontend/src/shared/services/storage.ts) 的 `R2Provider` 使用 `publicDomain: configs.r2_domain`，与 translate 流水线 **未打通**。

因此 Consumer 镜像阶段在无 `R2_PUBLIC_URL` 的 Worker 上必然走 **S3 API 主机（`r2_endpoint`）+ 签名查询串**，与你在 DB 里配置的 `r2_domain`（如 `https://storage.translatepdfonline.com`）无关；这不是「单字段配错」，而是 **两套公网读 URL 解析策略不一致**。

**目标设计（待你确认选项后写死实现）**：

1. **统一解析**：新增异步例如 `resolveR2PublicReadBaseUrl()`（或扩展 `getR2PublicBaseUrl` 为读 DB：`getAllConfigs()` → `r2_domain`，trim 去尾斜杠），优先级建议：`R2_PUBLIC_URL` / `NEXT_PUBLIC_R2_PUBLIC_URL`（运维覆盖）→ **DB `r2_domain`** → 无则回退 presign。
2. **调用点**：至少 [`publicUrlForAssetKey`](frontend/src/shared/lib/ocr-parse-result-image-proxy.ts)；评估 [`ocr-export-queue`](frontend/src/shared/lib/ocr-export-queue.ts) 等处导出 MD 是否复用同一 helper，保证 JSON 内外链与导出 Markdown 一致。
3. **前提**：`r2_domain` 指向的自定义域已对 **同一 bucket** 配置 R2 公共访问（匿名可读对象）；否则浏览器 `<img src>` 与导出拉取会 403——实现前需产品/运维确认。

**与「图片不用签名」的关系**：若公网域可读，则 `data_url` 可稳定为无查询串的 `https://storage.../translations/.../assets/xxx.jpg`，利于长期保存的 MD；若未开公读，仍只能 presign 或走 Worker 代理（二选一）。

**已确认（产品选择）**：`r2_domain` **优先**生成无签名公网路径；未配置或不可用时再回退 `createPresignedGet`（`r2_endpoint` 签名链）。实现时仍保留 env `R2_PUBLIC_URL` / `NEXT_PUBLIC_R2_PUBLIC_URL` 作为最高优先级运维覆盖（与代码注释一致）。
