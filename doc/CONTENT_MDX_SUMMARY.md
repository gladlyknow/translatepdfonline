# `frontend/content` — MDX 用途说明（存档）

站内 **用户可见** 文案由 MDX 提供，与 `src/config/locale/messages` 中的 JSON 文案并存；**勿**将 MDX 全文再复制到 `doc/`，以免双处维护。

## `content/docs/`

- **作用**：文档站首页/索引类内容（多语言：`index.mdx`、`index.zh.mdx`、`index.es.mdx`、`index.de.mdx`、`index.fr.mdx`、`index.it.mdx`、`index.el.mdx`、`index.ja.mdx`、`index.ko.mdx`、`index.ru.mdx`）。
- **维护**：新增语言时复制对应 `index.<locale>.mdx` 模式。

## `content/pages/`

- **作用**：独立页面——隐私政策、服务条款（`privacy-policy*.mdx`、`terms-of-service*.mdx`，含中/西等变体）。
- **维护**：法律文案变更时同步各语言文件。

## `content/logs/`

- **作用**：版本更新日志（如 `v1.0.mdx`、`v2.0.mdx` 及 `.zh` / `.es` 变体）。
- **维护**：发版时追加条目。

## `content/posts/`

- **作用**：博客/文章类（如 `what-is-xxx.mdx` 及多语言变体）。
- **维护**：按文章维度增加 MDX 与路由配置（若主题有 posts 路由）。

完整文件列表可在仓库中搜索 `frontend/content/**/*.mdx`（当前约 25 个文件）。
