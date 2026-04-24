/**
 * parse_result_url / 解析结果 JSON。接口常返回 null；Zod 的 .default([]) 不对 null 生效。
 */
import { z } from 'zod';

function nullishToArrayItems<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v.map((el) => (el != null && typeof el === 'object' ? el : {}))
        : [],
    z.array(item)
  );
}

function nullishToArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(item)
  );
}

function nullishToString() {
  return z.preprocess((v) => (v == null ? '' : String(v)), z.string());
}

function nullishToPositionTuple() {
  return z.preprocess((v) => {
    if (!Array.isArray(v) || v.length < 4) return [0, 0, 100, 24];
    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0, Number(v[3]) || 0];
  }, z.tuple([z.number(), z.number(), z.number(), z.number()]));
}

function optionalPositionTuple() {
  return z.preprocess(
    (v) => {
      if (v == null || !Array.isArray(v) || v.length < 4) return undefined;
      const a = v as number[];
      return [
        Number(a[0]) || 0,
        Number(a[1]) || 0,
        Number(a[2]) || 0,
        Number(a[3]) || 0,
      ];
    },
    z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
  );
}

const polygonSchema = z.preprocess(
  (v) => (Array.isArray(v) ? v : []),
  z.array(z.unknown())
);

const spanBoxEntrySchema = z
  .object({
    text: nullishToArray(nullishToString()),
    location: nullishToArray(z.union([z.number(), z.array(z.number())])),
  })
  .passthrough();

export const parseLayoutSchema = z
  .object({
    layout_id: nullishToString(),
    text: nullishToString(),
    position: nullishToPositionTuple(),
    polygon: polygonSchema.optional(),
    span_boxes: z.preprocess((v) => {
      if (v == null || !Array.isArray(v)) return [];
      return v.map((x) => (x != null && typeof x === 'object' ? x : {}));
    }, z.array(spanBoxEntrySchema)).optional(),
    type: nullishToString(),
    sub_type: z.preprocess(
      (v) => (v == null ? undefined : String(v)),
      z.string().optional()
    ),
  })
  .passthrough();

export const parseTableSchema = z
  .object({
    layout_id: nullishToString(),
    markdown: nullishToString(),
    position: optionalPositionTuple(),
    cells: nullishToArray(z.unknown()).optional(),
    matrix: z.preprocess(
      (v) =>
        Array.isArray(v) ? v.map((row) => (Array.isArray(row) ? row : [])) : [],
      z.array(z.array(z.unknown()))
    ).optional(),
    merge_table: z.preprocess(
      (v) => (v == null ? undefined : String(v)),
      z.string().optional()
    ),
  })
  .passthrough();

export const parseImageSchema = z
  .object({
    layout_id: nullishToString(),
    position: optionalPositionTuple(),
    data_url: nullishToString(),
    image_description: z.preprocess(
      (v) => (v == null ? undefined : String(v)),
      z.string().optional()
    ),
  })
  .passthrough();

export const parsePageMetaSchema = z
  .object({
    page_width: z.preprocess(
      (v) => (v == null ? undefined : Number(v)),
      z.number().optional()
    ),
    page_height: z.preprocess(
      (v) => (v == null ? undefined : Number(v)),
      z.number().optional()
    ),
  })
  .passthrough();

export const parsePageSchema = z
  .object({
    page_id: z.preprocess(
      (v) => (v == null ? undefined : String(v)),
      z.string().optional()
    ),
    page_num: z.preprocess((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.floor(n));
    }, z.number()),
    text: nullishToString(),
    layouts: nullishToArrayItems(parseLayoutSchema),
    tables: nullishToArrayItems(parseTableSchema),
    images: nullishToArrayItems(parseImageSchema),
    meta: z.preprocess(
      (v) => (v && typeof v === 'object' ? v : {}),
      parsePageMetaSchema.optional()
    ),
  })
  .passthrough();

export const parseResultSchema = z
  .object({
    file_name: z.preprocess(
      (v) => (v == null ? undefined : String(v)),
      z.string().optional()
    ),
    file_id: z.preprocess(
      (v) => (v == null ? undefined : String(v)),
      z.string().optional()
    ),
    pages: z
      .preprocess((v) => (Array.isArray(v) ? v : []), z.array(parsePageSchema))
      .refine((p) => p.length > 0, { message: 'pages must be a non-empty array' }),
  })
  .passthrough();

export type ParseLayout = z.infer<typeof parseLayoutSchema>;
export type ParseTable = z.infer<typeof parseTableSchema>;
export type ParseImage = z.infer<typeof parseImageSchema>;
export type ParsePage = z.infer<typeof parsePageSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;

export type LayoutEditorMeta = {
  fontSize?: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
};

export function parseParseResultJson(raw: unknown):
  | { ok: true; data: ParseResult }
  | { ok: false; error: string } {
  const candidates: unknown[] = [raw];
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    if (rec.result && typeof rec.result === 'object') candidates.push(rec.result);
    if (rec.data && typeof rec.data === 'object') candidates.push(rec.data);
    if (rec.parse_result && typeof rec.parse_result === 'object') {
      candidates.push(rec.parse_result);
    }
    if (rec.document && typeof rec.document === 'object') candidates.push(rec.document);
  }

  let lastError = 'invalid json';
  for (const one of candidates) {
    const r = parseResultSchema.safeParse(one);
    if (r.success) {
      return { ok: true, data: r.data };
    }
    lastError =
      r.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ') || 'invalid json';
  }
  return { ok: false, error: lastError };
}

export function globalLayoutIndexFromId(layoutId: string): number {
  const m = layoutId.match(/layout-(\d+)\s*$/i);
  if (m) return parseInt(m[1], 10);
  const n = parseInt(layoutId.replace(/\D/g, '') || '0', 10);
  return Number.isFinite(n) ? n : 0;
}
