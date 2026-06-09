# 页面清理审计（strict_reference_only）

目标目录核查：

- `src/app/[locale]/(landing)/(ai)`（候选）
- `src/app/[locale]/(landing)/activity/chats`（保留）
- `src/app/[locale]/(landing)/activity/ai-tasks`（保留）
- `src/app/[locale]/(landing)/showcases`（保留）
- `src/app/[locale]/(chat)`（保留）

## 保留项（存在明确引用）

- `activity/chats`：
  - 多语言侧边栏配置存在 `/activity/chats`
  - 目录页面仍被活动页体系使用
- `activity/ai-tasks`：
  - 多语言侧边栏配置存在 `/activity/ai-tasks`
  - 活动根页重定向到该路由
- `showcases`：
  - `sitemap` 含 `/showcases`
  - 多语言 `pages/showcases` 数据与页面代码在用
- `(chat)`：
  - 多语言 `ai/chat` 文案、站点 `robots`、聊天组件链路均引用

## 可清理项（本次执行）

`(landing)/(ai)` 下 3 个页面仅自引用，无站内入口或配置引用：

- `src/app/[locale]/(landing)/(ai)/ai-image-generator/page.tsx`
- `src/app/[locale]/(landing)/(ai)/ai-music-generator/page.tsx`
- `src/app/[locale]/(landing)/(ai)/ai-video-generator/page.tsx`

处理策略：

- 仅删除上述 3 个页面文件；
- 其余目录与功能保持不动，避免误删。

