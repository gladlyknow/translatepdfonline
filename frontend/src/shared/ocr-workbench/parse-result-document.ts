import type {
  ParseImage,
  ParseLayout,
  ParsePage,
  ParseResult,
  ParseTable,
} from '@/shared/ocr-workbench/translator-parse-result';
import { globalLayoutIndexFromId } from '@/shared/ocr-workbench/translator-parse-result';

export function cloneParseResult(doc: ParseResult): ParseResult {
  return structuredClone(doc) as ParseResult;
}

export function sortLayoutsByReadingOrder(layouts: ParseLayout[]): ParseLayout[] {
  return [...layouts].sort(
    (a, b) =>
      globalLayoutIndexFromId(a.layout_id) - globalLayoutIndexFromId(b.layout_id)
  );
}

export function findTableForLayout(
  page: ParsePage,
  layoutId: string
): ParseTable | undefined {
  return page.tables.find((t) => t.layout_id === layoutId);
}

export function findImageForLayout(
  page: ParsePage,
  layoutId: string
): ParseImage | undefined {
  return page.images.find((i) => i.layout_id === layoutId);
}

export function updateLayoutPosition(
  doc: ParseResult,
  pageIndex: number,
  layoutId: string,
  position: [number, number, number, number]
): void {
  const page = doc.pages[pageIndex];
  if (!page) return;
  const ly = page.layouts.find((l) => l.layout_id === layoutId);
  if (ly) ly.position = position;
  if (ly?.type === 'image') {
    const img = page.images.find((i) => i.layout_id === layoutId);
    if (img) img.position = position;
  }
}

export function updateLayoutText(
  doc: ParseResult,
  pageIndex: number,
  layoutId: string,
  text: string
): void {
  const page = doc.pages[pageIndex];
  if (!page) return;
  const ly = page.layouts.find((l) => l.layout_id === layoutId);
  if (ly) ly.text = text;
}

export function getPageBox(page: ParsePage): { w: number; h: number } {
  const w = page.meta?.page_width ?? 595;
  const h = page.meta?.page_height ?? 842;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}
