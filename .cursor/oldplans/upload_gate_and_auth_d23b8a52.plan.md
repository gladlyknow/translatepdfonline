---
name: Upload gate and Auth
overview: 实现「未登录仅能上传一个文件、再次上传需先登录」的上传门控，并在本项目中接入 Auth.js/NextAuth v5、邮箱注册与验证码、密码策略及首屏性能与体验要求（3.2–3.5）。
todos: []
isProject: false
---

# 上传门控 + 认证/注册/密码策略与体验（3.2–3.5）

## 一、需求 1：上传限制与再次上传需登录

### 现状

- 后端仅在 **presigned/complete** 时校验「临时用户已有 1 个文档」并返回 `login_required_for_multiple_documents`，文件已先上传到 R2，造成浪费且体验差。
- 前端在 complete 失败后展示 loginHint，但未在「发起第二次上传前」阻止。

### 目标

- 未登录用户只能上传**一个**文件；**再次上传前**必须先登录，不登录不允许上传（在获取上传凭证前就拦截）。

### 实现要点

**后端**（[backend/app/routes/upload.py](backend/app/routes/upload.py)）

- 在 **create_presigned_upload**（约 75 行）：在生成预签名 URL 前，若 `user.is_temporary` 且该用户已有 `Document` 数量 ≥ 1，直接返回 `403`，`detail="login_required_for_multiple_documents"`。不再在 complete 时才拒绝。
- 在 **direct_upload**（约 33 行）：同样在写入文件前增加「临时用户 + 已有 1 个文档 → 403」。
- 在 **init_multipart_upload** 与 **complete_multipart_upload**：同样增加上述校验，保证所有上传入口一致。

**前端**（[frontend/components/UploadDropzone.tsx](frontend/components/UploadDropzone.tsx)）

- 当前流程：`createPresignedUpload` → PUT → `completePresignedUpload`。complete 失败时已展示「请登录」。
- 改为在 **createPresignedUpload** 失败且 `detail === "login_required_for_multiple_documents"` 时：不发起 PUT，直接清空/不更新 uploaded 状态，并展示「请先登录后再上传更多文件」的提示（可复用或微调现有 `loginHint` 文案）。
- 可选：若已有 `documentId`（来自父组件）且希望更早提示，可在 dropzone 区域增加「您已上传 1 个文件，登录后可继续上传」的说明；不依赖新接口，仅根据 props 与现有 403 处理即可。

---

## 二、需求 3.2：认证（Auth.js / NextAuth v5）

### 目标

- 支持 **Email + Password**（后端校验/登录）。
- 支持 **Google OAuth**（无需验证码）。
- `AUTH_SECRET`：生产必配；开发可回退（仅限本地）。

### 架构选择

- **NextAuth v5（Auth.js）** 作为前端唯一认证入口与 session 管理；后端 FastAPI 保留并扩展为「校验 + 发码/注册/登录」的权威数据源。
- 前端请求后端 API 时携带 NextAuth 的 JWT（或 session token），后端需能验证该 JWT 并解析出当前用户（与现有 `get_current_user_or_temp` 共存）。

### 实现要点

**前端（Next.js）**

