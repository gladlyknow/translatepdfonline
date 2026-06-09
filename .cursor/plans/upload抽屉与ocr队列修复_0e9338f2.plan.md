---
name: upload抽屉与ocr队列修复
overview: 按你确认的方向：Upload 的 History 改为统一 Drawer；OCR 使用独立队列 Worker 消费。同步修复 translate 回跳、完善 develop 日志可见性与 OCR 排队过长问题。
todos:
  - id: upload-history-drawer
    content: 实现 upload 统一 History Drawer 结构与交互
    status: pending
  - id: fix-translate-redirect-loop
    content: 修复 translate 页面回跳 upload 的路由竞态
    status: pending
  - id: wire-separate-queue-worker
    content: 接入独立 OCR 队列 Worker 的 queue consumer 导出
    status: pending
  - id: unify-queue-configs
    content: 统一 wrangler 配置中的队列名称与消费职责
    status: pending
  - id: add-ocr-fallback-cron
    content: 增加 OCR dispatch-pending 的 cron 兜底触发
    status: pending
  - id: improve-observability-docs
    content: 补充 develop 日志查看路径与 OCR 运行排障文档
    status: pending
  - id: run-end-to-end-verification
    content: 完成 upload/translate/ocr 端到端验收与日志验证
    status: pending
  - id: prevent-runtime-vars-overwrite
    content: 修复并固化 deploy 流程，避免运行时变量和机密被覆盖/清空
    status: pending
isProject: false
---

# Upload Drawer 与 OCR 队列修复计划

## 项目构建配置（统一记录）

### 队列项目（OCR Consumer Worker）
- 根目录：`/frontend`
- 构建命令：`pnpm run build:opennext:ci`
- 部署命令：`npx wrangler deploy -c wrangler.queues.toml --keep-vars`
- 版本命令：`npx wrangler versions upload`

### 主项目（HTTP 主 Worker）
- 根目录：`/frontend`
- 构建命令：`pnpm run build:opennext:ci`
- 部署命令：`npx wrangler deploy --keep-vars`
- 版本命令：`npx wrangler versions upload`

## 当前已确认现象（需纳入同一修复）
- develop 构建后，Cloudflare Worker 中手动配置的“运行时变量和机密”出现缺失/不可见。
- `upload` 页点击 History 会进入 `translate`，但任务实际是 OCR（应按任务类型分流）。

## 目标
- `upload` 页点击 History 后，展示统一 Drawer（含模式说明、跳转按钮、当前文档、任务历史、已上传文档）。
- `translate` 页面不再出现“进入后自动跳回 `/upload`”。
- OCR 改为独立队列 Worker 消费，消除长期停留 `Queued · ocr_enqueued`。
- develop 环境日志可在 Cloudflare 主 Worker 与队列 Worker 明确查看。
- develop/prod 发布后，Cloudflare 运行时变量与机密不再被覆盖或丢失。

## 根因结论
- 回跳根因：`/translate` 对 query 强依赖，而客户端恢复后会清掉 `document` 参数，触发服务端重定向回 `/upload`。
  - 文件：[D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/page.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/page.tsx)
  - 文件：[D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx)
- OCR 队列卡住高概率为 consumer 接线/部署链路不稳定（Producer 入队后无稳定 Consumer 消费），且缺少强兜底调度。
  - 文件：[D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts](D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts)
  - 文件：[D:/imppro/translatepdfonline/frontend/wrangler.toml](D:/imppro/translatepdfonline/frontend/wrangler.toml)
  - 文件：[D:/imppro/translatepdfonline/frontend/wrangler.queues.toml](D:/imppro/translatepdfonline/frontend/wrangler.queues.toml)
- 日志不可见主要是“看错 Worker / 未部署独立队列 Worker / 变量层级误配”。
- 变量丢失主要由“部署命令未保留运行时变量、部署到错误 Worker 名/环境、主队列 Worker 混淆覆盖”导致。

## 实施步骤

### 1) Upload History 改为统一 Drawer
- 新建/改造 `UploadPageClient`：History 按钮打开右侧 Drawer。
- Drawer 内容分区（按你提供顺序）：
  - 模式说明文案（Translate vs OCR Translator）
  - `去 Translate`、`去 OCR Translator` 按钮
  - 当前文档信息
  - 任务历史列表（复用 `HistoryPanel` 的数据获取逻辑，抽成共享 hook 或内联复用 API）
  - 已上传文档列表（`translateApi.listDocuments()`）
