# 认证、注册、密码策略与发信

本文档记录「认证（NextAuth v5）、注册（邮箱验证码）、密码策略、Resend 发信、上传门控」的**技术要求**与**实现说明**。

---

## 1. 认证（Auth.js / NextAuth v5）

### 目标

- 支持 **Email + Password**（走后端校验/登录）。
- 支持 **Google OAuth**（无需验证码）。
- **AUTH_SECRET**：生产必须配置；开发可使用回退（仅限本地）。

### 架构

- **NextAuth v5（Auth.js）** 为前端唯一认证入口与 session 管理；后端 FastAPI 作为「校验 + 发码/注册/登录」的权威数据源。
- 前端请求后端 API 时携带 NextAuth 的 JWT（通过 `/api/auth/token` 获取），后端使用与 NextAuth 一致的 `AUTH_SECRET` 验证该 JWT 并解析出当前用户（与 `get_current_user_or_temp` 共存）。

### 配置要点

- **前端**（`frontend/auth.ts`）：Credentials 的 `authorize` 调用后端 `POST /api/auth/login`；Google 登录后通过 `POST /api/auth/ensure-user` 同步后端用户，保证 session `sub` 与后端 `user.id` 一致。
- **后端**（`backend/app/auth_utils.py`）：除现有 JWT（`JWT_SECRET`）外，支持使用 `AUTH_SECRET` 解码 NextAuth 签发的 JWT 及 Cookie（如 `authjs.session-token`），解析出 `sub` 作为 `user_id`。
- **环境变量**：生产必须配置 `AUTH_SECRET`（前后端一致）；开发未配置时前端使用固定回退值 `dev-auth-secret-local-only`，仅限本地。

### Rewrites 与 NextAuth 路由

- Next.js 的 rewrites 只将**后端提供的 API** 代理到 FastAPI（如 `/api/auth/login`、`/api/auth/send-code`、`/api/auth/verify-register`、`/api/auth/ensure-user`、`/api/auth/google/login`、`/api/auth/google/callback`）。
- **不代理** `/api/auth/session`、`/api/auth/csrf`、`/api/auth/callback/*`、`/api/auth/signin`、`/api/auth/token` 等，由 Next.js（NextAuth）处理，避免 404 导致 ClientFetchError。

---

## 2. 注册（邮箱验证码）

### 接口

- **POST /api/auth/send-code**：发验证码（Body: `{ "email": "user@example.com" }`）。验证码 60 秒有效；同一邮箱 60 秒内可覆盖旧码。
- **POST /api/auth/verify-register**：校验验证码并注册（Body: `email`, `code`, `password`, `confirm_password`）。验证码错误最多 5 次，超过需重新获取；密码需符合 3.4 节策略；成功则创建 User 并写 `password_hash`。

### 存储

- 验证码与错误次数存 **Redis**（见 `backend/app/verify_store.py`）：key 如 `verify_code:register:{email}`（TTL 60s）、`verify_attempts:{email}`（最多 5 次）。

### 注册成功后行为

- **注册成功后自动登录**：前端在 `verify-register` 成功后立即调用 `signIn("credentials", { email, password, redirect: false })`，成功则跳转首页，用户无需再点登录。
- 若自动登录失败（如网络问题），则展示「注册成功，请登录」并保留「返回首页」链接。

---

## 3. 密码策略

### 复杂度（前后端一致）

- **长度**：8–64 字符。
- **至少 4 类中的 3 类**：大写字母、小写字母、数字、符号。
- 前端（`frontend/lib/passwordValidation.ts`）与后端（`backend/app/password_utils.py`）均做相同校验；后端在 `verify-register` 与登录接口中拒绝不符合的请求。

### 可用性

- 密码输入框提供「显示/隐藏」按钮（`PasswordInput` 组件）；注册必须二次输入密码（确认密码）。

### bcrypt 与 72 字节限制

- **bcrypt 只使用密码的前 72 字节**；策略允许 8–64 **字符**，UTF-8 下可能超过 72 字节（如中文）。
- 实现：在 `password_utils.truncate_for_bcrypt(password)` 中按 UTF-8 截断至 72 字节并安全解码；注册与登录时均对密码做同一截断后再交给 passlib（`pwd_ctx.hash` / `pwd_ctx.verify`），保证哈希与校验一致。
- **passlib 与 bcrypt 版本**：bcrypt 4.1+ 移除了 `__about__`，与 passlib 1.7.4 不兼容；依赖中固定 `bcrypt>=4.0.0,<4.1`。

---

## 4. Resend 发信（验证码邮件）

### 配置

- **RESEND_API_KEY**：必填才发信；未配置时 `send-code` 仅打日志并返回成功（便于本地无 key 时跑通流程）。
- **RESEND_FROM**：发件人地址。若为自有域名（如 `hello@translatepdfonline.com`），须在 [Resend Domains](https://resend.com/domains) 添加并验证该域名（DKIM/SPF 等）。
- **本地开发**：未配置 `RESEND_FROM` 时，后端自动使用 Resend 沙箱发件人 `onboarding@resend.dev`，无需验证自有域名即可发信。

### 行为

- `send-code` 成功写入 Redis 后调用 `_send_verification_email`；若 Resend 抛错（如域名未验证、API key 无效），记录日志并返回 **503**，提示「Failed to send verification email. Please try again later.」。

### 环境

- 后端从**项目根目录**的 `.env` 读取 `RESEND_API_KEY`、`RESEND_FROM`（非 `frontend/.env.local`）。

---

## 5. 上传门控（未登录仅能上传一个文件）

### 规则

- **未登录**（临时用户 `is_temporary=True`）只能上传 **1 个**文件；**再次上传前**必须先登录，不登录不允许上传（在获取上传凭证前就拦截，避免文件先上传到 R2 再拒绝造成浪费）。

### 后端

- 在 **create_presigned_upload**、**direct_upload**、**init_multipart_upload**、**complete_multipart_upload** 入口处统一校验：若 `user.is_temporary` 且该用户已有 Document 数量 ≥ 1，直接返回 **403**，`detail="login_required_for_multiple_documents"`。

### 前端

- 在 **createPresignedUpload** 失败且 `detail === "login_required_for_multiple_documents"` 时：不发起 PUT，清空已选文件状态，并展示「请先登录后再上传更多文件」的提示（复用现有 loginHint）。

---

## 6. 性能与体验（摘录）

- **首屏**：目标 ≤ 2.5s；非首屏组件使用 `dynamic` 与 `loading` 按需加载。
- **触摸区域**：按钮/链接点击区域 ≥ 44px（如 `min-h-[44px]`），适用于 Header、注册/登录、上传、表单提交等。
