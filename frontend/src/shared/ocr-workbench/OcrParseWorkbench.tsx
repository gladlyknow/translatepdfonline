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
}: {
  taskId: string;
  parseResultUrl: string | null;
  /** 同源预签名 URL；无原稿时传 null */
  sourcePdfUrl: string | null;
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
  const [pageIndex, setPageIndex] = useState(0);
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

  const page = doc?.pages[pageIndex] ?? null;

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
        setPageIndex(0);
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
  }, [parseResultUrl, reset, pickDefaultLayoutId]);

  useEffect(() => {
    if (!doc || !page) return;
    const exists = selectedLayoutId
      ? page.layouts.some((ly) => ly.layout_id === selectedLayoutId)
      : false;
    if (!exists) {
      const first = page.layouts[0]?.layout_id ?? null;
      if (first) setSelectedLayoutId(first);
    }
  }, [doc, page, selectedLayoutId, pageIndex]);

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
        setLayoutEditor(draft, pageIndex, p.layoutId, { fontSize: p.fontSize });
      }
    });
  }, [page, pageIndex, commitMergeText]);

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
        updateLayoutPosition(draft, pageIndex, layoutId, position);
      });
    },
    [pageIndex, commit]
  );

  const onTextCommit = useCallback(
    (layoutId: string, html: string) => {
      commitMergeText((draft) => {
        updateLayoutText(draft, pageIndex, layoutId, html);
      });
    },
    [pageIndex, commitMergeText]
  );

  const onAutoFitFontSize = useCallback(
    (layoutId: string, fontSize: string) => {
      const curLayout = docRef.current?.pages[pageIndex]?.layouts.find(
        (l) => l.layout_id === layoutId
      );
      const curSize = curLayout ? getLayoutEditor(curLayout).fontSize : undefined;
      if (curSize === fontSize) return;
      commitMergeText((draft) => {
        setLayoutEditor(draft, pageIndex, layoutId, { fontSize });
      });
    },
    [pageIndex, commitMergeText]
  );

  const flushEditableText = useCallback(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-layout-editable="true"]'
    );
    if (!el || !selectedLayoutId || !docRef.current) return;
    const html = el.innerHTML || '';
    const cur =
      docRef.current.pages[pageIndex]?.layouts?.find(
        (l) => l.layout_id === selectedLayoutId
      )?.text ?? '';
    if (html === cur) return;
    commitMergeText((draft) => {
      updateLayoutText(draft, pageIndex, selectedLayoutId, html);
    });
  }, [selectedLayoutId, pageIndex, commitMergeText]);

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
        setLayoutEditor(draft, pageIndex, selectedLayoutId, patch);
      });
    },
    [selectedLayoutId, pageIndex, commitMergeText]
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
        updateLayoutPosition(draft, pageIndex, selectedLayoutId, p);
      });
    },
    [selectedLayoutId, selectedLayout, pageIndex, commit]
  );

  const onLayoutFontSizeChange = useCallback(
    (raw: string) => {
      if (!selectedLayoutId) return;
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return;
      const px = `${Math.max(6, Math.min(64, Math.round(n)))}px`;
      commitMergeText((draft) => {
        setLayoutEditor(draft, pageIndex, selectedLayoutId, { fontSize: px });
      });
    },
    [selectedLayoutId, pageIndex, commitMergeText]
  );

  const onLayoutFontFamilyChange = useCallback(
    (fontFamily: string) => {
      if (!selectedLayoutId) return;
      commitMergeText((draft) => {
        setLayoutEditor(draft, pageIndex, selectedLayoutId, { fontFamily });
      });
    },
    [selectedLayoutId, pageIndex, commitMergeText]
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!doc || pageIndex <= 0}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
        >
          {t('parseDemoPrevPage')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!doc || pageIndex >= totalPages - 1}
          onClick={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
        >
          {t('parseDemoNextPage')}
        </Button>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          {t('parseDemoPage', { n: pageIndex + 1, total: Math.max(1, totalPages) })}
        </span>
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
          Select a text block on the canvas, then drag/resize or edit style in the toolbar.
        </p>
      ) : null}

      <div
        className={cn(
          'grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900',
          collapsed ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_minmax(0,1.2fr)]'
        )}
      >
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
        <div className="relative flex min-h-0 min-w-0 flex-col border-t border-zinc-200 dark:border-zinc-800 md:border-t-0 md:border-l">
          {doc ? (
            <ParseResultCanvas
              doc={doc}
              pageIndex={pageIndex}
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

      <aside className="flex max-h-[40vh] w-full shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950 md:max-h-none md:w-72 md:self-start">
        <ParseResultEditorToolbar
          disabled={!selectedLayoutId}
          onFlushBeforeFormat={flushEditableText}
          onEditorStylePatch={onEditorStylePatch}
          currentEditorStyle={selectedEditorStyle}
          inspectorControls={inspectorControls}
          extraFontControls={scaleControl}
        />
      </aside>
    </div>
  );
}
