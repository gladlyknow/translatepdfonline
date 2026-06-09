# Cloudflare Queues 部署配置说明（PG/Supabase）

本文档说明 **双 Worker 架构**（OpenNext 主站 + 独立 Consumer）下的 Wrangler 配置、**Cloudflare 与 Git 自动构建** 的推荐命令，以及 **缩短构建/部署耗时** 的做法。

---

## 架构总览（必须先理解）

```
┌─────────────────────────────────────┐
│  Worker: onlinepdftranslator       │
│  （OpenNext，wrangler.jsonc）        │
│  • fetch：网站 + API                 │
│  • Queue：仅 Producer（发任务）       │
│  • Assets：静态资源 ASSETS           │
└──────────────┬──────────────────────┘
               │ env.TRANSLATOR_TASKS_QUEUE.send()
               ▼
┌──────────────────────────────────────┐
│  Queue: onlinepdftranslator         │
└──────────────┬───────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Worker: onlinepdftranslator-consumer│
│  （wrangler.consumer.jsonc）         │
│  • queue()：消费任务、跑 OCR/翻译等   │
└─────────────────────────────────────┘
```

**原则：**

| 组件 | 脚本名 | Queue 角色 | 是否跑 OpenNext 构建 |
|------|--------|------------|----------------------|
| 主站 | `onlinepdftranslator` | **仅 Producer** | 是（`opennextjs-cloudflare build`） |
| 消费者 | `onlinepdftranslator-consumer` | **仅 Consumer**（`queue()`） | 否（直接部署 TS 入口） |

---

## 关键结论（先看这 5 条）

1. **仅配环境变量不够**：必须在对应 Worker 的 Wrangler 配置里声明 **Queue 绑定**（Producer / Consumer），代码里才能使用 `env.TRANSLATOR_TASKS_QUEUE` 或收到 `queue` 事件。
2. **主 Worker 不要做 Queue Consumer**：主站 OpenNext 无 `queue()` 处理器；消费逻辑放在 `onlinepdftranslator-consumer`。
3. **绑定以仓库配置为准**：`wrangler.jsonc` / `wrangler.consumer.jsonc` 经 `wrangler deploy` 同步到 Cloudflare；控制台「绑定」页多为展示，**不要**在主 Worker 上手动添加「队列消费者」，否则易触发错误 `Queue handler is missing [11001]`。
4. **两个 Worker 的变量/机密要分别配置**：生产环境各配一套（或同一套值复制到两个 Worker）。
5. **Git 自动构建** 应把「构建」与「部署」拆开：构建阶段只做一次 OpenNext，部署阶段 **不要**再跑一遍完整 `cf:deploy:prod`（里面含 OpenNext），否则会 **重复构建、耗时翻倍**。

---

## 1. 是否需要创建绑定？

需要，且分两类（均在 Wrangler 中声明，随部署生效）：

- **Producer（主 Worker）**：`wrangler.jsonc` → `queues.producers`，供 API 发消息。
- **Consumer（消费者 Worker）**：`wrangler.consumer.jsonc` → `queues.consumers`，供平台调用 `queue()`。

`QUEUE_ENABLED`、`TRANSLATOR_TASK_QUEUE_NAME` 等为业务变量，**不能替代** Cloudflare Queue 绑定。

---

## 2. Web Worker（OpenNext）配置

文件：`wrangler.jsonc`

要点：

- `name`：`onlinepdftranslator`（与 Cloudflare 上 Worker 名称一致）。
- `main`：`.open-next/worker.js`（由 OpenNext 生成）。
- `assets`：`ASSETS` → `.open-next/assets`。
- `queues.producers`：队列名与控制台一致，例如 `onlinepdftranslator`，`binding` 与代码中 `env` 一致（如 `TRANSLATOR_TASKS_QUEUE`）。

