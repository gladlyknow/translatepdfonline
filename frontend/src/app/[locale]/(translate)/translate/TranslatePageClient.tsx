'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/core/i18n/navigation';
import { useSession } from '@/core/auth/client';
import { useAppContext } from '@/shared/contexts/app';
import { useTranslateFooterWorkbenchOptional } from '@/shared/contexts/translate-footer-workbench';
import { useTranslateHeaderAppearance } from '@/shared/contexts/translate-header-appearance';
import { UploadDropzone } from '@/shared/components/translate/UploadDropzone';
import { TranslationForm } from '@/shared/components/translate/TranslationForm';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import {
  translateApi,
  type TaskDetail,
  type TaskView,
  type TranslateTaskCreatedMeta,
  type UILang,
} from '@/shared/lib/translate-api';
import { TRANSLATE_MODEL_DISPLAY_NAME } from '@/config/translate-ui';
import { useTranslateShellChromeOptional } from '@/shared/contexts/translate-shell-chrome';
import { Loader2, Download, Trash2, RefreshCw } from 'lucide-react';

const PdfViewerPane = dynamic(
  () =>
    import('@/shared/components/translate/PdfViewerPane').then((m) => ({
      default: m.PdfViewerPane,
    })),
  { ssr: false }
);

const TASK_PARAM = 'task';
const DOCUMENT_PARAM = 'document';
const POLL_INTERVAL_MS_ACTIVE = 2000;
const PREVIEW_PAGE_DEBOUNCE_MS = 400;
const HISTORY_PAGE_SIZE = 10;

type TranslateUiLog = {
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

function isNoParagraphsFailure(
  code: string | null | undefined,
  message: string | null | undefined
): boolean {
  if (code === 'no_paragraphs') return true;
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('no paragraphs') ||
    m.includes('contains no paragraphs') ||
    m.includes('extracttexterror')
  );
}

function isScanLikelyFailure(
  code: string | null | undefined,
  message: string | null | undefined
): boolean {
  if (code === 'scan_detected_use_ocr') return true;
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes('too many cid paragraphs') || m.includes('cid paragraphs');
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
  )
    return null;
  return [start, end];
}