- 安装并配置 **NextAuth v5**（`next-auth@beta` 或当前稳定 v5）：`auth.config.ts` / `auth.ts`，使用 `AUTH_SECRET`，开发环境可回退到固定 dev secret（仅 localhost）。
- **Providers**：
  - **Credentials**：`authorize` 内调用后端 `POST /api/auth/login`（见下），传 email + password；成功则返回 `id`（后端 user.id）、`email` 等，供 NextAuth 写 session。
  - **Google**：使用 NextAuth 自带 Google provider，配置 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`，`redirect_uri` 指向 Next.js 的 `/api/auth/callback/google`。
- **Session 策略**：JWT strategy；JWT 中至少包含与后端一致的 `sub`（即后端 `user.id`），以便后端校验。
- 将 **AUTH_SECRET** 与后端共享（或后端单独配置为可验证 NextAuth 签名的 secret），用于后端验证 NextAuth 签发的 JWT。

**后端（FastAPI）**

- **接受 NextAuth JWT**：在 `auth_utils.get_current_user_or_temp`（或新依赖 `get_current_user_from_nextauth`）中，除现有 Bearer JWT（当前 `JWT_SECRET`）外，增加对「NextAuth 签发 JWT」的验证（使用与 NextAuth 一致的 secret），解析出 `sub` 作为 `user_id`，查询并返回 `User`。这样现有上传/任务等接口无需大改即可识别「已通过 NextAuth 登录」的用户。
- **Google 登录**：可保留现有 `/auth/google/login` 与 `/auth/google/callback` 作为兼容路径，或逐步迁移为「前端只用 NextAuth Google，回调后由 NextAuth 与后端同步用户」；若迁移，需在 NextAuth 的 signIn callback 中调用后端「用 Google 账号创建/获取 User 并返回 backend user.id」的接口，保证 `sub` 与后端一致。

**配置**

- 环境变量：`AUTH_SECRET`（生产必填）；开发可用 `.env`中回退值并注明仅本地使用）。
- 文档中说明：生产必须配置 `AUTH_SECRET`。

---

## 三、需求 3.3：注册（邮箱验证码）

### 目标

- 注册必须走后端 API：`POST /api/auth/send-code/`（发验证码）、`POST /api/auth/verify-register/`（校验并注册，写 DB）。
- 验证码 60 秒有效；校验接口最多 5 次错误，超过需重新获取验证码。

### 实现要点

**后端**

- **POST /api/auth/send-code/**  
  - Body：`{ "email": "user@example.com" }`（可加可选 `type: "register"` 便于扩展）。  
  - 校验 email 格式；生成 6 位数字验证码；存储到 Redis（或 DB 表）key 如 `verify_code:register:{email}`，TTL 60s；同一 email 在 60s 内可覆盖旧码，不重复发多码。  
  - 发邮件（可用现有 SMTP 或 SendGrid 等，若暂无则先 log + 返回成功，后续接真实发信）。  
  - 返回 `{ "ok": true }` 或 204。
- **POST /api/auth/verify-register/**  
  - Body：`{ "email", "code", "password", "confirm_password" }`。  
  - 后端校验：code 与 Redis 中一致；password 符合 3.4 策略（可仅做长度与复杂度校验，详细规则见下）；`password === confirm_password`。  
  - 校验失败计数：key 如 `verify_attempts:{email}`，失败 +1，达到 5 次则清除该 email 的 code 并返回「超过次数，请重新获取验证码」。  
  - 成功：创建 `User`（email、password_hash、is_temporary=False 等），清除 code 与 attempts，可选直接返回 JWT 或仅 201，由前端再调登录。

**前端**

- 注册页（或模态）：输入 email → 点击「获取验证码」→ 调用 `POST /api/auth/send-code/`，按钮 60s 倒计时防重复点击。  
- 输入验证码、密码、确认密码后提交 → `POST /api/auth/verify-register/`；成功则跳转登录或直接 signIn（NextAuth Credentials 或重定向到登录页）。

**数据与存储**

- User 表需有 `password_hash`（或单独 credentials 表）；验证码与尝试次数用 Redis 更合适，若无 Redis 可用 DB 表（code、attempts、expires_at）。

---

## 四、需求 3.4：密码策略（前端）

### 目标

- **复杂度**：长度 8–64，且至少满足 4 类中的 3 类：大写、小写、数字、符号。
- **可用性**：密码输入框提供「显示/隐藏」按钮；注册必须二次输入密码（确认密码）。

### 实现要点

- **前端**：  
  - 注册/修改密码表单：两个输入框（密码、确认密码），均带「显示/隐藏」图标按钮（type 切换 password/text）。  
  - 提交前校验：长度 8–64；至少 3 类字符（正则或简单计数）；两次输入一致。错误信息在对应字段下或汇总显示。
- **后端**：  
  - `verify-register` 与后续「修改密码」接口中，对 `password` 做相同规则校验（长度 + 3/4 类），拒绝不符合的请求，避免仅靠前端绕过。

---

## 五、需求 3.5：性能与体验

### 目标

- 首页首屏加载 ≤ 2.5s（本地/测试需关注包体与图片）。
- 按钮/链接点击区域 ≥ 44px（移动端）。

### 实现要点

- **首屏 ≤ 2.5s**：  
  - 使用 Next.js 的 `dynamic` 与 `loading` 对非首屏组件做按需加载（如 PDF 查看器已用 dynamic）；检查首屏是否引入过重依赖（如大图表库、未拆包的 BabelDOC 等不要进首屏）。  
  - 图片若有则用 `next/image`，并配合 3.6 的 `images.remotePatterns`（本需求不展开 3.6，但可预留）。  
  - 本地用 Lighthouse 或 Performance 面板测 LCP/首屏时间，目标 2.5s 内。
- **可点击区域 ≥ 44px**：  
  - 全局检查：Header 语言切换、登录/注册按钮、上传区域触发、表单提交等，用 min-height/min-width 或 padding 保证触摸目标 ≥ 44px；移动端可单独抽样式或使用 Tailwind 的 `min-h-[44px]` 等。

---

## 六、依赖与顺序建议

1. **先做需求 1**：后端上传入口统一加「临时用户 + 已有 1 文档 → 403」；前端在 createPresignedUpload 失败时拦截并提示登录。
2. **再做 3.3 + 3.4**：后端 send-code、verify-register、User.password_hash 与校验逻辑；前端注册页 + 密码策略与显示/隐藏、确认密码。
3. **再做 3.2**：NextAuth v5 集成（Credentials + Google）、后端接受 NextAuth JWT、AUTH_SECRET 配置。
4. **最后 3.5**：首屏与包体优化、44px 触摸区域检查。

---

## 七、不纳入本阶段（已排除）

- 3.6 next/image 与 R2 域名（未选）。
- 3.7 文章列表与分类、Wagtail（未选）。
- 3.8 mailto 与 MailtoLink 组件（未选）；现有 `mailto:hello@...` 可保持现状，后续若需再按 3.8 改。

