import type { ParseResult } from '@/shared/ocr-workbench/translator-parse-result';
import { parseParseResultJson } from '@/shared/ocr-workbench/translator-parse-result';
import { translateStringListWithDeepSeek } from '@/shared/lib/ocr-translate';
import {
  ocrParseResultSourceKey,
  ocrParseResultTargetKey,
} from '@/shared/lib/ocr-parse-result-r2-keys';
import { getObjectBody, putObject } from '@/shared/lib/translate-r2';

type TextSlot = { read: () => string; write: (v: string) => void };

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
  const translated = await translateStringListWithDeepSeek({
    parts,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
  });
  if (translated.length !== slots.length) {
    throw new Error('parse-result target translate: slot length mismatch');
  }
  for (let i = 0; i < slots.length; i++) {
    slots[i].write(translated[i] ?? '');
  }

  const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
  await putObject(
    ocrParseResultTargetKey(params.taskId),
    encoded,
    'application/json; charset=utf-8'
  );
}
