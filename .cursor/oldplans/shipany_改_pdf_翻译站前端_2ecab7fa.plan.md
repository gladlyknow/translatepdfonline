---
name: ShipAny 改 PDF 翻译站前端
overview: 将 ShipAny 模板残留的文案与品牌全部改为「在线 PDF 翻译」产品：涉及配置默认值、中英文 landing/首页/定价/博客/管理后台/公共组件与文案，按文件列出可手动修改的位置与建议替换内容。
todos: []
isProject: false
---

# ShipAny 改 PDF 翻译站 — 前端手动更改建议

## 当前状态

- **已改为 PDF 翻译**：英文 [en/landing.json](frontend/src/config/locale/messages/en/landing.json)（Header/Footer 为 "Translate PDF Online"）、[en/common.json](frontend/src/config/locale/messages/en/common.json)（metadata 为 PDF 翻译描述与关键词）。
- **仍为 ShipAny**：默认 app 名、中文 landing/首页/定价/博客/展示、管理侧栏、AI 聊天标题、Built with 链接、设置项占位符等。

以下按「改什么、在哪改、建议改成啥」列出，便于你本地手动改。

---

## 一、配置默认值（一处）


| 文件                                                           | 位置             | 当前              | 建议                       |
| ------------------------------------------------------------ | -------------- | --------------- | ------------------------ |
| [frontend/src/config/index.ts](frontend/src/config/index.ts) | `app_name` 默认值 | `'ShipAny App'` | `'Translate PDF Online'` |


说明：未设置 `NEXT_PUBLIC_APP_NAME` 时，全站会用该默认名（管理后台、邮件、版权等）。

---

## 二、中文 landing / 导航 / 页脚（与 en 对齐）


| 文件                                                                     | 键路径                             | 当前                  | 建议                                                     |
| ---------------------------------------------------------------------- | ------------------------------- | ------------------- | ------------------------------------------------------ |
| [zh/landing.json](frontend/src/config/locale/messages/zh/landing.json) | `header.brand.title`            | "ShipAny Two"       | "在线 PDF 翻译" 或 "Translate PDF Online"                   |
| 同上                                                                     | `header.brand.logo.alt`         | "ShipAny Two"       | 与 title 一致                                             |
| 同上                                                                     | `header.topbanner.text`         | ShipAny 模板演示、购买模板链接 | 改为产品宣传，如：「专业 AI PDF 翻译，保留版式与字体，支持中英西」并链接到 `/translate` |
| 同上                                                                     | `footer.brand.title`            | "ShipAny Two"       | 与 header 一致                                            |
| 同上                                                                     | `footer.brand.description`      | ShipAny NextJS 模板…  | 与 en 一致的中文版：如「精准翻译 PDF，保留版式与表格，安全快速，无需安装」              |
| 同上                                                                     | `footer.brand.logo.alt`         | "ShipAny Two"       | 与 title 一致                                             |
| 同上                                                                     | 若存在 `footer` 内链接到 shipany.ai 的项 | 指向 ShipAny 官网       | 删除或改为本站 /translate、/pricing                            |


建议：把 zh 的 header/footer 结构对齐 en（仅保留 PDF 翻译、定价等与产品相关的导航），去掉「功能亮点 / 案例展示 / AI 图片|音乐|视频|聊天 / 博客 / 更新日志 / 文档」等模板演示项，或改为你打算保留的少数入口。

---

## 三、中文全局 metadata（SEO）


| 文件                                                                   | 键路径                    | 当前                            | 建议                                        |
| -------------------------------------------------------------------- | ---------------------- | ----------------------------- | ----------------------------------------- |
| [zh/common.json](frontend/src/config/locale/messages/zh/common.json) | `metadata.title`       | "ShipAny 模板二"                 | "在线 PDF 翻译"                               |
| 同上                                                                   | `metadata.description` | ShipAny NextJS 脚手架…           | 与 en 一致的中文版，如「精准翻译 PDF，保留版式与表格，安全快速，无需安装」 |
| 同上                                                                   | `metadata.keywords`    | shipany, shipany-boilerplate… | pdf 翻译、在线翻译 pdf、中英西 pdf 等                 |


---

## 四、首页（index）— 多语言

首页 [en/pages/index.json](frontend/src/config/locale/messages/en/pages/index.json) 与 [zh/pages/index.json](frontend/src/config/locale/messages/zh/pages/index.json) 中大量「What is ShipAny」「Why Choose ShipAny」「Get ShipAny」、用户评价、FAQ 等均为模板内容。

- **若保留独立首页**：建议整体改写为「产品介绍 + 使用步骤 + PDF 翻译功能亮点 + 简短 FAQ」，并统一品牌为「Translate PDF Online」/「在线 PDF 翻译」；所有 "ShipAny" 替换为产品名，所有 CTA/链接改为 `/translate` 或 `/pricing`。
- **若以翻译页为主入口**：可只做最小修改——把 index 中的品牌与链接改为本站与 `/translate`，文案可后续再逐步替换。

