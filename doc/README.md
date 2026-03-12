# 技术文档索引

本目录包含 translatepdfonline 项目的技术文档与历史规划。

## 主技术文档

| 文档 | 说明 |
|------|------|
| [preview-polling-translation.md](preview-polling-translation.md) | 预览规则、轮询/SSE、漏句与列表配置、去重翻译、译文仅 mono、翻译失败联系提示 |
| [guest-fingerprint-download-ratelimit.md](guest-fingerprint-download-ratelimit.md) | 指纹绑定、下载限制、限流、Google 登录数据迁移 |
| [auth-and-registration.md](auth-and-registration.md) | 认证（NextAuth v5）、注册（邮箱验证码）、密码策略、Resend 发信、上传门控、注册后自动登录 |
| [preview-r2-and-ux-updates.md](preview-r2-and-ux-updates.md) | 译文 PDF 走 R2 消除 404、预览加载与分片优化（源切片/PyMuPDF/Range）、前端简约重设计与首排折叠、CORS 与兜底 |
| [worker-health-check.md](worker-health-check.md) | Celery Worker 健康检测脚本用法、Windows 任务计划程序与 Linux cron/systemd 配置示例、按退出码重启 Worker |

## 历史 Plan 文件（按主题）

| 文件 | 主题 |
|------|------|
| online-pdf-translate-site-spec_*.md | 产品与技术需求规划 |
| translatepdfonline-next-steps_*.md | 项目下一步规划 |
| frontend-ux-pdf-preview_*.md | 前端上传与 PDF 预览体验 |
| preview_polling_translation_fix_*.md | PDF 预览、轮询、漏译修复 |
| preview_sync_progress_reassurance_*.md | 对比预览、进度与安抚文案 |
| i18n_deepseek_preview_sync_*.md | 多语言、DeepSeek 配置、预览同步 |
| 指纹下载限流与文档_*.md | 指纹、下载限制、限流、文档 |
| db-redis-change-workflow_*.md | 数据库与 Redis 变更流程 |
