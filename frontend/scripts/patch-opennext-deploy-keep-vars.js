#!/usr/bin/env node
/**
 * ## `.wrangler/deploy/config.json` 具体在干什么？
 * Wrangler 在 `deploy` / `dev` 时会从当前目录向上查找 `.wrangler/deploy/config.json`。
 * 若存在且内含 `configPath`，则 **改用该路径指向的另一份配置** 去部署，而 **不再** 把仓库根的
 * `wrangler.toml` 当作本次上传的完整真相源（Cloudflare 文档：redirected Wrangler configuration）。
 *
 * ## 为啥平台/框架要这么设计？（不是「故意坑你」，而是分工）
 * 1. **构建产物与声明分离**：OpenNext 在 build 阶段会确定真实的 `main`、资源目录、以及适配器
 *    需要写进 Worker 包里的绑定；生成一份「只含本次上传所需字段」的 JSON，可降低 Wrangler
 *    与每个框架重复实现「合并用户配置 + 构建产物」的逻辑。
 * 2. **多环境扁平化**：部分工具会为某个环境输出已拍平的单一配置，避免在 deploy 时再解析
 *    `env.xxx` 嵌套。
 * 3. **不合理之处**：生成器往往 **只拷贝它关心的键**，容易漏掉 `keep_vars`、注释、或你
 *    在根配置里依赖的其它顶层字段 → 表现为「控制台变量被每次部署清空」。
 *
 * ## 更合理的「重新设计」方向（择一即可，本仓库当前用最后一项作桥）
 * - **单一真相源**：不在控制台维护明文变量；用 `generate-wrangler` + CI 构建 env、`wrangler secret put`
 *   或 Terraform/API 管理机密，使根 `wrangler.toml` 与部署一致，不依赖 `keep_vars`。
 * - **上游修复**：向 `@opennextjs/cloudflare` 提 PR，在写 deploy 配置时 **从用户 wrangler 合并**
 *   `keep_vars` 及白名单顶层字段。
 * - **本脚本（权宜）**：build 后给生成配置补上 `"keep_vars": true`，直到上游合并或你改用纯 CI 变量。
 * - **上游 Issue/PR 草稿**：见同目录 `OPENNEXT_UPSTREAM_KEEP_VARS.md`。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const redirectPath = path.join(root, '.wrangler', 'deploy', 'config.json');

function parseJsonRelaxed(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n\r]*/g, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(stripped);
  }
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function main() {
  if (!fs.existsSync(redirectPath)) {
    console.log(
      '[patch-opennext-keep-vars] skip: no .wrangler/deploy/config.json (OpenNext build may not have run yet)'
    );
    return;
  }

  let redirect;
  try {
    redirect = JSON.parse(fs.readFileSync(redirectPath, 'utf8'));
  } catch (e) {
    console.warn('[patch-opennext-keep-vars] invalid redirect JSON:', e.message);
    return;
  }

  const rel = redirect.configPath;
  if (!rel || typeof rel !== 'string') {
    console.log('[patch-opennext-keep-vars] skip: redirect has no configPath');
    return;
  }

  const target = path.resolve(path.dirname(redirectPath), rel);
  if (!fs.existsSync(target)) {
    console.warn('[patch-opennext-keep-vars] skip: target missing:', target);
    return;
  }

  let data;
  try {
    data = parseJsonRelaxed(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    console.warn('[patch-opennext-keep-vars] could not parse deploy config:', target, e.message);
    return;
  }

  if (data.keep_vars === true) {
    console.log('[patch-opennext-keep-vars] already set:', path.relative(root, target));
    return;
  }

  data.keep_vars = true;
  writeJson(target, data);
  console.log(
    '[patch-opennext-keep-vars] wrote keep_vars=true →',
    path.relative(root, target)
  );
}

main();
