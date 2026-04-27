'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Loader2, Redo2, Save, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { translateApi } from '@/shared/lib/translate-api';
import { cn } from '@/shared/lib/utils';
import {
  cloneParseResult,
  updateLayoutPosition,
  updateLayoutText,
} from '@/shared/ocr-workbench/parse-result-document';
import { buildMarkdownExport } from '@/shared/ocr-workbench/parse-result-export-md';
import {
  getLayoutEditor,
  setLayoutEditor,
} from '@/shared/ocr-workbench/parse-result-editor-styles';
import { tryNormalizeToParseResult } from '@/shared/ocr-workbench/normalize-ocr-parse-json';
import { ParseResultCanvas } from '@/shared/ocr-workbench/parse-result-canvas';
import { ParseResultEditorToolbar } from '@/shared/ocr-workbench/parse-result-editor-toolbar';
import { ParseResultOriginalPanel } from '@/shared/ocr-workbench/parse-result-original-panel';
import { useParseResultHistory } from '@/shared/ocr-workbench/use-parse-result-history';
const JSON_SCALE_KEY = 'ocr_workbench_json_scale_v1';

function stripHtmlForFit(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function estimateFitFontSize(
  text: string,
  w: number,
  h: number,
  layoutType?: string
): number {
  const plain = stripHtmlForFit(text);
  if (!plain) return 16;
  const t = (layoutType || '').toLowerCase();
  const minSize = t.includes('title') ? 12 : t.includes('formula') ? 11 : 9;
  for (let size = 72; size >= minSize; size -= 1) {
    const charsPerLine = Math.max(3, Math.floor((w * 2.25) / size));
    const lines = Math.ceil(plain.length / charsPerLine);
    const neededH = lines * size * 1.45;
    if (neededH <= h * 0.98) return size;
  }
  return minSize;
}

export function OcrParseWorkbench({
  taskId,
  parseResultUrl,
  sourcePdfUrl,
  hideSourcePanel = false,
  pageIndex: controlledPageIndex,
  onPageIndexChange,
  onWorkbenchPageJson,
  toolbarPosition = 'bottom',
  toolbarId,
  toolbarSectionIds,
}: {
  taskId: string;
  parseResultUrl: string | null;
  /** 同源预签名 URL；无原稿时传 null */
  sourcePdfUrl: string | null;
  /** 与外侧 PDF 并排时隐藏内嵌原稿条，仅保留画布与工具栏 */
  hideSourcePanel?: boolean;
  /** 受控页码（0-based）；与 `onPageIndexChange` 同时传入时生效 */
  pageIndex?: number;
  onPageIndexChange?: (index: number) => void;
  /** 当前解析页序列化 JSON（供外侧只读预览） */
  onWorkbenchPageJson?: (payload: { pageIndex: number; json: string }) => void;
  toolbarPosition?: 'bottom' | 'left';
  toolbarId?: string;
  toolbarSectionIds?: {
    textEdit?: string;
    fontSettings?: string;
    blockProps?: string;
    file?: string;
  };
}) {
  const t = useTranslations('translate.ocrWorkbench');
  const {
    doc,
    canUndo,
    canRedo,
    reset,
    commit,
    commitMergeText,
    undo,
    redo,
  } = useParseResultHistory();

  const docRef = useRef(doc);
  docRef.current = doc;

  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'error'>(
    'idle'
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [internalPageIndex, setInternalPageIndex] = useState(0);
  const pageIndexControlled =
    controlledPageIndex !== undefined && onPageIndexChange !== undefined;
  const totalPagesForClamp = Math.max(1, doc?.pages.length ?? 1);
  const activePageIndex = pageIndexControlled
    ? Math.max(
        0,
        Math.min(totalPagesForClamp - 1, Math.floor(controlledPageIndex ?? 0))
      )
    : internalPageIndex;

  const setActivePageIndex = useCallback(
    (next: number) => {
      const maxI = Math.max(0, (doc?.pages.length ?? 1) - 1);
      const clamped = Math.max(0, Math.min(maxI, next));
      if (pageIndexControlled) {
        onPageIndexChange!(clamped);
      } else {
        setInternalPageIndex(clamped);
      }
    },
    [doc?.pages.length, onPageIndexChange, pageIndexControlled]
  );
  const [pdfPageNum, setPdfPageNum] = useState(1);
  const [pdfPageTotal, setPdfPageTotal] = useState(1);
  const [collapsed, setCollapsed] = useState(false);
  const [jsonCanvasScale, setJsonCanvasScale] = useState(() => {
    if (typeof window === 'undefined') return 100;
    const v = Number.parseInt(
      window.localStorage.getItem(JSON_SCALE_KEY) || '100',
      10
    );
    return Number.isFinite(v) ? Math.max(30, Math.min(160, v)) : 100;
  });
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const page = doc?.pages[activePageIndex] ?? null;

  const pickDefaultLayoutId = useCallback((nextDoc: { pages?: Array<{ layouts?: Array<{ layout_id: string; type?: string }> }> } | null | undefined): string | null => {
    const layouts = nextDoc?.pages?.[0]?.layouts ?? [];
    if (layouts.length === 0) return null;
    const textLike =
      layouts.find((ly) => ly.type !== 'image' && ly.type !== 'table') ??
      layouts[0];
    return textLike?.layout_id ?? null;
  }, []);

  useEffect(() => {
    if (!parseResultUrl) {
      setLoadState('idle');
      return;
    }
    let cancelled = false;
    setLoadState('loading');
    setLoadError(null);
    void (async () => {
      try {
        const res = await fetch(parseResultUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as unknown;
        if (cancelled) return;
        const parsed = tryNormalizeToParseResult(raw);
        if (!parsed.ok) {
          setLoadState('error');
          setLoadError(parsed.error);
          return;
        }
        reset(parsed.data);
        setInternalPageIndex(0);
        onPageIndexChange?.(0);
        setSelectedLayoutId(pickDefaultLayoutId(parsed.data));
        setLoadState('ok');
      } catch (e) {
        if (cancelled) return;
        setLoadState('error');
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parseResultUrl, reset, pickDefaultLayoutId, onPageIndexChange]);

  useEffect(() => {
    if (!doc || !page) return;
    const exists = selectedLayoutId
      ? page.layouts.some((ly) => ly.layout_id === selectedLayoutId)
      : false;
    if (!exists) {
      const first = page.layouts[0]?.layout_id ?? null;
      if (first) setSelectedLayoutId(first);
    }
  }, [doc, page, selectedLayoutId, activePageIndex]);

  useEffect(() => {
    if (!page) return;
    const patches = page.layouts
      .filter((ly) => ly.type !== 'image' && ly.type !== 'table')
      .map((ly) => {
        const ed = getLayoutEditor(ly);
        if ((ed.fontSize || '').trim()) return null;
        const [, , w, h] = ly.position;
        const size = estimateFitFontSize(ly.text || '', w, h, ly.type || '');
        const cur = Number.parseInt(ed.fontSize || '0', 10);
        if (cur === size) return null;
        return { layoutId: ly.layout_id, fontSize: `${size}px` };
      })
      .filter((v): v is { layoutId: string; fontSize: string } => !!v);
    if (patches.length === 0) return;
    commitMergeText((draft) => {
      for (const p of patches) {
        setLayoutEditor(draft, activePageIndex, p.layoutId, { fontSize: p.fontSize });
      }
    });
  }, [page, activePageIndex, commitMergeText]);

  const selectedLayout = useMemo(() => {
    if (!page || !selectedLayoutId) return null;
    return page.layouts.find((l) => l.layout_id === selectedLayoutId) ?? null;
  }, [page, selectedLayoutId]);

  const selectedEditorStyle = useMemo(
    () => (selectedLayout ? getLayoutEditor(selectedLayout) : {}),
    [selectedLayout]
  );

  const onPositionChange = useCallback(
    (layoutId: string, position: [number, number, number, number]) => {
      commit((draft) => {
        updateLayoutPosition(draft, activePageIndex, layoutId, position);
      });
    },
    [activePageIndex, commit]
  );

  const onTextCommit = useCallback(
    (layoutId: string, html: string) => {
      commitMergeText((draft) => {
        updateLayoutText(draft, activePageIndex, layoutId, html);
      });
    },
    [activePageIndex, commitMergeText]
  );

  const onAutoFitFontSize = useCallback(
    (layoutId: string, fontSize: string) => {
      const curLayout = docRef.current?.pages[activePageIndex]?.layouts.find(
        (l) => l.layout_id === layoutId
      );
      const curSize = curLayout ? getLayoutEditor(curLayout).fontSize : undefined;
      if (curSize === fontSize) return;
      commitMergeText((draft) => {
        setLayoutEditor(draft, activePageIndex, layoutId, { fontSize });
      });
    },
    [activePageIndex, commitMergeText]
  );

  const flushEditableText = useCallback(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-layout-editable="true"]'
    );
    if (!el || !selectedLayoutId || !docRef.current) return;
    const html = el.innerHTML || '';
    const cur =
      docRef.current.pages[activePageIndex]?.layouts?.find(
        (l) => l.layout_id === selectedLayoutId
      )?.text ?? '';
    if (html === cur) return;
    commitMergeText((draft) => {
      updateLayoutText(draft, activePageIndex, selectedLayoutId, html);
    });
  }, [selectedLayoutId, activePageIndex, commitMergeText]);

  const onEditorStylePatch = useCallback(
    (patch: {
      fontSize?: string;
      fontFamily?: string;
      fontWeight?: string;
      color?: string;
      textAlign?: 'left' | 'center' | 'right';
    }) => {
      if (!selectedLayoutId) return;
      commitMergeText((draft) => {
        setLayoutEditor(draft, activePageIndex, selectedLayoutId, patch);
      });
    },
    [selectedLayoutId, activePageIndex, commitMergeText]
  );

  const onLayoutPositionFieldChange = useCallback(
    (axis: 0 | 1 | 2 | 3, raw: string) => {
      if (!selectedLayoutId || !selectedLayout) return;
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return;
      const v = Math.round(n);
      const p = [...selectedLayout.position] as [
        number,
        number,
        number,
        number,
      ];
      p[axis] = axis >= 2 ? Math.max(8, v) : v;
      commit((draft) => {
        updateLayoutPosition(draft, activePageIndex, selectedLayoutId, p);
      });
    },
    [selectedLayoutId, selectedLayout, activePageIndex, commit]
  );

  const onLayoutFontSizeChange = useCallback(
    (raw: string) => {
      if (!selectedLayoutId) return;
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return;
      const px = `${Math.max(6, Math.min(64, Math.round(n)))}px`;
      commitMergeText((draft) => {
        setLayoutEditor(draft, activePageIndex, selectedLayoutId, { fontSize: px });
      });
    },
    [selectedLayoutId, activePageIndex, commitMergeText]
  );

  const onLayoutFontFamilyChange = useCallback(
    (fontFamily: string) => {
      if (!selectedLayoutId) return;
      commitMergeText((draft) => {
        setLayoutEditor(draft, activePageIndex, selectedLayoutId, { fontFamily });
      });
    },
    [selectedLayoutId, activePageIndex, commitMergeText]
  );

  const inspectorControls = useMemo(() => {
    if (!doc || !selectedLayout || !selectedLayoutId) return null;
    return (
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground w-4 text-xs">X</span>
          <Input
            type="number"
            className="h-8 text-xs"
            value={String(Math.round(selectedLayout.position[0]))}
            onChange={(e) => onLayoutPositionFieldChange(0, e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground w-4 text-xs">Y</span>
          <Input
            type="number"
            className="h-8 text-xs"
            value={String(Math.round(selectedLayout.position[1]))}
            onChange={(e) => onLayoutPositionFieldChange(1, e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground w-4 text-xs">
            {t('parseDemoLayoutW')}
          </span>
          <Input
            type="number"
            className="h-8 text-xs"
            min={8}
            value={String(Math.round(selectedLayout.position[2]))}
            onChange={(e) => onLayoutPositionFieldChange(2, e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground w-4 text-xs">
            {t('parseDemoLayoutH')}
          </span>
          <Input
            type="number"
            className="h-8 text-xs"
            min={8}
            value={String(Math.round(selectedLayout.position[3]))}
            onChange={(e) => onLayoutPositionFieldChange(3, e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground w-8 whitespace-nowrap text-xs">
            {t('toolbarFontSize')}
          </span>
          <Input
            type="number"
            className="h-8 text-xs"
            min={6}
            value={String(Number.parseInt(selectedEditorStyle.fontSize || '16', 10))}
            onChange={(e) => onLayoutFontSizeChange(e.target.value)}
          />
        </label>
        <label className="flex min-w-0 items-center gap-1.5">
          <span className="text-muted-foreground w-7 shrink-0 truncate text-[10px]">
            {t('toolbarFontFamily')}
          </span>
          <select
            className="border-input bg-background h-8 min-w-0 max-w-full flex-1 rounded-md border px-1 text-[10px]"
            title={t('toolbarFontFamily')}
            value={selectedEditorStyle.fontFamily || 'system-ui,sans-serif'}
            onChange={(e) => onLayoutFontFamilyChange(e.target.value)}
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
        </label>
      </div>
    );
  }, [
    doc,
    selectedLayout,
    selectedLayoutId,
    selectedEditorStyle.fontFamily,
    selectedEditorStyle.fontSize,
    onLayoutPositionFieldChange,
    onLayoutFontSizeChange,
    onLayoutFontFamilyChange,
    t,
  ]);

  const originalLabels = useMemo(
    () => ({
      collapse: t('parseDemoCollapseOriginal'),
      expand: t('parseDemoExpandOriginal'),
      noFile: t('parseDemoNoOriginal'),
      pdfLoadError: t('parseDemoPdfError'),
    }),
    [t]
  );

  const totalPages = doc?.pages.length ?? 0;

  useEffect(() => {
    if (!onWorkbenchPageJson || !doc?.pages?.[activePageIndex]) return;
    try {
      onWorkbenchPageJson({
        pageIndex: activePageIndex,
        json: JSON.stringify(doc.pages[activePageIndex], null, 2),
      });
    } catch {
      /* ignore */
    }
  }, [doc, activePageIndex, onWorkbenchPageJson]);

  const saveToServer = useCallback(async () => {
    if (!docRef.current) return;
    flushSync(() => {
      flushEditableText();
    });
    setSaving(true);
    try {
      const payload = cloneParseResult(docRef.current) as unknown;
      await translateApi.patchOcrParseResult(taskId, payload);
      toast.success(t('parseDemoSavedNow'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [taskId, flushEditableText, t]);

  const exportMd = useCallback(() => {
    if (!docRef.current) return;
    const md = buildMarkdownExport(docRef.current);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocr-workbench-export.md';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const scaleControl = useMemo(
    () => (
      <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
        <span>{t('canvasScale')}</span>
        <input
          type="range"
          min={30}
          max={160}
          value={jsonCanvasScale}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            setJsonCanvasScale(n);
            try {
              window.localStorage.setItem(JSON_SCALE_KEY, String(n));
            } catch {
              /* ignore */
            }
          }}
          className="w-24"
        />
        <span className="tabular-nums">{jsonCanvasScale}%</span>
      </label>
    ),
    [jsonCanvasScale, t]
  );

  const fileControls = useMemo(
    () => (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!doc || !canUndo}
            onClick={undo}
          >
            <Undo2 className="mr-1 size-3.5" />
            {t('parseDemoUndo')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!doc || !canRedo}
            onClick={redo}
          >
            <Redo2 className="mr-1 size-3.5" />
            {t('parseDemoRedo')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!doc || saving}
            onClick={() => void saveToServer()}
          >
            {saving ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 size-3.5" />
            )}
            {t('parseDemoSaveNow')}
          </Button>
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={!doc} onClick={exportMd}>
          {t('parseDemoExportMd')}
        </Button>
      </div>
    ),
    [canRedo, canUndo, doc, exportMd, redo, saveToServer, saving, t, undo]
  );
  const showTopPageControls = !(toolbarPosition === 'left' && hideSourcePanel);

  if (!parseResultUrl) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('noParseUrl')}</p>
    );
  }

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Loader2 className="size-4 animate-spin" />
        {t('loadingParse')}
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50/90 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
        <p className="font-medium">{t('parseFailedTitle')}</p>
        <p className="mt-1 text-xs opacity-90">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
        {showTopPageControls ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!doc || activePageIndex <= 0}
              onClick={() => setActivePageIndex(activePageIndex - 1)}
            >
              {t('parseDemoPrevPage')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!doc || totalPages === 0 || activePageIndex >= totalPages - 1}
              onClick={() => setActivePageIndex(activePageIndex + 1)}
            >
              {t('parseDemoNextPage')}
            </Button>
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {t('parseDemoPage', {
                n: activePageIndex + 1,
                total: Math.max(1, totalPages),
              })}
            </span>
          </>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!doc || !canUndo}
            onClick={undo}
          >
            <Undo2 className="mr-1 size-3.5" />
            {t('parseDemoUndo')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!doc || !canRedo}
            onClick={redo}
          >
            <Redo2 className="mr-1 size-3.5" />
            {t('parseDemoRedo')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!doc || saving}
            onClick={() => void saveToServer()}
          >
            {saving ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 size-3.5" />
            )}
            {t('parseDemoSaveNow')}
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={!doc} onClick={exportMd}>
            {t('parseDemoExportMd')}
          </Button>
        </div>
      </div>
      {!selectedLayoutId ? (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {t('selectBlockHint')}
        </p>
      ) : null}

      <div
        className={cn(
          'min-h-0 min-w-0 flex-1',
          toolbarPosition === 'left' && hideSourcePanel ? 'flex flex-col gap-2 md:flex-row' : 'flex flex-col gap-2'
        )}
      >
        {toolbarPosition === 'left' && hideSourcePanel ? (
          <aside
            id={toolbarId}
            className="flex w-full shrink-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950 md:sticky md:top-2 md:h-[calc(100vh-9rem)] md:w-72 md:self-start md:overflow-y-auto"
          >
            <ParseResultEditorToolbar
              disabled={!selectedLayoutId}
              onFlushBeforeFormat={flushEditableText}
              onEditorStylePatch={onEditorStylePatch}
              currentEditorStyle={selectedEditorStyle}
              inspectorControls={inspectorControls}
              extraFontControls={scaleControl}
              fileControls={fileControls}
              sectionIds={toolbarSectionIds}
            />
          </aside>
        ) : null}
        <div
          className={cn(
            'grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900',
            hideSourcePanel
              ? 'grid-cols-1'
              : collapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_minmax(0,1.2fr)]'
          )}
        >
          {!hideSourcePanel ? (
            <ParseResultOriginalPanel
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((c) => !c)}
              file={null}
              sourcePdfUrl={sourcePdfUrl}
              pageNum={pdfPageNum}
              onPdfPageCountChange={(count) => {
                const safe = Math.max(1, count || 1);
                setPdfPageTotal(safe);
                setPdfPageNum((n) => Math.max(1, Math.min(safe, n)));
              }}
              hideHeader
              hideFooter
              labels={originalLabels}
            />
          ) : null}
          <div
            className={cn(
              'relative flex min-h-0 min-w-0 flex-col',
              !hideSourcePanel && 'border-t border-zinc-200 dark:border-zinc-800 md:border-t-0 md:border-l'
            )}
          >
            {doc ? (
              <ParseResultCanvas
                doc={doc}
                pageIndex={activePageIndex}
                canvasScalePercent={jsonCanvasScale}
                orientation="portrait"
                onActivate={() => {}}
                selectedLayoutId={selectedLayoutId}
                onSelectLayout={setSelectedLayoutId}
                onPositionChange={onPositionChange}
                onTextCommit={onTextCommit}
                onAutoFitFontSize={onAutoFitFontSize}
              />
            ) : null}
          </div>
        </div>
        {!(toolbarPosition === 'left' && hideSourcePanel) ? (
          <aside
            id={toolbarId}
            className={cn(
              'flex w-full shrink-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950 md:sticky md:top-2 md:h-[calc(100vh-9rem)] md:overflow-y-auto',
              hideSourcePanel ? 'md:w-full md:self-stretch' : 'md:w-72 md:self-start'
            )}
          >
            <ParseResultEditorToolbar
              disabled={!selectedLayoutId}
              onFlushBeforeFormat={flushEditableText}
              onEditorStylePatch={onEditorStylePatch}
              currentEditorStyle={selectedEditorStyle}
              inspectorControls={inspectorControls}
              extraFontControls={scaleControl}
              fileControls={fileControls}
              sectionIds={toolbarSectionIds}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
