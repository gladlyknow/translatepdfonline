'use client';

import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Minus,
  Plus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import {
  beginToolbarSelectionGuard,
  endToolbarSelectionGuard,
  restoreLayoutEditableSelection,
  saveLayoutEditableSelection,
} from '@/shared/ocr-workbench/parse-result-editor-selection';

type Props = {
  disabled?: boolean;
  /** 将 contentEditable 当前 HTML 写入 doc，再执行 execCommand，避免连续点格式时 ly.text 未更新 */
  onFlushBeforeFormat?: () => void;
  /** 写入布局样式（如 fontSize/textAlign）到 _editor，避免切换后丢失 */
  onEditorStylePatch?: (patch: {
    fontSize?: string;
    fontFamily?: string;
    fontWeight?: string;
    color?: string;
    textAlign?: 'left' | 'center' | 'right';
  }) => void;
  currentEditorStyle?: {
    fontSize?: string;
    fontFamily?: string;
    fontWeight?: string;
    color?: string;
    textAlign?: 'left' | 'center' | 'right';
  };
  extraFontControls?: ReactNode;
  fileControls?: ReactNode;
  sectionIds?: {
    textEdit?: string;
    fontSettings?: string;
    file?: string;
  };
};

/** 避免按钮抢走 contentEditable 焦点，否则 execCommand 无效 */
function preventToolbarMouseDown(e: ReactMouseEvent) {
  saveLayoutEditableSelection();
  focusEditable();
  beginToolbarSelectionGuard();
  e.preventDefault();
}

function focusEditable(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(
    '[data-layout-editable="true"]'
  );
  el?.focus({ preventScroll: true });
  return el;
}

function getSelectionInEditable(): {
  editable: HTMLElement;
  selection: Selection;
  range: Range;
  collapsed: boolean;
} | null {
  const editable = document.querySelector<HTMLElement>(
    '[data-layout-editable="true"]'
  );
  if (!editable) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) return null;
  return { editable, selection, range, collapsed: range.collapsed };
}

function applyInlineStyleToSelection(
  style: Partial<
    Pick<
      CSSStyleDeclaration,
      'fontFamily' | 'fontSize' | 'color' | 'fontWeight' | 'fontStyle'
    >
  >
): boolean {
  let picked = getSelectionInEditable();
  if (!picked) {
    restoreLayoutEditableSelection();
    picked = getSelectionInEditable();
  }
  if (!picked || picked.collapsed) return false;
  const { selection, range } = picked;
  const span = document.createElement('span');
  if (style.fontFamily) span.style.fontFamily = style.fontFamily;
  if (style.fontSize) span.style.fontSize = style.fontSize;
  if (style.color) span.style.color = style.color;
  if (style.fontWeight) span.style.fontWeight = style.fontWeight;
  if (style.fontStyle) span.style.fontStyle = style.fontStyle;
  try {
    span.append(range.extractContents());
    range.insertNode(span);
    selection.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(span);
    selection.addRange(after);
    saveLayoutEditableSelection({ force: true });
    return true;
  } catch {
    return false;
  }
}

function getEffectiveSelectionFontSizePx(
  fallback = 16
): { px: number; editable: HTMLElement | null } {
  let picked = getSelectionInEditable();
  if (!picked) {
    restoreLayoutEditableSelection();
    picked = getSelectionInEditable();
  }
  const editable = picked?.editable ?? null;
  let styleHost: HTMLElement | null = editable;
  if (picked) {
    const node =
      picked.range.startContainer.nodeType === Node.TEXT_NODE
        ? picked.range.startContainer.parentElement
        : (picked.range.startContainer as HTMLElement | null);
    if (node && editable?.contains(node)) styleHost = node;
  }
  const raw =
    (styleHost ? window.getComputedStyle(styleHost).fontSize : '') ||
    editable?.style.fontSize ||
    `${fallback}px`;
  const n = Number.parseInt(raw, 10);
  return { px: Number.isFinite(n) ? n : fallback, editable };
}

