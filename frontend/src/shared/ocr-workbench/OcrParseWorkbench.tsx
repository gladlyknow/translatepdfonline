'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslations } from 'next-intl';
import {
  Download,
  FileText,
  Loader2,
  Redo2,
  RotateCw,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { translateApi } from '@/shared/lib/translate-api';
import { cn } from '@/shared/lib/utils';
import {
  cloneParseResult,
  updateLayoutPosition,
  updateLayoutText,
} from '@/shared/ocr-workbench/parse-result-document';
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
  externalToolbarContainerId,
  canvasScalePercent,
  onCanvasScaleChange,
  onCanvasFocus,
}: {
  taskId: string | null;
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
    file?: string;
  };
  externalToolbarContainerId?: string;
  canvasScalePercent?: number;
  onCanvasScaleChange?: (next: number) => void;
  onCanvasFocus?: () => void;
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
  const [internalJsonCanvasScale, setInternalJsonCanvasScale] = useState(() => {
    if (typeof window === 'undefined') return 100;
    const v = Number.parseInt(
      window.localStorage.getItem(JSON_SCALE_KEY) || '100',
      10
    );
    return Number.isFinite(v) ? Math.max(30, Math.min(160, v)) : 100;
  });
  const jsonCanvasScale =
    typeof canvasScalePercent === 'number'
      ? Math.max(30, Math.min(160, Math.round(canvasScalePercent)))
      : internalJsonCanvasScale;
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportState, setExportState] = useState<{
    pdf: { status: 'idle' | 'processing' | 'ready' | 'failed'; error: string | null };
    md: { status: 'idle' | 'processing' | 'ready' | 'failed'; error: string | null };
  }>({
    pdf: { status: 'idle', error: null },
    md: { status: 'idle', error: null },
  });
  const exportPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const res = await fetch(parseResultUrl, { credentials: 'include' });
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

  const clearExportPollTimer = useCallback(() => {
    if (exportPollTimerRef.current) {
      clearTimeout(exportPollTimerRef.current);
      exportPollTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearExportPollTimer, [clearExportPollTimer]);

  const setSingleExportState = useCallback(
    (
      format: 'pdf' | 'md',
      next: { status: 'idle' | 'processing' | 'ready' | 'failed'; error: string | null }
    ) => {
      setExportState((prev) => ({ ...prev, [format]: next }));
    },
    []
  );

  const pollExportReady = useCallback(
    async (format: 'pdf' | 'md', attempt = 0) => {
      if (!taskId) return;
      const exportsState = await translateApi.listOcrTaskExports(taskId);
      const target = exportsState.exports.find((one) => one.format === format);
      if (!target) {
        setSingleExportState(format, {
          status: 'failed',
          error: `${format.toUpperCase()} export not found`,
        });
        return;
      }
      if (target.status === 'ready') {
        setSingleExportState(format, { status: 'ready', error: null });
        clearExportPollTimer();
        return;
      }
      if (target.status === 'cancelled') {
        setSingleExportState(format, { status: 'idle', error: null });
        clearExportPollTimer();
        return;
      }
      if (target.status === 'failed') {
        setSingleExportState(format, {
          status: 'failed',
          error: target.error_message ?? `${format.toUpperCase()} export failed`,
        });
        clearExportPollTimer();
        return;
      }
      if (attempt >= 30) {
        setSingleExportState(format, {
          status: 'failed',
          error: `${format.toUpperCase()} export timed out`,
        });
        clearExportPollTimer();
        return;
      }
      setSingleExportState(format, { status: 'processing', error: null });
      clearExportPollTimer();
      exportPollTimerRef.current = setTimeout(() => {
        void pollExportReady(format, attempt + 1);
      }, 4000);
    },
    [clearExportPollTimer, setSingleExportState, taskId]
  );

  const startExport = useCallback(async (format: 'pdf' | 'md') => {
    if (!taskId || exportState[format].status === 'processing') return;
    setSingleExportState(format, { status: 'processing', error: null });
    try {
      // Ensure export is generated from the latest workbench edits.
      if (docRef.current) {
        flushSync(() => {
          flushEditableText();
        });
        const payload = cloneParseResult(docRef.current) as unknown;
        await translateApi.patchOcrParseResult(taskId, payload);
      }
      await translateApi.retryOcrTaskExport(taskId, format);
      await pollExportReady(format, 0);
    } catch (e) {
      setSingleExportState(format, {
        status: 'failed',
        error: e instanceof Error ? e.message : `${format.toUpperCase()} export failed`,
      });
      clearExportPollTimer();
    }
  }, [
    clearExportPollTimer,
    exportState,
    flushEditableText,
    pollExportReady,
    setSingleExportState,
    taskId,
  ]);

  const handleDownloadExport = useCallback(
    async (format: 'pdf' | 'md') => {
      if (!taskId) return;
      try {
        const dl = await translateApi.getOcrTaskExportDownloadUrl(taskId, format);
        window.open(dl.download_url, '_blank', 'noopener,noreferrer');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `${format.toUpperCase()} download failed`);
      }
    },
    [taskId]
  );

  const cancelExport = useCallback(
    async (format: 'pdf' | 'md') => {
      if (!taskId) return;
      try {
        await translateApi.cancelOcrTaskExport(taskId, format);
        clearExportPollTimer();
        setSingleExportState(format, { status: 'idle', error: null });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Cancel failed');
      }
    },
    [clearExportPollTimer, setSingleExportState, taskId]
  );

  const deleteExport = useCallback(
    async (format: 'pdf' | 'md') => {
      if (!taskId) return;
      try {
        await translateApi.deleteOcrTaskExport(taskId, format);
        setSingleExportState(format, { status: 'idle', error: null });
        toast.success(
          format === 'pdf' ? 'PDF export removed' : 'Markdown export removed'
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [setSingleExportState, taskId]
  );

  useEffect(() => {
    if (!taskId) {
      setExportState({
        pdf: { status: 'idle', error: null },
        md: { status: 'idle', error: null },
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const exportsState = await translateApi.listOcrTaskExports(taskId);
        if (cancelled) return;
        const next: {
          pdf: { status: 'idle' | 'processing' | 'ready' | 'failed'; error: string | null };
          md: { status: 'idle' | 'processing' | 'ready' | 'failed'; error: string | null };
        } = {
          pdf: { status: 'idle', error: null },
          md: { status: 'idle', error: null },
        };
        const pdf = exportsState.exports.find((one) => one.format === 'pdf');
        const md = exportsState.exports.find((one) => one.format === 'md');
        if (pdf) {
          const nextPdfStatus =
            pdf.status === 'ready'
              ? 'ready'
              : pdf.status === 'cancelled'
                ? 'idle'
              : pdf.status === 'failed'
                ? 'failed'
                : pdf.status === 'pending' ||
                    pdf.status === 'processing' ||
                    exportState.pdf.status === 'processing'
                  ? 'processing'
                  : 'idle';
          next.pdf = {
            status: nextPdfStatus,
            error:
              pdf.status === 'cancelled'
                ? null
                : (pdf.error_message ?? null),
          };
        }
        if (md) {
          const nextMdStatus =
            md.status === 'ready'
              ? 'ready'
              : md.status === 'cancelled'
                ? 'idle'
              : md.status === 'failed'
                ? 'failed'
                : md.status === 'pending' ||
                    md.status === 'processing' ||
                    exportState.md.status === 'processing'
                  ? 'processing'
                  : 'idle';
          next.md = {
            status: nextMdStatus,
            error:
              md.status === 'cancelled'
                ? null
                : (md.error_message ?? null),
          };
        }
        setExportState(next);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exportState.md.status, exportState.pdf.status, taskId]);

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
    if (!docRef.current || !taskId) return;
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
            if (onCanvasScaleChange) {
              onCanvasScaleChange(n);
            } else {
              setInternalJsonCanvasScale(n);
            }
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
    [jsonCanvasScale, onCanvasScaleChange, t]
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
            disabled={!doc || saving || !taskId}
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
        <div className="space-y-2">
          <div className="rounded-md border border-emerald-200/80 bg-emerald-50/60 p-2 dark:border-emerald-900/50 dark:bg-emerald-950/25">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
              Markdown
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {exportState.md.status === 'ready' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="border border-emerald-400 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                    disabled={!taskId}
                    onClick={() => void handleDownloadExport('md')}
                  >
                    <Download className="mr-1 size-3.5" />
                    Download
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!taskId}
                    title="Remove exported file"
                    onClick={() => void deleteExport('md')}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              ) : exportState.md.status === 'processing' ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-emerald-700 dark:text-emerald-400" />
                  <span className="text-[11px] text-emerald-900 dark:text-emerald-200">
                    Exporting…
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={!taskId}
                    onClick={() => void cancelExport('md')}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!taskId}
                    onClick={() => void startExport('md')}
                    className="border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-100"
                  >
                    {exportState.md.status === 'failed' ? (
                      <RotateCw className="mr-1 size-3.5" />
                    ) : (
                      <FileText className="mr-1 size-3.5" />
                    )}
                    {exportState.md.status === 'failed' ? 'Retry' : 'Export'}
                  </Button>
                  {exportState.md.error ? (
                    <span className="max-w-[14rem] text-[11px] text-red-600 dark:text-red-400">
                      {exportState.md.error}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <div className="rounded-md border border-blue-200/80 bg-blue-50/60 p-2 dark:border-blue-900/50 dark:bg-blue-950/25">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300">
              PDF
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {exportState.pdf.status === 'ready' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="border border-blue-400 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
                    disabled={!taskId}
                    onClick={() => void handleDownloadExport('pdf')}
                  >
                    <Download className="mr-1 size-3.5" />
                    Download
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!taskId}
                    title="Remove exported file"
                    onClick={() => void deleteExport('pdf')}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              ) : exportState.pdf.status === 'processing' ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-blue-700 dark:text-blue-400" />
                  <span className="text-[11px] text-blue-900 dark:text-blue-200">
                    Exporting…
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={!taskId}
                    onClick={() => void cancelExport('pdf')}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!taskId}
                    onClick={() => void startExport('pdf')}
                    className="border border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-100"
                  >
                    {exportState.pdf.status === 'failed' ? (
                      <RotateCw className="mr-1 size-3.5" />
                    ) : (
                      <img src="/brand/local/pdf.png" alt="" className="mr-1 h-3.5 w-3.5" />
                    )}
                    {exportState.pdf.status === 'failed' ? 'Retry' : 'Export'}
                  </Button>
                  {exportState.pdf.error ? (
                    <span className="max-w-[14rem] text-[11px] text-red-600 dark:text-red-400">
                      {exportState.pdf.error}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    ),
    [
      canRedo,
      canUndo,
      doc,
      exportState,
      cancelExport,
      deleteExport,
      handleDownloadExport,
      redo,
      saveToServer,
      saving,
      startExport,
      t,
      taskId,
      undo,
    ]
  );
  const showTopPageControls = !(toolbarPosition === 'left' && hideSourcePanel);
  const showLeftToolbar = toolbarPosition === 'left' && hideSourcePanel;
  const showTopFileActions = !showLeftToolbar;
  const [externalToolbarHost, setExternalToolbarHost] = useState<HTMLElement | null>(
    null
  );
  useEffect(() => {
    if (!externalToolbarContainerId || typeof document === 'undefined') {
      setExternalToolbarHost(null);
      return;
    }
    setExternalToolbarHost(document.getElementById(externalToolbarContainerId));
  }, [externalToolbarContainerId, loadState, taskId, parseResultUrl]);
  const shouldUseExternalToolbar = showLeftToolbar && Boolean(externalToolbarHost);
  const toolbarContent = (
    <ParseResultEditorToolbar
      disabled={!selectedLayoutId}
      onFlushBeforeFormat={flushEditableText}
      onEditorStylePatch={onEditorStylePatch}
      currentEditorStyle={selectedEditorStyle}
      fileControls={fileControls}
      sectionIds={toolbarSectionIds}
    />
  );

  const renderStatusWithToolbar = (
    panel: ReactNode,
    tone: 'normal' | 'error' = 'normal'
  ) => (
    <div
      className={cn(
        'min-h-0 min-w-0 flex-1',
        showLeftToolbar ? 'flex flex-col gap-2 md:flex-row' : 'flex'
      )}
    >
      {showLeftToolbar &&
      !externalToolbarContainerId &&
      !shouldUseExternalToolbar ? (
        <aside
          id={toolbarId}
          className="flex w-full shrink-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950 md:sticky md:top-2 md:h-[calc(100vh-9rem)] md:w-72 md:self-start md:overflow-y-auto"
        >
          <ParseResultEditorToolbar disabled currentEditorStyle={{}} sectionIds={toolbarSectionIds} />
        </aside>
      ) : null}
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 items-center rounded-lg border p-3',
          tone === 'error'
            ? 'border-red-200 bg-red-50/90 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200'
            : 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
        )}
      >
        {panel}
      </div>
    </div>
  );

  if (!parseResultUrl) {
    return renderStatusWithToolbar(
      <p className="text-sm">{t('noParseUrl')}</p>
    );
  }

  if (loadState === 'loading' || loadState === 'idle') {
    return renderStatusWithToolbar(
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t('loadingParse')}
      </div>
    );
  }

  if (loadState === 'error') {
    return renderStatusWithToolbar(
      <div>
        <p className="text-sm font-medium">{t('parseFailedTitle')}</p>
        <p className="mt-1 text-xs opacity-90">{loadError}</p>
      </div>,
      'error'
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
        {showTopFileActions ? (
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                !taskId ||
                exportState.md.status === 'processing' ||
                exportState.pdf.status === 'processing'
              }
              onClick={() =>
                exportState.md.status === 'ready'
                  ? void handleDownloadExport('md')
                  : void startExport('md')
              }
            >
              {exportState.md.status === 'ready'
                ? 'MD · Download'
                : exportState.md.status === 'failed'
                  ? 'MD · Retry'
                  : 'MD · Export'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                !taskId ||
                exportState.md.status === 'processing' ||
                exportState.pdf.status === 'processing'
              }
              onClick={() =>
                exportState.pdf.status === 'ready'
                  ? void handleDownloadExport('pdf')
                  : void startExport('pdf')
              }
            >
              {exportState.pdf.status === 'ready'
                ? 'PDF · Download'
                : exportState.pdf.status === 'failed'
                  ? 'PDF · Retry'
                  : 'PDF · Export'}
            </Button>
          </div>
        ) : null}
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
        {showLeftToolbar &&
        !externalToolbarContainerId &&
        !shouldUseExternalToolbar ? (
          <aside
            id={toolbarId}
            className="flex w-full shrink-0 flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50/95 p-1.5 dark:border-zinc-800 dark:bg-zinc-950 md:sticky md:top-2 md:h-[calc(100vh-9rem)] md:w-64 md:self-start md:overflow-y-auto"
          >
            {toolbarContent}
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
                onActivate={() => onCanvasFocus?.()}
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
              'flex w-full shrink-0 flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50/95 p-1.5 dark:border-zinc-800 dark:bg-zinc-950 md:sticky md:top-2 md:h-[calc(100vh-9rem)] md:overflow-y-auto',
              hideSourcePanel ? 'md:w-full md:self-stretch' : 'md:w-72 md:self-start'
            )}
          >
            <ParseResultEditorToolbar
              disabled={!selectedLayoutId}
              onFlushBeforeFormat={flushEditableText}
              onEditorStylePatch={onEditorStylePatch}
              currentEditorStyle={selectedEditorStyle}
              fileControls={fileControls}
              sectionIds={toolbarSectionIds}
            />
          </aside>
        ) : null}
        {shouldUseExternalToolbar && externalToolbarHost
          ? createPortal(
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/95 p-1.5 dark:border-zinc-800 dark:bg-zinc-950">
                {toolbarContent}
              </div>,
              externalToolbarHost
            )
          : null}
      </div>
    </div>
  );
}
