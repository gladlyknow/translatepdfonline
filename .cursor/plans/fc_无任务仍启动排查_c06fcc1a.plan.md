---
name: FC 无任务仍启动排查
overview: 日志里的 Uvicorn 启动行表示阿里云 FC **为该 HTTP 函数分配/冷启动了实例**，与「是否有翻译业务」无直接等价关系。应用侧在无 `queued` 任务时不会调用 FC；需从 **谁在请求 FC 公网 URL** 与 **平台健康检查** 入手排查，并可通过关闭 FastAPI 文档面、收紧探测与网络策略减少无谓拉起。
todos:
  - id: fc-console-logs
    content: 在阿里云 FC 控制台核对三次时间点的 HTTP 方法/路径/来源，区分探活、扫描与 POST /translate
    status: pending
  - id: db-queued-audit
    content: 查询 translation_tasks 是否存在 status=queued 且 preprocess_with_ocr=false 的滞留行
    status: pending
  - id: disable-fastapi-docs-prod
    content: （可选）babeldoc_fc 生产环境关闭 docs/redoc/openapi 或按 env 开关，降低扫描触达
    status: pending
  - id: doc-operational-note
    content: （可选）在 translate-fc 文档中写明：任意 HTTP 可能冷启动；健康检查与公网暴露的影响
    status: pending
isProject: false
---

# FC 无「翻译任务」仍出现 Uvicorn 启动日志 — 原因与处理

## 现象含义

你看到的：

`INFO: Started server process [1]` / `Uvicorn running on http://0.0.0.0:9000`

是 **babeldoc_fc**（[babeldoc_fc/main.py](d:\imppro\translatepdfonline\babeldoc_fc\main.py)）进程启动时的标准输出。**只要 FC 为该函数拉起一个新实例（冷启动），就会打印**，不要求此时正在执行 `POST /translate` 里的翻译逻辑。

因此：**「没有翻译任务」≠「没有任何 HTTP 打到 FC」**。任何一次对该函数 HTTP 入口的请求（含失败、探活、误扫）都可能触发冷启动与上述日志。

## 应用代码侧结论（translatepdfonline）

- Worker 只在 **确有可认领任务** 时对 FC 发起 `fetch`：`dispatchPendingTranslateFcJobs` 在 [frontend/src/app/api/translate/invoke-fc.ts](d:\imppro\translatepdfonline\frontend\src\app\api\translate\invoke-fc.ts) 中先查库取 `queued` 任务，无 `id` 则 `break`，**不会调用 FC**；`POST /api/translate` 里也是在有 `FC_URL`、有 `sourcePdfUrl` 等条件满足后才 `invokeTranslateFcForTask`（[frontend/src/app/api/translate/route.ts](d:\imppro\translatepdfonline\frontend\src\app\api\translate\route.ts)）。
- 因此：**若你确认当时库里没有 `status=queued` 且 `preprocessWithOcr=false` 的待派发任务**，则这些 FC 启动日志 **大概率不是** 本仓库 `dispatch-pending` 或 `invoke-fc` 在无任务时「误调」导致的，而是 **其它流量触发了 FC HTTP 触发器**。

## 最可能原因（按优先级）

1. **阿里云 FC / SLB / 自定义域名上的「健康检查」或「可用性探测」**  
   若探测 URL 指向该函数的 HTTP 地址（哪怕是 `GET /health`），**每次探测仍可能冷启动实例**（取决于实例是否已被回收、并发策略等）。你提供的三次时间间隔不固定，也符合「外部或平台间歇探测」而非固定业务队列。

2. **公网暴露的 HTTP 函数被扫描**  
   FastAPI 默认会挂 **OpenAPI `/docs`、`/redoc`、`/openapi.json`**（当前 [babeldoc_fc/main.py](d:\imppro\translatepdfonline\babeldoc_fc\main.py) 使用默认 `FastAPI(...)`，未关闭）。爬虫或安全扫描访问这些路径同样会拉起实例。

3. **人为或脚本误请求**  
   浏览器打开 FC URL、Postman、监控 SaaS、旧版 CI 冒烟测试等。

4. **数据库里仍有「queued」僵尸任务**（次要）  
   若存在长期 `queued` 且满足 `fc_next_attempt_at` / lease 条件，`dispatch-pending` 会 `invokeTranslateFcForTask`，**这是真实翻译派发**，只是业务上你认为「没有任务」。需在 DB 侧核对。

## 建议排查步骤（不改代码即可完成）

1. **在阿里云 FC 控制台查看「调用记录 / 访问日志」**  
   对照三次时间戳，看 **HTTP 方法、路径、来源 IP、是否异步头** 等；确认是 `GET /health`、`GET /docs`、还是 `POST /translate` 等。

2. **检查该函数是否配置了「健康检查 URL」**  
   若指向本函数域名：评估是否关闭、降低频率，或改为仅内网可访问（见下）。

3. **检查是否对 FC 公网 URL 配置了外部 Uptime 监控**  
   与业务翻译解耦：要么关掉，要么只监控你们 **Cloudflare Worker** 站点而非 FC 直连。

4. **SQL 核对是否有待派发翻译**（与代码筛选条件一致）  
   `status = 'queued' AND preprocess_with_ocr = false`，并看 `fc_next_attempt_at`、`fc_invoke_lease_until`。

## 可选工程改进（确认根因后再做）

| 项 | 目的 | 位置 |
|----|------|------|
| 生产关闭 Swagger/ReDoc | 减少无意义 GET 触达 | [babeldoc_fc/main.py](d:\imppro\translatepdfonline\babeldoc_fc\main.py)：`FastAPI(..., docs_url=None, redoc_url=None)` 或通过环境变量开关 |
| 文档说明「零请求才零冷启动」 | 避免误解 FC 计费模型 | [frontend/docs/translate-fc-contract.md](d:\imppro\translatepdfonline\frontend\docs\translate-fc-contract.md) 或 [babeldoc_fc/README.md](d:\imppro\translatepdfonline\babeldoc_fc\README.md)（若存在） |
| 网络层仅允许 Worker 出口 IP / VPC | 阻断公网扫描与随意探测 | 阿里云安全组 / 函数访问控制 / 专用网关（运维配置，非必选代码） |

**重要边界**：在典型 Serverless HTTP 模型下，**无法做到「绝对没有任何 HTTP 时仍保证第一次翻译零延迟」**；能做的是 **减少与翻译无关的请求** 触达该函数，从而减少冷启动与费用。

## 需要你确认的一点（便于把计划落到具体配置）

若你能在 FC 控制台截一条 **失败或成功的访问日志中的「请求路径 + 方法」**（可打码域名），可以直接判定是健康检查、`/docs` 扫描还是真实 `POST /translate`。