function hasNonCollapsedSelectionInEditable(): boolean {
  const cur = getSelectionInEditable();
  if (cur && !cur.collapsed) return true;
  if (!restoreLayoutEditableSelection()) return false;
  const restored = getSelectionInEditable();
  return Boolean(restored && !restored.collapsed);
}

function applyBlockTagToSelection(tag: 'p' | 'h1' | 'h2'): boolean {
  let picked = getSelectionInEditable();
  if (!picked) {
    restoreLayoutEditableSelection();
    picked = getSelectionInEditable();
  }
  if (!picked) return false;
  const { editable, selection, range, collapsed } = picked;
  const targetRange = range.cloneRange();
  if (collapsed) {
    targetRange.selectNodeContents(editable);
  }
  const wrapper = document.createElement(tag);
  try {
    wrapper.append(targetRange.extractContents());
    if (!wrapper.textContent?.trim() && wrapper.querySelectorAll('*').length === 0) {
      wrapper.innerHTML = '<br>';
    }
    targetRange.insertNode(wrapper);
    selection.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(wrapper);
    selection.addRange(after);
    saveLayoutEditableSelection({ force: true });
    return true;
  } catch {
    return false;
  }
}

function applyListToSelection(kind: 'ul' | 'ol'): boolean {
  let picked = getSelectionInEditable();
  if (!picked) {
    restoreLayoutEditableSelection();
    picked = getSelectionInEditable();
  }
  if (!picked) return false;
  const { editable, selection, range, collapsed } = picked;
  const targetRange = range.cloneRange();
  if (collapsed) {
    targetRange.selectNodeContents(editable);
  }
  const list = document.createElement(kind);
  const li = document.createElement('li');
  try {
    li.append(targetRange.extractContents());
    if (!li.textContent?.trim() && li.querySelectorAll('*').length === 0) {
      li.innerHTML = '<br>';
    }
    list.append(li);
    targetRange.insertNode(list);
    selection.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(list);
    selection.addRange(after);
    saveLayoutEditableSelection({ force: true });
    return true;
  } catch {
    return false;
  }
}

function getAnchorElementFromSelection(): HTMLElement | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  let picked = getSelectionInEditable();
  if (!picked) {
    restoreLayoutEditableSelection();
    picked = getSelectionInEditable();
  }
  if (!picked) return null;
  const node = picked.range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement;
  }
  return node as HTMLElement | null;
}

function getFormatState() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      bold: false,
      italic: false,
      align: 'left' as 'left' | 'center' | 'right',
      list: 'none' as 'none' | 'ul' | 'ol',
      block: 'p' as 'p' | 'h1' | 'h2',
    };
  }
  const anchor = getAnchorElementFromSelection();
  const editable = document.querySelector<HTMLElement>('[data-layout-editable="true"]');
  const host = anchor || editable;
  if (!host) {
    return {
      bold: false,
      italic: false,
      align: 'left' as 'left' | 'center' | 'right',
      list: 'none' as 'none' | 'ul' | 'ol',
      block: 'p' as 'p' | 'h1' | 'h2',
    };
  }
  const computed = window.getComputedStyle(host);
  const fw = Number.parseInt(computed.fontWeight || '400', 10);
  const boldByWeight = Number.isFinite(fw) ? fw >= 600 : false;
  const boldByTag = Boolean(host.closest('b,strong'));
  const italicByStyle = computed.fontStyle === 'italic' || computed.fontStyle === 'oblique';
  const italicByTag = Boolean(host.closest('i,em'));
  const alignRaw = (computed.textAlign || '').toLowerCase();
  const align = alignRaw.includes('center')
    ? 'center'
    : alignRaw.includes('right')
      ? 'right'
      : 'left';
  const list = host.closest('ol') ? 'ol' : host.closest('ul') ? 'ul' : 'none';
  const block = host.closest('h1') ? 'h1' : host.closest('h2') ? 'h2' : 'p';
  return {
    bold: boldByWeight || boldByTag,
    italic: italicByStyle || italicByTag,
    align,
    list,
    block,
  };
}

