---
name: translatepdfonline-next-steps
overview: 规划将当前已接入 BabelDOC + DeepSeek 的原型，推进为可实际测试的完整在线 PDF 翻译网站（前后端功能闭环、存储与任务流打通、基本生产级健壮性）。
todos:
  - id: backend-babeldoc-hardening
    content: 强化后端 BabelDOC + DeepSeek 任务流（错误分类、状态字段、日志）
    status: pending
  - id: storage-output-contract
    content: 稳定化任务视图与输出文件下载 API，规范本地输出目录结构为未来 R2 适配做准备
    status: pending
  - id: frontend-task-flow
    content: 完善前端任务生命周期可视化与翻译结果预览/下载体验
    status: pending
  - id: docs-sync-v07
    content: 将本轮所有后端/前端改动完整落入技术文档（第 2/4/6/9 章）
    status: pending
isProject: false
---

# translatepdfonline 下一步整体实施规划

## 目标

- 让整站从「原型状态」升级为**可实际测试的完整在线 PDF 翻译服务**：
  - 用户可以上传真实 PDF → 触发翻译 → 等待任务完成 → 下载译文 PDF，并在前端看到清晰的任务状态与结果。
  - 后端任务流（上传 → 预处理 → 翻译 → 输出）基于 BabelDOC + DeepSeek 全链路可跑通。
  - 为后续接入 R2 存储、登录/计费、支付等生产能力预留清晰扩展点。

## 一、后端任务流与 BabelDOC 集成强化

- **1.1 完善上传与预处理链路**（文件层面：`backend/app/routes/upload.py`、`backend/app/pdf_utils.py`、`backend/app/tasks_pdf.py`）
  - 确认 `direct_upload` 写入的 PDF 路径与 `BABELDOC_STAGING_DIR` 目录结构，与 BabelDOC 预期一致（`uploads/{uuid}/{filename}`）。
  - 在 `preprocess_pdf` 中补充最小可用逻辑：
    - 校验文件存在与可读性；
    - 记录日志（页数、大小等），为后续 MinerU 预处理保留挂载点；
    - 预留将来调用 MinerU 的函数签名（例如 `run_layout_analysis(document_id, local_path)`），在技术文档中同步伪代码。
- **1.2 BabelDOC + DeepSeek 流水线稳定性与监控**（`backend/app/babeldoc_adapter.py`、`backend/app/tasks_translate.py`）
  - 在 `run_translate` 前后增加更详细的日志（输入路径、语言对、页范围、耗时）和异常分类：
    - 配置错误（缺 `DEEPSEEK_API_KEY` / BabelDOC import 失败）归类为 `config_error`；
    - DeepSeek API 调用失败（网络/额度）归类为 `upstream_error`；
    - 单文档内部错误（PDF 损坏）归类为 `document_error`；
  - 在 `run_translation_task` 中：
    - 将上述错误类型写入 `TranslationTask`（例如新增 `error_code`、`error_message` 字段），便于前端和运维展示。
    - 根据错误类型决定是否允许重试（为将来引入重试策略打基础）。
- **1.3 Celery 配置生产化**（`backend/app/celery_app.py`、`.env`）
  - 统一通过 `REDIS_URL` 控制 broker；为 result backend 预留 `CELERY_RESULT_BACKEND_URL`（当前仍保持关闭，避免影响主流程），在技术文档第 4 章中说明设计取舍。
  - 将 `tasks_pdf`、`tasks_translate` 的导入约定写入技术文档：所有新任务模块要在 `celery_app.py` 中显式导入，以保证 worker 注册完整。

## 二、存储与输出管理（本地 → R2 可迁移设计）

- **2.1 本地输出目录规范化**（`backend/app/babeldoc_adapter.py`、技术文档第 2/4 章）
  - 规范 `BABELDOC_OUTPUT_DIR` 目录结构：`{BABELDOC_OUTPUT_DIR}/{task_id}/...`，所有翻译结果必须放在该目录下；
  - 在文档中明确：
    - 本地开发使用文件系统；
    - 生产环境中，由 Worker 将该目录内文件同步到 R2，并只保留 `object_key`（例如 `translations/{task_id}/{file}`）。
