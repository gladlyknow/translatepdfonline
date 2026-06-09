# Postgres 迁移（translatepdfonline）

在 **与 `DATABASE_URL` 相同的库** 中执行（Neon SQL Editor、psql、`pgAdmin` 等）。

| 文件 | 说明 |
|------|------|
| `translation_tasks_billing.sql` | 积分扣费相关列：`credit_consume_id`、`credits_estimated`、`credits_charged`、`billing_error`、`preprocess_with_ocr` |
| `translation_tasks_fc_dispatch.sql` | FC 重试调度列：`fc_next_attempt_at`、`fc_last_*`、`fc_dispatch_attempt_count`、`fc_invoke_lease_until` |

**建议顺序**：先 `translation_tasks_billing.sql`，再 `translation_tasks_fc_dispatch.sql`。可重复执行（`IF NOT EXISTS`）。

若插入任务报错 **42703 / 字段不存在**，说明上述 SQL 尚未在该库执行。
