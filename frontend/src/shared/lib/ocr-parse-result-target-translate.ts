import type { ParseResult } from '@/shared/ocr-workbench/translator-parse-result';
import { parseParseResultJson } from '@/shared/ocr-workbench/translator-parse-result';
import { translateStringListWithDeepSeek } from '@/shared/lib/ocr-translate';
import {
  ocrParseResultSourceKey,
  ocrParseResultTargetKey,
} from '@/shared/lib/ocr-parse-result-r2-keys';
import { getObjectBody, putObject } from '@/shared/lib/translate-r2';

type TextSlot = { read: () => string; write: (v: string) => void };

/** 短串且仅空白 / 数字 / Unicode 标点或符号时，不送 DeepSeek（版面碎片常见） */
const PASSTHROUGH_PUNCT_OR_SYMBOL_MAX_LEN = 16;

function shouldPassthroughParseSlotText(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (t.length > PASSTHROUGH_PUNCT_OR_SYMBOL_MAX_LEN) return false;
  return /^[\s\p{P}\p{S}\d]+$/u.test(t);
}

/**
 * 对需翻译的槽位按原文去重，减少 DeepSeek 调用量；返回每槽对应 `uniqueForApi` 下标，-1 表示本地原样写回。
 */
function buildDedupedTranslationPlan(parts: string[]): {
  uniqueForApi: string[];
  slotToUniqueIndex: number[];
  passthroughCount: number;
} {
  const slotToUniqueIndex: number[] = new Array(parts.length);
  const uniqueForApi: string[] = [];
  const firstIndexByText = new Map<string, number>();
  let passthroughCount = 0;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] ?? '';
    if (shouldPassthroughParseSlotText(p)) {
      slotToUniqueIndex[i] = -1;
      passthroughCount += 1;
      continue;
    }
    const existing = firstIndexByText.get(p);
    if (existing !== undefined) {
      slotToUniqueIndex[i] = existing;
      continue;
    }
    const idx = uniqueForApi.length;
    firstIndexByText.set(p, idx);
    uniqueForApi.push(p);
    slotToUniqueIndex[i] = idx;
  }
  return { uniqueForApi, slotToUniqueIndex, passthroughCount };
}

function walkTableCells(cells: unknown, slots: TextSlot[]): void {
  if (!Array.isArray(cells)) return;
  for (const cell of cells) {
    if (Array.isArray(cell)) {
      walkTableCells(cell, slots);
      continue;
    }
    if (cell && typeof cell === 'object') {
      const o = cell as Record<string, unknown>;
      if (typeof o.text === 'string') {
        slots.push({
          read: () => o.text as string,
          write: (v) => {
            o.text = v;
          },
        });
      }
      for (const v of Object.values(o)) {
        if (Array.isArray(v)) walkTableCells(v, slots);
      }
    }
  }
}

/** 遍历版面树，顺序与写入时一致 */
function collectSlots(data: ParseResult, slots: TextSlot[]): void {
  for (const page of data.pages) {
    slots.push({
      read: () => page.text ?? '',
      write: (v) => {
        page.text = v;
      },
    });

    for (const layout of page.layouts) {
      slots.push({
        read: () => layout.text ?? '',
        write: (v) => {
          layout.text = v;
        },
      });

      const spans = layout.span_boxes;
      if (Array.isArray(spans)) {
        for (const box of spans) {
          if (!box || typeof box !== 'object') continue;
          const arr = (box as { text?: unknown }).text;
          if (!Array.isArray(arr)) continue;
          for (let i = 0; i < arr.length; i++) {
            const idx = i;
            slots.push({
              read: () => String(arr[idx] ?? ''),
              write: (v) => {
                arr[idx] = v;
              },
            });
          }
        }
      }
    }

    const tables = page.tables;
    if (Array.isArray(tables)) {
      for (const table of tables) {
        slots.push({
          read: () => table.markdown ?? '',
          write: (v) => {
            table.markdown = v;
          },
        });
        walkTableCells(table.cells, slots);
      }
    }

    const images = page.images;
    if (Array.isArray(images)) {
      for (const img of images) {
        slots.push({
          read: () => img.image_description ?? '',
          write: (v) => {
            img.image_description = v;
          },
        });
      }
    }
  }
}

/**
 * 读取当前 OCR 解析 JSON，将可编辑文本译为 target 语言并写入 `ocr-parse-result-target.json`。
 * Workbench / `/api/tasks/.../parse-result` 在语种不同时优先返回此文件。
 */
export async function translateAndPersistParseResultTarget(params: {
  taskId: string;
  sourceLang: string;
  targetLang: string;
}): Promise<void> {
  const bytes = await getObjectBody(ocrParseResultSourceKey(params.taskId));
  const raw = JSON.parse(new TextDecoder('utf-8').decode(bytes));
  const parsed = parseParseResultJson(raw);
  if (!parsed.ok) {
    throw new Error(`parse result invalid before target translate: ${parsed.error}`);
  }

  const data = structuredClone(parsed.data) as ParseResult;
  const slots: TextSlot[] = [];
  collectSlots(data, slots);
  const parts = slots.map((s) => s.read());
  const { uniqueForApi, slotToUniqueIndex, passthroughCount } =
    buildDedupedTranslationPlan(parts);
  const needingCount = slots.length - passthroughCount;
  const dedupeSaved =
    needingCount > 0 ? Math.max(0, needingCount - uniqueForApi.length) : 0;
  const dedupeRatio =
    needingCount > 0 ? dedupeSaved / needingCount : 0;

  console.log(
    '[ocr/parse_target_translate] start',
    JSON.stringify({
      task_id: params.taskId,
      source_lang: params.sourceLang,
      target_lang: params.targetLang,
      text_slots: slots.length,
      parts_total: slots.length,
      parts_passthrough: passthroughCount,
      parts_needing_translation: needingCount,
      parts_to_translate_unique: uniqueForApi.length,
      dedupe_ratio: Number(dedupeRatio.toFixed(4)),
    })
  );
  const stageStarted = Date.now();

  const translatedUnique =
    uniqueForApi.length === 0
      ? []
      : await translateStringListWithDeepSeek({
          parts: uniqueForApi,
          sourceLang: params.sourceLang,
          targetLang: params.targetLang,
          logContext: { taskId: params.taskId },
        });
  if (translatedUnique.length !== uniqueForApi.length) {
    throw new Error('parse-result target translate: unique translate length mismatch');
  }

  for (let i = 0; i < slots.length; i++) {
    const u = slotToUniqueIndex[i];
    if (u < 0) {
      slots[i].write(parts[i] ?? '');
    } else {
      slots[i].write(translatedUnique[u] ?? '');
    }
  }

  const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
  await putObject(
    ocrParseResultTargetKey(params.taskId),
    encoded,
    'application/json; charset=utf-8'
  );
  console.log(
    '[ocr/parse_target_translate] done',
    JSON.stringify({
      task_id: params.taskId,
      text_slots: slots.length,
      elapsed_ms: Date.now() - stageStarted,
      target_key: ocrParseResultTargetKey(params.taskId),
    })
  );
}
