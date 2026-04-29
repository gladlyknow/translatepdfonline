'use client';

import MarkdownIt from 'markdown-it';
import type { CSSProperties } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Moveable from 'react-moveable';
import type { OnDrag, OnDragEnd } from 'react-moveable';
import { useTranslations } from 'next-intl';

import {
  editorStyleToCss,
  getLayoutEditor,
} from '@/shared/ocr-workbench/parse-result-editor-styles';
import {
  findImageForLayout,
  findTableForLayout,
  getPageBox,
  sortLayoutsByReadingOrder,
} from '@/shared/ocr-workbench/parse-result-document';
import { saveLayoutEditableSelection } from '@/shared/ocr-workbench/parse-result-editor-selection';
import { cn } from '@/shared/lib/utils';
import type { ParseLayout, ParseResult } from '@/shared/ocr-workbench/translator-parse-result';

const md = new MarkdownIt({ html: false, linkify: false });

function isLikelyHtml(s: string): boolean {
  if (!s.trim()) return false;
  return /<\/?[a-z][\s\S]*>/i.test(s) || /<\s*br\s*\/?>/i.test(s);
}

function renderLayoutTextHtml(text: string): string {
  if (!text) return '<p><br></p>';
  if (isLikelyHtml(text)) return text;
  return md.render(text) || '<p><br></p>';
}

