

# Google 登录品牌展示与合规

本文档记录为通过 Google OAuth 品牌审核所做的首页合规要求及实现方式。

## 背景问题

使用 Google 登录（OAuth）时，Google 会审核站点是否满足品牌与政策展示要求。若**首页**（如 `https://entity-echo.com`）未包含指向隐私权政策的链接，审核会不通过，提示类似：

- 「您的首页网址中不包含指向隐私权政策的链接」
- 「解决方案：首页不包含指向隐私权政策的链接」

Google 的审核员或爬虫会直接打开首页，在页面上查找 **「Privacy Policy」** 字样及可点击链接。

## 合规要求

- 在**首页**上必须有**显眼的**隐私政策链接。
- 推荐位置：首页底部（Footer），与用户可见的「Privacy Policy」文字一起出现。

## 实现方案

### 1. 页脚：审核要求的显眼链接（必做）

Google 建议在首页底部加上**一行字**，且 HTML 中为：

```html
<a href="/privacy">隐私权政策 (Privacy Policy)</a>
```

当前实现：

- 在 **Footer 最底部** 增加一条独立横栏（全宽、居中），**仅包含**上述链接。
- 使用**静态文案**「隐私权政策 (Privacy Policy)」（不随语言切换），确保爬虫/审核在任何语言下都能在首页 HTML 中看到该字样。
- 使用原生 `<a href="/privacy">`，便于审核识别。

### 2. 页脚 Legal 列（可选）

- **Privacy Policy** / **Terms of Service**：仍在 Footer 的 Legal 列中保留多语言链接，指向 `/privacy`、`/terms`。

### 3. 隐私政策页面 `/privacy`

- 路径：`https://entity-echo.com/privacy`（须与 Google Cloud Console「OAuth 同意屏幕」中的「应用隐私权政策链接」**完全一致**）。
- 内容：完整六段式政策（我们收集的信息、如何使用、共享与披露、数据安全、您的权利、联系我们），中英按 locale 切换；联系邮箱：support@entity-echo.com。
- 实现：`web/app/privacy/page.tsx`（含 PRIVACY_CONTENT_ZH / PRIVACY_CONTENT_EN）。

### 4. 涉及文件

| 文件 | 说明 |
|------|------|
| `web/components/Footer.tsx` | 页脚：底部横栏静态「隐私权政策 (Privacy Policy)」+ Legal 列多语言链接 |
| `web/app/privacy/page.tsx` | 隐私政策页：完整政策正文，中英双语 |
| `web/messages/en.json` / `zh.json` | `footer.privacyPolicy`、`footer.termsOfService`（Legal 列用） |

### 5. 审核与配置检查

- **首页 HTML**：部署后打开 `https://entity-echo.com`，查看源码，确认存在可见的「隐私权政策 (Privacy Policy)` 或 "Privacy Policy" 文本及 `<a href="/privacy">`。
- **OAuth 同意屏幕**：在 Google Cloud Console 中，「应用隐私权政策链接」必须填写 `https://entity-echo.com/privacy`，且与站点实际 URL 一致。

## 若审核仍不通过

- 再次确认首页**服务端渲染出的 HTML**（禁用 JS 或 curl 首页）中是否包含上述链接与文案。
- 若审核要求链接在「首屏」可见，可在 Header 或 Hero 下方增加一行小字：`<a href="/privacy">隐私权政策 (Privacy Policy)</a>`。