export function TranslatePageClient() {
  const t = useTranslations('translate.task');
  const tHome = useTranslations('translate.home');
  const tPdf = useTranslations('translate.pdfViewer');
  const tErrors = useTranslations('translate.errors');
  const tTranslate = useTranslations('translate.translate');
  const tOcrWb = useTranslations('translate.ocrWorkbench');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user, fetchUserCredits, fetchUserInfo, setIsShowSignModal } = useAppContext();
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
  const [ocrRedirecting, setOcrRedirecting] = useState(false);
  const [translateBilling, setTranslateBilling] = useState<{
    enabled: boolean;
    creditsPerPage: number;
  } | null>(null);
  const [historyLogOpen, setHistoryLogOpen] = useState(false);
  const [recentTasks, setRecentTasks] = useState<
    Array<{
      id: string;
      status: string;
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

  useEffect(() => {
    let cancelled = false;
    translateApi
      .getBillingConfig()
      .then((c) => {
        if (cancelled) return;
        setTranslateBilling({
          enabled: Boolean(c.credits_enabled),
          creditsPerPage:
            typeof c.credits_per_page === 'number' && c.credits_per_page > 0
              ? c.credits_per_page
              : 10,
        });
      })
      .catch(() => {
        if (!cancelled) setTranslateBilling(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  useEffect(() => {
    if (!footerWorkbench) return;
    footerWorkbench.setWorkbenchOpen(Boolean(documentId));
  }, [documentId, footerWorkbench]);

  useEffect(() => {
    if (!shellChrome) return;
    shellChrome.setHeaderCollapsed(true);
    return () => shellChrome.setHeaderCollapsed(false);
  }, [shellChrome]);

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
    if (!themeMounted) return;
    if (documentId) {
      setAppearance('onLight');
      return;
    }
    setAppearance(resolvedTheme === 'dark' ? 'onDark' : 'onLight');
  }, [documentId, resolvedTheme, themeMounted, setAppearance]);

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
        } else if (detail.document_id) {
          blockAutoDocumentLoadRef.current = false;
          setDocumentId(detail.document_id);
          try {
            const d = await translateApi.getDocument(detail.document_id);
            if (cancelled) return;
            setFilename(d.filename);
            setLastUploadedFile({
              name: d.filename,
              size: d.size_bytes ?? 0,
            });
          } catch {
            if (!cancelled) {
              setFilename(null);
              setLastUploadedFile(null);
            }
          }
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
  }, [searchParams, pathname, router]);

  useEffect(() => {
    if (searchParams.get(TASK_PARAM)) return;
    const docParam = searchParams.get(DOCUMENT_PARAM)?.trim();
    if (!docParam) return;
    if (documentId === docParam) return;

    let cancelled = false;
    (async () => {
      try {
        const doc = await translateApi.getDocument(docParam);
        if (cancelled) return;
        blockAutoDocumentLoadRef.current = false;
        setDocumentId(doc.id);
        setFilename(doc.filename);
        setLastUploadedFile({
          name: doc.filename,
          size: doc.size_bytes ?? 0,
        });
        setTaskId(null);
        setTaskView(null);
        setTaskDetail(null);
        setTaskStatus(null);
      } catch {
        if (cancelled) return;
        router.replace('/upload');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, router, documentId]);

  useEffect(() => {
    if (documentId) return;
    const hasTask = Boolean(searchParams.get(TASK_PARAM)?.trim());
    const hasDoc = Boolean(searchParams.get(DOCUMENT_PARAM)?.trim());
    if (hasTask || hasDoc) return;
    router.replace('/upload');
  }, [documentId, searchParams, router]);

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

  /**
   * 用户主动删除当前文档后，不再自动选中其它文档，直到再次上传（避免 Strict Mode 双次 effect 误恢复）。
   */
  const blockAutoDocumentLoadRef = useRef(false);

  const outputPreviewFailedRef = useRef<{
    taskId: string;
    page: number;
    at: number;
  } | null>(null);
  const OUTPUT_PREVIEW_BACKOFF_MS = 60_000;

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
        if (detail.status === 'completed' || detail.status === 'failed') {
          const view = await translateApi.getTaskView(taskId).catch(() => null);
          if (!cancelled && view) setTaskView(view);
          return;
        }
      } catch {
        // ignore
      }
    };
    poll();
    const terminal =
      taskStatus === 'completed' || taskStatus === 'failed';
    const shouldPoll = !terminal;
    const id = shouldPoll
      ? setInterval(poll, POLL_INTERVAL_MS_ACTIVE)
      : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [taskId, taskStatus]);

  useEffect(() => {
    if (!historyLogOpen) return;
    let cancelled = false;
    const loadRecent = async () => {
      try {
        const [tasks, docs] = await Promise.all([
          translateApi.listTasks({
            limit: HISTORY_PAGE_SIZE,
            offset: recentTaskPage * HISTORY_PAGE_SIZE,
          }),
          translateApi.listDocuments({
            limit: HISTORY_PAGE_SIZE,
            offset: recentDocumentPage * HISTORY_PAGE_SIZE,
          }),
        ]);
        if (cancelled) return;
        setRecentTasks(
          tasks.map((one) => ({
            id: one.id,
            status: one.status,
            updated_at: one.updated_at ?? null,
            created_at: one.created_at,
          }))
        );
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
          setRecentTasks([]);
          setRecentDocuments([]);
        }
      }
    };
    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [historyLogOpen, recentDocumentPage, recentTaskPage, taskId, taskStatus]);

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
      if (detail.status === 'completed' || detail.status === 'failed') {
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
      router.replace('/upload');
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleTaskCreated = (tid: string, _?: TranslateTaskCreatedMeta) => {
    setTaskId(tid);
    setTaskStatus('queued');
    setTaskDetail(null);
    setTaskView(null);
    updateTaskInUrl(tid);
  };

  const taskAwaitingResult =
    Boolean(taskId) &&
    (taskStatus == null ||
      taskStatus === 'queued' ||
      taskStatus === 'processing');

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
    };
    return t(keyMap[s] ?? 'status');
  };

  const stageLabel = useCallback(
    (stage: string) => {
      const keyMap: Record<string, string> = {
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
        queued: 'statusQueued',
        processing: 'statusProcessing',
        completed: 'statusCompleted',
        failed: 'statusFailed',
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
    if (taskStatus === 'completed') return 100;
    if (taskStatus === 'processing') {
      return taskDetail?.progress_percent ?? 50;
    }
    if (taskStatus === 'queued' || taskStatus == null) {
      return Math.max(
        12,
        taskDetail?.progress_percent != null && taskDetail.progress_percent > 0
          ? taskDetail.progress_percent
          : 24
      );
    }
    return 0;
  })();

  const sourcePdfUrl = documentId ? sourceSliceUrl : '';
  const targetPdfUrl =
    taskStatus === 'completed' && targetSliceUrl ? targetSliceUrl : '';
  const pageRange = parsePageRange(taskView?.task?.page_range ?? null);
  const isPageTranslated =
    pageRange == null ||
    (currentPage >= pageRange[0] && currentPage <= pageRange[1]);

  const handleSourcePageChange = useCallback(
    (p: number) => {
      setCurrentPage(p);
      if (
        taskStatus === 'completed' &&
        effectiveTargetTotalPages > 0
      ) {
        setTargetPage(
          Math.min(Math.max(1, p), effectiveTargetTotalPages)
        );
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

  const uiLogs: TranslateUiLog[] = useMemo(() => {
    if (!taskId) return [];
    const logs: TranslateUiLog[] = [];
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
    return logs.slice(-8);
  }, [taskDetail, taskId, tOcrWb, stageLabel]);

  const downloadUrl =
    taskView?.can_download &&
    (taskView?.primary_file_url || taskView?.outputs?.[0]?.download_url)
      ? (taskView.primary_file_url ?? taskView.outputs![0].download_url)
      : null;

  const failedTaskInfo =
    taskView?.task ??
    (taskStatus === 'failed' && taskDetail ? taskDetail : null);

  /** 正在从 URL（task / document）恢复工作台 */
  if (!documentId) {
    return (
      <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-3 p-8 text-zinc-600 dark:text-zinc-400">
        <Loader2 className="h-10 w-10 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
        <p className="text-center text-sm">{t('restoring')}</p>
      </div>
    );
  }

  /** 工作台 */
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-100 md:flex-row dark:bg-zinc-950">
      <aside
        id="translate-workbench-aside"
        className="flex max-h-[45vh] w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 md:max-h-none md:w-72 md:border-b-0 md:border-r"
      >
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/70">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <Image src="/brand/local/upload.png" alt="" width={14} height={14} />
            {tOcrWb('navHome')}
          </button>
          <button
            type="button"
            onClick={() => router.push('/upload')}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
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

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {tHome('workbenchModel')}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-zinc-100">
            {TRANSLATE_MODEL_DISPLAY_NAME}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {tHome('workbenchZoomHint')}
          </p>
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
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {tHome('workbenchDocument')}
          </p>
          {filename && (
            <p className="mt-1 truncate text-sm text-zinc-800 dark:text-zinc-200" title={filename}>
              {filename}
            </p>
          )}
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

        <TranslationForm
          documentId={documentId}
          onTaskCreated={handleTaskCreated}
          variant="workbench"
          taskStatus={
            taskAwaitingResult ? taskStatus ?? 'queued' : taskStatus
          }
          documentPageCount={effectiveDocumentPageCount}
          translateBilling={translateBilling}
          isLoggedIn={Boolean(user?.id)}
          onRequireSignIn={() => setIsShowSignModal(true)}
          sourceLang={sourceLang}
          targetLang={targetLang}
          onSourceLangChange={setSourceLang}
          onTargetLangChange={setTargetLang}
        />

        {taskStatus === 'completed' && targetPdfUrl && downloadUrl && (
          <a
            href={downloadUrl}
            download="translation.pdf"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white shadow hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            <Download size={18} className="shrink-0" />
            {tHome('download')}
          </a>
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
              <div className="flex items-center gap-2">
                {taskAwaitingResult && (
                  <span className="font-medium tabular-nums">{taskProgress}%</span>
                )}
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
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-1 min-w-[4px] rounded-full bg-blue-600 transition-[width] duration-500 dark:bg-blue-400"
                style={{ width: `${taskProgress}%` }}
              />
            </div>
            {taskAwaitingResult && (
              <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                {tHome('translationPatience')}
              </p>
            )}
            {taskStatus === 'failed' &&
              failedTaskInfo &&
              (failedTaskInfo.error_message || failedTaskInfo.error_code) && (
                <p
                  className={
                    isNoParagraphsFailure(
                      failedTaskInfo.error_code,
                      failedTaskInfo.error_message
                    )
                      ? 'mt-2 rounded-md border border-amber-200/90 bg-amber-50 px-2 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-50'
                      : 'mt-2 text-xs text-red-600 dark:text-red-400'
                  }
                >
                  {isNoParagraphsFailure(
                    failedTaskInfo.error_code,
                    failedTaskInfo.error_message
                  )
                    ? tErrors('no_paragraphs')
                    : failedTaskInfo.error_code === 'scan_detected_use_ocr'
                      ? tErrors('scan_detected_use_ocr')
                    : failedTaskInfo.error_message ??
                      (failedTaskInfo.error_code
                        ? tErrors(
                            failedTaskInfo.error_code as
                              | 'pdf_font_unsupported'
                              | 'tounicode_missing'
                              | 'font_subset_corrupt'
                              | 'no_paragraphs'
                              | 'ocr_preprocess_failed'
                              | 'scan_detected_use_ocr'
                          )
                        : '')}
                </p>
              )}
            {taskStatus === 'failed' &&
              failedTaskInfo &&
              isScanLikelyFailure(
                failedTaskInfo.error_code,
                failedTaskInfo.error_message
              ) &&
              documentId && (
                <button
                  type="button"
                  onClick={() => {
                    if (ocrRedirecting) return;
                    setOcrRedirecting(true);
                    const qs = new URLSearchParams({
                      document: documentId,
                      source_lang:
                        sourceLang ||
                        (taskView?.task?.source_lang as UILang | undefined) ||
                        'en',
                      target_lang:
                        targetLang ||
                        (taskView?.task?.target_lang as UILang | undefined) ||
                        'zh',
                    });
                    router.push(`/ocrtranslator?${qs.toString()}`);
                    setTimeout(() => setOcrRedirecting(false), 3000);
                  }}
                  disabled={ocrRedirecting}
                  className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {ocrRedirecting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : null}
                    {tTranslate('preprocessWithOcr')}
                  </span>
                </button>
              )}
            {taskStatus === 'completed' &&
              !targetPdfUrl &&
              (taskView?.primary_file_url ?? taskView?.outputs?.length) && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  {tHome('previewLoadFailedRetry')}
                </p>
              )}
          </div>
        )}

        <div className="min-h-2 shrink-0 md:min-h-0 md:flex-1" aria-hidden />
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
                {taskDetail?.progress_stage
                  ? ` · ${taskDetail.progress_stage}`
                  : ''}
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
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <p className="shrink-0 border-b border-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              {tHome('sourceLabel')}
            </p>
            <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable] p-2">
              <PdfViewerPane
                key={`source-${documentId}-${currentPage}`}
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
              {tHome('targetLabel')}
            </p>
            <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable] p-2">
              {taskStatus === 'completed' && targetPdfUrl && !isPageTranslated ? (
                <div className="flex h-full min-h-[280px] items-center justify-center">
                  <span className="text-zinc-500">{tPdf('pageNotTranslated')}</span>
                </div>
              ) : (
                <PdfViewerPane
                  key={`target-${taskId ?? ''}-${targetPage}`}
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
                  onPageChange={
                    targetPdfUrl ? setTargetPage : undefined
                  }
                  totalPages={
                    effectiveTargetTotalPages > 0
                      ? effectiveTargetTotalPages
                      : undefined
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
              <div className="max-h-72 space-y-1 overflow-auto rounded-lg border border-zinc-200 bg-white p-2 pr-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-950">
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
              <div className="max-h-40 space-y-1 overflow-auto pr-1">
                {recentTasks.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {tOcrWb('recentTaskEmpty')}
                  </p>
                ) : (
                  recentTasks.map((one) => (
                    <button
                      key={one.id}
                      type="button"
                      onClick={() => {
                        setTaskId(one.id);
                        setTaskStatus(null);
                        setTaskDetail(null);
                        setTaskView(null);
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
                  disabled={recentTasks.length < HISTORY_PAGE_SIZE}
                >
                  {tOcrWb('historyNext')}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                {tOcrWb('uploadedFileTitle')}
              </p>
              <div className="max-h-40 space-y-1 overflow-auto pr-1">
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