/** 从 Moveable 写入的 transform 字符串解析 translate(px)，作 onDragEnd 最后兜底 */
function parseTranslatePx(transform: string): [number, number] | null {
  const m = transform.match(
    /translate(?:3d)?\(\s*([-\d.]+)(?:px)?\s*,\s*([-\d.]+)(?:px)?/
  );
  if (!m) return null;
  const x = parseFloat(m[1]);
  const y = parseFloat(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

/** 与容器 padding 一致，避免重复扣减 */
const FIT_PADDING = 0;
/** 仅在宽高都测不到时使用 */
const FALLBACK_SCALE = 1;
const MIN_CANVAS_SCALE = 0.05;
const MAX_CANVAS_SCALE = 6;
const TEXT_INPUT_DEBOUNCE_MS = 300;

type Props = {
  doc: ParseResult;
  pageIndex: number;
  selectedLayoutId: string | null;
  onActivate?: () => void;
  onSelectLayout: (id: string | null) => void;
  onPositionChange: (
    layoutId: string,
    position: [number, number, number, number]
  ) => void;
  /** 文本写入 doc（合并栈顶），含防抖 input 与 blur */
  onTextCommit: (layoutId: string, content: string) => void;
  /** 自动适配得到的新字号持久化，避免失焦后恢复 */
  onAutoFitFontSize: (layoutId: string, fontSize: string) => void;
  /** JSON 画布整体缩放百分比（默认 100） */
  canvasScalePercent?: number;
  /** 纸张方向（影响预览与导出） */
  orientation?: 'portrait' | 'landscape';
};

function LayoutText({
  ly,
  isSel,
  frameStyle,
  editorStyle,
  skipAutoFitTypography,
  baseWidthPx,
  baseHeightPx,
  onSelectLayout,
  onTextCommit,
  onAutoFitFontSize,
  onResizeByNativeHandle,
  dragMoveTitle,
}: {
  ly: ParseLayout;
  isSel: boolean;
  frameStyle: CSSProperties;
  editorStyle: CSSProperties;
  /** 为 true 时保留 _editor 字号，不再用二分缩放覆盖工具栏设置 */
  skipAutoFitTypography: boolean;
  baseWidthPx: number;
  baseHeightPx: number;
  onSelectLayout: (id: string | null) => void;
  onTextCommit: (layoutId: string, content: string) => void;
  onAutoFitFontSize: (layoutId: string, fontSize: string) => void;
  onResizeByNativeHandle: (layoutId: string, widthPx: number, heightPx: number) => void;
  dragMoveTitle: string;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const domRef = useRef<HTMLDivElement | null>(null);
  const textSaveRef = useRef(onTextCommit);
  textSaveRef.current = onTextCommit;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutId = ly.layout_id;

  /**
   * ref 回调在卸载时先收到 null；若在此处不把 innerHTML 写回 doc，domRef 会在 useEffect cleanup 前被清空，导致内容丢失。
   * useCallback 保持稳定，避免每次渲染 null→el 误触发保存。
   */
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) {
        innerRef.current = el;
        domRef.current = el;
      } else {
        const prev = domRef.current;
        innerRef.current = null;
        domRef.current = null;
        if (prev) {
          textSaveRef.current(layoutId, prev.innerHTML || '');
        }
      }
    },
    [layoutId]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  /** 勿依赖 ly.text：保存后父级更新会触发 effect，用 renderLayoutTextHtml 重刷会覆盖刚编辑的 HTML */
  useEffect(() => {
    if (!isSel || !innerRef.current) return;
    innerRef.current.innerHTML = renderLayoutTextHtml(ly.text || '');
  }, [isSel, ly.layout_id]);

  useEffect(() => {
    if (!isSel) return;
    const onSelChange = () => {
      saveLayoutEditableSelection();
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, [isSel]);

  const dragHandlePx = 0;
  const innerStyle: CSSProperties = {
    ...editorStyle,
    position: 'absolute',
    left: 0,
    right: 0,
    top: dragHandlePx,
    bottom: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
  };

  const fitTextToBox = useCallback(() => {
    if (skipAutoFitTypography) return;
    const el = innerRef.current;
    if (!el) return;
    const before = parseInt(window.getComputedStyle(el).fontSize || '16', 10);
    let size = before;
    if (!Number.isFinite(size)) size = 16;
    const fits = () =>
      el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    while (
      size > 6 &&
      !fits()
    ) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
    // 温和向上填充：在不溢出的前提下逐步增大，减少“大框小字”
    let guard = 0;
    while (size < 64 && fits() && guard < 40) {
      const trySize = size + 1;
      el.style.fontSize = `${trySize}px`;
      if (!fits()) {
        el.style.fontSize = `${size}px`;
        break;
      }
      size = trySize;
      guard += 1;
    }
    if (size !== before) {
      onAutoFitFontSize(layoutId, `${size}px`);
    }
  }, [layoutId, onAutoFitFontSize, skipAutoFitTypography]);

  useEffect(() => {
    if (!isSel || skipAutoFitTypography) return;
    const id = requestAnimationFrame(() => {
      fitTextToBox();
    });
    return () => cancelAnimationFrame(id);
  }, [isSel, skipAutoFitTypography, fitTextToBox, baseWidthPx, baseHeightPx]);

  return (
    <div
      data-layout-id={layoutId}
      style={frameStyle}
      className={cn(
        'bg-white/90 relative',
        isSel && 'ring-primary ring-2 ring-offset-1'
      )}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelectLayout(ly.layout_id);
      }}
      onMouseUp={(e) => {
        if (!isSel) return;
        const el = e.currentTarget;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (Math.abs(w - baseWidthPx) < 1 && Math.abs(h - baseHeightPx) < 1) {
          return;
        }
        onResizeByNativeHandle(layoutId, w, h);
      }}
    >
      <div
        data-drag-handle
        className="bg-muted/80 border-border/70 text-muted-foreground absolute top-1 left-1 z-20 flex h-4 w-4 cursor-grab select-none items-center justify-center rounded border text-[10px] leading-none"
        title={dragMoveTitle}
        onMouseDown={(e) => {
          e.stopPropagation();
          onSelectLayout(ly.layout_id);
        }}
      >
        ⋮
      </div>
      <div
        ref={setRef}
        role="textbox"
        tabIndex={0}
        data-layout-editable={isSel ? 'true' : undefined}
        contentEditable={isSel}
        suppressContentEditableWarning
        style={innerStyle}
        className={cn(
          'parse-result-rich-host bg-white/90 outline-none',
          'overflow-y-auto overflow-x-hidden',
          '[&_ol]:list-decimal [&_ol]:list-inside [&_ol]:pl-2',
          '[&_ul]:list-disc [&_ul]:list-inside [&_ul]:pl-2',
          '[&_li]:my-0.5 [&_li]:list-item'
        )}
        onMouseDown={(e) => {
          e.stopPropagation();
          onSelectLayout(ly.layout_id);
        }}
        onMouseUp={() => {
          if (isSel) saveLayoutEditableSelection();
        }}
        onKeyUp={() => {
          if (isSel) saveLayoutEditableSelection();
        }}
        onInput={() => {
          if (!isSel) return;
          saveLayoutEditableSelection();
          if (debounceTimerRef.current != null) {
            clearTimeout(debounceTimerRef.current);
          }
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            const el = innerRef.current;
            if (!el) return;
            textSaveRef.current(layoutId, el.innerHTML || '');
          }, TEXT_INPUT_DEBOUNCE_MS);
        }}
        onBlur={(e) => {
          if (!isSel) return;
          if (debounceTimerRef.current != null) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          if (!skipAutoFitTypography) fitTextToBox();
          textSaveRef.current(layoutId, e.currentTarget.innerHTML || '');
        }}
      />
      {isSel ? (
        <div
          className="pointer-events-none absolute right-0 bottom-0 z-20 h-3 w-3 border-r-2 border-b-2 border-neutral-500/80"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

function LayoutTable({
  layoutId,
  isSel,
  frameStyle,
  typographyStyle,
  skipAutoFitTypography,
  markdown,
  scale,
  x,
  y,
  w,
  h,
  onSelectLayout,
  onPositionChange,
  onAutoFitFontSize,
  dragMoveTitle,
  resizeTableTitle,
}: {
  layoutId: string;
  isSel: boolean;
  frameStyle: CSSProperties;
  typographyStyle: CSSProperties;
  skipAutoFitTypography: boolean;
  markdown: string;
  scale: number;
  x: number;
  y: number;
  w: number;
  h: number;
  onSelectLayout: (id: string | null) => void;
  onPositionChange: (
    layoutId: string,
    position: [number, number, number, number]
  ) => void;
  onAutoFitFontSize: (layoutId: string, fontSize: string) => void;
  dragMoveTitle: string;
  resizeTableTitle: string;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const fitTableFont = useCallback(() => {
    const host = innerRef.current;
    if (!host) return;
    if (skipAutoFitTypography) {
      const fs = typographyStyle.fontSize;
      if (fs) host.style.fontSize = String(fs);
      if (typographyStyle.fontFamily) {
        host.style.fontFamily = String(typographyStyle.fontFamily);
      }
      if (typographyStyle.color) host.style.color = String(typographyStyle.color);
      if (typographyStyle.fontWeight) {
        host.style.fontWeight = String(typographyStyle.fontWeight);
      }
      return;
    }
    const before = parseInt(window.getComputedStyle(host).fontSize || '0', 10);
    const minSize = 8;
    const byBox = Math.max(20, Math.floor(Math.min(host.clientWidth, host.clientHeight)));
    const maxSize = Math.max(minSize, Math.min(120, byBox));
    const fits = (size: number): boolean => {
      host.style.fontSize = `${size}px`;
      return (
        host.scrollHeight <= host.clientHeight + 1 &&
        host.scrollWidth <= host.clientWidth + 1
      );
    };
    let lo = minSize;
    let hi = maxSize;
    let best = minSize;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // 轻微上调倾向，尽量占满而不溢出
    const finalSize = Math.max(minSize, best);
    host.style.fontSize = `${finalSize}px`;
    if (!Number.isFinite(before) || before !== finalSize) {
      onAutoFitFontSize(layoutId, `${finalSize}px`);
    }
  }, [layoutId, onAutoFitFontSize, skipAutoFitTypography, typographyStyle]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fitTableFont();
    });
    return () => cancelAnimationFrame(id);
  }, [fitTableFont, markdown, w, h, scale, skipAutoFitTypography, typographyStyle]);

  return (
    <div
      data-layout-id={layoutId}
      role="presentation"
      style={{ ...frameStyle, resize: isSel ? 'both' : undefined }}
      className="touch-none bg-white leading-snug select-none dark:bg-neutral-900 relative"
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelectLayout(layoutId);
      }}
      onMouseUp={(e) => {
        if (!isSel) return;
        const el = e.currentTarget;
        const wPx = el.offsetWidth;
        const hPx = el.offsetHeight;
        const nw = Math.max(8, wPx / scale);
        const nh = Math.max(8, hPx / scale);
        if (Math.abs(nw - w) < 0.2 && Math.abs(nh - h) < 0.2) return;
        onPositionChange(layoutId, [x, y, nw, nh]);
      }}
    >
      <div
        ref={innerRef}
        style={{
          fontSize: typographyStyle.fontSize,
          fontFamily: typographyStyle.fontFamily,
          fontWeight: typographyStyle.fontWeight,
          color: typographyStyle.color,
        }}
        className={cn(
          'parse-result-rich-host h-full w-full overflow-hidden leading-[1.2]',
          '[&_*]:pointer-events-none [&_p]:m-0 [&_table]:h-full [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse',
          '[&_td]:break-words [&_td]:align-top [&_th]:break-words [&_th]:align-top'
        )}
        dangerouslySetInnerHTML={{
          __html: md.render(markdown || ''),
        }}
      />
      {isSel ? (
        <div
          data-drag-handle
          className="bg-muted/80 border-border/70 text-muted-foreground absolute top-1 left-1 z-20 flex h-4 w-4 cursor-grab select-none items-center justify-center rounded border text-[10px] leading-none"
          title={dragMoveTitle}
          onMouseDown={(e) => {
            e.stopPropagation();
            onSelectLayout(layoutId);
          }}
        >
          ⋮
        </div>
      ) : null}
      {isSel ? (
        <div
          className="bg-muted/80 border-border/70 text-muted-foreground absolute right-0 bottom-0 z-30 h-3 w-3 cursor-se-resize border-r-2 border-b-2"
          title={resizeTableTitle}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectLayout(layoutId);
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = w * scale;
            const startH = h * scale;
            const onMove = (ev: MouseEvent) => {
              const dx = ev.clientX - startX;
              const dy = ev.clientY - startY;
              const nw = Math.max(8, (startW + dx) / scale);
              const nh = Math.max(8, (startH + dy) / scale);
              onPositionChange(layoutId, [x, y, nw, nh]);
            };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
        />
      ) : null}
    </div>
  );
}

