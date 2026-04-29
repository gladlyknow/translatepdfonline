'use client';

import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/core/i18n/navigation';
import { useSession } from '@/core/auth/client';
import { useAppContext } from '@/shared/contexts/app';
import { useTranslateFooterWorkbenchOptional } from '@/shared/contexts/translate-footer-workbench';
import { useTranslateHeaderAppearance } from '@/shared/contexts/translate-header-appearance';
import { useTranslateShellChromeOptional } from '@/shared/contexts/translate-shell-chrome';
import { UploadDropzone } from '@/shared/components/translate/UploadDropzone';
import { LanguageSelector } from '@/shared/components/translate/LanguageSelector';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';
import { cn } from '@/shared/lib/utils';
import {
  translateApi,
  type TaskDetail,
  type TaskView,
  type UILang,
} from '@/shared/lib/translate-api';
import { toSupportedUiLang } from '@/shared/lib/translate-langs';
import {
  Loader2,
  Trash2,
  RefreshCw,
  Languages,
} from 'lucide-react';

const PdfViewerPane = dynamic(
  () =>
    import('@/shared/components/translate/PdfViewerPane').then((m) => ({
      default: m.PdfViewerPane,
    })),
  { ssr: false }
);

const OcrParseWorkbench = dynamic(
  () =>
    import('@/shared/ocr-workbench/OcrParseWorkbench').then((m) => ({
      default: m.OcrParseWorkbench,
    })),
  { ssr: false }
);

const TASK_PARAM = 'task';
const DOC_PARAM = 'document';
const SOURCE_LANG_PARAM = 'source_lang';
const TARGET_LANG_PARAM = 'target_lang';
const POLL_INTERVAL_MS_ACTIVE = 10_000;
const PREVIEW_PAGE_DEBOUNCE_MS = 400;
const OCR_TOOLBAR_ID = 'ocr-workbench-toolbar';
const OCR_TOOLBAR_HOST_ID = 'ocr-workbench-toolbar-host';
const OCR_TOOLBAR_TEXT_EDIT_ID = 'ocr-workbench-toolbar-text-edit';
const OCR_TOOLBAR_FONT_SETTINGS_ID = 'ocr-workbench-toolbar-font-settings';
const OCR_TOOLBAR_FILE_ID = 'ocr-workbench-toolbar-file';
const HISTORY_PAGE_SIZE = 3;
type OcrFocusPanel = 'json' | 'source';

type OcrUiLog = {
  at: string;
  stage: string;
  status: string;
  message: string;
};