示例：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "onlinepdftranslator",
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-03-01",
  "compatibility_flags": ["nodejs_compat", "nodejs_compat_populate_process_env"],
  "assets": {
    "binding": "ASSETS",
    "directory": ".open-next/assets"
  },
  "queues": {
    "producers": [
      {
        "queue": "onlinepdftranslator",
        "binding": "TRANSLATOR_TASKS_QUEUE"
      }
    ]
  },
  "env": {
    "preview": {}
  },
  "observability": {
    "enabled": true
  }
}
```

---

## 3. Consumer Worker 配置

文件：`wrangler.consumer.jsonc`

- `name`：`onlinepdftranslator-consumer`（独立 Worker）。
- `main`：`workers/translator-consumer/src/index.ts`（需导出 `default` 且含 `queue()`）。
- **仅**在此配置 `queues.consumers`，不要写进主站 `wrangler.jsonc`。

示例：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "onlinepdftranslator-consumer",
  "main": "workers/translator-consumer/src/index.ts",
  "compatibility_date": "2025-03-01",
  "compatibility_flags": ["nodejs_compat", "nodejs_compat_populate_process_env"],
  "queues": {
    "consumers": [
      {
        "queue": "onlinepdftranslator",
        "max_batch_size": 5,
        "max_batch_timeout": 10,
        "max_retries": 5
      }
    ]
  },
  "observability": {
    "enabled": true
  }
}
```

---

## 4. 环境变量与机密（PG + R2）

两边 Worker 的运行时配置应一致（至少数据库、队列开关、R2、翻译相关密钥一致）。

### 必备（Web + Consumer）

- `DATABASE_PROVIDER=postgresql`
- `DATABASE_URL=postgresql://...`（建议 `sslmode=require`）
- `AUTH_SECRET=...`（如 Consumer 不鉴权也建议保留）
- `QUEUE_ENABLED=true`
- `TRANSLATOR_TASK_QUEUE_NAME=onlinepdftranslator`
- `NEXT_PUBLIC_APP_URL=https://onlinepdftranslator.gladlyknow.workers.dev`（consumer 也建议配置为主站 URL，避免导出链路回落 localhost）

### 任务执行链路（Consumer 必须有；Web 若读状态也建议配置）

- `BAIDU_AUTHORIZATION`（或 `BAIDU_OCR_API_KEY` + `BAIDU_OCR_SECRET_KEY`）
- `DEEPSEEK_API_KEY`
- `R2_ACCOUNT_ID`、`R2_ACCESS_KEY`、`R2_SECRET_KEY`、`R2_BUCKET_NAME`、`R2_ENDPOINT`
- `R2_PUBLIC_URL`（或 `R2_DOMAIN`）

> 若 consumer 缺少以上 R2 配置，队列任务会在运行时报错：`No storage provider configured`（PDF/HTML 导出直接失败）。

### 建议（稳定性）

- `TRANSLATOR_EXPORT_STALE_PENDING_MS=900000`
- `TRANSLATOR_EXPORT_STALE_PROCESSING_MS=1800000`
- `TRANSLATOR_EXPORT_HEARTBEAT_MS=45000`
- `TRANSLATOR_OCR_PIPELINE_TIMEOUT_MS=1800000`

### DeepSeek 翻译重构相关（Web + Consumer）

> 以下变量用于“分隔符批量翻译 + 结构感知批次”新链路；建议 **Web 与 Consumer 两端一致配置**（至少 Consumer 必配）。

- `TRANSLATOR_TRANSLATE_MODE=delimiter`  
  - 新链路默认值；若需要应急回滚可设 `json_legacy`。
- `TRANSLATOR_TRANSLATE_CONCURRENCY=2`
- `TRANSLATOR_TRANSLATE_BATCH_ITEMS=16`
- `TRANSLATOR_TRANSLATE_BATCH_CHARS=9000`
- `TRANSLATOR_TRANSLATE_TABLE_ROW_WINDOW=10`
- `TRANSLATOR_TRANSLATE_BATCH_TIMEOUT_MS=90000`
- `TRANSLATOR_TRANSLATE_BATCH_ATTEMPTS=3`
- `TRANSLATOR_TRANSLATE_ENFORCE_COVERAGE=false`（灰度期建议先关闭强门禁）
- `TRANSLATOR_TRANSLATE_MIN_COVERAGE=0.92`

发布建议：

1. 第一阶段（灰度）：`ENFORCE_COVERAGE=false`，观察 `pipeline_translation_coverage` 指标与失败率。
2. 第二阶段（收敛后）：再切 `ENFORCE_COVERAGE=true`，启用覆盖率硬门禁。

---

## 5. `package.json` 脚本说明（部署落地）

仓库已统一为下列脚本，请按场景选用。

