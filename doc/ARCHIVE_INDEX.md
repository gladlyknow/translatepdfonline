# translatepdfonline — 文档存档总索引

> 最后整理目的：为项目结项与后续迭代提供**单一入口**；标明「必读」「运维真相」「历史设计」与根 README **失效链接的勘误**。

---

## 1. 必读（当前部署与契约）

| 文档 | 路径 | 类型 | 必读 |
|------|------|------|:----:|
| 环境变量（本地 / CI / Worker） | [frontend/docs/environment-variables.md](../frontend/docs/environment-variables.md) | 运维 | 是 |
| Cloudflare 构建与运行时变量真相 | [frontend/docs/cloudflare-env-真相.md](../frontend/docs/cloudflare-env-真相.md) | 运维 | 是 |
| 项目初始化、FC 调用流程 | [frontend/docs/PROJECT_SETUP_AND_FC.md](../frontend/docs/PROJECT_SETUP_AND_FC.md) | 架构/运维 | 是 |
| Next ↔ FC 请求与回调契约 | [frontend/docs/translate-fc-contract.md](../frontend/docs/translate-fc-contract.md) | 契约 | 是 |
| Creem 支付与 Webhook | [frontend/docs/creem-checkout-setup.md](../frontend/docs/creem-checkout-setup.md) | 集成 | 视任务 |
| 数据库迁移说明与 SQL | [frontend/docs/migrations/README.md](../frontend/docs/migrations/README.md) | 迁移 | 视任务 |
| BabelDOC FC 服务说明 | [babeldoc_fc/README.md](../babeldoc_fc/README.md) | 服务 | 是 |
| OCR Queue 与管线（Workbench / R2 JSON） | [frontend/docs/ocr-queue-and-pipeline.md](../frontend/docs/ocr-queue-and-pipeline.md) | 运维/架构 | 改 OCR 派发时 |

---

## 2. 技术设计长文（`doc/technical/`，与 `.cursor/plans/doc` 同步副本）

以下文件在仓库中 **两份路径并存**：`doc/technical/`（建议作为克隆后阅读路径）与 `.cursor/plans/doc/`（Cursor 计划目录）。内容应以**后提交者为准**；若需单一事实来源，以 **`doc/technical/`** 为存档 canonical。

| 文档 | `doc/technical/` 路径 | 类型 | 必读 |
|------|------------------------|------|:----:|
| 预览、轮询、漏句、去重 | [technical/preview-polling-translation.md](./technical/preview-polling-translation.md) | 架构 | 改预览/翻译流时 |
| 指纹、下载限制、限流 | [technical/guest-fingerprint-download-ratelimit.md](./technical/guest-fingerprint-download-ratelimit.md) | 架构 | 改访客逻辑时 |
| 认证与注册 | [technical/auth-and-registration.md](./technical/auth-and-registration.md) | 架构 | 改登录注册时 |
| 译文 R2、分片预览、UX | [technical/preview-r2-and-ux-updates.md](./technical/preview-r2-and-ux-updates.md) | 架构 | 改 R2/预览时 |
| Worker 健康检查说明 | [technical/worker-health-check.md](./technical/worker-health-check.md) | 运维/历史 | 自建 Worker 时 |
| Google 相关笔记 | [technical/google.md](./technical/google.md) | 集成 | 视任务 |
| 在线 PDF 翻译站需求与规划（长文） | [technical/online-pdf-translate-site-spec_4e7a7b0f.plan.md](./technical/online-pdf-translate-site-spec_4e7a7b0f.plan.md) | 需求/历史 | 产品对齐时 |
| 下一步规划 | [technical/translatepdfonline-next-steps_9ab66596.plan.md](./technical/translatepdfonline-next-steps_9ab66596.plan.md) | 规划 | 存档 |
| 前端上传与 PDF 预览 | [technical/frontend-ux-pdf-preview_33efb8aa.plan.md](./technical/frontend-ux-pdf-preview_33efb8aa.plan.md) | 设计 | 存档 |
| 预览轮询修复 | [technical/preview_polling_translation_fix_3dda77f9.plan.md](./technical/preview_polling_translation_fix_3dda77f9.plan.md) | 设计 | 存档 |
| 对比预览与进度 | [technical/preview_sync_progress_reassurance_889b9bf1.plan.md](./technical/preview_sync_progress_reassurance_889b9bf1.plan.md) | 设计 | 存档 |
| i18n / DeepSeek / 预览 | [technical/i18n_deepseek_preview_sync_e16d65d7.plan.md](./technical/i18n_deepseek_preview_sync_e16d65d7.plan.md) | 设计 | 存档 |
| 指纹下载限流（规划） | [technical/指纹下载限流与文档_34679bed.plan.md](./technical/指纹下载限流与文档_34679bed.plan.md) | 设计 | 存档 |
| DB / Redis 变更流程 | [technical/db-redis-change-workflow_6ffafc63.plan.md](./technical/db-redis-change-workflow_6ffafc63.plan.md) | 运维 | 改库时 |
| 本目录说明 | [technical/README.md](./technical/README.md) | 索引 | — |

