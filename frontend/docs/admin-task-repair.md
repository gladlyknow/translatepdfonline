# 管理员任务修复指南

当 OCR 翻译任务在流水线中失败（如 DeepSeek JSON 解析错误），管理员可通过以下流程手动修复。

## 前置条件

- 管理员账号（可登录后台 `/admin`）
- 数据库访问权限（用于验证和异常数据修复）
- R2 存储访问权限（用于复制文件，仅在跨任务复制场景需要）

## 推荐流程：同任务重试

> 重试复用同一 `task_id`，R2 文件路径不变，修复后用户立即可见。

### 1. 查询失败任务

```sql
-- schema 默认为 public；如使用 translate_dev 请替换
SELECT
    id,
    user_id,
    document_id,
    source_lang,
    target_lang,
    status,
    error_code,
    error_message,
    progress_stage,
    created_at
FROM translation_tasks
WHERE status = 'failed'
  AND preprocess_with_ocr = TRUE
  AND error_code = 'ocr_stage_translate_parse_result_failed'
ORDER BY created_at DESC
LIMIT 20;
```

### 2. 管理员后台重试

登录后台 → AI Tasks 页面 → 找到对应任务 → 点击重试（Retry）。

系统调用 `retryOcrTaskFromFailedStage` 将任务置为 `queued`，重新入队 OCR 流水线。完成后同一条记录 status 自动变为 `completed`。

### 3. 验证修复结果

```sql
SELECT id, status, progress_stage, progress_percent, error_code, updated_at
FROM translation_tasks
WHERE id = 'TASK_ID';
```

status 为 `completed`、progress_percent 为 100 即修复成功。

---

## 备选流程：跨任务复制

> 适用于重试失败、或通过新建翻译任务间接修复的场景。将新成功任务的输出复制到旧失败任务。

### 1. 查询新旧任务

```sql
-- 失败任务（待修复）
SELECT id, user_id, document_id, source_lang, target_lang,
       output_object_key, output_primary_path, progress_stage
FROM translation_tasks WHERE id = 'FAILED_TASK_ID';

-- 成功任务（输出源）
SELECT id, user_id, document_id,
       output_object_key, output_primary_path
FROM translation_tasks WHERE id = 'NEW_TASK_ID' AND status = 'completed';
```

### 2. R2 文件复制

使用 Cloudflare 控制台或 CLI 将新任务的 R2 文件复制到旧任务路径：

```
源: translations/{NEW_TASK_ID}/ocr-output.pdf          → translations/{FAILED_TASK_ID}/ocr-output.pdf
源: translations/{NEW_TASK_ID}/ocr-output.md           → translations/{FAILED_TASK_ID}/ocr-output.md
源: translations/{NEW_TASK_ID}/ocr-source.md           → translations/{FAILED_TASK_ID}/ocr-source.md
源: translations/{NEW_TASK_ID}/ocr-parse-result.json   → translations/{FAILED_TASK_ID}/ocr-parse-result.json
源: translations/{NEW_TASK_ID}/ocr-parse-result-target.json → translations/{FAILED_TASK_ID}/ocr-parse-result-target.json
源: translations/{NEW_TASK_ID}/ocr-translated.md       → translations/{FAILED_TASK_ID}/ocr-translated.md
```

### 3. SQL 更新旧任务状态

```sql
-- 将旧任务指向新任务的输出，并标记为完成
UPDATE translation_tasks
SET
    status = 'completed',
    error_code = NULL,
    error_message = NULL,
    progress_percent = 100,
    progress_stage = 'completed',
    progress_current = NULL,
    progress_total = NULL,
    output_object_key = NULL,          -- OCR 流程完成后固定为 null
    output_primary_path = NULL,        -- 同上
    fc_next_attempt_at = NULL,
    fc_dispatch_attempt_count = 0,
    fc_invoke_lease_until = NULL,
    updated_at = NOW()
WHERE id = 'FAILED_TASK_ID';
```

### 4. 复制导出记录（如有）

```sql
INSERT INTO translation_task_export
    (id, task_id, user_id, anon_id, format, status,
     source_markdown_object_key, r2_key, error_message, log,
     created_at, updated_at)
SELECT
    gen_random_uuid(),                    -- 新 id
    'FAILED_TASK_ID',                     -- 指向旧任务
    user_id,
    anon_id,
    format,
    status,
    source_markdown_object_key,
    r2_key,
    error_message,
    log,
    NOW(),
    NOW()
FROM translation_task_export
WHERE task_id = 'NEW_TASK_ID';
```

### 5. 验证

```sql
-- 确认旧任务已完成
SELECT id, status, progress_percent, error_code, updated_at
FROM translation_tasks WHERE id = 'FAILED_TASK_ID';

-- 确认导出记录已关联
SELECT id, task_id, format, status, r2_key
FROM translation_task_export WHERE task_id = 'FAILED_TASK_ID';
```

---

## 批量修复 translate_parse_result 失败任务

```sql
-- 1. 预览待修复任务（含用户邮箱，方便后续通知）
SELECT
    t.id,
    t.user_id,
    u.email,
    t.source_lang,
    t.target_lang,
    t.error_code,
    t.created_at
FROM translation_tasks t
LEFT JOIN "user" u ON u.id = t.user_id
WHERE t.status = 'failed'
  AND t.preprocess_with_ocr = TRUE
  AND t.error_code = 'ocr_stage_translate_parse_result_failed'
ORDER BY t.created_at DESC;

-- 2. 批量重置为 queued（注意：实际重试应通过 API，不要直接 SQL 重置）
--    以下 SQL 仅供紧急批量操作参考，需配合 dispatchPendingOcrJobs 使用
-- UPDATE translation_tasks
-- SET
--     status = 'queued',
--     error_code = NULL,
--     error_message = NULL,
--     fc_next_attempt_at = NOW(),
--     fc_dispatch_attempt_count = 0,
--     fc_invoke_lease_until = NULL,
--     updated_at = NOW()
-- WHERE status = 'failed'
--   AND preprocess_with_ocr = TRUE
--   AND error_code = 'ocr_stage_translate_parse_result_failed';
```

> **警告**：批量 SQL 重置绕过了 `retryOcrTaskFromFailedStage` 的校验逻辑。优先通过后台逐个重试；仅在大量任务需要紧急修复时使用批量 SQL，且需确认后立即触发 `dispatchPendingOcrJobs` 或等待 cron 自动派发。

---

## 邮件通知模板（人工发送）

修复完成后，管理员手动向用户发送邮件：

```
Subject: Your PDF translation is ready / 您的 PDF 翻译已完成

Hi {user_name},

Your translation task (ID: {task_id}) that previously failed has been repaired.
You can now view and download the translated PDF at:
https://www.translatepdfonline.com/dashboard

We apologize for the inconvenience.

Best regards,
TranslatePDFOnline Team
```
