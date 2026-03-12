# Worker 健康检测与定时恢复

本文说明如何**运行与检查** Celery Worker、健康检测脚本用法，以及在 Windows 与 Linux 下通过定时任务在检测到异常时重启 Worker。

## 如何运行 Worker

翻译任务由 **Celery Worker** 执行（调用 BabelDOC + DeepSeek）。若不启动 Worker，任务会一直停在「排队/翻译中」，前端会一直显示 "Translating" 或 "Generating translation"。

**方式一：一键启动后端 + Worker + 前端（推荐本地开发）**

在项目根目录执行：

```bash
cd frontend
npm run dev:all
```

会同时启动：backend（FastAPI）、**worker**（Celery）、frontend（Next.js）。终端里会有三个区，带 `[worker]` 前缀的即为 Worker 输出。

**方式二：单独启动 Worker**

在项目根目录执行（需已启动 Redis，且后端可单独用 `uvicorn` 等启动）：

```bash
node scripts/run-worker.js
```

Worker 会从 **backend** 目录下以 `python -m celery -A app.celery_app.celery_app worker ...` 运行，连接 `REDIS_URL` 并消费队列中的任务。

## 如何确认 Worker 是否在跑、是否在执行翻译

1. **看终端**  
   若用 `npm run dev:all`，应有一个子进程持续输出带 `[worker]` 的日志。接到翻译任务时会看到类似：
   - `Task translate.run_translation_task[xxx] received`
   - `run_translation_task started task_id=...`
   - `run_translation_task progress: ... stage=translating`
   - 完成后：`run_translation_task completed task_id=...`

2. **用健康检测脚本**（在 backend 目录下）  
   ```bash
   cd backend
   python -m scripts.check_celery_worker
   ```  
   退出码 **0** 表示有 Worker 响应；退出码 **1** 表示有积压/长时间 queued 且 **没有** Worker 响应（即 Worker 没在跑或连不上）。

3. **看进程**  
   Windows：任务管理器里找 `python.exe`，命令行参数含 `celery`、`worker`。  
   Linux/macOS：`ps aux | grep celery` 能看到 worker 进程。

**若重启后只开了后端和前端、没开 Worker**：新提交的翻译会一直处于 queued；之前已变成 "processing" 的任务会一直卡在 "processing"，前端就会一直显示 "Translating"。解决方法是**启动 Worker**（如上方式一或二）。新任务在 Worker 启动后会被正常消费。

**Worker 启动时自动修复「卡在 Translating」**：每次 Celery Worker 进程启动时，会把数据库中所有仍为 `processing` 的任务标记为失败（`error_code=worker_restart`，提示 "Translation was interrupted (e.g. server or worker restarted). Please try again."）。因此重启后只要再次执行 `npm run dev:all` 或 `node scripts/run-worker.js`，前端刷新后这些任务会显示为失败而非一直 Translating，用户可重新发起翻译。

## 脚本说明

- **路径**：`backend/scripts/check_celery_worker.py`
- **作用**：检测「长时间处于 queued 的任务」与「Celery 队列有积压且无活跃 worker」；仅检测并设置退出码，**不在此脚本内杀进程或重启**。
- **退出码**：
  - **0**：正常（有 worker 响应，或无积压/无长时间 queued）。
  - **1**：异常（存在长时间 queued 或 Redis 队列积压，且 `inspect().ping()` 无 worker 响应），便于上层脚本或定时任务触发重启。

### 运行方式

在项目 **backend** 目录下执行（使用项目已有 .venv 与配置）：

```bash
cd backend
python -m scripts.check_celery_worker
```

依赖与 backend 一致：从 `.env` / 环境变量读取 `DATABASE_URL`、`REDIS_URL` 等（见 `app.config.get_settings()`）。

### 可选环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `WORKER_STUCK_MINUTES` | 判定「长时间 queued」的分钟数（`updated_at` 早于当前时间减去该值即视为 stuck） | `5` |

## 根据退出码重启 Worker

脚本只负责检测并返回退出码，由调用方根据 **退出码 1** 决定是否重启 Worker（如：杀进程后由 PM2 / 任务计划程序 / systemd 重新拉起）。

