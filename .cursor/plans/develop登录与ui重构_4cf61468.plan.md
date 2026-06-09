---
name: develop登录与UI重构
overview: 先仅在 develop/dev Worker 范围内完成 UI 去AI化改版与认证修复，确保不影响 master 生产；并且明确按 tmp/images 替换按钮与 SVG，认证配置保持“数据库优先”并参照 tmp/src_bak 的原始实现风格。
todos:
  - id: ui-minimal-redesign
    content: 去AI化重做首页与按钮风格并改 OCR 文案为 PDF OCR（按钮/SVG参照 tmp/images）
    status: pending
  - id: replace-logo-assets
    content: 替换项目 Logo 与缩略图资源（LOGO_T-PDF.jpeg / T-PDF.jpeg）
    status: pending
  - id: upload-history-popover
    content: upload 页移除正文 history，改为右上角 history 弹出交互
    status: pending
  - id: google-state-fix
    content: 修复 Google 登录 state_not_found/403 的域名与回调状态链路
    status: pending
  - id: social-no-email-verify
    content: 实现社交登录不触发邮箱验证，邮箱登录保留验证
    status: pending
  - id: email-delivery-fix
    content: 修复 Resend 发信与 verify-email 收不到邮件，保持数据库配置读取优先
    status: pending
  - id: dev-safe-deploy
    content: 固化 develop 专用部署命令与变量保留策略，确保不影响 master
    status: pending
  - id: preserve-db-config-logic
    content: 保持 google/github/ads/resend 的数据库获取逻辑，不做破坏性重构，按 tmp/src_bak 校对差异
    status: pending
isProject: false
---

# Develop 环境 UI 与登录修复计划

## 目标与边界
- 仅修改 develop 发布链路与对应代码行为，**不直接改动 master 线上运行效果**。
- UI 目标：简约、整洁、去 AI 化、减少渐变、蓝色按钮基调；`OCR` 文案改 `PDF OCR`。
- 认证目标：修复 Google 登录 `state_not_found/403`，并减少验证拦截（Google 社交登录不触发邮箱验证；邮箱登录保留验证）。
- 设计资源约束：按钮与 SVG 替换以 `D:/imppro/translatepdfonline/tmp/images` 为参照源，必要资源迁移到 `frontend/public/imgs/...`。
- 逻辑约束：尽量保持 google、github、ads、resend 的“数据库优先读取”逻辑；以 `D:/imppro/translatepdfonline/tmp/src_bak` 为行为对照，不做无关重写。

## 实施步骤
- 调整首页导航与按钮风格基线
  - 修改多语言文案：`[D:/imppro/translatepdfonline/frontend/src/config/locale/messages/en/landing.json](D:/imppro/translatepdfonline/frontend/src/config/locale/messages/en/landing.json)`、`[D:/imppro/translatepdfonline/frontend/src/config/locale/messages/zh/landing.json](D:/imppro/translatepdfonline/frontend/src/config/locale/messages/zh/landing.json)` 将 `OCR` 改为 `PDF OCR`。
  - 统一按钮主色与弱化渐变：`[D:/imppro/translatepdfonline/frontend/src/config/style/theme.css](D:/imppro/translatepdfonline/frontend/src/config/style/theme.css)`、`[D:/imppro/translatepdfonline/frontend/src/config/translate-ui.ts](D:/imppro/translatepdfonline/frontend/src/config/translate-ui.ts)`、`[D:/imppro/translatepdfonline/frontend/src/themes/default/blocks/hero.tsx](D:/imppro/translatepdfonline/frontend/src/themes/default/blocks/hero.tsx)`。
  - 参考图素材搬运到 `frontend/public/imgs/...`（从 `D:/imppro/translatepdfonline/tmp/images` 选取按钮/SVG），避免直接磁盘路径引用。
  - 替换品牌资源：使用 `D:/imppro/translatepdfonline/tmp/images/LOGO_T-PDF.jpeg` 作为站点 logo，`D:/imppro/translatepdfonline/tmp/images/T-PDF.jpeg` 作为缩略图/分享图（落地到 `frontend/public/imgs/...` 并更新对应引用配置）。

