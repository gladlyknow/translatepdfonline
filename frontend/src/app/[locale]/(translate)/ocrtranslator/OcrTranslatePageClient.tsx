'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Loader2,
  Download,
  Trash2,
  RefreshCw,
  FileText,
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
const OCR_TOOLBAR_TEXT_EDIT_ID = 'ocr-workbench-toolbar-text-edit';
const OCR_TOOLBAR_FONT_SETTINGS_ID = 'ocr-workbench-toolbar-font-settings';
const OCR_TOOLBAR_BLOCK_PROPS_ID = 'ocr-workbench-toolbar-block-props';
const OCR_TOOLBAR_FILE_ID = 'ocr-workbench-toolbar-file';
const HISTORY_PAGE_SIZE = 3;

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

function parsePageRange(range: string | null): [number, number] | null {
  if (range == null || range.trim() === '') return null;
  const s = range.trim();
  const dash = s.indexOf('-');
  if (dash === -1) {
    const n = parseInt(s, 10);
    if (Number.isNaN(n) || n < 1) return null;
    return [n, n];
  }
  const start = parseInt(s.slice(0, dash).trim(), 10);
  const end = parseInt(s.slice(dash + 1).trim(), 10);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 1 ||
    end < start
  ) {
    return null;
  }
  return [start, end];
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
  const low = String(v || '').trim().toLowerCase();
  const allow: UILang[] = [
    'en',
    'zh',
    'es',
    'fr',
    'it',
    'el',
    'ja',
    'ko',
    'de',
    'ru',
  ];
  return allow.includes(low as UILang) ? (low as UILang) : '';
}

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
  const [targetPage, setTargetPage] = useState(1);
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
  const [targetSliceUrl, setTargetSliceUrl] = useState<string>('');
  const [targetTotalPages, setTargetTotalPages] = useState<number>(0);
  const [targetNumPagesFromViewer, setTargetNumPagesFromViewer] = useState<
    number | null
  >(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [parsePageJson, setParsePageJson] = useState('');
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

  const blockAutoDocumentLoadRef = useRef(false);
  const outputPreviewFailedRef = useRef<{
    taskId: string;
    page: number;
    at: number;
  } | null>(null);
  const OUTPUT_PREVIEW_BACKOFF_MS = 60_000;

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
    if (!footerWorkbench) return;
    footerWorkbench.setWorkbenchOpen(Boolean(documentId));
  }, [documentId, footerWorkbench]);

  useEffect(() => {
    if (!shellChrome) return;
    shellChrome.setHeaderCollapsed(true);
    return () => shellChrome.setHeaderCollapsed(false);
  }, [shellChrome]);

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

  const effectiveTargetTotalPages = useMemo(
    () => Math.max(targetTotalPages, targetNumPagesFromViewer ?? 0),
    [targetTotalPages, targetNumPagesFromViewer]
  );

  const debouncedSourcePage = useDebouncedValue(
    currentPage,
    PREVIEW_PAGE_DEBOUNCE_MS
  );
  const debouncedTargetPage = useDebouncedValue(
    targetPage,
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
          setTaskView(view);
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
  }, [searchParams, pathname, router, sourceLang, targetLang, taskId]);

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
    setTargetNumPagesFromViewer(null);
  }, [taskId]);

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
    setTargetPage(1);
  }, [taskId]);

  useEffect(() => {
    if (
      !taskId ||
      taskStatus !== 'completed' ||
      !taskView?.primary_file_url ||
      debouncedTargetPage < 1
    ) {
      setTargetSliceUrl('');
      setTargetTotalPages(0);
      return;
    }
    const failed = outputPreviewFailedRef.current;
    if (
      failed &&
      failed.taskId === taskId &&
      failed.page === debouncedTargetPage &&
      Date.now() - failed.at < OUTPUT_PREVIEW_BACKOFF_MS
    ) {
      return;
    }
    let cancelled = false;
    translateApi
      .getTaskOutputPreviewUrl(taskId, debouncedTargetPage)
      .then((res) => {
        if (!cancelled) {
          outputPreviewFailedRef.current = null;
          setTargetSliceUrl(res.preview_url);
          setTargetTotalPages(res.total_pages);
        }
      })
      .catch(() => {
        if (!cancelled) {
          outputPreviewFailedRef.current = {
            taskId,
            page: debouncedTargetPage,
            at: Date.now(),
          };
          setTargetSliceUrl('');
          setTargetTotalPages(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, taskStatus, taskView?.primary_file_url, debouncedTargetPage]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const detail = await translateApi.getTask(taskId);
        if (cancelled) return;
        setTaskStatus(detail.status);
        setTaskDetail(detail);
        if (
          detail.status === 'completed' ||
          detail.status === 'failed' ||
          detail.status === 'cancelled'
        ) {
          const view = await translateApi.getTaskView(taskId).catch(() => null);
          if (!cancelled && view) setTaskView(view);
          if (
            detail.status === 'completed' &&
            (!view?.can_download || (view.outputs?.length ?? 0) === 0)
          ) {
            return;
          }
          return;
        }
      } catch {
        // ignore
      }
    };
    poll();
    const waitingExportReady =
      taskStatus === 'completed' &&
      (!(taskView?.can_download ?? false) || (taskView?.outputs?.length ?? 0) === 0);
    const terminal =
      (taskStatus === 'completed' && !waitingExportReady) ||
      taskStatus === 'failed' ||
      taskStatus === 'cancelled';
    const shouldPoll = !terminal;
    const id = shouldPoll ? setInterval(poll, POLL_INTERVAL_MS_ACTIVE) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [taskId, taskStatus, taskView?.can_download, taskView?.outputs?.length]);

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
    outputPreviewFailedRef.current = null;
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
        if (view) setTaskView(view);
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
      outputPreviewFailedRef.current = null;
      setCurrentPage(1);
      setTargetPage(1);
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

  const startOcrTask = async () => {
    if (!documentId || !sourceLang || starting) return;
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
      setSubmitError(
        e instanceof Error ? e.message : tTranslate('createTaskFailed')
      );
    } finally {
      setStarting(false);
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
  const targetPdfUrl =
    taskStatus === 'completed' && targetSliceUrl ? targetSliceUrl : '';
  const pageRange = parsePageRange(taskView?.task?.page_range ?? null);
  const isPageTranslated =
    pageRange == null || (currentPage >= pageRange[0] && currentPage <= pageRange[1]);

  const handleSourcePageChange = useCallback(
    (p: number) => {
      setCurrentPage(p);
      if (taskStatus === 'completed' && effectiveTargetTotalPages > 0) {
        setTargetPage(Math.min(Math.max(1, p), effectiveTargetTotalPages));
      }
    },
    [taskStatus, effectiveTargetTotalPages]
  );

  const handlePrevPage = useCallback(() => {
    const next = Math.max(1, currentPage - 1);
    setCurrentPage(next);
    if (taskStatus === 'completed' && effectiveTargetTotalPages > 0) {
      setTargetPage(Math.min(Math.max(1, next), effectiveTargetTotalPages));
    }
  }, [currentPage, effectiveTargetTotalPages, taskStatus]);

  const handleNextPage = useCallback(() => {
    const total = Math.max(1, effectiveDocumentPageCount || 1);
    const next = Math.min(total, currentPage + 1);
    setCurrentPage(next);
    if (taskStatus === 'completed' && effectiveTargetTotalPages > 0) {
      setTargetPage(Math.min(Math.max(1, next), effectiveTargetTotalPages));
    }
  }, [currentPage, effectiveDocumentPageCount, effectiveTargetTotalPages, taskStatus]);

  const outputs = taskView?.outputs ?? [];
  const pdfOutput =
    outputs.find((o) => o.filename.toLowerCase().endsWith('.pdf')) ?? null;
  const mdOutput =
    outputs.find((o) => o.filename.toLowerCase().endsWith('.md')) ?? null;
  const ocrParseResultUrl = taskView?.ocr_parse_result_url ?? null;

  useEffect(() => {
    setParsePageJson('');
  }, [ocrParseResultUrl, taskId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-100 md:flex-row dark:bg-zinc-950">
      <aside
        className="flex max-h-[45vh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 md:max-h-none md:w-64 md:border-b-0 md:border-r md:p-4"
      >
        <div className="border-b border-zinc-100 pb-2 dark:border-zinc-800">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {tHome('workbenchModelOcr')}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {tHome('workbenchPipelineTitle')}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/70">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <Image src="/brand/local/upload.png" alt="" width={14} height={14} />
            {tOcrWb('navHome')}
          </button>
          <button
            type="button"
            onClick={() => router.push('/upload')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <Image src="/brand/local/upload.webp" alt="" width={14} height={14} />
            {tOcrWb('navUpload')}
          </button>
          <button
            type="button"
            onClick={() => setHistoryLogOpen(true)}
            className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <Image src="/brand/local/history.png" alt="" width={14} height={14} />
            {tOcrWb('navHistLog')}
          </button>
        </div>

        <div className="rounded-xl border border-blue-200/80 bg-blue-50/90 p-2.5 dark:border-blue-900/50 dark:bg-blue-950/40">
          {user?.id || sessionUserId ? (
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-blue-900/80 dark:text-blue-200/90">
                  {tHome('creditsRemaining')}
                </p>
                <p className="text-base font-bold tabular-nums text-slate-900 dark:text-zinc-50">
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

        <div className="order-last rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            {tOcrWb('pagesTitle')}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                shellChrome?.setHeaderCollapsed(!(shellChrome?.headerCollapsed ?? false))
              }
              className="col-span-2 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {tOcrWb('pagesExpandHeader')}
            </button>
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={currentPage <= 1}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {tOcrWb('pagesPrev')}
            </button>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={currentPage >= Math.max(1, effectiveDocumentPageCount || 1)}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {tOcrWb('pagesNext')}
            </button>
            <p className="col-span-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
              {tOcrWb('pagesSourcePage', {
                current: currentPage,
                total: Math.max(1, effectiveDocumentPageCount || 1),
              })}
            </p>
            <button
              type="button"
              onClick={() =>
                footerWorkbench?.setFooterExpanded(
                  !(footerWorkbench?.footerExpanded ?? false)
                )
              }
              className="col-span-2 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {tOcrWb('pagesExpandFooter')}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="mt-2">
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
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="grid gap-2">
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
                'flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold',
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

        {taskStatus === 'completed' && (
          <div className="flex flex-col gap-2">
            {pdfOutput && (
              <a
                href={pdfOutput.download_url}
                download="translation.pdf"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white shadow hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <Download size={16} className="shrink-0" />
                {tHome('download')} PDF
              </a>
            )}
            {mdOutput && (
              <a
                href={mdOutput.download_url}
                download="translation.md"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white py-2.5 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                <FileText size={16} className="shrink-0" />
                {tHome('download')} MD
              </a>
            )}
            {!pdfOutput && !mdOutput ? (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {tOcrWb('logCurrentStage', { stage: tOcrWb('stageExportOutputs') })}
              </p>
            ) : null}
          </div>
        )}

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

        {taskStatus === 'completed' && ocrParseResultUrl && taskId ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 md:p-4">
            <div className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 md:min-h-[320px] md:flex-1">
              <p className="mb-1 shrink-0 px-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                {tOcrWb('tabWorkbench')}
              </p>
              <div className="min-h-0 flex-1 overflow-hidden">
                <OcrParseWorkbench
                  taskId={taskId}
                  parseResultUrl={ocrParseResultUrl}
                  sourcePdfUrl={
                    taskView?.source_pdf_url || (sourcePdfUrl ? sourcePdfUrl : null)
                  }
                  hideSourcePanel
                  pageIndex={Math.max(0, currentPage - 1)}
                  onPageIndexChange={(idx) => {
                    const maxP = Math.max(1, effectiveDocumentPageCount || 1);
                    setCurrentPage(Math.min(maxP, Math.max(1, idx + 1)));
                  }}
                  onWorkbenchPageJson={({ json }) => setParsePageJson(json)}
                  toolbarPosition="left"
                  toolbarId={OCR_TOOLBAR_ID}
                  toolbarSectionIds={{
                    textEdit: OCR_TOOLBAR_TEXT_EDIT_ID,
                    fontSettings: OCR_TOOLBAR_FONT_SETTINGS_ID,
                    blockProps: OCR_TOOLBAR_BLOCK_PROPS_ID,
                    file: OCR_TOOLBAR_FILE_ID,
                  }}
                />
              </div>
            </div>
            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-2 md:gap-4 md:min-h-[180px] md:max-h-[34vh]">
              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <p className="shrink-0 border-b border-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  {tHome('sourceLabel')}
                </p>
                <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable] p-2">
                  <PdfViewerPane
                    key={`source-ocr-wb-${documentId}-${currentPage}`}
                    fileUrl={sourcePdfUrl ?? ''}
                    mode="source"
                    page={currentPage}
                    onPageChange={handleSourcePageChange}
                    totalPages={
                      effectiveDocumentPageCount > 0
                        ? effectiveDocumentPageCount
                        : undefined
                    }
                    onPdfNumPages={setSourceNumPagesFromViewer}
                    scale={pdfZoom}
                    onScaleChange={setPdfZoom}
                    showZoomControls
                  />
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <p className="shrink-0 border-b border-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  {tOcrWb('parseJsonPanelTitle')}
                </p>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 p-3 font-mono text-[11px] leading-snug text-zinc-100 dark:bg-black">
                  {parsePageJson.trim() ? parsePageJson : tOcrWb('parseJsonEmpty')}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 md:grid-cols-2 md:gap-4 md:p-4">
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <p className="shrink-0 border-b border-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                {tHome('sourceLabel')}
              </p>
              <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable] p-2">
                <PdfViewerPane
                  key={`source-ocr-${documentId}-${currentPage}`}
                  fileUrl={sourcePdfUrl ?? ''}
                  mode="source"
                  page={currentPage}
                  onPageChange={handleSourcePageChange}
                  totalPages={
                    effectiveDocumentPageCount > 0 ? effectiveDocumentPageCount : undefined
                  }
                  onPdfNumPages={setSourceNumPagesFromViewer}
                  scale={pdfZoom}
                  onScaleChange={setPdfZoom}
                  showZoomControls
                />
              </div>
            </div>
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <p className="shrink-0 border-b border-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                {tHome('targetLabel')}
              </p>
              <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable] p-2">
                {taskStatus === 'completed' && targetPdfUrl && !isPageTranslated ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center">
                    <span className="text-zinc-500">{tPdf('pageNotTranslated')}</span>
                  </div>
                ) : (
                  <PdfViewerPane
                    key={`target-ocr-${taskId ?? ''}-${targetPage}`}
                    fileUrl={targetPdfUrl ?? ''}
                    mode="target"
                    placeholder={
                      taskId && !targetPdfUrl
                        ? taskAwaitingResult
                          ? t('targetPlaceholder')
                          : tPdf('noPdf')
                        : undefined
                    }
                    page={targetPdfUrl ? targetPage : undefined}
                    onPageChange={targetPdfUrl ? setTargetPage : undefined}
                    totalPages={
                      effectiveTargetTotalPages > 0 ? effectiveTargetTotalPages : undefined
                    }
                    onPdfNumPages={setTargetNumPagesFromViewer}
                    scale={pdfZoom}
                    onScaleChange={setPdfZoom}
                    showZoomControls={false}
                  />
                )}
              </div>
            </div>
          </div>
        )}
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
                    <button
                      key={one.id}
                      type="button"
                      onClick={() => {
                        setTaskId(one.id);
                        updateTaskInUrl(one.id);
                        setHistoryLogOpen(false);
                      }}
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
                    >
                      <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                        {one.id}
                      </p>
                      <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                        {statusLabel(one.status)}
                      </p>
                    </button>
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
                {recentDocuments.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {tOcrWb('uploadedFileEmpty')}
                  </p>
                ) : (
                  recentDocuments.map((one) => (
                    <button
                      key={one.id}
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
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
                    >
                      <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                        {one.filename}
                      </p>
                      <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                        {(one.size_bytes / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </button>
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
