/**
 * 一次性管理脚本：把旧 OCR 任务的 ParseResult JSON 中残留的百度图片
 * 镜像到 R2，并把字段（含 markdown / HTML 内嵌 URL）改写为 R2 URL。
 *
 * 用法：
 *   npx tsx scripts/with-env.ts npx tsx scripts/ocr-mirror-baidu-images.ts --task=<id>
 *   npx tsx scripts/with-env.ts npx tsx scripts/ocr-mirror-baidu-images.ts --task-file=tasks.txt
 *   npx tsx scripts/with-env.ts npx tsx scripts/ocr-mirror-baidu-images.ts --all-recent=200
 *   npx tsx scripts/with-env.ts npx tsx scripts/ocr-mirror-baidu-images.ts --all-recent=200 --concurrency=5
 *   npx tsx scripts/with-env.ts npx tsx scripts/ocr-mirror-baidu-images.ts --task=abc --dry-run
 *
 * 行为：
 * - 每个 task 串行处理，单 task 内部图片下载并发 = `--concurrency`（默认 5）
 * - 单图自动重试 3 次（401/403/404/410 fast-fail；与 OCR 队列阶段共享底层实现）
 * - source 与 target 两份 JSON 都尝试改写（target 不存在时静默跳过）
 * - dry-run 仅扫描并报告 replaced/failed/total，不写回 R2
 *
 * 依赖 env：`R2_*`、`DATABASE_URL` / Hyperdrive；与 `with-env.ts` 配合使用。
 */

process.env.DB_SINGLETON_ENABLED = process.env.DB_SINGLETON_ENABLED || 'true';
process.env.DB_MAX_CONNECTIONS = process.env.DB_MAX_CONNECTIONS || '2';

import * as fs from 'node:fs';

import { desc, eq } from 'drizzle-orm';

import { closeDb, db } from '@/core/db';
import { translationTasks } from '@/config/db/schema';
import { rewriteExternalImagesToR2 } from '@/shared/lib/ocr-parse-result-image-proxy';
import {
  ocrParseResultSourceKey,
  ocrParseResultTargetKey,
} from '@/shared/lib/ocr-parse-result-r2-keys';
import { getObjectBody, putObject } from '@/shared/lib/translate-r2';

type Args = {
  task?: string;
  taskFile?: string;
  allRecent?: number;
  concurrency: number;
  dryRun: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (prefix: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(prefix));
    if (!arg) return undefined;
    if (arg.includes('=')) return arg.split('=').slice(1).join('=');
    const idx = argv.indexOf(arg);
    return argv[idx + 1];
  };
  const concurrencyRaw = Number(get('--concurrency') ?? 5);
  const concurrency = Number.isFinite(concurrencyRaw)
    ? Math.max(1, Math.min(16, Math.floor(concurrencyRaw)))
    : 5;
  return {
    task: get('--task'),
    taskFile: get('--task-file'),
    allRecent: get('--all-recent') != null ? Number(get('--all-recent')) : undefined,
    concurrency,
    dryRun: argv.includes('--dry-run'),
  };
}

function printUsageAndExit(): never {
  console.error('Usage:');
  console.error(
    '  npx tsx scripts/ocr-mirror-baidu-images.ts --task=<id>'
  );
  console.error(
    '  npx tsx scripts/ocr-mirror-baidu-images.ts --task-file=<path>'
  );
  console.error(
    '  npx tsx scripts/ocr-mirror-baidu-images.ts --all-recent=<N>  (default 200)'
  );
  console.error(
    '  Options: --concurrency=<1-16> (default 5)  --dry-run'
  );
  process.exit(2);
}