| 脚本 | 行为 |
|------|------|
| `cf:opennext:build` | 仅执行 `opennextjs-cloudflare build -c wrangler.jsonc`（生成 `.open-next`） |
| `cf:deploy:prod` | **OpenNext 构建 +** `wrangler deploy` 主 Worker（本地一键全量） |
| `cf:deploy:prod:only` | **仅** `wrangler deploy` 主 Worker（**不**跑 OpenNext，需已有 `.open-next`） |
| `cf:deploy:consumer` | 仅部署 Consumer Worker |
| `cf:deploy:all` | `cf:deploy:prod` + `cf:deploy:consumer`（本地一键：主站 **仅一次** OpenNext 构建） |
| `cf:deploy:all:ci` | `cf:deploy:prod:only` + `cf:deploy:consumer`（**适合 Git/CI：构建步骤已跑过 `cf:opennext:build`，部署不再构建**） |
| `cf:deploy:verify-order` | 强制按“consumer → 主站”顺序部署，用于验证 11001 收敛 |

**本地推荐：**

```bash
pnpm run cf:deploy:all
```

（会完整构建主站再部署；若只改 Consumer，可只跑 `pnpm run cf:deploy:consumer`。）

---

## 6. Cloudflare「连接到 Git」构建与部署（推荐配置）

当 Cloudflare 提供 **构建命令** 与 **部署命令** 两步时，应避免：

- 构建：`opennext build`
- 部署：`pnpm run cf:deploy:all`（其中 `cf:deploy:prod` **再次** `opennext build`）

→ 主站 OpenNext **构建执行两次**，时间与 CPU 浪费明显。

### 推荐配置（单流水线：同一个 Build 同时部署主站+Consumer）

| 步骤 | 推荐命令 |
|------|----------|
| **安装依赖**（若平台未自动执行） | `pnpm install --frozen-lockfile` |
| **构建** | `pnpm run cf:opennext:build` |
| **部署** | `pnpm run cf:deploy:all:ci` |

说明：

- **构建**：只生成 OpenNext 产物（`.open-next` 等），供后续 `wrangler deploy` 上传。
- **部署**：主站用 `cf:deploy:prod:only`（不再构建），再部署 Consumer；Consumer 不依赖 OpenNext，体积与耗时远小于主站。

若平台已固定先执行 `pnpm install`，构建命令可省略 `install`，只保留：

```bash
pnpm run cf:opennext:build
```

部署命令：

```bash
pnpm run cf:deploy:all:ci
```

**根目录** `/`、**生产分支** `main` 等与仓库一致即可。

### 构建监视路径（可选优化）

若希望 **仅改 consumer** 时不跑 OpenNext，可在 Cloudflare 中配置路径规则（仅示例，按团队习惯调整）：

- 包含 `workers/translator-consumer/**`、`wrangler.consumer.jsonc` → 部署命令可改为仅 `pnpm run cf:deploy:consumer`（需单独流水线或条件脚本，复杂项目可用 GitHub Actions 分支）。

默认仍使用 **全量** `cf:opennext:build` + `cf:deploy:all:ci` 最稳妥。

### 推荐配置（双流水线：主站与 Consumer 各自一个 Workers Build，强烈推荐）

当你在 Cloudflare 控制台已经拆成两个应用（`onlinepdftranslator` 与 `onlinepdftranslator-consumer`）时，必须使用以下命令，避免互相覆盖 Worker 名称：

#### 主站 Build（onlinepdftranslator）

| 步骤 | 推荐命令 |
|------|----------|
| **构建** | `pnpm install --frozen-lockfile && pnpm run cf:opennext:build` |
| **部署** | `pnpm run cf:deploy:web:ci`（等价 `cf:deploy:prod:only`） |
| **版本命令（可选）** | `pnpm run cf:versions:prod` |

#### Consumer Build（onlinepdftranslator-consumer）

| 步骤 | 推荐命令 |
|------|----------|
| **构建** | `pnpm install --frozen-lockfile` |
| **部署** | `pnpm run cf:deploy:consumer:ci`（等价 `cf:deploy:consumer`） |
| **版本命令（可选）** | `pnpm run cf:versions:consumer` |

