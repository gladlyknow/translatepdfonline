# 上游方案 B：在生成 deploy 配置时保留 `keep_vars`

本仓库当前用 `patch-opennext-deploy-keep-vars.js` 在 OpenNext build 之后给 **Wrangler 重定向指向的生成配置** 补上 `"keep_vars": true`。  
若上游修复，可删除该脚本及 `package.json` 里对它的调用。

## 应向哪里提 Issue / PR

1. **首选**：[`opennextjs/opennextjs-cloudflare`](https://github.com/opennextjs/opennextjs-cloudflare)  
   - 构建管线已用 `unstable_readConfig` 读取用户 Wrangler（见 `packages/cloudflare/src/cli/commands/utils/utils.ts` 的 `readWranglerConfig`）。  
   - 请求：在写出或依赖「deploy 用扁平配置」时，**从用户原始配置合并** `keep_vars`（及文档建议一并保留的运维向字段）。

2. **若重定向 JSON 完全由 Wrangler 写出**：同时在 [`cloudflare/workers-sdk`](https://github.com/cloudflare/workers-sdk)（`wrangler`）搜 `.wrangler/deploy`、`configPath`，在 **生成重定向目标配置** 时从 **用户原始 wrangler** 合并 `keep_vars`。  
   - 与 OpenNext 互相链接两个 issue，避免踢皮球。

## 预期行为（验收标准）

- 用户在根目录 `wrangler.toml` / `wrangler.jsonc` 中设置 `keep_vars = true`（或 `"keep_vars": true`）。  
- 执行 `opennextjs-cloudflare build` 后，**实际参与 `wrangler deploy` 的配置**（含通过 `.wrangler/deploy/config.json` 重定向加载的那份）中 **`keep_vars` 仍为 `true`**。  
- 不在控制台重复配变量的前提下，**连续 deploy 不会清空** Dashboard 中已存在的明文变量（与 Wrangler 文档「source of truth」一致）。

---

## 可复制：GitHub Issue（英文标题 + 正文）

**Title:** `Preserve keep_vars from user Wrangler config in generated deploy config (redirect)`

**Body:**

```markdown
### Problem

After `opennextjs-cloudflare build`, `wrangler deploy` uses a **redirected** Wrangler configuration (via `.wrangler/deploy/config.json` → `configPath`), as documented in Cloudflare Wrangler (“redirected Wrangler configuration”).

The **generated** deploy config does not include `keep_vars` even when the user’s root `wrangler.toml` / `wrangler.jsonc` sets `keep_vars = true`.

Result: dashboard-managed plain-text environment variables are removed on each deploy unless consumers post-process the generated JSON (undesirable).

### Expected

When emitting / relying on the generated deploy configuration, **merge** operational fields from the user’s original Wrangler config, at minimum:

- `keep_vars` (boolean)

Optionally also preserve related fields if safe:

- `observability.head_sampling_rate` (if present)
- other top-level keys that do not conflict with OpenNext’s generated `main`, `assets`, etc.

### Context in adapter

`readWranglerConfig` already uses `unstable_readConfig` (`packages/cloudflare/src/cli/commands/utils/utils.ts`), so the user value is known at build time.

### Acceptance criteria

1. User sets `keep_vars: true` in root Wrangler config.
2. Run `opennextjs-cloudflare build && opennextjs-cloudflare deploy` (or CI equivalent).
3. The effective config used by deploy contains `keep_vars: true`.
4. Dashboard plain-text vars not declared in the generated `vars` object survive deploy (Wrangler semantics).

### Note

If the redirect target file is owned entirely by `wrangler` rather than `@opennextjs/cloudflare`, please coordinate a fix in `cloudflare/workers-sdk` and link issues.
```

---

## PR 实现提示（给贡献者）

- 在 **写出** 或 **交给 wrangler 之前** 解析到的 deploy 配置对象上：  
  `deployConfig.keep_vars = userWranglerConfig.keep_vars ?? deployConfig.keep_vars`  
- 若生成逻辑在 wrangler 内部：在创建「扁平 deploy 配置」的同一函数中，对 **用户源配置** 做一次 `pick(keep_vars, observability, …)` 合并。  
- 增加 **单元测试**：fixtures 含 `keep_vars: true` 的用户 config + 模拟生成输出，断言输出中为 `true`。

---

## 合并上游后本仓库要做的事

1. 升级 `@opennextjs/cloudflare`（及必要时的 `wrangler`）到包含修复的版本。  
2. 删除 `scripts/patch-opennext-deploy-keep-vars.js`。  
3. 从 `package.json` 的 `build:opennext`、`build:opennext:ci`、`cf:deploy`、`cf:preview`、`cf:upload` 中移除对该脚本的调用。  
4. 保留根目录 `wrangler.toml` / `wrangler.consumer.jsonc` 中的 `keep_vars` 仍有意义（非重定向场景与队列 Worker）。