async function loadTaskIds(args: Args): Promise<string[]> {
  if (args.task) return [args.task.trim()].filter(Boolean);
  if (args.taskFile) {
    const raw = fs.readFileSync(args.taskFile, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
  }
  const limit = Math.max(
    1,
    Math.min(2000, Math.floor(Number(args.allRecent ?? 200) || 200))
  );
  const rows = await db()
    .select({ id: translationTasks.id })
    .from(translationTasks)
    .where(eq(translationTasks.preprocessWithOcr, true))
    .orderBy(desc(translationTasks.createdAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

type SubResult = {
  key: string;
  found: boolean;
  replaced: number;
  failed: number;
  total: number;
  written: boolean;
  errorMessage?: string;
};

async function processOneJsonKey(
  taskId: string,
  key: string,
  concurrency: number,
  dryRun: boolean
): Promise<SubResult> {
  let bytes: Uint8Array;
  try {
    bytes = await getObjectBody(key);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/404|NoSuchKey|not found/i.test(msg)) {
      return {
        key,
        found: false,
        replaced: 0,
        failed: 0,
        total: 0,
        written: false,
      };
    }
    return {
      key,
      found: false,
      replaced: 0,
      failed: 0,
      total: 0,
      written: false,
      errorMessage: msg.slice(0, 300),
    };
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch (e) {
    return {
      key,
      found: true,
      replaced: 0,
      failed: 0,
      total: 0,
      written: false,
      errorMessage: `JSON parse failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  const result = await rewriteExternalImagesToR2({
    json,
    taskId,
    maxConcurrent: concurrency,
  });
  let written = false;
  if (!dryRun && result.replaced > 0) {
    await putObject(
      key,
      new TextEncoder().encode(JSON.stringify(json)),
      'application/json; charset=utf-8'
    );
    written = true;
  }
  return {
    key,
    found: true,
    replaced: result.replaced,
    failed: result.failed,
    total: result.total,
    written,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.task && !args.taskFile && args.allRecent == null) {
    args.allRecent = 200;
    console.log(
      '[ocr/mirror-script] no selector provided, defaulting to --all-recent=200'
    );
  }

  console.log(
    '[ocr/mirror-script] start',
    JSON.stringify({
      concurrency: args.concurrency,
      dry_run: args.dryRun,
      selector: args.task
        ? `task=${args.task}`
        : args.taskFile
          ? `task-file=${args.taskFile}`
          : `all-recent=${args.allRecent ?? 200}`,
    })
  );

  let taskIds: string[];
  try {
    taskIds = await loadTaskIds(args);
  } catch (e) {
    console.error(
      '[ocr/mirror-script] load_task_ids_failed',
      e instanceof Error ? e.message : String(e)
    );
    printUsageAndExit();
  }
  if (taskIds.length === 0) {
    console.log('[ocr/mirror-script] no tasks selected, nothing to do');
    return;
  }

  let totalTasks = 0;
  let totalReplaced = 0;
  let totalFailed = 0;
  let totalScanned = 0;
  let totalErrorTasks = 0;

  for (const taskId of taskIds) {
    totalTasks++;
    const startedAt = Date.now();
    try {
      const sourceRes = await processOneJsonKey(
        taskId,
        ocrParseResultSourceKey(taskId),
        args.concurrency,
        args.dryRun
      );
      const targetRes = await processOneJsonKey(
        taskId,
        ocrParseResultTargetKey(taskId),
        args.concurrency,
        args.dryRun
      );
      totalReplaced += sourceRes.replaced + targetRes.replaced;
      totalFailed += sourceRes.failed + targetRes.failed;
      totalScanned += sourceRes.total + targetRes.total;
      console.log(
        '[ocr/mirror-script] task_done',
        JSON.stringify({
          task: taskId,
          source: {
            found: sourceRes.found,
            replaced: sourceRes.replaced,
            failed: sourceRes.failed,
            total: sourceRes.total,
            written: sourceRes.written,
            error: sourceRes.errorMessage,
          },
          target: {
            found: targetRes.found,
            replaced: targetRes.replaced,
            failed: targetRes.failed,
            total: targetRes.total,
            written: targetRes.written,
            error: targetRes.errorMessage,
          },
          elapsed_ms: Date.now() - startedAt,
        })
      );
    } catch (e) {
      totalErrorTasks++;
      console.error(
        '[ocr/mirror-script] task_error',
        JSON.stringify({
          task: taskId,
          error: e instanceof Error ? e.message : String(e),
          elapsed_ms: Date.now() - startedAt,
        })
      );
    }
  }

  console.log(
    '[ocr/mirror-script] summary',
    JSON.stringify({
      tasks: totalTasks,
      task_errors: totalErrorTasks,
      urls_scanned: totalScanned,
      urls_replaced: totalReplaced,
      urls_failed: totalFailed,
      dry_run: args.dryRun,
    })
  );
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('[ocr/mirror-script] fatal', e);
    try {
      await closeDb();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
