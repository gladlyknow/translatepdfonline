---
name: 移植 reference config 到 frontend
overview: 将 tmp/onlinepdftranslator/src 的 config 目录及依赖其的「前端后台」能力（env 配置、DB schema、theme、locale 约定）完整移植到 frontend，路径与现有 i18n/build 兼容，为后续 auth/payment/settings 提供统一配置层。
todos: []
isProject: false
---

# 移植 reference config 到当前 frontend

## 参考源码与当前差异

- **参考**：[tmp/onlinepdftranslator/src/config](tmp/onlinepdftranslator/src/config) 含：`index.ts`（envConfigs）、`theme/index.ts`、`db/schema.ts`（含 schema.postgres）、`locale/index.ts`（locales、localeMessagesPaths）、`style/`（theme.css、global.css）。
- **参考依赖**：`core/db/config.ts`、`core/auth`、`shared/models/config.ts` 等通过 `@/config`、`@/config/db/schema` 使用。
- **当前 frontend**：仅有 [frontend/config/page-slugs.json](frontend/config/page-slugs.json)；无 env 集中配置、无 DB schema、无 config/theme、无 config/locale；i18n 用 [frontend/i18n/request.ts](frontend/i18n/request.ts) 单文件 `messages/${locale}.json`。

## 移植范围与原则

