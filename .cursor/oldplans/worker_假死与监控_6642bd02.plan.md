---
name: Worker 假死与监控
overview: 消除 Celery 重复节点名警告、降低 Worker 假死概率，并增加可选的独立检测脚本与定时任务配置说明，便于 Windows 与 Linux 部署。
todos: []
isProject: false
---

# Worker 假死与监控方案

## 问题与根因

- **现象**：点击翻译后任务一直处于 Queued，Worker 日志显示 `celery@XS-1010515 ready` 但未执行任务；日志出现 `DuplicateNodenameWarning`。
- **可能原因**：
  1. **重复节点名**：未为 worker 指定唯一 `-n`，多实例或 mingle 阶段导致同名节点冲突，影响 broker 消费。
  2. **Worker 未真正消费**：solo 池在 Windows 下偶发不拉取、或 broker 连接在 “ready” 后断开未重连。
  3. **单点无监控**：无独立进程检测“有任务无人消费”，无法自动发现并恢复。

## 目标

1. 为每个 Worker 进程使用**唯一节点名**，消除 DuplicateNodenameWarning 并减少 broker 混淆。
2. 增强 Celery 配置的**连接与重试**，降低假死概率。
3. 提供**独立检测脚本**，可定期运行：发现“长时间 queued 无进展”或“队列有积压且无活跃 worker”时告警或触发恢复。
4. 文档化在 **Windows（当前）** 与 **Linux（上服务器后）** 下如何以定时任务/后台方式运行该检测。

### 与翻译按钮的适配（已实现，本方案保持一致即可）

- **翻译按钮**（[frontend/components/TranslationForm.tsx](frontend/components/TranslationForm.tsx)）：首页已传入 `taskStatus`；当 `taskStatus === "queued"` 或 `"processing"` 时按钮禁用（变灰）并显示「翻译中…」，防止重复点击；当任务变为 `completed` 或 `failed` 后按钮自动恢复可点击。
- **本方案无需再改按钮逻辑**。Worker 唯一节点名、连接重试与检测脚本只影响后台消费与恢复；前端仍通过 SSE/轮询获取 `taskStatus`。Worker 恢复正常并执行任务后，状态会更新为 completed/failed，按钮随之恢复；若检测脚本触发 Worker 重启，用户刷新或等待下一次状态更新后，按钮状态也会正确。实施本方案时确认首页已对 `TranslationForm` 传入 `taskStatus={taskStatus}` 即可。

---

## 1. Worker 唯一节点名（消除 DuplicateNodenameWarning）

**文件**：[scripts/run-worker.js](scripts/run-worker.js)

- 当前启动参数无 `-n`，Celery 默认使用主机名，多实例或 mingle 会报重复节点名。
- **修改**：增加 `-n`，使用唯一标识。推荐格式：`worker@%h-%t`（%h=hostname，%t=timestamp）或 `worker@%h-<pid>`。在 Node 中可用：
  - `-n`, `worker@%h-` + `${Date.now()}` 或
  - `-n`, `worker1@%h`（单实例时固定即可）。
- 单机单 worker 时用 `worker1@%h` 即可；若可能起多个进程（如误开两个 dev:all），可用 `worker@%h-${Date.now()}` 保证每次启动不同。

**建议**：`-n worker1@%h`，并在文档中说明“同一台机只起一个 worker 进程”。若需支持同机多 worker，再改为带 PID 或时间戳。

---

## 2. Celery 连接与重试配置（降低假死）

**文件**：[backend/app/celery_app.py](backend/app/celery_app.py)

- 在 `celery_app.conf.update(...)` 中增加：
  - **broker_connection_retry_on_startup**: `True`（启动时 broker 不可用时重试，避免静默失败）。
  - **broker_transport_options**: 可选 `{'visibility_timeout': 3600}`（与 Redis 一致，避免任务被误认为超时重投）。
  - **worker_prefetch_multiplier**: 已用 `-P solo` 时通常为 1，可显式设为 `1`，确保一次只取一个任务，便于排查“卡在一任务”的情况。

不改变现有 broker/backend 配置，仅增加上述稳健性选项。

---

## 3. 独立检测脚本（后台/定时检测）

**新建**：`scripts/check_celery_worker.py`（或置于 `backend/scripts/`）

**逻辑概要**：

1. **输入**：可选配置（如 DB 连接、Redis URL、等待阈值分钟数），从环境变量或 `.env` 读取与 backend 一致。
2. **检测项**：
  - **A. 长时间处于 queued 的任务**：查询 DB，`status='queued'` 且 `updated_at` 早于“当前时间 - N 分钟”（如 5 分钟）。若存在，认为可能有任务未被消费。
  - **B. Worker 是否存活**：使用 Celery 的 `inspect().ping()` 向 broker 查询是否有 worker 响应。若无响应，认为 worker 未运行或假死。
  - **C. （可选）Redis 队列长度**：若可访问 Redis，读取 Celery 默认队列（如 `celery`）的 list length，大于 0 表示有积压。
