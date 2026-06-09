# Cloudflare 环境变量：为什么 `.env.development` 里配了线上还是没有？

## 一句话

**`.env.development` 被 `.gitignore`，只给你本机 `next dev` 用；Cloudflare Worker 上永远不会自动出现这些键。**

你在本机文件里写一百个变量，线上 `process.env` 也可以是空的——**这不是 bug，是两套环境**。

另外：本项目有主/队列两个 Worker，若部署命令不带 `--keep-vars`，会覆盖运行时变量集合。

---

## 本地 vs 线上

| 位置 | 谁读 | 怎么生效 |
|------|------|----------|
| `frontend/.env.development` | 本机 Next | 仅本地，**不进 git、不进 CF** |
| Cloudflare **Git → 构建 →「Build variables」** | 官方说明：**仅构建过程**，**默认不进** Worker 运行时 `process.env` |
| 同上 | `generate-wrangler.js`（本仓库） | 从构建 `process.env` 取白名单键 → 写入 `wrangler.toml` `[vars]` → **deploy 后** 运行时才有 |
| **Worker → Settings → Variables and secrets** | Worker `process.env` | 真正的「运行时」变量；`wrangler deploy --keep-vars` 保的是 **这一份** |
| 数据库 `config` 表 | `getAllConfigs()` | 后台 **PDF translate (FC)** 等 |

---

## `/api/translate` 要的 FC 配置（线上）

代码只认（按优先级合并）：

1. `TRANSLATE_FC_URL` 或 `BABELDOC_FC_URL`
2. `TRANSLATE_FC_SECRET` 或 `BABELDOC_FC_SECRET`
3. 库里的 `translate_fc_url` / `translate_fc_secret`

**不读、可删的「摆设」变量**（不要从前端/别的项目照抄）：

- `BABELDOC_USE_FC`
- `BABELDOC_FC_TIMEOUT_SECONDS`
- `FRONTEND_ORIGINS`（本仓库 Next 未使用）
- `ENVIRONMENT`
- `TRANSLATION_MAX_CONCURRENT`

---

## 推荐上线方式（选一种坚持到底）

**A. 构建注入（适合 Git 自动部署、不想折腾 keep-vars）**  
在 Cloudflare Workers **Build variables / secrets** 里设：

- `TRANSLATE_FC_URL`
- `TRANSLATE_FC_SECRET`（如需）

`pnpm run build:opennext:ci` 会先跑 `generate-wrangler.js`，把它们写进 `[vars]` 再 deploy。

**B. 控制台运行时 + 保留变量**  
运行时里配好变量，部署命令使用：

`npx wrangler deploy --keep-vars`

队列 Worker 需要使用：

`npx wrangler deploy -c wrangler.queues.toml --keep-vars`

**C. 后台入库**  
管理员 **Settings → General → PDF translate (FC)** 填写 URL/Secret。

---

## 自检日志

请求翻译后看 Worker 日志里的 `[translate] fc_env` / `FC skipped` 附带的 JSON：

- `process_env_keys_matching: []` → 线上 **根本没** 注入这些变量，回来看本文 **A/B/C**。
- `worker_env_keys` 只有 `HYPERDRIVE`、`ASSETS` → 正常只有绑定；字符串变量要靠 **A 或 B**。

更多总表见 `environment-variables.md`。

---

## 主 Worker 与队列 Worker 的变量保全清单

1. 确认部署目标 Worker 名称无误  
   - 主 Worker：`translatepdfonline`  
   - 队列 Worker：`translatepdfonline-quenues`
2. 两个部署命令都必须带 `--keep-vars`
3. 发布后在 Dashboard 对比 Variables and secrets 键集合是否变化
4. 队列 Worker 额外检查：`OCR_DISPATCH_URL`、`OCR_DISPATCH_SECRET`