关键键示例（两语言同理）：`hero.description`、`hero.title`、`avatars_tip`、`what_is_`*、`why_choose_`*、`how_to_launch_*`、`key_features_*`、`testimonials`、`faq`、`cta.description`、`cta.buttons[].title`、`newsletter.description` 等，凡出现 "ShipAny" 或模板购买链接均改为产品名与本站链接。

---

## 五、定价页（pricing）

[en/pages/pricing.json](frontend/src/config/locale/messages/en/pages/pricing.json) 与 [zh/pages/pricing.json](frontend/src/config/locale/messages/zh/pages/pricing.json) 当前为 ShipAny 模板定价（Starter/Standard/Premium、月付/年付等）。

- **若你已有 PDF 翻译产品的定价方案**：用新标题、描述、套餐名与价格整体替换现有结构，并统一品牌为 "Translate PDF Online" / "在线 PDF 翻译"。
- **若暂不提供付费**：可保留文件结构，仅把 `title`、`description`、各 `product_name`、按钮 `title` 等中的 "ShipAny" 改为产品名，链接改为 `/translate` 或 "#"；或暂时隐藏/重定向定价入口，待定价确定后再改文案。

---

## 六、博客 / 案例展示 / 其他页面


| 文件                                                                                     | 建议                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [en/pages/blog.json](frontend/src/config/locale/messages/en/pages/blog.json)           | `title`: "ShipAny Blog" → "Translate PDF Online Blog" 或 "Blog" |
| [zh/pages/blog.json](frontend/src/config/locale/messages/zh/pages/blog.json)           | 同上，中文「博客」或「在线 PDF 翻译 博客」                                       |
| [en/pages/showcases.json](frontend/src/config/locale/messages/en/pages/showcases.json) | 描述与标题中的 "ShipAny" → 产品名；若暂无案例可改为「使用本产品翻译的示例」类中性文案              |
| [zh/pages/showcases.json](frontend/src/config/locale/messages/zh/pages/showcases.json) | 同上                                                             |


---

## 七、管理后台侧栏（品牌）


| 文件                                                                                 | 键路径                             | 当前            | 建议                                   |
| ---------------------------------------------------------------------------------- | ------------------------------- | ------------- | ------------------------------------ |
| [en/admin/sidebar.json](frontend/src/config/locale/messages/en/admin/sidebar.json) | `header.brand.title`、`logo.alt` | "ShipAny Two" | "Translate PDF Online"               |
| [zh/admin/sidebar.json](frontend/src/config/locale/messages/zh/admin/sidebar.json) | 同上                              | "ShipAny Two" | "在线 PDF 翻译" 或 "Translate PDF Online" |


---

## 八、AI 聊天页标题（若保留该入口）


| 文件                                                                     | 键路径                             | 当前             | 建议                              |
| ---------------------------------------------------------------------- | ------------------------------- | -------------- | ------------------------------- |
| [en/ai/chat.json](frontend/src/config/locale/messages/en/ai/chat.json) | `header.brand.title`、`logo.alt` | "ShipAny Chat" | "Translate PDF Online" 或 "Chat" |
| [zh/ai/chat.json](frontend/src/config/locale/messages/zh/ai/chat.json) | 同上                              | "ShipAny Chat" | "在线 PDF 翻译" 或 "聊天"              |


---

## 九、公共组件（Built with）


| 文件                                                                                                   | 位置            | 当前                                   | 建议                                             |
| ---------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------ | ---------------------------------------------- |
| [frontend/src/shared/blocks/common/built-with.tsx](frontend/src/shared/blocks/common/built-with.tsx) | Link 文案与 href | "Built with ❤️ ShipAny" → shipany.ai | 改为 "Translate PDF Online" 链接到本站 `/`，或删除该区块若不需要 |


---

## 十、设置服务占位符与描述（后台配置项）

[frontend/src/shared/services/settings.ts](frontend/src/shared/services/settings.ts) 中部分默认描述、placeholder 仍含 ShipAny / Affonso / PromoteKit：

- 搜索 `ShipAny`、`shipany`、`affonso`、`promotekit`，将面向「站点名称、发件人、域名」等的占位与说明改为产品相关（如 "Translate PDF Online"、`translatepdfonline.com`、`hello@translatepdfonline.com`），避免后台配置界面仍显示模板品牌。

---

## 十一、实施顺序建议

1. **先改影响全站的**：`config/index.ts` 默认 `app_name`、`zh/common.json` metadata、`zh/landing.json` header/footer/topbanner。
2. **再改导航与入口**：zh landing 的 nav 与 en 对齐（以 PDF 翻译、定价为主），删或改无关模板入口。
3. **然后按需改**：index 首页（可先只替换品牌与链接）、pricing、blog、showcases、admin/ai 侧栏、built-with、settings 占位符。

按上述清单在对应文件里查找并替换即可；若需要，我可以再按「仅改品牌不改结构」给出一份逐文件 search/replace 列表（仅字符串级别）。