function makeExec(flush?: () => void) {
  return function exec(
    cmd: string,
    value?: string,
    opts?: { applyWholeBlockWhenCollapsed?: boolean }
  ) {
    flush?.();
    let picked = getSelectionInEditable();
    if (!picked || picked.collapsed) {
      focusEditable();
      restoreLayoutEditableSelection();
      picked = getSelectionInEditable();
    }
    if (!picked) {
      endToolbarSelectionGuard();
      return;
    }
    const { editable, selection, collapsed } = picked;
    const applyWholeBlock = collapsed && opts?.applyWholeBlockWhenCollapsed;
    if (applyWholeBlock) {
      const all = document.createRange();
      all.selectNodeContents(editable);
      selection.removeAllRanges();
      selection.addRange(all);
    }
    requestAnimationFrame(() => {
      try {
        const payload =
          cmd === 'formatBlock' && value
            ? value.startsWith('<')
              ? value
              : `<${value}>`
            : value;
        document.execCommand(cmd, false, payload);
      } catch {
        /* ignore */
      }
      saveLayoutEditableSelection({ force: true });
      // execCommand 修改 DOM 后立刻落盘，避免后续操作读到旧值
      queueMicrotask(() => {
        flush?.();
        endToolbarSelectionGuard();
      });
    });
  };
}

type ExecFn = ReturnType<typeof makeExec>;

/** 优先 execCommand（可切换列表、结构更标准），失败再用手动包裹或带全选回退的 exec */
function insertListCommand(
  kind: 'ul' | 'ol',
  exec: ExecFn,
  onFlushBeforeFormat: Props['onFlushBeforeFormat'],
  refreshFormatState: () => void
) {
  const cmd = kind === 'ul' ? 'insertUnorderedList' : 'insertOrderedList';
  onFlushBeforeFormat?.();
  focusEditable();
  restoreLayoutEditableSelection();
  requestAnimationFrame(() => {
    let ok = false;
    try {
      ok = document.execCommand(cmd, false);
    } catch {
      /* ignore */
    }
    if (ok) {
      saveLayoutEditableSelection({ force: true });
      queueMicrotask(() => {
        onFlushBeforeFormat?.();
        endToolbarSelectionGuard();
      });
    } else {
      const changed = applyListToSelection(kind);
      if (!changed) {
        exec(cmd, undefined, { applyWholeBlockWhenCollapsed: true });
      } else {
        queueMicrotask(() => {
          onFlushBeforeFormat?.();
          endToolbarSelectionGuard();
        });
      }
    }
    queueMicrotask(refreshFormatState);
  });
}

/** 与侧栏「下载」按钮一致的外边框与底色 */
const toolbarEditBtnClass =
  'box-border flex h-9 min-h-9 w-full min-w-0 items-center justify-center gap-0.5 rounded-lg border border-zinc-300 bg-white px-1 text-[11px] font-semibold text-zinc-800 shadow-sm transition-all duration-150 hover:-translate-y-[1px] hover:border-zinc-400 hover:bg-zinc-100 hover:shadow focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 [&_svg]:size-4';

const toolbarPanelClass =
  'space-y-1.5 rounded-xl border border-zinc-200 bg-zinc-50/90 p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70';
const toolbarPanelTitleClass =
  'text-center text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-200';