function LayoutReadOnlyText({
  ly,
  frameStyle,
  editorStyle,
  baseWidthPx,
  baseHeightPx,
  onSelectLayout,
}: {
  ly: ParseLayout;
  frameStyle: CSSProperties;
  editorStyle: CSSProperties;
  baseWidthPx: number;
  baseHeightPx: number;
  onSelectLayout: (id: string | null) => void;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const fitReadOnlyText = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const before = parseInt(window.getComputedStyle(el).fontSize || '16', 10);
    let size = Number.isFinite(before) ? before : 16;
    const fits = () =>
      el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    while (size > 8 && !fits()) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
    let guard = 0;
    while (size < 72 && fits() && guard < 56) {
      const trySize = size + 1;
      el.style.fontSize = `${trySize}px`;
      if (!fits()) {
        el.style.fontSize = `${size}px`;
        break;
      }
      size = trySize;
      guard += 1;
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fitReadOnlyText();
    });
    return () => cancelAnimationFrame(id);
  }, [fitReadOnlyText, baseWidthPx, baseHeightPx, ly.text]);

  return (
    <div
      data-layout-id={ly.layout_id}
      role="presentation"
      style={{ ...frameStyle, ...editorStyle, overflow: 'hidden' }}
      className="bg-white/90 leading-snug dark:bg-neutral-900"
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelectLayout(ly.layout_id);
      }}
    >
      <div
        ref={innerRef}
        className={cn(
          'parse-result-rich-host h-full w-full overflow-hidden',
          '[&_ol]:list-decimal [&_ol]:list-inside [&_ol]:pl-2',
          '[&_ul]:list-disc [&_ul]:list-inside [&_ul]:pl-2',
          '[&_li]:my-0.5 [&_li]:list-item'
        )}
        dangerouslySetInnerHTML={{
          __html: renderLayoutTextHtml(ly.text || ''),
        }}
      />
    </div>
  );
}