### Windows：任务计划程序（Task Scheduler）

1. 每 2–5 分钟运行一次检测脚本。
2. 若脚本退出码为 1，再运行「重启 Worker」的动作。

**示例：先建“重启 Worker”的批处理**（如 `scripts/restart-worker.bat`，按你实际路径调整）：

```batch
@echo off
taskkill /F /IM python.exe /FI "WINDOWTITLE eq *celery*" 2>nul
timeout /t 2 /nobreak >nul
cd /d D:\imppro\translatepdfonline\backend
call ..\.venv\Scripts\activate.bat
start "celery-worker" /B node ..\scripts\run-worker.js
```

或若 Worker 由 `npm run dev:all` 等用 PM2/Concurrently 启动，可改为调用 `pm2 restart celery-worker` 等。

**任务计划程序中**：

- 程序：`D:\imppro\translatepdfonline\.venv\Scripts\python.exe`
- 参数：`-m scripts.check_celery_worker`
- 起始于：`D:\imppro\translatepdfonline\backend`
- 若需“退出码非 0 时运行另一程序”，可在该任务“条件”或“操作”中配置：当上述程序返回 1 时，再运行 `restart-worker.bat`（具体依你使用的任务计划程序版本配置）。

### Windows：单独常驻进程循环检测

写一个小脚本循环：每 2 分钟执行一次 `check_celery_worker.py`，若退出码为 1 则结束当前 Worker 进程（需事先记录 PID 或通过进程名匹配），由用户或 PM2/Concurrently 的 restart 策略重新拉起。实现方式依你现有进程管理方式而定，此处不展开。

### Linux：cron

每 2 分钟执行一次检测；退出码 1 时可由 cron 调用重启脚本（见下节）。

```cron
*/2 * * * * cd /path/to/translatepdfonline/backend && .venv/bin/python -m scripts.check_celery_worker || /path/to/restart-celery-worker.sh
```

或分开两个 cron：一个只跑检测并写日志；另一个在检测脚本返回 1 时执行重启脚本（通过包装脚本判断退出码）。

**示例包装脚本**（`scripts/check-and-restart-worker.sh`）：

```bash
#!/bin/bash
cd /path/to/translatepdfonline/backend
.venv/bin/python -m scripts.check_celery_worker
exitcode=$?
if [ $exitcode -eq 1 ]; then
  systemctl restart celery-worker.service
  # 或: supervisorctl restart celery-worker
  # 或: pkill -f "celery.*worker" && (nohup ... &)
fi
exit $exitcode
```

### Linux：systemd

若 Worker 由 systemd 管理（如 `celery-worker.service`），可单独建一个 timer unit 定期执行检测脚本；当脚本退出 1 时，在 `ExecStartPost` 或单独一个 unit 中执行 `systemctl restart celery-worker.service`。

**示例**（仅思路，按你实际路径和 unit 名修改）：

- `check-celery-worker.service`：执行 `python -m scripts.check_celery_worker`，工作目录为 backend。
- `check-celery-worker.timer`：每 2 分钟触发一次上述 service。
- 若需“退出码 1 时重启 worker”，可在同机写一个小脚本：先跑检测脚本，若返回 1 则 `systemctl restart celery-worker.service`，再由 timer 调用该脚本。

## 小结

| 环境 | 方式 | 说明 |
|------|------|------|
| Windows | 任务计划程序 | 每 2–5 分钟运行 `check_celery_worker.py`；退出码 1 时运行“重启 Worker”的批处理或命令。 |
| Windows | 常驻进程循环 | 循环 sleep + 检测；退出码 1 时结束 Worker 进程，由 PM2/Concurrently 等重新拉起。 |
| Linux | cron | `*/2 * * * * cd .../backend && .venv/bin/python -m scripts.check_celery_worker`，可与重启脚本组合。 |
| Linux | systemd timer | 定时执行检测脚本；退出码 1 时执行 `systemctl restart celery-worker.service`。 |

脚本本身不杀进程、不重启，仅做检测与退出码输出，便于跨平台与不同部署方式复用。