- 重构 upload 页 history 交互
  - 在 `[D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/upload/UploadPageClient.tsx](D:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/upload/UploadPageClient.tsx)` 中移除正文内 history 内容。
  - 复用悬浮历史面板组件 `[D:/imppro/translatepdfonline/frontend/src/shared/components/translate/HistoryPanel.tsx](D:/imppro/translatepdfonline/frontend/src/shared/components/translate/HistoryPanel.tsx)`，仅保留页首右上角入口。
  - 保持任务点击分流逻辑（普通翻译/ocrtranslator）不回退。

- 修复 Google 登录与回调状态
  - 核对并修复鉴权基准 URL 与回调一致性：`[D:/imppro/translatepdfonline/frontend/src/core/auth/config.ts](D:/imppro/translatepdfonline/frontend/src/core/auth/config.ts)`、`[D:/imppro/translatepdfonline/frontend/src/core/auth/client.ts](D:/imppro/translatepdfonline/frontend/src/core/auth/client.ts)`、`[D:/imppro/translatepdfonline/frontend/src/app/api/auth/[...all]/route.ts](D:/imppro/translatepdfonline/frontend/src/app/api/auth/[...all]/route.ts)`。
  - 增加诊断日志降噪与关键字段日志（仅 develop 用），定位 `state` 丢失点（域名、cookie、origin）。
  - 保持 social provider 读取来源与现有 DB 配置模型一致（google/github 不改为硬编码 env-only）。

- 落实“社交登录不触发邮箱验证”策略
  - 在 `[D:/imppro/translatepdfonline/frontend/src/core/auth/config.ts](D:/imppro/translatepdfonline/frontend/src/core/auth/config.ts)` 中调整 email verification 触发条件：
    - Google 登录成功后不强制走 verify-email 页面；
    - 邮箱密码登录维持可配置验证。
  - 保留开关化控制，避免后续切回严格策略需要大改。

- 修复邮件发送链路（收不到信）
  - 对齐配置键：支持 `resend_sender_email` 与当前常见 `RESEND_FROM` 的兼容映射（代码层兜底）。
  - 完善发送失败日志与用户提示：`[D:/imppro/translatepdfonline/frontend/src/shared/services/email.ts](D:/imppro/translatepdfonline/frontend/src/shared/services/email.ts)`、`[D:/imppro/translatepdfonline/frontend/src/extensions/email/resend.ts](D:/imppro/translatepdfonline/frontend/src/extensions/email/resend.ts)`。
  - 明确“配置来自 DB 优先 + env 兜底”的读取顺序并避免空值覆盖；与 `D:/imppro/translatepdfonline/tmp/src_bak` 做差异对照后再改。

- develop 部署与变量保留（不碰 master）
  - 使用现有隔离配置：`wrangler.toml` 的 `[env.develop]` 与 `wrangler.consumer.develop.jsonc`。
  - 仅给出/执行 develop 命令：`wrangler deploy --env develop --keep-vars` + develop consumer deploy。
  - 明确 Cloudflare Builds 中“非生产分支部署命令”不得回退到 `versions upload`。

## 验证与回归
- UI：首页导航文案、按钮样式、upload 页 history 入口位置与交互。
- Auth：Google 登录完整回调闭环，不再出现 `state_not_found`；邮箱登录按策略表现一致。
- Mail：触发 verify-email 时在日志中可追踪发送结果；用户可收到邮件。
- Deploy：仅 `translatepdfonline-dev` / `translatepdfonline-quenues-dev` 更新，master 服务不变。

## 交付物
- 代码改动（仅 develop 目标行为）。
- 一份简短运维清单：Cloudflare Build 命令、非生产部署命令、必要变量键（DB/env）对照。