export function ParseResultCanvas({
  doc,
  pageIndex,
  selectedLayoutId,
  onActivate,
  onSelectLayout,
  onPositionChange,
  onTextCommit,
  onAutoFitFontSize,
  canvasScalePercent = 100,
  orientation = 'portrait',
}: Props) {
  const t = useTranslations('translate.ocrWorkbench');
  const page = doc.pages[pageIndex];
  const boxRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** lastEvent.translate 偶发缺失时，用最后一次 onDrag 的位移兜底 */
  const lastDragTranslateRef = useRef<[number, number]>([0, 0]);
  const [moveTarget, setMoveTarget] = useState<HTMLElement | null>(null);
  const [dragHandleEl, setDragHandleEl] = useState<HTMLElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxSeenSizeRef = useRef({ w: 0, h: 0 });
  const sizeLockedRef = useRef(false);
  const lastStableScaleRef = useRef(FALLBACK_SCALE);
  const [sizeReady, setSizeReady] = useState(false);

  /**
   * 选中变化后根据 data-layout-id 绑定 Moveable 目标。
   * 不可在「每次 selectedLayoutId 变化」时无条件 setMoveTarget(null)：会在子组件 ref 设好 target 之后执行，导致永远拿不到 Moveable。
   */
  /**
   * 勿依赖 doc：每次 commit 文本都会变 doc，重复绑定 Moveable 会触发多余渲染，
   * 极端情况下与 ref/onTextCommit 形成更新环。仅随选中块与页变化重绑。
   */
  useLayoutEffect(() => {
    if (!selectedLayoutId || !boxRef.current) {
      setMoveTarget(null);
      setDragHandleEl(null);
      return;
    }
    const node = boxRef.current.querySelector(
      `[data-layout-id="${CSS.escape(selectedLayoutId)}"]`
    );
    const el = node instanceof HTMLElement ? node : null;
    setMoveTarget(el);
    if (el) {
      const h = el.querySelector('[data-drag-handle]');
      setDragHandleEl(h instanceof HTMLElement ? h : null);
    } else {
      setDragHandleEl(null);
    }
  }, [selectedLayoutId, pageIndex]);

  const box = useMemo(
    () => (page ? getPageBox(page) : { w: 612, h: 792 }),
    [page]
  );
  const isLandscape = orientation === 'landscape';
  const renderBox = useMemo(
    () => ({
      w: isLandscape ? box.h : box.w,
      h: isLandscape ? box.w : box.h,
    }),
    [box.h, box.w, isLandscape]
  );

  const toRenderRect = useCallback(
    ([x, y, w, h]: [number, number, number, number]): [number, number, number, number] => {
      if (!isLandscape) return [x, y, w, h];
      return [box.h - y - h, x, h, w];
    },
    [box.h, isLandscape]
  );

  const toDocRect = useCallback(
    ([x, y, w, h]: [number, number, number, number]): [number, number, number, number] => {
      if (!isLandscape) return [x, y, w, h];
      return [y, box.h - x - w, h, w];
    },
    [box.h, isLandscape]
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !page) return;
    sizeLockedRef.current = false;
    maxSeenSizeRef.current = { w: 0, h: 0 };
    setSizeReady(false);
    /** 与 ResizeObserver 一致，用 client 尺寸（内容区，不含滚动条占位误差） */
    const sync = () => {
      if (sizeLockedRef.current) return;
      const next = { w: el.clientWidth, h: el.clientHeight };
      if (next.w < 16 || next.h < 16) return;
      maxSeenSizeRef.current = {
        w: Math.max(maxSeenSizeRef.current.w, next.w),
        h: Math.max(maxSeenSizeRef.current.h, next.h),
      };
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        sizeLockedRef.current = true;
        const committed = maxSeenSizeRef.current;
        setContainerSize(committed);
        setSizeReady(true);
      }, 180);
    };
    sync();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(sync);
    });
    const ro = new ResizeObserver(() => {
      sync();
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      ro.disconnect();
    };
  }, [pageIndex, renderBox.w, renderBox.h]);

  const fitScale = useMemo(() => {
    const bw = renderBox.w;
    const bh = renderBox.h;
    if (bw <= 0 || bh <= 0) return FALLBACK_SCALE;
    const rawW = containerSize.w;
    const rawH = containerSize.h;
    if (rawW < 16 || rawH < 16) {
      return lastStableScaleRef.current;
    }
    const vpW = typeof window !== 'undefined' ? window.innerWidth : bw * 2;
    const vpH = typeof window !== 'undefined' ? window.innerHeight : bh * 2;
    const aw = Math.max(
      0,
      (rawW > 8 ? rawW : Math.max(320, vpW * 0.58)) - FIT_PADDING
    );
    const ah = Math.max(
      0,
      (rawH > 8 ? rawH : Math.max(280, vpH * 0.52)) - FIT_PADDING
    );
    /** 默认占满可视区：使用 cover 缩放；细节可由工作台缩放滑块缩小查看 */
    if (aw >= 16 && ah >= 16) {
      const s = Math.min(
        Math.max(Math.max(aw / bw, ah / bh), MIN_CANVAS_SCALE),
        MAX_CANVAS_SCALE
      );
      lastStableScaleRef.current = s;
      return s;
    }
    if (aw >= 16) {
      const s = Math.min(Math.max(aw / bw, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
      lastStableScaleRef.current = s;
      return s;
    }
    if (ah >= 16) {
      const s = Math.min(Math.max(ah / bh, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
      lastStableScaleRef.current = s;
      return s;
    }
    const s = Math.min(
      Math.max(Math.min(vpW * 0.58 / bw, vpH * 0.5 / bh), MIN_CANVAS_SCALE),
      MAX_CANVAS_SCALE
    );
    lastStableScaleRef.current = s;
    return s;
  }, [renderBox.w, renderBox.h, containerSize.w, containerSize.h]);

  const scale = useMemo(() => {
    /** 与侧栏 / 工作台滑块一致：约 20%–160%，100% = 适配后的基准 fitScale */
    const clampedPercent = Math.max(20, Math.min(160, canvasScalePercent));
    const factor = clampedPercent / 100;
    return Math.min(Math.max(fitScale * factor, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
  }, [fitScale, canvasScalePercent]);

  if (!page) return null;

  const layouts = sortLayoutsByReadingOrder(page.layouts);
  const vw = renderBox.w * scale;
  const vh = renderBox.h * scale;

  return (
    <div
      ref={containerRef}
      className="relative box-border flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-auto bg-[linear-gradient(180deg,rgba(255,251,235,0.72)_0%,rgba(254,243,199,0.48)_100%)] p-0 dark:bg-neutral-950"
      style={{ opacity: sizeReady ? 1 : 0 }}
      onMouseDown={(e) => {
        onActivate?.();
        if (e.target === e.currentTarget) onSelectLayout(null);
      }}
    >
      <div
        className="box-border flex h-full min-h-full w-full min-w-full flex-col items-center justify-center overflow-visible"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onSelectLayout(null);
        }}
      >
        <div
          ref={boxRef}
          data-export-page="true"
          data-export-page-index={String(pageIndex)}
          className="relative z-10 shrink-0 bg-white shadow-[0_4px_18px_rgba(70,40,10,0.18)] dark:bg-neutral-900"
          style={{ width: vw, height: vh }}
          onMouseDownCapture={() => onActivate?.()}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onSelectLayout(null);
          }}
        >
        {layouts.map((ly) => {
          const [x, y, w, h] = toRenderRect(ly.position);
          const isSel = ly.layout_id === selectedLayoutId;
          const ed = getLayoutEditor(ly);
          const overflowForBlock =
            ly.type === 'image' ? 'hidden' : 'auto';
          const editorCss = editorStyleToCss(ed);
          const boxFrame: CSSProperties = {
            position: 'absolute',
            left: x * scale,
            top: y * scale,
            width: Math.max(8, w * scale),
            height: Math.max(8, h * scale),
            boxSizing: 'border-box',
            border: isSel
              ? '1.5px solid hsl(var(--primary))'
              : '1px solid transparent',
          };
          const baseStyle: CSSProperties = {
            ...boxFrame,
            ...editorCss,
            overflow: overflowForBlock,
            touchAction:
              ly.type === 'image' || ly.type === 'table' ? 'none' : undefined,
          };

          if (ly.type === 'table') {
            const tb = findTableForLayout(page, ly.layout_id);
            const skipFit = Boolean((ed.fontSize || '').trim());
            return (
              <LayoutTable
                key={ly.layout_id}
                layoutId={ly.layout_id}
                isSel={isSel}
                frameStyle={baseStyle}
                typographyStyle={{
                  fontSize: editorCss.fontSize,
                  fontFamily: editorCss.fontFamily,
                  fontWeight: editorCss.fontWeight,
                  color: editorCss.color,
                }}
                skipAutoFitTypography={skipFit}
                markdown={tb?.markdown || ''}
                scale={scale}
                x={x}
                y={y}
                w={w}
                h={h}
                onSelectLayout={onSelectLayout}
                onPositionChange={(layoutId, position) =>
                  onPositionChange(layoutId, toDocRect(position))
                }
                onAutoFitFontSize={onAutoFitFontSize}
                dragMoveTitle={t('canvasDragMove')}
                resizeTableTitle={t('canvasResizeTable')}
              />
            );
          }

          if (ly.type === 'image') {
            const im = findImageForLayout(page, ly.layout_id);
            const imageStyle: CSSProperties = {
              ...baseStyle,
              resize: isSel ? 'both' : undefined,
            };
            return (
              <div
                key={ly.layout_id}
                data-layout-id={ly.layout_id}
                role="presentation"
                style={imageStyle}
                className="touch-none bg-white p-0 select-none dark:bg-neutral-900 relative"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onSelectLayout(ly.layout_id);
                }}
                onMouseUp={(e) => {
                  if (!isSel) return;
                  const el = e.currentTarget;
                  const wPx = el.offsetWidth;
                  const hPx = el.offsetHeight;
                  const nw = Math.max(8, wPx / scale);
                  const nh = Math.max(8, hPx / scale);
                  if (Math.abs(nw - w) < 0.2 && Math.abs(nh - h) < 0.2) return;
                  onPositionChange(
                    ly.layout_id,
                    toDocRect([x, y, nw, nh])
                  );
                }}
              >
                {im?.data_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={im.data_url}
                    alt=""
                    className="pointer-events-none h-full w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                {isSel ? (
                  <div
                    data-drag-handle
                    className="bg-muted/80 border-border/70 text-muted-foreground absolute top-1 left-1 z-20 flex h-4 w-4 cursor-grab select-none items-center justify-center rounded border text-[10px] leading-none"
                    title={t('canvasDragMove')}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onSelectLayout(ly.layout_id);
                    }}
                  >
                    ⋮
                  </div>
                ) : null}
              </div>
            );
          }

          if (isSel) {
            const frameStyle: CSSProperties = {
              ...boxFrame,
              overflow: 'hidden',
              resize: 'both',
            };
            const skipTextFit = Boolean((ed.fontSize || '').trim());
            return (
              <LayoutText
                key={ly.layout_id}
                ly={ly}
                isSel
                frameStyle={frameStyle}
                editorStyle={editorCss}
                skipAutoFitTypography={skipTextFit}
                baseWidthPx={Math.max(8, w * scale)}
                baseHeightPx={Math.max(8, h * scale)}
                onSelectLayout={onSelectLayout}
                onTextCommit={onTextCommit}
                onAutoFitFontSize={onAutoFitFontSize}
                dragMoveTitle={t('canvasDragMove')}
                onResizeByNativeHandle={(layoutId, widthPx, heightPx) => {
                  const nw = Math.max(8, widthPx / scale);
                  const nh = Math.max(8, heightPx / scale);
                  onPositionChange(layoutId, toDocRect([x, y, nw, nh]));
                }}
              />
            );
          }

          return (
            <LayoutReadOnlyText
              key={ly.layout_id}
              ly={ly}
              frameStyle={boxFrame}
              editorStyle={editorCss}
              baseWidthPx={Math.max(8, w * scale)}
              baseHeightPx={Math.max(8, h * scale)}
              onSelectLayout={onSelectLayout}
            />
          );
        })}

        {moveTarget && boxRef.current && selectedLayoutId ? (
          <Moveable
            className="z-20"
            target={moveTarget}
            container={boxRef.current}
            dragTarget={dragHandleEl ?? undefined}
            dragTargetSelf={dragHandleEl == null}
            rootContainer={
              typeof document !== 'undefined' ? document.body : undefined
            }
            translateZ={48}
            checkInput={false}
            draggable
            resizable={false}
            hideDefaultLines
            origin={false}
            throttleDrag={0}
            zoom={Math.min(2.75, 1 / Math.max(scale, 0.2))}
            onDrag={(e: OnDrag) => {
              lastDragTranslateRef.current = [
                e.translate[0] ?? 0,
                e.translate[1] ?? 0,
              ];
              (e.target as HTMLElement).style.transform = e.transform;
            }}
            onDragEnd={(e: OnDragEnd) => {
              const el = e.target as HTMLElement;
              const inlineTf = el.style.transform;
              el.style.transform = '';
              const id = selectedLayoutId;
              const ly = layouts.find((l) => l.layout_id === id);
              if (!ly) return;
              const [ox, oy, ow, oh] = toRenderRect(ly.position);
              const lastEv = e.lastEvent as OnDrag | undefined;
              let tx = lastEv?.translate?.[0];
              let ty = lastEv?.translate?.[1];
              if (
                tx === undefined ||
                ty === undefined ||
                Number.isNaN(tx) ||
                Number.isNaN(ty)
              ) {
                const [rx, ry] = lastDragTranslateRef.current;
                tx = rx;
                ty = ry;
              }
              if (
                (tx === undefined || ty === undefined) &&
                inlineTf &&
                /translate/i.test(inlineTf)
              ) {
                const parsed = parseTranslatePx(inlineTf);
                if (parsed) {
                  tx = parsed[0];
                  ty = parsed[1];
                }
              }
              if (tx === undefined || ty === undefined) return;
              const nx = ox + tx / scale;
              const ny = oy + ty / scale;
              onPositionChange(id, toDocRect([nx, ny, ow, oh]));
            }}
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}