- 目标文件：
  - [D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/upload/UploadPageClient.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/upload/UploadPageClient.tsx)
  - [D:/imppro/translatepdfonline/frontend/src/shared/components/translate/HistoryPanel.tsx](D:/imppro/translatepdfonline/frontend/src/shared/components/translate/HistoryPanel.tsx)
  - 视实现新增共享组件：`frontend/src/shared/components/translate/UploadHistoryDrawer.tsx`

### 2) 修复 Translate 回跳
- 停止在 document 恢复后立即清空 URL 的 `document` 参数，或引入“恢复完成”保护后再处理。
- 服务端 `translate/page.tsx` 保留无上下文重定向，但避免与客户端恢复阶段冲突。
- 删除文档后跳转保持 `/upload`。
- 目标文件：
  - [D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx)
  - [D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/page.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/page.tsx)

### 3) OCR 独立队列 Worker 落地
- 以 `wrangler.queues.toml` 的独立 Worker 作为唯一 OCR consumer。
- 在队列 Worker 入口显式导出 `queue(batch, env, ctx)`，调用 `handleOcrPipelineQueueBatch`。
- 主 Worker 仅负责生产消息，不承担 OCR queue 消费。
- 统一队列名在 template/正式配置/文档三处一致。
- 目标文件：
  - [D:/imppro/translatepdfonline/frontend/wrangler.queues.toml](D:/imppro/translatepdfonline/frontend/wrangler.queues.toml)
  - [D:/imppro/translatepdfonline/frontend/wrangler.toml](D:/imppro/translatepdfonline/frontend/wrangler.toml)
  - [D:/imppro/translatepdfonline/frontend/wrangler.toml.template](D:/imppro/translatepdfonline/frontend/wrangler.toml.template)
  - [D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts](D:/imppro/translatepdfonline/frontend/src/shared/lib/ocr-queue.ts)
  - 新增队列 Worker 入口文件（例如 `frontend/src/worker-queue.ts`，以实际构建链路为准）

### 4) 增加兜底调度与可观测性
- 配置 Cron 触发 `/api/ocr/dispatch-pending` 作为兜底。
- 增补日志关键点：入队、consumer 启动、状态迁移、重试原因与耗时。
- 文档补充 develop 日志查看路径（主 Worker、队列 Worker、阿里云 FC）。
- 目标文件：
  - [D:/imppro/translatepdfonline/frontend/src/app/api/ocr/dispatch-pending/route.ts](D:/imppro/translatepdfonline/frontend/src/app/api/ocr/dispatch-pending/route.ts)
  - [D:/imppro/translatepdfonline/frontend/docs/ocr-queue-and-pipeline.md](D:/imppro/translatepdfonline/frontend/docs/ocr-queue-and-pipeline.md)
  - [D:/imppro/translatepdfonline/frontend/docs/environment-variables.md](D:/imppro/translatepdfonline/frontend/docs/environment-variables.md)

### 5) 运行时变量防覆盖（本次必须落地）
- 固化部署命令只允许带 `--keep-vars`：
  - 主 Worker：`npx wrangler deploy --keep-vars`
  - 队列 Worker：`npx wrangler deploy -c wrangler.queues.toml --keep-vars`
- 发布前后执行变量完整性检查（主 Worker + 队列 Worker 分开核对）。
- 明确禁止使用会覆盖变量的命令路径（例如无 `--keep-vars` 的 deploy 脚本）。
- 在文档中新增“变量保全检查清单”：Worker 名称、环境、变量键集合、部署命令、回滚命令。
- 目标文件：
  - [D:/imppro/translatepdfonline/frontend/package.json](D:/imppro/translatepdfonline/frontend/package.json)
  - [D:/imppro/translatepdfonline/frontend/docs/environment-variables.md](D:/imppro/translatepdfonline/frontend/docs/environment-variables.md)
  - [D:/imppro/translatepdfonline/frontend/docs/cloudflare-env-真相.md](D:/imppro/translatepdfonline/frontend/docs/cloudflare-env-真相.md)

### 6) 验证与验收
- 本地/预发验证：
  - `/upload` 点击 History -> Drawer 展示完整结构
  - 上传后 `去 Translate` 不回跳
  - OCR 任务状态能从 `ocr_enqueued` 进入 `ocr_consumer_started`/`processing`
  - 主 Worker 与队列 Worker 的运行时变量在部署后保持不变
- 命令验证：
  - `wrangler tail <main-worker>`
  - `wrangler tail <queue-worker> --config wrangler.queues.toml`
- 通过后再发布 develop。