- 在 **frontend/** 下新增与参考同构的 **config** 目录，所有路径以 frontend 为根（`@/` → frontend）。
- 保留现有 **首页翻译流程** 与 **i18n 单文件 messages**；config/locale 仅做「约定与路径」，不强制改为多文件加载，缺失文案仍从现有 messages 或后续合并。
- DB 与 drizzle 为**可选**：先落 env + schema 类型/文件，无 DB 时 `getConfigs` 仅从 env 读；有 DB 时再接 drizzle 与参考的 `getConfigs`/`getAllConfigs`。

---

## 一、config/index.ts（env 配置）

- **来源**：[tmp/onlinepdftranslator/src/config/index.ts](tmp/onlinepdftranslator/src/config/index.ts)。
- **操作**：在 frontend 新增 [frontend/config/index.ts](frontend/config/index.ts)。
- **内容**：复刻 `ConfigMap`、`envConfigs` 的键与默认值；`version` 改为从 `process.env.NEXT_PUBLIC_APP_VERSION` 或 `frontend/package.json` 的 `version` 读取（避免引用根 package.json）；`db_schema_file`、`db_migrations_out` 默认改为 `./config/db/schema.ts`、`./config/db/migrations`（相对 frontend 根）。
- **注意**：不引入 dotenv 等额外依赖，依赖 Next 已有 env 加载即可。

---

## 二、config/theme/index.ts

- **来源**：[tmp/onlinepdftranslator/src/config/theme/index.ts](tmp/onlinepdftranslator/src/config/theme/index.ts)。
- **操作**：新增 [frontend/config/theme/index.ts](frontend/config/theme/index.ts)，导出 `themeNames`、`defaultTheme`（与参考一致）。

---

## 三、config/db（Schema）

- **来源**：[tmp/onlinepdftranslator/src/config/db/schema.ts](tmp/onlinepdftranslator/src/config/db/schema.ts) 及 [schema.postgres.ts](tmp/onlinepdftranslator/src/config/db/schema.postgres.ts)。
- **操作**：
  - 新增 [frontend/config/db/schema.postgres.ts](frontend/config/db/schema.postgres.ts)：仅移植与 **auth + 配置 + 支付/订单/订阅/积分** 相关的表（`user`、`session`、`account`、`verification`、`config`、`order`、`subscription`、`credit`）；可省略 `taxonomy`、`post`、`role`、`apikey` 等与当前产品无关的表，或先只保留 `user`/`session`/`account`/`verification`/`config`/`order`/`subscription`/`credit`。
  - 新增 [frontend/config/db/schema.ts](frontend/config/db/schema.ts)：`export * from './schema.postgres';`（与参考一致，便于后续扩展 mysql/sqlite）。
- **依赖**：`envConfigs` 从 `@/config` 引入；若 frontend 暂未安装 `drizzle-orm`，可只移植类型定义与表结构（占位），待 step 7 再接 drizzle；若已安装则直接使用 `pgTable` 等。

---

## 四、config/locale/index.ts

- **来源**：[tmp/onlinepdftranslator/src/config/locale/index.ts](tmp/onlinepdftranslator/src/config/locale/index.ts)。
- **操作**：新增 [frontend/config/locale/index.ts](frontend/config/locale/index.ts)。
- **内容**：导出 `locales`、`defaultLocale`、`localeNames`、`localePrefix`、`localeDetection`；`localeMessagesRootPath` 设为 `@/config/locale/messages`；`localeMessagesPaths` 仅保留与当前项目相关的子集（例如 `common`、`landing`、`pages/pricing`、`settings/sidebar`、`settings/billing`、`settings/payments`、`settings/profile`、`settings/credits`、`settings/apikeys`），与参考的 settings/pages 对齐，便于后续若改为按路径加载 messages 时可直接使用。
- **与现有 i18n 的关系**：不修改 [frontend/i18n/request.ts](frontend/i18n/request.ts) 的默认加载逻辑（仍从 `messages/${locale}.json` 合并）；仅在 config 中声明「约定」的路径列表，供技能或后续多文件 messages 使用。

---

## 五、config/locale/messages（可选、精简）

- **参考**：参考含 `config/locale/messages/{en,zh}/common.json`、`pages/pricing.json`、`settings/billing.json`、`settings/payments.json` 等。
- **操作**：二选一。  
  - **方案 A（推荐）**：不新建 `config/locale/messages` 目录；保持现有 [frontend/messages/zh.json](frontend/messages/zh.json)、[frontend/messages/en.json](frontend/messages/en.json)，在计划 step 7 做 auth/payment/settings 时，把参考里 `common.sign`、`pages.pricing`、`settings.billing`、`settings.payments` 等键合并进现有 messages。  
  - **方案 B**：新建 `frontend/config/locale/messages/{en,zh}/`，仅放 `common.json`、`pages/pricing.json`、`settings/billing.json`、`settings/payments.json` 等与定价/设置/登录相关的最小集，并修改 `i18n/request.ts` 在动态页或指定路由按 `localeMessagesPaths` 合并这些文件（工作量大，且与现有单文件结构重复）。
- **建议**：采用方案 A；config/locale 只做「路径与命名约定」，不强制多文件。

---

## 六、config/style（可选）

- **来源**：[tmp/onlinepdftranslator/src/config/style/theme.css](tmp/onlinepdftranslator/src/config/style/theme.css)、[global.css](tmp/onlinepdftranslator/src/config/style/global.css)。
- **操作**：可选。若希望与参考主题变量一致，可新增 `frontend/config/style/theme.css`（CSS 变量），并在 [frontend/app/globals.css](frontend/app/globals.css) 中 `@import` 或复制所需变量；否则保留现有 globals.css，不新增 config/style。

---

## 七、对现有 frontend 的适配

- **tsconfig paths**：确保 `@/`* 指向 frontend 根，使 `@/config`、`@/config/db/schema` 可被解析。
- **core/theme**：已有 [frontend/core/theme/index.ts](frontend/core/theme/index.ts) 使用 `getActiveTheme()` 时，可改为从 `@/config/theme` 读取 `defaultTheme`，与 config 统一。
- **不修改**：不改动 [frontend/app/[locale]/page.tsx](frontend/app/[locale]/page.tsx) 翻译主流程；不修改 plan 文件。

---

## 八、交付物检查

- [frontend/config/index.ts](frontend/config/index.ts) 存在且导出 `envConfigs`，路径与默认值适配 frontend。
- [frontend/config/theme/index.ts](frontend/config/theme/index.ts) 存在且导出 `themeNames`、`defaultTheme`。
- [frontend/config/db/schema.ts](frontend/config/db/schema.ts) 与 [frontend/config/db/schema.postgres.ts](frontend/config/db/schema.postgres.ts) 存在，至少包含 user、session、account、verification、config、order、subscription、credit 表定义。
- [frontend/config/locale/index.ts](frontend/config/locale/index.ts) 存在，导出 locales、defaultLocale、localeMessagesPaths（与 settings/pricing 相关的子集）。
- （可选）config/style 或 globals 中引入参考主题变量；否则跳过。
- `pnpm build` 通过；首页与动态页行为不变。

---

## 执行顺序建议

```mermaid
flowchart LR
  C1[config/index.ts]
  C2[config/theme]
  C3[config/db/schema]
  C4[config/locale/index]
  C5[适配 core/theme]
  C1 --> C2
  C2 --> C3
  C3 --> C4
  C4 --> C5
```



- 先做 config/index.ts，再做 theme、db、locale；最后若有 core/theme 引用则改为读 config/theme。

