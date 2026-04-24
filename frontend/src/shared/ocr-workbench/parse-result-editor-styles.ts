import type { CSSProperties } from 'react';

import type { ParseLayout, ParseResult } from '@/shared/ocr-workbench/translator-parse-result';

type EditorPatch = Partial<{
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  color: string;
  textAlign: 'left' | 'center' | 'right';
}>;

export function getLayoutEditor(ly: ParseLayout): EditorPatch {
  const raw = (ly as ParseLayout & { _editor?: unknown })._editor;
  if (!raw || typeof raw !== 'object') return {};
  return { ...(raw as EditorPatch) };
}

export function setLayoutEditor(
  doc: ParseResult,
  pageIndex: number,
  layoutId: string,
  patch: EditorPatch
): void {
  const ly = doc.pages[pageIndex]?.layouts.find((l) => l.layout_id === layoutId);
  if (!ly) return;
  const prev = getLayoutEditor(ly);
  const next = { ...prev, ...patch };
  (ly as ParseLayout & { _editor: EditorPatch })._editor = next;
}

export function editorStyleToCss(ed: EditorPatch): CSSProperties {
  return {
    fontSize: ed.fontSize ?? '16px',
    fontFamily:
      ed.fontFamily ??
      '"Noto Sans SC","Noto Sans JP","Noto Sans KR","Noto Sans","Microsoft YaHei",system-ui,sans-serif',
    fontWeight: ed.fontWeight as CSSProperties['fontWeight'],
    color: ed.color ?? '#2b2525',
    textAlign: ed.textAlign,
    lineHeight: 1.45,
  };
}