- **2.2 任务视图与下载 API 固化为“稳定契约”**（`backend/app/routes/tasks.py`）
  - 将 `GET /api/tasks/{task_id}/view` 和 `GET /api/tasks/{task_id}/files/{filename}` 标注为 v1 稳定接口：
    - 文档中给出完整请求/响应示例；
    - 说明未来接入 R2 时，仅内部实现变更，不破坏前端协议。

## 三、前端功能闭环与用户体验

- **3.1 任务生命周期可视化**（`frontend/app/[locale]/page.tsx`）
  - 当前已实现：创建任务后轮询 `GET /api/tasks/{task_id}`，并在 UI 中显示状态。
  - 待补充：
    - 当状态为 `failed` 时，展示友好错误提示（使用后端的 `error_code` / `error_message`），引导用户重试或联系支持；
    - 在翻译进行中增加轻量 loading/进度提示（即便暂时没有真实进度，也可以基于 SSE 占位/估计时间）。
- **3.2 翻译结果下载与预览一体化**（`frontend/app/[locale]/page.tsx`、`components/PdfViewerPane.tsx`）
  - 将 `TaskView.outputs` 中第一个译文 PDF 的 URL 直接传给右侧 `PdfViewerPane`：
    - 左侧 `PdfViewerPane` 显示原文 PDF（后端需暴露原文预览 URL，或使用 R2 公共 URL）；
    - 右侧显示译文 PDF；
    - 使用相同的分页控件和视口高度，保证用户能同步翻页查看对比效果。
  - 为下载按钮保留：
    - 支持点击下载完整译文 PDF；
    - 将「下载」与「预览」分开，保证弱网场景下也能直接保存结果。
- **3.3 文档列表与任务历史**（`frontend` 新增简单页面）
  - 添加一个基础的「我的文档 / 最近任务」视图：
    - 调用 `GET /api/documents` 和 `GET /api/tasks`；
    - 支持按文档点击查看关联任务，并跳转到主页带上 `taskId`（例如 `/en?task=...`）自动展开状态与结果区块。

## 四、对 BabelDOC / MinerU 的对齐与扩展点

- **4.1 页数与布局分析扩展（参考 `tmp/BabelDOC-main` / `tmp/MinerU-master`）**
  - 在当前 `pdf_utils.get_pdf_page_count` 的基础上：
    - 在文档第 2 章补充对 MinerU/BabelDOC 上游项目的对比说明；
    - 设计未来的 `run_layout_analysis(document_id, local_path)` 接口（只在技术文档中规划，不立即实现），说明：
      - 如何从 MinerU 获取表格、公式、段落布局信息；
      - 如何将这些信息写入中间 IR，再由 BabelDOC/DeepSeek 使用。
- **4.2 BabelDOC 调用策略**
  - 在文档中明确：
    - 当前使用 `babeldoc.format.pdf.high_level.translate` + `OpenAITranslator`；
    - DeepSeek 调用遵循 OpenAI 兼容协议（`base_url` + `api_key` + `model`）；
    - 为未来切换模型（如 deepseek-v3 / deepseek-r1）保留配置项说明与建议。

## 五、技术文档同步与生产规范

- **5.1 文档章节更新**（`在线翻译网站-技术需求细化-中英西.md`）
  - 第 4 章：
    - 更新接口清单，补全：
      - `POST /api/upload/direct`（页数写入、BABELDOC_STAGING_DIR 约定）；
      - `POST /api/translate`（调用 Celery 任务、状态流转）；
      - `GET /api/tasks/{task_id}` / `tasks/{task_id}/view` / `tasks/{task_id}/files/{filename}`。
  - 第 2 章与 6 章：
    - 补充 `pdf_utils`、BabelDOC 输出目录结构、`TranslationTask` 状态与错误字段设计。
  - 第 9 章 Changelog：
    - 已新增 v0.7，后续每实现一批新功能（如登录、计费、支付、R2 存储）继续按此模式记录。

## 六、后续阶段（本轮之后）预告

- 登录与基础鉴权（Google / GitHub / 邮箱登录），与 `users`、`wallets` 表真正联通；
- 接入 Cloudflare R2 作为统一 PDF 存储与翻译结果存储，替换本地文件访问；
- 引入基础计费与额度控制（按页数 / Token 预估），并预留 Stripe/支付宝支付接口实现。