export function ParseResultEditorToolbar({
  disabled,
  onFlushBeforeFormat,
  onEditorStylePatch,
  currentEditorStyle,
  extraFontControls,
  fileControls,
  sectionIds,
}: Props) {
  const t = useTranslations('translate.ocrWorkbench');
  const [fontFamily, setFontFamily] = useState('system-ui,sans-serif');
  const [fontSize, setFontSize] = useState('16');
  const [fontColor, setFontColor] = useState('#111111');
  const [formatState, setFormatState] = useState(() => getFormatState());
  const exec = useMemo(
    () => makeExec(onFlushBeforeFormat),
    [onFlushBeforeFormat]
  );

  const activeBtn = (active?: boolean) =>
    `${toolbarEditBtnClass} ${active ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300' : ''}`;

  const refreshFormatState = () => {
    setFormatState(getFormatState());
  };

  useEffect(() => {
    if (currentEditorStyle?.fontFamily) {
      setFontFamily(currentEditorStyle.fontFamily);
    }
    if (currentEditorStyle?.fontSize) {
      const px = Number.parseInt(currentEditorStyle.fontSize, 10);
      if (Number.isFinite(px)) {
        setFontSize(String(px));
      }
    }
    if (currentEditorStyle?.color) {
      setFontColor(currentEditorStyle.color);
    }
  }, [
    currentEditorStyle?.fontFamily,
    currentEditorStyle?.fontSize,
    currentEditorStyle?.color,
  ]);

  useEffect(() => {
    const onSelChange = () => refreshFormatState();
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);

  return (
    <div
      data-editor-toolbar="true"
      onMouseUpCapture={() => endToolbarSelectionGuard()}
      onBlurCapture={() => endToolbarSelectionGuard()}
      className="flex w-full min-w-0 shrink-0 flex-col gap-2"
    >
      <section id={sectionIds?.textEdit} className={toolbarPanelClass}>
        <p className={toolbarPanelTitleClass}>{t('toolbarTextEdit')}</p>
        <div className="grid grid-cols-3 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="default"
            className={activeBtn(formatState.bold)}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              const hasSelection = hasNonCollapsedSelectionInEditable();
              if (hasSelection) {
                const changed = applyInlineStyleToSelection({
                  fontWeight: formatState.bold ? '400' : '700',
                });
                if (!changed) {
                  exec('bold', undefined, { applyWholeBlockWhenCollapsed: true });
                }
              } else {
                exec('bold', undefined, { applyWholeBlockWhenCollapsed: true });
              }
              if (!hasSelection) {
                const cur = currentEditorStyle?.fontWeight;
                onEditorStylePatch?.({
                  fontWeight: cur === '700' || cur === 'bold' ? '400' : '700',
                });
              }
              queueMicrotask(refreshFormatState);
            }}
          >
            <Bold />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={activeBtn(formatState.italic)}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              const hasSelection = hasNonCollapsedSelectionInEditable();
              if (hasSelection) {
                const changed = applyInlineStyleToSelection({
                  fontStyle: formatState.italic ? 'normal' : 'italic',
                });
                if (!changed) {
                  exec('italic', undefined, { applyWholeBlockWhenCollapsed: true });
                }
              } else {
                exec('italic', undefined, { applyWholeBlockWhenCollapsed: true });
              }
              queueMicrotask(refreshFormatState);
            }}
          >
            <Italic />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={activeBtn(formatState.align === 'left')}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              const editable = focusEditable();
              if (editable) editable.style.textAlign = 'left';
              onEditorStylePatch?.({ textAlign: 'left' });
              exec('justifyLeft', undefined, { applyWholeBlockWhenCollapsed: true });
              queueMicrotask(refreshFormatState);
            }}
          >
            <AlignLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={activeBtn(formatState.align === 'center')}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              const editable = focusEditable();
              if (editable) editable.style.textAlign = 'center';
              onEditorStylePatch?.({ textAlign: 'center' });
              exec('justifyCenter', undefined, { applyWholeBlockWhenCollapsed: true });
              queueMicrotask(refreshFormatState);
            }}
          >
            <AlignCenter />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={activeBtn(formatState.align === 'right')}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              const editable = focusEditable();
              if (editable) editable.style.textAlign = 'right';
              onEditorStylePatch?.({ textAlign: 'right' });
              exec('justifyRight', undefined, { applyWholeBlockWhenCollapsed: true });
              queueMicrotask(refreshFormatState);
            }}
          >
            <AlignRight />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={activeBtn(formatState.list === 'ul')}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              insertListCommand('ul', exec, onFlushBeforeFormat, refreshFormatState);
            }}
          >
            <List />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={activeBtn(formatState.list === 'ol')}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              insertListCommand('ol', exec, onFlushBeforeFormat, refreshFormatState);
            }}
          >
            <ListOrdered />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={activeBtn(formatState.block === 'p')}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              const changed = applyBlockTagToSelection('p');
              if (!changed) {
                exec('formatBlock', 'p', { applyWholeBlockWhenCollapsed: true });
              } else {
                queueMicrotask(() => {
                  onFlushBeforeFormat?.();
                  endToolbarSelectionGuard();
                });
              }
              queueMicrotask(refreshFormatState);
            }}
          >
            P
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={`${activeBtn(formatState.block === 'h1')} font-medium`}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              const changed = applyBlockTagToSelection('h1');
              if (!changed) {
                exec('formatBlock', 'h1', { applyWholeBlockWhenCollapsed: true });
              } else {
                queueMicrotask(() => {
                  onFlushBeforeFormat?.();
                  endToolbarSelectionGuard();
                });
              }
              queueMicrotask(refreshFormatState);
            }}
          >
            H1
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={`${activeBtn(formatState.block === 'h2')} font-medium`}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              const changed = applyBlockTagToSelection('h2');
              if (!changed) {
                exec('formatBlock', 'h2', { applyWholeBlockWhenCollapsed: true });
              } else {
                queueMicrotask(() => {
                  onFlushBeforeFormat?.();
                  endToolbarSelectionGuard();
                });
              }
              queueMicrotask(refreshFormatState);
            }}
          >
            H2
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={toolbarEditBtnClass}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              onFlushBeforeFormat?.();
              focusEditable();
              restoreLayoutEditableSelection();
              requestAnimationFrame(() => {
                restoreLayoutEditableSelection();
                const one = getEffectiveSelectionFontSizePx(
                  Number.parseInt(currentEditorStyle?.fontSize || '16', 10)
                );
                const cur = one.px;
                const next = `${Math.min(cur + 2, 48)}px`;
                const changed = applyInlineStyleToSelection({ fontSize: next });
                if (!changed) {
                  if (one.editable) one.editable.style.fontSize = next;
                  onEditorStylePatch?.({ fontSize: next });
                }
                queueMicrotask(() => {
                  onFlushBeforeFormat?.();
                  endToolbarSelectionGuard();
                });
              });
            }}
          >
            <Plus />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            className={toolbarEditBtnClass}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onClick={() => {
              onFlushBeforeFormat?.();
              focusEditable();
              restoreLayoutEditableSelection();
              requestAnimationFrame(() => {
                restoreLayoutEditableSelection();
                const one = getEffectiveSelectionFontSizePx(
                  Number.parseInt(currentEditorStyle?.fontSize || '16', 10)
                );
                const cur = one.px;
                const next = `${Math.max(cur - 2, 6)}px`;
                const changed = applyInlineStyleToSelection({ fontSize: next });
                if (!changed) {
                  if (one.editable) one.editable.style.fontSize = next;
                  onEditorStylePatch?.({ fontSize: next });
                }
                queueMicrotask(() => {
                  onFlushBeforeFormat?.();
                  endToolbarSelectionGuard();
                });
              });
            }}
          >
            <Minus />
          </Button>
        </div>
      </section>

      <section id={sectionIds?.fontSettings} className={toolbarPanelClass}>
        <p className={toolbarPanelTitleClass}>{t('toolbarFontSettings')}</p>
        <div className="grid min-w-0 grid-cols-3 gap-1.5">
          <select
            className="border-input bg-background h-9 min-w-0 max-w-full rounded-md border px-1 text-[10px] leading-tight"
            value={fontFamily}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onChange={(e) => {
              const v = e.target.value;
              setFontFamily(v);
              const changed = applyInlineStyleToSelection({ fontFamily: v });
              if (!changed) {
                const el = document.querySelector<HTMLElement>(
                  '[data-layout-editable="true"]'
                );
                if (el) el.style.fontFamily = v;
                onEditorStylePatch?.({ fontFamily: v });
              }
              queueMicrotask(() => {
                onFlushBeforeFormat?.();
                endToolbarSelectionGuard();
              });
            }}
            title={`${t('toolbarFontFamily')}: ${fontFamily}`}
          >
            <option value="system-ui,sans-serif" title={t('toolbarSystemDefault')}>
              {t('toolbarSystemDefaultShort')}
            </option>
            <option
              value='"Microsoft YaHei",sans-serif'
              title={t('toolbarFontYahei')}
            >
              {t('toolbarFontYaheiShort')}
            </option>
            <option value='"Noto Sans SC",sans-serif' title="Noto Sans SC">
              {t('toolbarFontNotoShort')}
            </option>
            <option value='"SimSun",serif' title={t('toolbarFontSimsun')}>
              {t('toolbarFontSimsunShort')}
            </option>
            <option value='"KaiTi",serif' title={t('toolbarFontKaiti')}>
              {t('toolbarFontKaitiShort')}
            </option>
          </select>
          <select
            className="border-input bg-background h-9 min-w-0 max-w-full rounded-md border px-1 text-center text-[10px] tabular-nums"
            value={fontSize}
            disabled={disabled}
            onMouseDown={preventToolbarMouseDown}
            onChange={(e) => {
              const v = e.target.value;
              setFontSize(v);
              const px = `${v}px`;
              const changed = applyInlineStyleToSelection({ fontSize: px });
              if (!changed) {
                const el = document.querySelector<HTMLElement>(
                  '[data-layout-editable="true"]'
                );
                if (el) el.style.fontSize = px;
                onEditorStylePatch?.({ fontSize: px });
              }
              queueMicrotask(() => {
                onFlushBeforeFormat?.();
                endToolbarSelectionGuard();
              });
            }}
            title={t('toolbarFontSize')}
          >
            <option value="6">6</option>
            <option value="8">8</option>
            <option value="10">10</option>
            <option value="12">12</option>
            <option value="14">14</option>
            <option value="16">16</option>
            <option value="18">18</option>
            <option value="20">20</option>
            <option value="24">24</option>
            <option value="28">28</option>
            <option value="32">32</option>
          </select>
          <label className="border-input bg-background flex h-9 min-w-0 max-w-full items-center gap-1 rounded-md border px-1 text-[10px]">
            <span className="text-muted-foreground max-w-[2rem] shrink-0 truncate">
              {t('toolbarColor')}
            </span>
            <input
              type="color"
              value={fontColor}
              disabled={disabled}
              className="h-6 min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0"
              onMouseDown={preventToolbarMouseDown}
              onChange={(e) => {
                const v = e.target.value;
                setFontColor(v);
                const changed = applyInlineStyleToSelection({ color: v });
                if (!changed) {
                  const el = document.querySelector<HTMLElement>(
                    '[data-layout-editable="true"]'
                  );
                  if (el) el.style.color = v;
                  onEditorStylePatch?.({ color: v });
                }
                queueMicrotask(() => {
                  onFlushBeforeFormat?.();
                  endToolbarSelectionGuard();
                });
              }}
              title={t('toolbarTextColor')}
            />
          </label>
        </div>
        {extraFontControls ? <div className="mt-2 min-w-0">{extraFontControls}</div> : null}
      </section>

      {fileControls ? (
        <section id={sectionIds?.file} className={toolbarPanelClass}>
          <p className={toolbarPanelTitleClass}>{t('toolbarFileOps')}</p>
          <div className="min-w-0">{fileControls}</div>
        </section>
      ) : null}
    </div>
  );
}
