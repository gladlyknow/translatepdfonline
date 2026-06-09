---
name: translatepdfonline-project
description: Use when modifying translatepdfonline (Next.js PDF translation site, Cloudflare, R2, Aliyun FC babeldoc_fc, Creem billing, next-intl, landing/docs MDX). Loads the project documentation map and constraints; do not treat ShipAny template README as product spec.
---

# translatepdfonline 项目 Skill

## 必读文档（先读再改代码）

1. [doc/ARCHIVE_INDEX.md](../../doc/ARCHIVE_INDEX.md) — 全仓库 MD/MDX 与链接勘误。
2. [frontend/docs/environment-variables.md](../../frontend/docs/environment-variables.md) — 本地 / CI / Worker 变量；Hyperdrive 与构建阶段限制。
3. [frontend/docs/translate-fc-contract.md](../../frontend/docs/translate-fc-contract.md) — Next 调用 FC 与回调字段（含计费页数字段）。

初始化与调用链：[frontend/docs/PROJECT_SETUP_AND_FC.md](../../frontend/docs/PROJECT_SETUP_AND_FC.md)。  
Cloudflare 构建与运行时差异：[frontend/docs/cloudflare-env-真相.md](../../frontend/docs/cloudflare-env-真相.md)。

## 按任务类型跳转

| 任务 | 文档 |
|------|------|
| 翻译流程、预览、轮询、R2 | [doc/technical/preview-polling-translation.md](../../doc/technical/preview-polling-translation.md)、[doc/technical/preview-r2-and-ux-updates.md](../../doc/technical/preview-r2-and-ux-updates.md) |
| FC 容器、本地 uvicorn | [babeldoc_fc/README.md](../../babeldoc_fc/README.md) |
| 支付、Creem、Webhook | [frontend/docs/creem-checkout-setup.md](../../frontend/docs/creem-checkout-setup.md) |
| 数据库 / Drizzle 迁移 | [frontend/docs/migrations/](../../frontend/docs/migrations/) |
| 认证、注册、上传门控 | [doc/technical/auth-and-registration.md](../../doc/technical/auth-and-registration.md) |
| 访客指纹、下载、限流 | [doc/technical/guest-fingerprint-download-ratelimit.md](../../doc/technical/guest-fingerprint-download-ratelimit.md) |
| 产品范围、非功能需求（摘要） | [doc/REQUIREMENTS.md](../../doc/REQUIREMENTS.md) |
| 架构总览 | [doc/TECHNICAL_OVERVIEW.md](../../doc/TECHNICAL_OVERVIEW.md) |
| 站内 MDX（条款、日志、文档首页） | [doc/CONTENT_MDX_SUMMARY.md](../../doc/CONTENT_MDX_SUMMARY.md) |

实现计划与历史：`.cursor/plans/**/*.plan.md`；与 **doc/technical/** 重复时以 **后提交** 为准，存档阅读优先 **doc/technical/**。

## 约定

- **不要**把 [frontend/README.md](../../frontend/README.md)（ShipAny 模板）当作业务需求；版权声明与模板链接保持原样，除非刻意替换模板。
- **营销文案 / 多语言 UI 字符串**：`frontend/src/config/locale/messages`；**文档站 / 条款 / 日志长文**：`frontend/content/**/*.mdx`（见 CONTENT_MDX_SUMMARY）。
- **主 CTA 品牌渐变**等业务样式：[frontend/src/config/translate-ui.ts](../../frontend/src/config/translate-ui.ts)。

## 已知陷阱

- 根 README 曾指向不存在的 `doc/*.md`；已统一到 [doc/ARCHIVE_INDEX.md](../../doc/ARCHIVE_INDEX.md) 勘误表。
- `DATABASE_URL` 在 **Node 构建** 阶段不能使用 Hyperdrive 代理主机名；见 cloudflare-env 文档。
- Celery Worker 文档为遗留路径；当前主线以 **FC + 回调** 为准，见 worker-health-check 说明。