---

## 3. 精炼存档（本目录新建）

| 文档 | 路径 | 说明 |
|------|------|------|
| 需求摘要 | [REQUIREMENTS.md](./REQUIREMENTS.md) | 从规划长文抽取的范围与非功能需求 |
| 技术总览 | [TECHNICAL_OVERVIEW.md](./TECHNICAL_OVERVIEW.md) | 架构图与模块导航 |
| 站内 MDX 用途 | [CONTENT_MDX_SUMMARY.md](./CONTENT_MDX_SUMMARY.md) | `frontend/content` 下 MDX 分类说明 |

---

## 4. 根目录与其它 Markdown

| 文档 | 路径 | 类型 |
|------|------|------|
| 仓库总览（含后端说明，与 FC 主线可能并存） | [../README.md](../README.md) | 入口 |
| 技术索引入口 | [README.md](./README.md) | 索引 |
| ShipAny 模板说明（非业务） | [../frontend/README.md](../frontend/README.md) | 模板 |
| 品牌资源 | [../frontend/public/brand/README.md](../frontend/public/brand/README.md) | 资源 |
| 对比图资源 | [../frontend/public/translate-compare/README.md](../frontend/public/translate-compare/README.md) | 资源 |
| 部署脚本 | [../scripts/deploy/README.md](../scripts/deploy/README.md) | 运维 |
| BabelDOC 上游（临时/子模块） | `tmp/BabelDOC/**/*.md` | 上游 |

---

## 5. Cursor 实现计划（节选）

路径：`/.cursor/plans/*.plan.md`（数量多，**不**在索引中逐条展开）。与 `doc/technical/` **重叠**的文档以 `doc/technical/` 为准阅读；其余计划按文件名主题检索（部署、Creem、预览、FC、多语言首页等）。

---

## 6. 根 README 链接勘误表

根 [README.md](../README.md) 中曾指向 **`doc/` 下不存在的文件名**，按下表改为有效路径：

| 原链接（无效或易误解） | 应使用 |
|------------------------|--------|
| `在线翻译网站-技术需求细化-中英西.md` | 仓库内无此文件；需求见 [technical/online-pdf-translate-site-spec_4e7a7b0f.plan.md](./technical/online-pdf-translate-site-spec_4e7a7b0f.plan.md) 与 [REQUIREMENTS.md](./REQUIREMENTS.md) |
| `doc/worker-health-check.md` | [technical/worker-health-check.md](./technical/worker-health-check.md) |
| `doc/preview-polling-translation.md` | [technical/preview-polling-translation.md](./technical/preview-polling-translation.md) |
| `doc/guest-fingerprint-download-ratelimit.md` | [technical/guest-fingerprint-download-ratelimit.md](./technical/guest-fingerprint-download-ratelimit.md) |
| `doc/preview-r2-and-ux-updates.md` | [technical/preview-r2-and-ux-updates.md](./technical/preview-r2-and-ux-updates.md) |

通用规则：**详细设计** → `doc/technical/`；**环境与 FC 契约** → `frontend/docs/`。

---

## 7. Cursor Skill

后续迭代时由 Agent 加载的项目说明： [../.cursor/skills/translatepdfonline-project/SKILL.md](../.cursor/skills/translatepdfonline-project/SKILL.md)
