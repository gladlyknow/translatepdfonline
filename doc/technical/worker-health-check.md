# Celery / Worker 健康检查（历史方案说明）

> **当前主线部署**以 [frontend/docs/PROJECT_SETUP_AND_FC.md](../../frontend/docs/PROJECT_SETUP_AND_FC.md) 为准：翻译由 **Next 调阿里云 FC（`babeldoc_fc`）**，任务状态由 **FC 回调 Next** 更新。根目录 [README.md](../../README.md) 中描述的 **FastAPI + Celery + Redis** 为早期/可选自建后端路线；若生产未跑 Worker，本节仅供遗留环境或自建 Worker 时参考。

## 规划与脚本出处

- 健康检测脚本、Windows 任务计划与 Linux systemd/cron 示例、按退出码重启等，在实现计划中集中说明：  
  [.cursor/plans/worker_假死与监控_6642bd02.plan.md](../../.cursor/plans/worker_假死与监控_6642bd02.plan.md)

## 若仍运行 Celery Worker

1. 使用计划文档中的检测脚本定期探测队列消费与心跳。  
2. 非零退出时由调度器重启进程，并配合日志与告警。  
3. 与 [db-redis-change-workflow.md](./db-redis-change-workflow_6ffafc63.plan.md) 中的 Redis/DB 变更流程协调，避免 Worker 连错实例。

更完整的索引见 [../ARCHIVE_INDEX.md](../ARCHIVE_INDEX.md)。