function sanitizeUiLogMessage(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '[path]')
    .replace(/(?:^|[\s"'`])(\/[^\s"'`]+)+/g, ' [path]')
    .replace(/translations\/[^\s"'`]+/gi, '[object_key]')
    .slice(0, 220);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function toLang(v: string | null): UILang | '' {
  return toSupportedUiLang(v);
}

/** 与 JSON 画布 scale 解耦，避免拖动滑块时整页重绘导致左侧 pdf.js 闪屏 */
const OcrSourcePdfPanel = memo(function OcrSourcePdfPanel({
  sourceLabel,
  documentId,
  currentPage,
  sourcePdfUrl,
  effectiveDocumentPageCount,
  pdfZoom,
  onSourcePageChange,
  onPdfNumPages,
  onScaleChange,
  onFocusSource,
}: {
  sourceLabel: string;
  documentId: string | null;
  currentPage: number;
  sourcePdfUrl: string;
  effectiveDocumentPageCount: number;
  pdfZoom: number;
  onSourcePageChange: (p: number) => void;
  onPdfNumPages: (n: number | null) => void;
  onScaleChange: (next: number) => void;
  onFocusSource: () => void;
}) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
      onClick={onFocusSource}
    >
      <p className="shrink-0 border-b border-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        {sourceLabel}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] p-2">
        <PdfViewerPane
          key={`source-ocr-${documentId}-${currentPage}`}
          fileUrl={sourcePdfUrl ?? ''}
          mode="source"
          page={currentPage}
          onPageChange={onSourcePageChange}
          totalPages={
            effectiveDocumentPageCount > 0 ? effectiveDocumentPageCount : undefined
          }
          onPdfNumPages={onPdfNumPages}
          scale={pdfZoom}
          onScaleChange={onScaleChange}
          showZoomControls={false}
          showPageControls={false}
        />
      </div>
    </div>
  );
});

export function OcrTranslatePageClient() {
  const t = useTranslations('translate.task');
  const tHome = useTranslations('translate.home');
  const tTranslate = useTranslations('translate.translate');
  const tPdf = useTranslations('translate.pdfViewer');
  const tOcrWb = useTranslations('translate.ocrWorkbench');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user, fetchUserCredits, fetchUserInfo } = useAppContext();
  const { data: session, isPending: sessionPending } = useSession();
  const sessionUserId = session?.user?.id ?? null;
  const { setAppearance } = useTranslateHeaderAppearance();
  const footerWorkbench = useTranslateFooterWorkbenchOptional();
  const shellChrome = useTranslateShellChromeOptional();
  const { resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);

  const [sourceLang, setSourceLang] = useState<UILang | ''>('');
  const [targetLang, setTargetLang] = useState<UILang | ''>('');
  const [pdfZoom, setPdfZoom] = useState(1);
  const [jsonCanvasScale, setJsonCanvasScale] = useState(100);
  const [activeFocusPanel, setActiveFocusPanel] = useState<OcrFocusPanel>('json');

  const [documentId, setDocumentId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskView, setTaskView] = useState<TaskView | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [jsonPage, setJsonPage] = useState(1);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [documentCreatedAt, setDocumentCreatedAt] = useState<string | null>(
    null
  );
  const [documentSizeBytes, setDocumentSizeBytes] = useState<number | null>(
    null
  );
  const [sourceSliceUrl, setSourceSliceUrl] = useState<string>('');
  const [sourceTotalPages, setSourceTotalPages] = useState<number>(0);
  const [sourceNumPagesFromViewer, setSourceNumPagesFromViewer] = useState<
    number | null
  >(null);
  const [documentPageCountFromDb, setDocumentPageCountFromDb] = useState<
    number | null
  >(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stableParseResultUrl, setStableParseResultUrl] = useState<string | null>(
    null
  );
  const [lastResumeStage, setLastResumeStage] = useState<string | null>(null);
  const [historyLogOpen, setHistoryLogOpen] = useState(false);
  const [recentOcrTasks, setRecentOcrTasks] = useState<
    Array<{
      id: string;
      status: string;
      progress_stage?: string | null;
      updated_at?: string | null;
      created_at: string;
    }>
  >([]);
  const [recentDocuments, setRecentDocuments] = useState<
    Array<{
      id: string;
      filename: string;
      size_bytes: number;
      created_at: string;
    }>
  >([]);
  const [recentTaskPage, setRecentTaskPage] = useState(0);
  const [recentDocumentPage, setRecentDocumentPage] = useState(0);
  const isRecentRequested = searchParams.get('recent') === '1';
  const [recentBootstrapDone, setRecentBootstrapDone] = useState(
    !isRecentRequested
  );

  useEffect(() => {
    setRecentBootstrapDone(!isRecentRequested);
  }, [isRecentRequested]);

  const blockAutoDocumentLoadRef = useRef(false);
  const startOcrLockRef = useRef(false);
  const taskViewRef = useRef<TaskView | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollInFlightRef = useRef(false);
  const pollNextAllowedAtRef = useRef(0);

  const setTaskViewStable = useCallback((next: TaskView | null) => {
    if (!next) {
      setTaskView(null);
      return;
    }
    setTaskView((prev) => {
      if (!prev) return next;
      const mergedOutputs =
        Array.isArray(next.outputs) && next.outputs.length > 0
          ? next.outputs
          : prev.outputs;
      return {
        ...next,
        // 避免轮询时 presigned URL 频繁刷新导致 workbench 每次重载闪烁
        ocr_parse_result_url: prev.ocr_parse_result_url || next.ocr_parse_result_url,
        source_pdf_url: prev.source_pdf_url || next.source_pdf_url,
        primary_file_url: next.primary_file_url || prev.primary_file_url,
        outputs: mergedOutputs,
        can_download:
          next.can_download ??
          (Array.isArray(mergedOutputs) && mergedOutputs.length > 0),
      };
    });
  }, []);

  useEffect(() => {
    taskViewRef.current = taskView;
  }, [taskView]);

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  useEffect(() => {
    if (!themeMounted) return;
    if (documentId) {
      setAppearance('onLight');
      return;
    }
    setAppearance(resolvedTheme === 'dark' ? 'onDark' : 'onLight');
  }, [documentId, resolvedTheme, themeMounted, setAppearance]);

  useEffect(() => {
    footerWorkbench?.setWorkbenchOpen(Boolean(documentId));
  }, [documentId, footerWorkbench?.setWorkbenchOpen]);

  useEffect(() => {
    if (!shellChrome?.setHeaderCollapsed) return;
    shellChrome.setHeaderCollapsed(true);
    return () => shellChrome.setHeaderCollapsed(false);
  }, [shellChrome?.setHeaderCollapsed]);

  useEffect(() => {
    if (!sessionUserId && !user?.id) return;
    if (!user?.id) {
      void fetchUserInfo();
      return;
    }
    void fetchUserCredits();
  }, [sessionUserId, user?.id, fetchUserCredits, fetchUserInfo]);

  useEffect(() => {
    if (taskStatus === 'completed' && (user?.id || sessionUserId)) {
      void fetchUserCredits();
    }
  }, [taskStatus, user?.id, sessionUserId, fetchUserCredits]);

  const effectiveDocumentPageCount = useMemo(
    () =>
      Math.max(
        sourceTotalPages,
        sourceNumPagesFromViewer ?? 0,
        documentPageCountFromDb != null && documentPageCountFromDb > 0
          ? documentPageCountFromDb
          : 0
      ),
    [sourceTotalPages, sourceNumPagesFromViewer, documentPageCountFromDb]
  );

  const debouncedSourcePage = useDebouncedValue(
    currentPage,
    PREVIEW_PAGE_DEBOUNCE_MS
  );

  const updateTaskInUrl = useCallback(
    (tid: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tid) params.set(TASK_PARAM, tid);
      else params.delete(TASK_PARAM);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [searchParams, pathname, router]
  );

  useEffect(() => {
    const tid = searchParams.get(TASK_PARAM);
    if (!tid || taskId === tid) return;
    let cancelled = false;
    const restore = async () => {
      try {
        const [detail, view] = await Promise.all([
          translateApi.getTask(tid),
          translateApi.getTaskView(tid).catch(() => null),
        ]);
        if (cancelled) return;
        setTaskId(tid);
        setTaskStatus(detail.status);
        setTaskDetail(detail);
        if (view) {
          setTaskViewStable(view);
          blockAutoDocumentLoadRef.current = false;
          setDocumentId(detail.document_id);
          setFilename(view.document_filename);
          setLastUploadedFile({
            name: view.document_filename,
            size: view.document_size_bytes ?? 0,
          });
          if (!sourceLang) setSourceLang(toLang(detail.source_lang));
          if (!targetLang) setTargetLang(toLang(detail.target_lang));
        }
      } catch {
        if (!cancelled) {
          const params = new URLSearchParams(searchParams.toString());
          params.delete(TASK_PARAM);
          router.replace(params.toString() ? `${pathname}?${params}` : pathname);
        }
      }
    };
    restore();
    return () => {
      cancelled = true;
    };
  }, [searchParams, pathname, router, sourceLang, targetLang, taskId, setTaskViewStable]);

  useEffect(() => {
    const qDoc = searchParams.get(DOC_PARAM);
    if (qDoc && !documentId) {
      setDocumentId(qDoc);
    }
    const qSource = toLang(searchParams.get(SOURCE_LANG_PARAM));
    const qTarget = toLang(searchParams.get(TARGET_LANG_PARAM));
    if (qSource && !sourceLang) setSourceLang(qSource);
    if (qTarget && !targetLang) setTargetLang(qTarget);
  }, [searchParams, documentId, sourceLang, targetLang]);

  useEffect(() => {
    if (taskView?.ocr_parse_result_url) {
      setStableParseResultUrl(taskView.ocr_parse_result_url);
    }
  }, [taskView?.ocr_parse_result_url]);

  useEffect(() => {
    setStableParseResultUrl(null);
  }, [taskId]);

  useEffect(() => {
    if (searchParams.get(TASK_PARAM)) return;
    if (taskId) return;
    let cancelled = false;
    (async () => {
      try {
        const recent = await translateApi.listTasks({
          limit: 30,
          offset: 0,
          ocrOnly: true,
        });
        if (cancelled || recent.length === 0) return;
        let latest: { id: string } | null = null;
        for (const one of recent) {
          const detail = await translateApi.getTask(one.id).catch(() => null);
          if (cancelled || !detail) continue;
          // OCR 页面只允许加载 OCR 任务
          if (detail.preprocess_with_ocr !== true) continue;
          latest = one;
          break;
        }
        if (!latest) {
          const docs = await translateApi.listDocuments({ limit: 1, offset: 0 });
          if (!cancelled && docs.length === 0 && isRecentRequested) {
            router.replace('/upload');
          }
          return;
        }
        const [detail, view] = await Promise.all([
          translateApi.getTask(latest.id),
          translateApi.getTaskView(latest.id).catch(() => null),
        ]);
        if (cancelled) return;
        setTaskId(latest.id);
        setTaskStatus(detail.status);
        setTaskDetail(detail);
        updateTaskInUrl(latest.id);
        if (view) {
          setTaskViewStable(view);
          setDocumentId(detail.document_id);
          setFilename(view.document_filename);
          setLastUploadedFile({
            name: view.document_filename,
            size: view.document_size_bytes ?? 0,
          });
        }
      } catch {
        if (!cancelled && isRecentRequested) {
          router.replace('/upload');
        }
      } finally {
        if (!cancelled && isRecentRequested) {
          setRecentBootstrapDone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isRecentRequested, searchParams, taskId, updateTaskInUrl, setTaskViewStable]);

  useEffect(() => {
    if (documentId) return;
    if (searchParams.get(TASK_PARAM)) return;
    if (blockAutoDocumentLoadRef.current) return;
    let cancelled = false;
    translateApi
      .listDocuments()
      .then((docs) => {
        if (!cancelled && docs.length > 0) {
          const doc = docs[0];
          setDocumentId(doc.id);
          setFilename(doc.filename);
          setLastUploadedFile({ name: doc.filename, size: doc.size_bytes });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [documentId, searchParams]);

  useEffect(() => {
    if (!documentId) {
      setDocumentCreatedAt(null);
      setDocumentSizeBytes(null);
      setDocumentPageCountFromDb(null);
      return;
    }
    let cancelled = false;
    translateApi
      .getDocument(documentId)
      .then((doc) => {
        if (!cancelled) {
          setDocumentCreatedAt(doc.created_at ?? null);
          setDocumentSizeBytes(doc.size_bytes ?? null);
          const pc = doc.page_count;
          setDocumentPageCountFromDb(
            typeof pc === 'number' && pc > 0 ? pc : null
          );
          setFilename(doc.filename);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDocumentCreatedAt(null);
          setDocumentSizeBytes(null);
          setDocumentPageCountFromDb(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    setSourceNumPagesFromViewer(null);
  }, [documentId]);

  useEffect(() => {
    if (!documentId || debouncedSourcePage < 1) {
      setSourceSliceUrl('');
      setSourceTotalPages(0);
      return;
    }
    let cancelled = false;
    translateApi
      .getDocumentPreviewUrl(documentId, debouncedSourcePage)
      .then((res) => {
        if (cancelled) return;
        setSourceSliceUrl((prev) =>
          prev === res.preview_url ? prev : res.preview_url
        );
        setSourceTotalPages((prev) =>
          prev === res.total_pages ? prev : res.total_pages
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSourceSliceUrl('');
          setSourceTotalPages(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, debouncedSourcePage]);

  useEffect(() => {
    setJsonPage(1);
  }, [taskId, documentId]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const clearPollTimer = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    const schedulePoll = (delayMs: number) => {
      if (cancelled) return;
      clearPollTimer();
      pollTimerRef.current = setTimeout(() => {
        void poll();
      }, Math.max(0, delayMs));
    };
    const poll = async () => {
      if (cancelled) return;
      if (pollInFlightRef.current) {
        schedulePoll(POLL_INTERVAL_MS_ACTIVE);
        return;
      }
      const now = Date.now();
      if (now < pollNextAllowedAtRef.current) {
        schedulePoll(pollNextAllowedAtRef.current - now);
        return;
      }
      pollInFlightRef.current = true;
      try {
        const detail = await translateApi.getTask(taskId);
        if (cancelled) return;
        setTaskStatus(detail.status);
        setTaskDetail(detail);
        let shouldContinue = true;
        if (
          detail.status === 'completed' ||
          detail.status === 'failed' ||
          detail.status === 'cancelled'
        ) {
          if (detail.status === 'completed') {
            let currentView = taskViewRef.current;
            if (!currentView || !currentView.ocr_parse_result_url) {
              const view = await translateApi.getTaskView(taskId).catch(() => null);
              if (!cancelled && view) {
                setTaskViewStable(view);
                currentView = view;
              }
            }
            shouldContinue = !Boolean(currentView?.ocr_parse_result_url);
          } else {
            if (!taskViewRef.current) {
              const view = await translateApi.getTaskView(taskId).catch(() => null);
              if (!cancelled && view) {
                setTaskViewStable(view);
              }
            }
            shouldContinue = false;
          }
        }
        if (!cancelled && shouldContinue) {
          pollNextAllowedAtRef.current = Date.now() + POLL_INTERVAL_MS_ACTIVE;
          schedulePoll(POLL_INTERVAL_MS_ACTIVE);
        }
      } catch {
        if (!cancelled) {
          pollNextAllowedAtRef.current = Date.now() + POLL_INTERVAL_MS_ACTIVE;
          schedulePoll(POLL_INTERVAL_MS_ACTIVE);
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };
    pollNextAllowedAtRef.current = 0;
    void poll();
    return () => {
      cancelled = true;
      clearPollTimer();
      pollInFlightRef.current = false;
    };
  }, [taskId, setTaskViewStable]);

  useEffect(() => {
    if (!historyLogOpen) return;
    let cancelled = false;
    const loadRecent = async () => {
      try {
        const [tasks, docs] = await Promise.all([
          translateApi.listTasks({
            limit: HISTORY_PAGE_SIZE,
            offset: recentTaskPage * HISTORY_PAGE_SIZE,
            ocrOnly: true,
          }),
          translateApi.listDocuments({
            limit: HISTORY_PAGE_SIZE,
            offset: recentDocumentPage * HISTORY_PAGE_SIZE,
          }),
        ]);
        if (cancelled) return;
        const normalized = tasks.map((one) => ({
            id: one.id,
            status: one.status,
            progress_stage: null,
            updated_at: one.updated_at ?? null,
            created_at: one.created_at,
          }));
        setRecentOcrTasks(normalized);
        setRecentDocuments(
          docs.map((one) => ({
            id: one.id,
            filename: one.filename,
            size_bytes: one.size_bytes,
            created_at: one.created_at,
          }))
        );
      } catch {
        if (!cancelled) {
          setRecentOcrTasks([]);
          setRecentDocuments([]);
        }
      }
    };
    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [historyLogOpen, taskId, taskStatus, recentTaskPage, recentDocumentPage]);

  useEffect(() => {
    if (!historyLogOpen) return;
    setRecentTaskPage(0);
    setRecentDocumentPage(0);
  }, [historyLogOpen]);

  const handleRefreshResult = async () => {
    if (!taskId || refreshing) return;
    setRefreshing(true);
    try {
      const detail = await translateApi.getTask(taskId);
      setTaskStatus(detail.status);
      setTaskDetail(detail);
      if (
        detail.status === 'completed' ||
        detail.status === 'failed' ||
        detail.status === 'cancelled'
      ) {
        const view = await translateApi.getTaskView(taskId).catch(() => null);
        if (view) setTaskViewStable(view);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleUploaded = (
    docId: string,
    name: string,
    sizeBytes: number,
    _file?: File
  ) => {
    blockAutoDocumentLoadRef.current = false;
    setDocumentId(docId);
    setFilename(name);
    setLastUploadedFile({ name, size: sizeBytes });
    setTaskId(null);
    setTaskView(null);
    setTaskDetail(null);
    setTaskStatus(null);
    setSubmitError(null);
    updateTaskInUrl(null);
  };

  const handleDeleteDocument = async () => {
    if (!documentId || deletingDocId) return;
    if (!window.confirm(tHome('deleteDocumentConfirm'))) return;
    setDeletingDocId(documentId);
    try {
      await translateApi.deleteDocument(documentId);
      blockAutoDocumentLoadRef.current = true;
      setCurrentPage(1);
      setDocumentId(null);
      setFilename(null);
      setLastUploadedFile(null);
      setTaskId(null);
      setTaskView(null);
      setTaskDetail(null);
      setTaskStatus(null);
      updateTaskInUrl(null);
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleDeleteRecentTask = useCallback(async (id: string) => {
    await translateApi.deleteTask(id);
    setRecentOcrTasks((prev) => prev.filter((one) => one.id !== id));
  }, []);

  const handleDeleteRecentDocument = useCallback(async (id: string) => {
    await translateApi.deleteDocument(id);
    setRecentDocuments((prev) => prev.filter((one) => one.id !== id));
    if (documentId === id) {
      setDocumentId(null);
      setFilename(null);
      setLastUploadedFile(null);
      setTaskId(null);
      setTaskView(null);
      setTaskDetail(null);
      setTaskStatus(null);
      updateTaskInUrl(null);
    }
  }, [documentId, updateTaskInUrl]);

  const startOcrTask = async () => {
    if (!documentId || !sourceLang || starting || startOcrLockRef.current) return;
    startOcrLockRef.current = true;
    setStarting(true);
    setSubmitError(null);
    try {
      const res = await translateApi.createOcrTask(
        documentId,
        sourceLang,
        targetLang
      );
      setTaskId(res.task_id);
      setTaskStatus('queued');
      setTaskDetail(null);
      setTaskView(null);
      updateTaskInUrl(res.task_id);
    } catch (e) {
      const err = e as Error & {
        status?: number;
        body?: Record<string, unknown>;
      };
      if (err.status === 402) {
        const body = err.body ?? {};
        const need = typeof body.need === 'number' ? body.need : null;
        const have = typeof body.have === 'number' ? body.have : null;
        if (need != null && have != null) {
          setSubmitError(
            tTranslate('creditsModalIntro', {
              shortfall: String(Math.max(0, need - have)),
              need: String(need),
              have: String(have),
            })
          );
        } else {
          setSubmitError(tTranslate('creditsModalIntroGeneric'));
        }
      } else if (
        err.status === 400 &&
        typeof err.body?.code === 'string' &&
        err.body.code === 'document_pages_required_for_billing'
      ) {
        setSubmitError(tTranslate('documentPagesUnknown'));
      } else {
        setSubmitError(
          e instanceof Error ? e.message : tTranslate('createTaskFailed')
        );
      }
    } finally {
      setStarting(false);
      startOcrLockRef.current = false;
    }
  };

  const taskAwaitingResult =
    Boolean(taskId) &&
    (taskStatus == null || taskStatus === 'queued' || taskStatus === 'processing');

  const handleRequireSignInForUpload = () => {
    const qs = searchParams.toString();
    const redirectTo = qs ? `${pathname}?${qs}` : pathname;
    router.push(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
  };

  const statusLabel = (s: string) => {
    const keyMap: Record<string, string> = {
      queued: 'queued',
      processing: 'processing',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
    };
    return t(keyMap[s] ?? 'status');
  };

  const stageLabel = useCallback(
    (stage: string) => {
      const keyMap: Record<string, string> = {
        ocr_submit_poll: 'stageOcrSubmitPoll',
        ocr_parse_persisted: 'stageOcrParsePersisted',
        translate_markdown: 'stageTranslateMarkdown',
        export_outputs: 'stageExportOutputs',
        completed: 'stageCompleted',
        task_created: 'stageTaskCreated',
      };
      const key = keyMap[stage];
      if (key) return tOcrWb(key);
      return stage.replace(/_/g, ' ');
    },
    [tOcrWb]
  );

  const logStatusLabel = useCallback(
    (status: string) => {
      const keyMap: Record<string, string> = {
        info: 'statusInfo',
        retry: 'statusRetry',
        queued: 'statusQueued',
        processing: 'statusProcessing',
        completed: 'statusCompleted',
        failed: 'statusFailed',
        cancelled: 'statusCancelled',
      };
      const key = keyMap[status];
      if (key) return tOcrWb(key);
      return status;
    },
    [tOcrWb]
  );

  const taskProgress = (() => {
    if (!taskId) return 0;
    if (taskStatus === 'failed') return 0;
    if (taskStatus === 'cancelled') return 0;
    if (taskStatus === 'completed') return 100;
    if (taskStatus === 'processing') {
      return taskDetail?.progress_percent ?? 50;
    }
    if (taskStatus === 'queued' || taskStatus == null) {
      return Math.max(
        12,
        taskDetail?.progress_percent != null && taskDetail.progress_percent > 0
          ? taskDetail.progress_percent
          : 20
      );
    }
    return 0;
  })();

  const uiLogs: OcrUiLog[] = useMemo(() => {
    if (!taskId) return [];
    const logs: OcrUiLog[] = [];
    if (taskDetail?.created_at) {
      logs.push({
        at: taskDetail.created_at,
        stage: 'task_created',
        status: 'info',
        message: tOcrWb('logTaskCreated'),
      });
    }
    if (taskDetail?.progress_stage) {
      logs.push({
        at: taskDetail.updated_at || new Date().toISOString(),
        stage: taskDetail.progress_stage,
        status: taskDetail.status || 'processing',
        message: tOcrWb('logCurrentStage', {
          stage: stageLabel(taskDetail.progress_stage),
        }),
      });
    }
    if (taskDetail?.error_code || taskDetail?.error_message) {
      logs.push({
        at: taskDetail.updated_at || new Date().toISOString(),
        stage: taskDetail.progress_stage || 'failed',
        status: 'failed',
        message: sanitizeUiLogMessage(
          taskDetail.error_message || taskDetail.error_code || tOcrWb('logTaskFailed')
        ),
      });
    }
    if (lastResumeStage) {
      logs.push({
        at: new Date().toISOString(),
        stage: lastResumeStage,
        status: 'retry',
        message: tOcrWb('logResumeFromFailed', {
          stage: stageLabel(lastResumeStage),
        }),
      });
    }
    return logs.slice(-3);
  }, [taskId, taskDetail, lastResumeStage, tOcrWb, stageLabel]);

  const sourcePdfUrl = documentId ? sourceSliceUrl : '';
  const handleSourcePageChange = useCallback(
    (p: number) => {
      setCurrentPage(p);
    },
    []
  );

  const handlePrevPage = useCallback(() => {
    if (activeFocusPanel === 'source') {
      const next = Math.max(1, currentPage - 1);
      setCurrentPage(next);
      return;
    }
    const next = Math.max(1, jsonPage - 1);
    setJsonPage(next);
  }, [activeFocusPanel, currentPage, jsonPage]);

  const handleNextPage = useCallback(() => {
    const total = Math.max(1, effectiveDocumentPageCount || 1);
    if (activeFocusPanel === 'source') {
      const next = Math.min(total, currentPage + 1);
      setCurrentPage(next);
      return;
    }
    const next = Math.min(total, jsonPage + 1);
    setJsonPage(next);
  }, [
    activeFocusPanel,
    currentPage,
    effectiveDocumentPageCount,
    jsonPage,
  ]);
  const ocrParseResultUrl =
    taskId && taskView?.task?.preprocess_with_ocr
      ? `/api/tasks/${taskId}/parse-result`
      : stableParseResultUrl ?? taskView?.ocr_parse_result_url ?? null;
  const sidebarBtnClass =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-800 shadow-sm transition-all duration-150 hover:-translate-y-[1px] hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800';
  const sidebarCardClass =
    'rounded-xl border border-zinc-200 bg-zinc-50/90 p-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-900/60';
  const restoringFromUrl = Boolean(searchParams.get(TASK_PARAM)?.trim()) && !taskId;
  const restoringRecent =
    isRecentRequested && !recentBootstrapDone && !taskId && !documentId;

  if (restoringFromUrl || restoringRecent) {
    return (
      <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-3 p-8 text-zinc-600 dark:text-zinc-400">
        <Loader2 className="h-10 w-10 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
        <p className="text-center text-sm">{t('restoring')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-100 md:flex-row dark:bg-zinc-950">
      <aside className="flex max-h-[45vh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 md:max-h-none md:w-72 md:overflow-y-visible md:border-b-0 md:border-r md:p-4">
        <div className={sidebarCardClass}>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => router.push('/')}
              className={sidebarBtnClass}
            >
              <Image src="/brand/local/upload.png" alt="" width={14} height={14} />
              {tOcrWb('navHome')}
            </button>
            <button
              type="button"
              onClick={() => router.push('/upload')}
              className={sidebarBtnClass}
            >
              <Image src="/brand/local/upload.webp" alt="" width={14} height={14} />
              {tOcrWb('navUpload')}
            </button>
            <button
              type="button"
              onClick={() => setHistoryLogOpen(true)}
              className={`col-span-2 ${sidebarBtnClass}`}
            >
              <Image src="/brand/local/history.png" alt="" width={14} height={14} />
              {tOcrWb('navHistLog')}
            </button>
          </div>
          <div className="mt-2 rounded-lg border border-blue-200/80 bg-blue-50/90 p-2 dark:border-blue-900/50 dark:bg-blue-950/40">
            {user?.id || sessionUserId ? (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-blue-900/80 dark:text-blue-200/90">
                    {tHome('creditsRemaining')}
                  </p>
                  <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-zinc-50">
                    {user?.credits?.remainingCredits ?? (sessionPending ? '...' : '…')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/pricing')}
                  className="rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:bg-zinc-900 dark:text-blue-300 dark:hover:bg-zinc-800"
                >
                  {tHome('buyCredits')}
                </button>
              </div>
            ) : (
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                {tHome('creditsLoadHint')}
              </p>
            )}
          </div>
        </div>

        <div className={sidebarCardClass}>
          <div>
            <UploadDropzone
              onUploaded={handleUploaded}
              initialFile={lastUploadedFile}
              compactToolbar
              onRequireSignIn={handleRequireSignInForUpload}
            />
          </div>
          <button
            type="button"
            onClick={handleDeleteDocument}
            disabled={!!deletingDocId}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-red-200 bg-white py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            {deletingDocId ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Trash2 size={12} />
            )}
            {tHome('deleteDocumentPermanently')}
          </button>
          {(documentSizeBytes != null || documentCreatedAt) && (
            <p className="mt-2 text-[11px] text-zinc-500">
              {documentSizeBytes != null && (
                <span>
                  {tHome('fileSize')}:{' '}
                  {(documentSizeBytes / 1024 / 1024).toFixed(2)} MB
                </span>
              )}
              {documentSizeBytes != null && documentCreatedAt && ' · '}
              {documentCreatedAt && (
                <span>
                  {tHome('uploadedAt')}:{' '}
                  {new Date(documentCreatedAt).toLocaleString()}
                </span>
              )}
            </p>
          )}
          <div className="mt-3 grid gap-2">
            <LanguageSelector
              value={sourceLang}
              onChange={setSourceLang}
              label={tTranslate('sourceLang')}
              placeholderKey="selectSourceLang"
            />
            <LanguageSelector
              value={targetLang}
              onChange={setTargetLang}
              label={tTranslate('targetLang')}
              placeholderKey="selectTargetLang"
            />
            <button
              type="button"
              onClick={startOcrTask}
              disabled={starting || taskAwaitingResult || !sourceLang}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold',
                TRANSLATE_PRIMARY_CTA_CLASSNAME
              )}
            >
              {starting || taskAwaitingResult ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Languages size={14} />
              )}
              {starting || taskAwaitingResult
                ? tTranslate('submitting')
                : tTranslate('preprocessWithOcr')}
            </button>
            {submitError ? (
              <p className="text-xs text-red-600 dark:text-red-400">{submitError}</p>
            ) : null}
          </div>
        </div>

        <div
          id={OCR_TOOLBAR_HOST_ID}
          className="space-y-2 md:sticky md:top-4 md:z-20 md:max-h-[calc(100vh-10rem)] md:overflow-y-auto"
        />

        <div className={`order-last ${sidebarCardClass}`}>
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            {tOcrWb('pagesTitle')}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                shellChrome?.setHeaderCollapsed(!(shellChrome?.headerCollapsed ?? true));
              }}
              className={`col-span-2 ${sidebarBtnClass}`}
            >
              {shellChrome?.headerCollapsed ? 'Expand header' : 'Close header'}
            </button>
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={currentPage <= 1}
              className={`${sidebarBtnClass} disabled:opacity-50`}
            >
              {tOcrWb('pagesPrev')}
            </button>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={currentPage >= Math.max(1, effectiveDocumentPageCount || 1)}
              className={`${sidebarBtnClass} disabled:opacity-50`}
            >
              {tOcrWb('pagesNext')}
            </button>
            <p className="col-span-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
              {tOcrWb('pagesSourcePage', {
                current: activeFocusPanel === 'source' ? currentPage : jsonPage,
                total: Math.max(1, effectiveDocumentPageCount || 1),
              })}
            </p>
            <p className="col-span-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
              {activeFocusPanel === 'json' ? 'JSON focus' : 'Source focus'}
            </p>
            <label className="col-span-2 flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
              <span>{tOcrWb('canvasScale')}</span>
              <input
                type="range"
                min={30}
                max={250}
                value={
                  activeFocusPanel === 'source'
                    ? Math.round(pdfZoom * 100)
                    : jsonCanvasScale
                }
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  if (activeFocusPanel === 'source') {
                    const zoom = Math.max(0.5, Math.min(2.5, next / 100));
                    setPdfZoom(zoom);
                    return;
                  }
                  const clamped = Math.max(30, Math.min(160, next));
                  startTransition(() => {
                    setJsonCanvasScale(clamped);
                  });
                }}
                className="flex-1"
              />
              <span className="w-10 text-right tabular-nums">
                {activeFocusPanel === 'source'
                  ? `${Math.round(pdfZoom * 100)}%`
                  : `${jsonCanvasScale}%`}
              </span>
            </label>
            <button
              type="button"
              onClick={() => {
                footerWorkbench?.setFooterExpanded(
                  !(footerWorkbench?.footerExpanded ?? false)
                );
              }}
              className={`col-span-2 ${sidebarBtnClass}`}
            >
              {footerWorkbench?.footerExpanded ? 'Close footer' : 'Expand footer'}
            </button>
          </div>
        </div>

        {taskId && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/90 p-3 dark:border-zinc-800 dark:bg-zinc-900/80">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-zinc-600 dark:text-zinc-400">
                {taskStatus == null ? t('restoring') : statusLabel(taskStatus)}
                {taskAwaitingResult && taskDetail?.progress_stage
                  ? ` · ${taskDetail.progress_stage}`
                  : ''}
              </span>
              <button
                type="button"
                onClick={handleRefreshResult}
                disabled={refreshing}
                aria-label={tHome('refreshResult')}
                className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              >
                {refreshing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </button>
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-1 min-w-[4px] rounded-full bg-blue-600 transition-[width] duration-500 dark:bg-blue-400"
                style={{ width: `${taskProgress}%` }}
              />
            </div>
            {(taskStatus === 'failed' || taskStatus === 'cancelled') &&
              (taskDetail?.error_message || taskDetail?.error_code) && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {taskDetail?.error_message || taskDetail?.error_code}
                </p>
              )}
            {(taskStatus === 'queued' || taskStatus === 'processing') && taskId ? (
              <button
                type="button"
                className="mt-2 w-full rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                onClick={async () => {
                  if (!taskId) return;
                  setRefreshing(true);
                  try {
                    await translateApi.cancelTask(taskId);
                    setTaskStatus('cancelled');
                    setSubmitError(null);
                    await handleRefreshResult();
                  } catch (e) {
                    setSubmitError(
                      e instanceof Error ? e.message : tTranslate('createTaskFailed')
                    );
                  } finally {
                    setRefreshing(false);
                  }
                }}
                disabled={refreshing}
              >
                {tOcrWb('cancelTask')}
              </button>
            ) : null}
            {(taskStatus === 'failed' || taskStatus === 'cancelled') && taskId ? (
              <button
                type="button"
                className="mt-2 w-full rounded-lg border border-zinc-300 bg-white py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                onClick={async () => {
                  if (!taskId) return;
                  setRefreshing(true);
                  try {
                    const res = await translateApi.retryOcrTask(taskId);
                    setTaskStatus('queued');
                    setLastResumeStage(res.resume_stage ?? null);
                    setSubmitError(null);
                    await handleRefreshResult();
                  } catch (e) {
                    setSubmitError(
                      e instanceof Error ? e.message : tTranslate('createTaskFailed')
                    );
                  } finally {
                    setRefreshing(false);
                  }
                }}
                disabled={refreshing}
              >
                {tOcrWb('retryTask')}
                {taskDetail?.progress_stage ? ` (${taskDetail.progress_stage})` : ''}
              </button>
            ) : null}
            {lastResumeStage ? (
              <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                {tOcrWb('resumedFromStage', { stage: lastResumeStage })}
              </p>
            ) : null}
          </div>
        )}
      </aside>

      <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
        {taskAwaitingResult && (
          <div className="shrink-0 border-b border-blue-200/80 bg-blue-50/95 px-4 py-2 dark:border-blue-900/50 dark:bg-blue-950/40">
            <div className="flex items-center justify-between gap-2 text-xs text-blue-900 dark:text-blue-100">
              <span className="font-medium">
                {taskStatus == null
                  ? t('restoring')
                  : taskStatus === 'processing'
                    ? statusLabel('processing')
                    : statusLabel('queued')}
                {taskDetail?.progress_stage ? ` · ${taskDetail.progress_stage}` : ''}
              </span>
              <span className="tabular-nums">{taskProgress}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-blue-200/80 dark:bg-blue-900/50">
              <div
                className="h-1.5 min-w-[6px] rounded-full bg-blue-600 transition-[width] duration-500 dark:bg-blue-400"
                style={{ width: `${taskProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 md:grid-cols-2 md:gap-4 md:p-4">
          <OcrSourcePdfPanel
            sourceLabel={tHome('sourceLabel')}
            documentId={documentId}
            currentPage={currentPage}
            sourcePdfUrl={sourcePdfUrl}
            effectiveDocumentPageCount={effectiveDocumentPageCount}
            pdfZoom={pdfZoom}
            onSourcePageChange={handleSourcePageChange}
            onPdfNumPages={setSourceNumPagesFromViewer}
            onScaleChange={setPdfZoom}
            onFocusSource={() => setActiveFocusPanel('source')}
          />
          <div
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            onClick={() => setActiveFocusPanel('json')}
          >
            <p className="mb-1 shrink-0 px-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              {tOcrWb('tabWorkbench')}
            </p>
            <div className="min-h-0 flex-1 overflow-hidden">
              <OcrParseWorkbench
                taskId={taskId ?? 'pending'}
                parseResultUrl={ocrParseResultUrl}
                sourcePdfUrl={taskView?.source_pdf_url || (sourcePdfUrl ? sourcePdfUrl : null)}
                hideSourcePanel
                pageIndex={Math.max(0, jsonPage - 1)}
                onPageIndexChange={(idx) => {
                  const maxP = Math.max(1, effectiveDocumentPageCount || 1);
                  setJsonPage(Math.min(maxP, Math.max(1, idx + 1)));
                }}
                canvasScalePercent={jsonCanvasScale}
                onCanvasScaleChange={setJsonCanvasScale}
                onCanvasFocus={() => setActiveFocusPanel('json')}
                toolbarPosition="left"
                toolbarId={OCR_TOOLBAR_ID}
                externalToolbarContainerId={OCR_TOOLBAR_HOST_ID}
                toolbarSectionIds={{
                  textEdit: OCR_TOOLBAR_TEXT_EDIT_ID,
                  fontSettings: OCR_TOOLBAR_FONT_SETTINGS_ID,
                  file: OCR_TOOLBAR_FILE_ID,
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <Sheet open={historyLogOpen} onOpenChange={setHistoryLogOpen}>
        <SheetContent side="left" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{tOcrWb('navHistLog')}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {tOcrWb('logSanitizedHint')}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                {tOcrWb('taskLogTitle')}
              </p>
              <div className="space-y-1 rounded-lg border border-zinc-200 bg-white p-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-950">
                {uiLogs.length === 0 ? (
                  <p className="text-zinc-500 dark:text-zinc-400">{tOcrWb('taskLogEmpty')}</p>
                ) : (
                  uiLogs.map((log, idx) => (
                    <div key={`${log.at}-${idx}`} className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
                      <p className="font-medium text-zinc-700 dark:text-zinc-200">
                        {stageLabel(log.stage)} · {logStatusLabel(log.status)}
                      </p>
                      <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">{log.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                {tOcrWb('recentTaskTitle')}
              </p>
              <div className="space-y-1">
                {recentOcrTasks.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {tOcrWb('recentTaskEmpty')}
                  </p>
                ) : (
                  recentOcrTasks.map((one) => (
                    <div key={one.id} className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTaskId(one.id);
                          updateTaskInUrl(one.id);
                          setHistoryLogOpen(false);
                        }}
                        className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
                      >
                        <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                          {one.id}
                        </p>
                        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                          {statusLabel(one.status)}
                        </p>
                      </button>
                      <button
                        type="button"
                        title={tHome('delete')}
                        aria-label={tHome('delete')}
                        onClick={() => void handleDeleteRecentTask(one.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
                  onClick={() => setRecentTaskPage((p) => Math.max(0, p - 1))}
                  disabled={recentTaskPage <= 0}
                >
                  {tOcrWb('historyPrev')}
                </button>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {tOcrWb('historyPage', { page: recentTaskPage + 1 })}
                </span>
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
                  onClick={() => setRecentTaskPage((p) => p + 1)}
                  disabled={recentOcrTasks.length < HISTORY_PAGE_SIZE}
                >
                  {tOcrWb('historyNext')}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                {tOcrWb('uploadedFileTitle')}
              </p>
              <div className="space-y-1">
                {recentDocuments.length === 0 &&
                documentId &&
                (filename || lastUploadedFile?.name) ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-1.5 dark:border-emerald-800/50 dark:bg-emerald-950/30">
                    <p className="truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
                      {filename ?? lastUploadedFile?.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {lastUploadedFile != null && lastUploadedFile.size > 0
                        ? `${(lastUploadedFile.size / 1024 / 1024).toFixed(2)} MB`
                        : '—'}
                    </p>
                  </div>
                ) : recentDocuments.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {tOcrWb('uploadedFileEmpty')}
                  </p>
                ) : (
                  recentDocuments.map((one) => (
                    <div key={one.id} className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentId(one.id);
                          setFilename(one.filename);
                          setLastUploadedFile({
                            name: one.filename,
                            size: one.size_bytes,
                          });
                          setHistoryLogOpen(false);
                        }}
                        className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
                      >
                        <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                          {one.filename}
                        </p>
                        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                          {(one.size_bytes / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </button>
                      <button
                        type="button"
                        title={tHome('delete')}
                        aria-label={tHome('delete')}
                        onClick={() => void handleDeleteRecentDocument(one.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
                  onClick={() => setRecentDocumentPage((p) => Math.max(0, p - 1))}
                  disabled={recentDocumentPage <= 0}
                >
                  {tOcrWb('historyPrev')}
                </button>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {tOcrWb('historyPage', { page: recentDocumentPage + 1 })}
                </span>
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
                  onClick={() => setRecentDocumentPage((p) => p + 1)}
                  disabled={recentDocuments.length < HISTORY_PAGE_SIZE}
                >
                  {tOcrWb('historyNext')}
                </button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