> 注意：主站 Build 里不要使用 `cf:deploy:all:ci`，否则会尝试在主站流水线里再次部署 consumer，触发 Worker 名称不匹配和 Queue consumer 冲突（11004）。

---

## 7. 缩短构建与部署时长（优化清单）

按优先级从高到低：

### 7.1 避免重复 OpenNext 构建（必做）

- Git 集成：**构建** 已跑 `cf:opennext:build` 时，**部署** 使用 `cf:deploy:all:ci`，不要再用 `cf:deploy:all` 或 `cf:deploy:prod`。

### 7.2 开启并保留构建缓存

- 在 Cloudflare **启用「构建缓存」**（若提供）。
- 若使用 GitHub Actions 等 CI，缓存：
  - `~/.pnpm-store` 或 pnpm 的 store 目录
  - `node_modules`（可选，需与 lockfile 一致）
  - `.next/cache`（Next 编译缓存）
  - `.open-next/cache`（OpenNext 缓存，若存在）

恢复缓存 key 建议包含：`pnpm-lock.yaml`、Node 版本。

### 7.3 依赖与工具链

- 使用 `pnpm install --frozen-lockfile` 锁定依赖，减少非确定性安装时间。
- 定期升级 `wrangler`、`@opennextjs/cloudflare` 到当前稳定版（构建与打包性能会持续改进）。
- 若构建 OOM，可在构建命令前增加：`NODE_OPTIONS=--max-old-space-size=8192`（按 Runner 内存调整）。

### 7.4 仅改 Consumer 时

- 只执行：`pnpm run cf:deploy:consumer`（跳过 OpenNext），可显著缩短单次发布耗时。

### 7.5 不在 Worker 安装 Playwright 浏览器

- E2E 与 `playwright install` 放在独立测试流水线，**不要**放进 Cloudflare 构建步骤。

---

## 8. 错误 11001：Queue handler is missing

**现象：** 部署主 Worker 时报 `Queue handler is missing [code: 11001]`，或控制台显示主 Worker 绑定了 Queue 的 **consumer** 触发器。

**原因：** Cloudflare 上 **队列消费者** 绑定到了 **没有 `queue()` 的脚本**（例如 `onlinepdftranslator` 主站），而消费者应在 `onlinepdftranslator-consumer`。

**处理思路：**

1. 确认主站 `wrangler.jsonc` **只有** `queues.producers`，**没有** `queues.consumers`。
2. 确认 `wrangler.consumer.jsonc` 中有 `queues.consumers` 且实现 `queue()`。
3. 使用 Wrangler（需 API Token）检查并修正消费者绑定，例如：
   - 从主 Worker 移除 consumer：`wrangler queues consumer remove <queue-name> <script-name>`
   - 将 consumer 绑到消费者 Worker：`wrangler queues consumer add <queue-name> onlinepdftranslator-consumer`
   - 或直接执行仓库脚本（等价操作）：`pnpm run cf:queue:rebind:consumer`
4. 不要在控制台给 **主 Worker** 手动添加「队列消费者」绑定。

---

## 9. 本地开发（Windows 同模型）

双进程：

```bash
# 终端 1：Web
pnpm dev

# 终端 2：Consumer
pnpm exec wrangler dev -c wrangler.consumer.jsonc
```

环境：

- Web：`.env.development` 等
- Wrangler：`/.dev.vars`（与文档一致）

---

## 10. 上线前核对清单

- [ ] Queue 名称与 `wrangler` 中 `queue` 字段一致（`onlinepdftranslator`）
- [ ] 主 Worker 已配置 `queues.producers`，代码使用 `env.TRANSLATOR_TASKS_QUEUE`（或与 binding 一致）
- [ ] Consumer Worker 已配置 `queues.consumers`，且实现 `queue()`
- [ ] 两个 Worker 的变量/机密均已配置
- [ ] `QUEUE_ENABLED=true` 在生产生效
- [ ] Git 构建使用 `cf:opennext:build` + 部署使用 `cf:deploy:all:ci`，避免重复 OpenNext
- [ ] 主 Worker **未**被错误配置为 Queue consumer（无 11001）
- [ ] 部署后可验证：发任务 → 队列消费 → 轮询状态推进
- [ ] `TRANSLATOR_TRANSLATE_MODE=delimiter` 已生效（或按灰度策略）
- [ ] 灰度期 `TRANSLATOR_TRANSLATE_ENFORCE_COVERAGE=false`
- [ ] 观察到 `pipeline_translation_coverage` 指标（coverage/textCoverage/tableCoverage）
- [ ] 可视化兼容性验证通过（`layout_id/type/position/matrix` 未变化）