3. **输出与退出码**：
  - 若 A 或 C 有积压且 B 无 worker 响应：打印告警日志，**退出码 1**（便于上层脚本或 cron 做“重启 worker”等动作）。
  - 否则：退出码 0。
4. **不在此脚本内直接杀进程**：仅检测 + 退出码；由调用方（如 cron、Task Scheduler 或 restart 脚本）根据退出码决定是否重启 worker，便于跨平台。

**依赖**：使用项目已有 `backend` 环境（SQLAlchemy、Celery、redis），在 `backend` 目录下以 `python -m scripts.check_celery_worker` 或 `python scripts/check_celery_worker.py` 运行；或通过 `celery_app` 的 control.inspect() 需要 broker 连接，与 backend 共用配置。

**实现要点**：

- 通过 `backend/app/config.py` 的 `get_settings()` 取 `REDIS_URL`、DB 等；或脚本内最小化依赖，仅连 Redis + 读 DB。
- 若使用 Celery inspect，需从 `app.celery_app` 获取 app 并 `app.control.inspect().ping()`。
- 建议 N 分钟阈值可配置（如环境变量 `WORKER_STUCK_MINUTES=5`）。

---

## 4. Windows 与 Linux 下的“定时/后台”运行方式

**文档**：在 [doc/README.md](doc/README.md) 或新建 [doc/worker-health-check.md](doc/worker-health-check.md) 中说明。


| 环境          | 方式                     | 说明                                                                                                                                                                             |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Windows** | 任务计划程序（Task Scheduler） | 每 2–5 分钟运行一次 `check_celery_worker.py`；若退出码 1，可配置“运行另一程序”如重启 worker 的批处理（先 taskkill 再启动 run-worker.js 或 celery 命令）。                                                             |
| **Windows** | 单独常驻进程                 | 写一个小脚本循环：sleep 2 分钟 → 调用 `check_celery_worker.py` → 若退出码 1 则用 `child_process` 或 `taskkill` 结束当前 worker 进程（需记录 worker 的 PID，或通过进程名匹配），然后由用户或 PM2/concurrently 的 restart 策略重新拉起。 |
| **Linux**   | cron                   | `*/2 * * * * cd /path/to/project/backend && .venv/bin/python -m scripts.check_celery_worker                                                                                    |
| **Linux**   | systemd                | 若 worker 由 systemd 管理，可单独一个 timer unit 定期执行检测脚本；脚本退出 1 时执行 `systemctl restart celery-worker.service`。                                                                          |


不在本方案内实现具体的“自动杀进程/重启”逻辑，仅提供脚本退出码与文档说明，由部署方按环境选择。

---

## 5. 实施顺序与文件清单


| 步骤  | 文件                                                                              | 变更                                                                                                 |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | [scripts/run-worker.js](scripts/run-worker.js)                                  | 增加 `-n worker1@%h`（或带时间戳的唯一名），消除重复节点名。                                                             |
| 2   | [backend/app/celery_app.py](backend/app/celery_app.py)                          | 增加 broker_connection_retry_on_startup、可选 worker_prefetch_multiplier=1、可选 broker_transport_options。 |
| 3   | 新建 `backend/scripts/check_celery_worker.py`（或 `scripts/check_celery_worker.py`） | 检测 DB 中长时间 queued 的任务、Celery inspect ping、可选 Redis 队列长度；退出码 0/1。                                   |
| 4   | 新建 [doc/worker-health-check.md](doc/worker-health-check.md)                     | 说明脚本用法、Windows 任务计划程序与 Linux cron/systemd 的配置示例、如何根据退出码重启 worker。                                  |
| 5   | [doc/README.md](doc/README.md)                                                  | 在技术文档索引中增加 worker-health-check 的链接。                                                                |


---

## 6. 可选后续

- **Worker 重启脚本**：在 Windows 下提供 `.bat`/`.ps1` 用于“停止当前 worker 再启动”（可被 Task Scheduler 在检测到退出码 1 时调用）。
- **告警通道**：检测到异常时写入日志或发送邮件/Webhook，便于运维发现。
- **前端/API 提示**：当任务长时间处于 queued 时，前端可提示“若长时间未开始可刷新页面或联系管理员检查后台 Worker”。

以上方案在不改变现有业务逻辑的前提下，从“唯一节点名 + 连接重试”和“独立检测 + 文档”两方面降低 Worker 假死现象并便于排查与恢复。