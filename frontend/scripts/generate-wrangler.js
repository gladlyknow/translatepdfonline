#!/usr/bin/env node
/**
 * 从 wrangler.toml.template 生成 wrangler.toml。
 *
 * Cloudflare 官方说明：Workers Git 里「Build variables and secrets」**只在构建过程可见**，
 * **默认不会**出现在 Worker 运行时 process.env 里；运行时变量要在 Worker → Settings → Variables and secrets。
 *
 * 因此：若在「构建」里配了全套变量、但运行时读不到，本脚本在 **pnpm run build:opennext:ci 的第一步**
 * 把下面白名单里的键从 **构建环境 process.env** 写入 wrangler.toml [vars]，随 `wrangler deploy` 进入 Worker，
 * 这样 **无需** 在控制台维护两套完全相同的变量。
 *
 * 另：`wrangler deploy --keep-vars` 保留的是 **运行时** 控制台已有变量，与「构建变量不进运行时」是两件事。
 * OpenNext：`opennextjs-cloudflare build` 后会生成 `.wrangler/deploy/config.json` 指向另一份部署配置，
 *   那份文件默认 **不含** `keep_vars`，会覆盖你在控制台配的变量；见 `scripts/patch-opennext-deploy-keep-vars.js`（在 build 后自动补上）。
 *
 * Postgres：若配置 **[[hyperdrive]]**，运行时 `getPostgresDb()` 使用 Hyperdrive 连接串；否则使用 `[vars]` / 密钥中的 `DATABASE_URL`（见 `src/core/db/postgres.ts`）。
 * 敏感串推荐只配 Worker Variables and secrets；`HYPERDRIVE_CONFIG_ID` 构建注入可写入下方 Hyperdrive `id`。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const templatePath = path.join(root, 'wrangler.toml.template');
const outPath = path.join(root, 'wrangler.toml');

function env(key) {
  const v = process.env[key];
  return v != null && v !== '' ? String(v).trim() : '';
}

/** 与 translatepdfonline 生产控制台「构建变量」对齐；仅写入构建时存在的键 */
const WRANGLER_VARS_FROM_BUILD = [
  'ADSENSE_CODE',
  'AUTH_SECRET',
  'AUTH_URL',
  'BABELDOC_FC_TIMEOUT_SECONDS',
  'BABELDOC_USE_FC',
  'AUTH_DB_DIAG',
  'DATABASE_URL',
  'DB_MAX_CONNECTIONS',
  'DB_SINGLETON_ENABLED',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_MODEL',
  'ENVIRONMENT',
  'FRONTEND_ORIGINS',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'INITIAL_CREDITS_AMOUNT',
  'INITIAL_CREDITS_ENABLED',
  'JWT_SECRET',
  'NEXT_PUBLIC_APPEARANCE',
  'NEXT_PUBLIC_APP_NAME',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_ADSENSE_CLIENT',
  'NEXT_PUBLIC_GOOGLE_ONE_TAP_AUTO',
  'NEXT_PUBLIC_R2_PUBLIC_URL',
  'NEXT_PUBLIC_THEME',
  'R2_ACCESS_KEY_ID',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
  'R2_PUBLIC_URL',
  'R2_SECRET_ACCESS_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'CRON_SECRET',
  'TRANSLATE_FC_SECRET',
  'TRANSLATE_FC_URL',
  'TRANSLATE_FC_AUTH_HEADER',
  'TRANSLATE_FC_AUTH_SCHEME',
  'TRANSLATE_CREDITS_ENABLED',
  'TRANSLATE_CREDITS_PER_PAGE',
  'TRANSLATE_BILLING_REQUIRE_FC_PAGE_COUNT',
  'TRANSLATE_DISPATCH_SECRET',
  'TRANSLATE_DISPATCH_BATCH_SIZE',
  'TRANSLATION_MAX_CONCURRENT',
  'VERIFY_DB_SECRET',
];

const vars = {
  __WRANGLER_NAME__: env('WRANGLER_NAME') || 'translatepdfonline',
};

const varLines = [];
for (const key of [...WRANGLER_VARS_FROM_BUILD].sort()) {
  const v = env(key);
  if (v) varLines.push(`${key} = ${JSON.stringify(v)}`);
}

let varsBody;
if (varLines.length > 0) {
  varsBody = `${varLines.join('\n')}\n`;
} else {
  varsBody =
    '# 构建环境未命中白名单变量。若变量只配在「Build」里，运行时本不会有；请见脚本头注释。\n' +
    '# 或在 Worker → Settings → Variables and secrets 配置运行时变量 + wrangler deploy --keep-vars。\n';
}

vars.__WRANGLER_VARS_BODY__ = varsBody;
vars.__HYPERDRIVE_CONFIG_ID__ =
  env('HYPERDRIVE_CONFIG_ID') || 'REPLACE_ME_HYPERDRIVE_CONFIG_ID';

let content = fs.readFileSync(templatePath, 'utf8');
for (const [placeholder, value] of Object.entries(vars)) {
  content = content.split(placeholder).join(value);
}

fs.writeFileSync(outPath, content, 'utf8');
console.log('Generated wrangler.toml from template');
console.log(
  '[generate-wrangler] Injected %s keys into [vars] from build env',
  varLines.length
);
if (env('TRANSLATE_FC_URL')) {
  console.log('[generate-wrangler] TRANSLATE_FC_URL present in build env');
}