---

## 11. 常见误区

- **误区 1：** 只配 `QUEUE_ENABLED` 就能发队列。  
  **纠正：** 必须有 Wrangler 的 Queue producer 绑定。

- **误区 2：** OpenNext Worker 可以顺便当 Consumer。  
  **纠正：** 主站无 `queue()`；消费应独立 Worker，或需在主站显式导出 `queue`（不推荐与 OpenNext 混在同一入口）。

- **误区 3：** Web 配了变量，Consumer 自动继承。  
  **纠正：** 两个 Worker，需分别配置（或脚本批量写入）。

- **误区 4：** 控制台「绑定」里手动加 Queue 与仓库一致即可。  
  **纠正：** 以 `wrangler deploy` 为准；错误地把 consumer 绑到主 Worker 会触发 11001。

- **误区 5：** CI 里 `cf:deploy:all` 与 `cf:deploy:all:ci` 没区别。  
  **纠正：** `cf:deploy:all` 会再次完整 OpenNext 构建主站；`cf:deploy:all:ci` 在构建阶段已产出 `.open-next` 时使用，避免重复构建。

- **误区 6：** DeepSeek 重构后会改动可视化坐标结构。  
  **纠正：** 本次只改文本承载字段（`layouts[].text`、`tables[].cells[].text`，并同步 `pages[].text/markdown`），不改 `layout_id/type/position/matrix`。

- **误区 7：** 新翻译链路无法回滚。  
  **纠正：** 可通过 `TRANSLATOR_TRANSLATE_MODE=json_legacy` 一键回滚到旧 JSON 映射模式。

---

## 12. 本次生产发布（DeepSeek 重构）操作卡

### 12.1 发布目标

- 启用“分隔符协议 + 结构感知批次”翻译链路。
- 保持可视化解析兼容：不变更 `pages/layouts/tables/images/meta` 结构与坐标语义。

### 12.2 建议发布顺序

1. 同步两端变量（Web + Consumer）；
2. 先发 Consumer（队列任务执行端），再发 Web；
3. 验证 OCR→翻译→导出闭环；
4. 观察指标 30~60 分钟后再考虑开启 coverage 强门禁。

### 12.3 命令（本地一键）

```bash
# 全量（主站+消费者）
pnpm run cf:deploy:all
```

如仅改了 consumer 逻辑：

```bash
pnpm run cf:deploy:consumer
```

### 12.4 上线后快速验收

- API 功能验收：
  - 上传文档并触发翻译任务，确认状态能从 `ocr_submitted` 进入 `ready`。
- 质量验收：
  - 检查日志中 `pipeline_translation_coverage` 指标是否出现，覆盖率是否稳定。
- 兼容验收：
  - workbench 打开译文 JSON，确认框选/拖拽/导出不漂移。

### 12.5 指定样本脚本验收（可选）

```bash
pnpm run test:deepseek-translate-json -- \
  --input "D:/imppro/onlinepdftranslator/temp/file-uiYmUG43MWbSgo1HtOc2srapRjCbXpWP.json" \
  --output "D:/imppro/onlinepdftranslator/temp/file-uiYmUG43MWbSgo1HtOc2srapRjCbXpWP.translated.json" \
  --sourceLang "en" --targetLang "zh"
```

> 脚本依赖 `DEEPSEEK_API_KEY` 环境变量；输出会打印 coverage 统计。

### 12.6 回滚预案

仅需调整环境变量并重启发布：

- `TRANSLATOR_TRANSLATE_MODE=json_legacy`
- （可选）`TRANSLATOR_TRANSLATE_ENFORCE_COVERAGE=false`

然后执行：

```bash
pnpm run cf:deploy:all
```

---

## 附录：当前 Queue 状态（示例）

> 以下 ID/名称若与控制台不一致，以 Cloudflare 控制台为准。

- Queue 名称：`onlinepdftranslator`
- 需在控制台创建同名队列后，与上述 `wrangler` 配置一致。
