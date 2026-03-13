"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Header } from "@/components/Header";
import { UploadDropzone } from "@/components/UploadDropzone";
import { TranslationForm } from "@/components/TranslationForm";
import { HistoryPanel } from "@/components/HistoryPanel";
import { ChevronUp, ChevronDown, Loader2, Download, Trash2 } from "lucide-react";
import { api, getSessionToken, resolveApiUrl, type TaskDetail, type TaskView } from "@/lib/api";

const PdfViewerPane = dynamic(
  () => import("@/components/PdfViewerPane").then((m) => ({ default: m.PdfViewerPane })),
  { ssr: false }
);

/** "7" -> [7,7], "1-5" -> [1,5]. Returns null if invalid or null. */
function parsePageRange(range: string | null): [number, number] | null {
  if (range == null || range.trim() === "") return null;
  const s = range.trim();
  const dash = s.indexOf("-");
  if (dash === -1) {
    const n = parseInt(s, 10);
    if (Number.isNaN(n) || n < 1) return null;
    return [n, n];
  }
  const start = parseInt(s.slice(0, dash).trim(), 10);
  const end = parseInt(s.slice(dash + 1).trim(), 10);
  if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < start) return null;
  return [start, end];
}

const TASK_PARAM = "task";

export default function HomePage() {
  const t = useTranslations("task");
  const tHome = useTranslations("home");
  const tPdfViewer = useTranslations("pdfViewer");
  const tErrors = useTranslations("errors");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<{ name: string; size: number } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskView, setTaskView] = useState<TaskView | null>(null);
  const taskCreatedAtRef = useRef<number | null>(null);
  const defaultPageSetForTaskRef = useRef<string | null>(null);
  const sourceFileRef = useRef<File | null>(null);
  const [tick, setTick] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [usePollingFallback, setUsePollingFallback] = useState(false);
  const [topRowCollapsed, setTopRowCollapsed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  const POLL_INTERVAL_MS = 5000;

  // 从 URL ?task=xxx 恢复任务（刷新/返回后）
  useEffect(() => {
    const tid = searchParams.get(TASK_PARAM);
    if (!tid || taskId === tid) return;

    let cancelled = false;
    const restore = async () => {
      try {
        const [detail, view] = await Promise.all([
          api.getTask(tid),
          api.getTaskView(tid).catch(() => null),
        ]);
        if (cancelled) return;
        setTaskId(tid);
        setTaskStatus(detail.status);
        setTaskDetail(detail);
        if (view) {
          setTaskView(view);
          setDocumentId(detail.document_id);
          setFilename(view.document_filename);
          setLastUploadedFile({
            name: view.document_filename,
            size: view.document_size_bytes ?? 0,
          });
        }
        if (detail.status === "completed" || detail.status === "failed") {
          taskCreatedAtRef.current = Date.now() - 1;
        }
      } catch {
        if (!cancelled) {
          const params = new URLSearchParams(searchParams.toString());
          params.delete(TASK_PARAM);
          const qs = params.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname);
        }
      }
    };
    restore();
    return () => {
      cancelled = true;
    };
  }, [searchParams, pathname, router]);

  // 新任务时优先使用 SSE，重置轮询回退
  useEffect(() => {
    setUsePollingFallback(false);
  }, [taskId]);

  // 页面首次加载时，尝试从后端恢复最近一个文档，
  // 这样即便匿名上传额度已用完，上传区也始终显示最近一次上传的 PDF。
  // 若 URL 有 task 参数，由 restore 效果设置 documentId，此处跳过。
  useEffect(() => {
    if (documentId) return;
    if (searchParams.get(TASK_PARAM)) return;

    let cancelled = false;
    const loadLatestDocument = async () => {
      try {
        const docs = await api.listDocuments();
        if (!cancelled && docs.length > 0) {
          const doc = docs[0];
          setDocumentId(doc.id);
          setFilename(doc.filename);
          setLastUploadedFile({ name: doc.filename, size: doc.size_bytes });
        }
      } catch {
        // 忽略恢复失败，保持空状态
      }
    };

    loadLatestDocument();
    return () => {
      cancelled = true;
    };
  }, [documentId, searchParams]);

  const updateTaskInUrl = (tid: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tid) {
      params.set(TASK_PARAM, tid);
    } else {
      params.delete(TASK_PARAM);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const handleUploaded = (docId: string, name: string, sizeBytes: number, file?: File) => {
    setDocumentId(docId);
    setFilename(name);
    setLastUploadedFile({ name, size: sizeBytes });
    sourceFileRef.current = file ?? null;
    setTaskId(null);
    setTaskView(null);
    setTaskDetail(null);
    setTaskStatus(null);
    updateTaskInUrl(null);
  };

  const handleDeleteDocument = async () => {
    if (!documentId || deletingDocId) return;
    if (!window.confirm(tHome("deleteDocumentConfirm"))) {
      return;
    }
    setDeletingDocId(documentId);
    try {
      await api.deleteDocument(documentId);
      const prevId = documentId;
      setDocumentId(null);
      setFilename(null);
      setLastUploadedFile(null);
      setTaskId(null);
      setTaskView(null);
      setTaskDetail(null);
      setTaskStatus(null);
      updateTaskInUrl(null);
      const docs = await api.listDocuments();
      if (docs.length > 0 && docs[0].id !== prevId) {
        const doc = docs[0];
        setDocumentId(doc.id);
        setFilename(doc.filename);
        setLastUploadedFile({ name: doc.filename, size: doc.size_bytes });
      }
    } catch {
      setDeletingDocId(null);
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleTaskCreated = (tid: string) => {
    setTaskId(tid);
    setTaskStatus("queued");
    setTaskDetail(null);
    setTaskView(null); // 清空旧任务预览，避免仍显示上一页/旧译文
    taskCreatedAtRef.current = Date.now();
    defaultPageSetForTaskRef.current = null;
    updateTaskInUrl(tid);
  };

  // 任务状态：优先 SSE，失败时回退到 5s 轮询
  useEffect(() => {
    if (!taskId) return;

    let cancelled = false;

    const fetchViewOnce = async () => {
      try {
        const view = await api.getTaskView(taskId);
        if (!cancelled) setTaskView(view);
      } catch {
        // 忽略
      }
    };

    if (usePollingFallback) {
      const poll = async () => {
        try {
          const detail = await api.getTask(taskId);
          if (cancelled) return;
          setTaskStatus(detail.status);
          setTaskDetail(detail);
          if (detail.status === "completed" || detail.status === "failed") {
            await fetchViewOnce();
          }
        } catch {
          // 下一轮再试
        }
      };
      poll();
      const id = setInterval(poll, POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }

    const url = `/api/tasks/${taskId}/events`;
    const es = new EventSource(url);

    api.getTask(taskId).then((detail) => {
      if (!cancelled) {
        setTaskStatus(detail.status);
        setTaskDetail(detail);
        if (detail.status === "completed" || detail.status === "failed") {
          es.close();
          fetchViewOnce();
        }
      }
    }).catch(() => {
      if (!cancelled) setUsePollingFallback(true);
    });

    es.onmessage = (e) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(e.data) as {
          status: string;
          progress?: number | null;
          stage?: string | null;
          stage_current?: number | null;
          stage_total?: number | null;
          error_code?: string | null;
          error_message?: string | null;
        };
        setTaskStatus(data.status);
        setTaskDetail((prev) =>
          prev
            ? {
                ...prev,
                status: data.status,
                progress_percent: data.progress ?? prev.progress_percent,
                progress_stage: data.stage ?? prev.progress_stage,
                progress_current: data.stage_current ?? prev.progress_current,
                progress_total: data.stage_total ?? prev.progress_total,
                error_code: data.error_code ?? prev.error_code,
                error_message: data.error_message ?? prev.error_message,
              }
            : null
        );
        if (data.status === "completed" || data.status === "failed") {
          es.close();
          fetchViewOnce();
        }
      } catch {
        // 忽略解析错误
      }
    };

    es.onerror = () => {
      es.close();
      if (!cancelled) setUsePollingFallback(true);
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, [taskId, usePollingFallback]);

  // 处理中时按轮询间隔刷新，用于阶段提示文案
  useEffect(() => {
    if (taskStatus !== "processing") return;
    const id = setInterval(() => setTick((n) => n + 1), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [taskStatus]);

  // 进入任务页时若有 page_range，将原文/译文预览默认页设为选中范围第一页
  useEffect(() => {
    if (!taskId || !taskView?.task?.page_range || defaultPageSetForTaskRef.current === taskId) return;
    const range = parsePageRange(taskView.task.page_range);
    if (range) {
      setCurrentPage(range[0]);
      defaultPageSetForTaskRef.current = taskId;
    }
  }, [taskId, taskView?.task?.page_range]);

  const statusLabel = (s: string) => {
    const keyMap: Record<string, string> = {
      queued: "queued",
      processing: "processing",
      completed: "completed",
      failed: "failed",
    };
    return t(keyMap[s] || "status");
  };

  const taskProgress = (() => {
    if (!taskStatus) return 0;
    if (
      (taskStatus === "queued" || taskStatus === "processing") &&
      taskDetail?.progress_percent != null
    ) {
      return Math.min(100, Math.max(0, taskDetail.progress_percent));
    }
    switch (taskStatus) {
      case "queued":
        return 20;
      case "processing":
        return taskDetail?.progress_percent == null ? 50 : Math.min(100, Math.max(0, taskDetail.progress_percent));
      case "completed":
        return 100;
      case "failed":
        return 100;
      default:
        return 0;
    }
  })();

  const elapsedSeconds =
    taskCreatedAtRef.current != null
      ? (Date.now() - taskCreatedAtRef.current) / 1000
      : 0;
  const stageToPhaseKey: Record<string, string> = {
    started: "phaseStarted",
    translating: "phaseTranslating",
    uploading: "phaseUploading",
  };
  const phaseMessage =
    taskStatus === "queued"
      ? t("phaseQueued")
      : taskStatus === "processing"
        ? taskDetail?.progress_stage && stageToPhaseKey[taskDetail.progress_stage]
          ? t(stageToPhaseKey[taskDetail.progress_stage])
          : elapsedSeconds < 15
            ? t("phasePreprocess")
            : elapsedSeconds < 60
              ? t("phaseTranslating")
              : t("phaseGenerating")
        : null;
  const showLongTaskHint = elapsedSeconds > 30;

  const sourcePdfUrl = taskView?.source_pdf_url != null ? resolveApiUrl(taskView.source_pdf_url) : null;
  // 预签名 URL（R2 直连）不能追加 query，否则签名失效导致 400
  const isPresigned = (url: string) => /^https?:\/\//i.test(url);
  const withDisposition = (url: string, disp: string) =>
    isPresigned(url) ? url : `${url}${url.includes("?") ? "&" : "?"}disposition=${disp}`;
  // 译文预览优先用 primary_file_url（不含文件名，避免中文/编码 404），否则回退到 outputs[0]
  const translationOutput =
    taskView?.outputs?.find((f) => f.filename.toLowerCase().includes(".mono.")) ??
    taskView?.outputs?.[0];
  const targetPdfUrlRaw =
    taskView && (taskView.primary_file_url ?? translationOutput)
      ? taskView.primary_file_url
        ? withDisposition(taskView.primary_file_url, "inline")
        : withDisposition(translationOutput!.download_url, "inline")
      : null;
  const targetPdfUrl = targetPdfUrlRaw ? resolveApiUrl(targetPdfUrlRaw) : null;
  const pageRange = parsePageRange(taskView?.task.page_range ?? null);
  const isPageTranslated =
    pageRange == null ||
    (currentPage >= pageRange[0] && currentPage <= pageRange[1]);
  // 译文 PDF 仅包含已翻译页时，右侧页码为译文中的序号
  const targetPageInPdf =
    pageRange == null
      ? currentPage
      : isPageTranslated
        ? currentPage - pageRange[0] + 1
        : 1;
  const handleRightPageChange = (p: number) => setCurrentPage(p);

  const downloadUrlRaw =
    taskView?.can_download === true && (taskView?.primary_file_url || taskView?.outputs?.[0]?.download_url || taskId)
      ? taskView.primary_file_url
        ? withDisposition(taskView.primary_file_url, "attachment")
        : taskView.outputs?.[0]?.download_url
          ? withDisposition(taskView.outputs[0].download_url, "attachment")
          : `/api/tasks/${taskId}/file?disposition=attachment`
      : null;
  const downloadUrl = downloadUrlRaw ? resolveApiUrl(downloadUrlRaw) : null;

  const downloadError = searchParams.get("download_error"); // "login" | "not_found" | truthy

  const handleDownload = async () => {
    if (!downloadUrl || downloading) return;
    setDownloading(true);
    try {
      // 预签名 R2 URL 不能带 credentials；直连后端时带 token 以支持跨域静态部署
      const headers: HeadersInit = {};
      if (!isPresigned(downloadUrl)) {
        const token = await getSessionToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(downloadUrl, {
        credentials: isPresigned(downloadUrl) ? "omit" : "include",
        headers,
      });
      if (!res.ok) {
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (data?.detail === "login_required_to_download") {
            const params = new URLSearchParams(searchParams.toString());
            params.set("download_error", "login");
            router.push(`${pathname}?${params.toString()}`);
            return;
          }
        }
        if (res.status === 404) {
          const data = await res.json().catch(() => ({}));
          const params = new URLSearchParams(searchParams.toString());
          if (taskId) params.set("task", taskId);
          params.set("download_error", data?.detail === "task_not_found" ? "login" : "not_found");
          router.push(`${pathname}?${params.toString()}`);
          return;
        }
        return;
      }
      const contentType = (res.headers.get("Content-Type") ?? "").toLowerCase();
      if (!contentType.includes("pdf")) {
        const params = new URLSearchParams(searchParams.toString());
        if (taskId) params.set("task", taskId);
        params.set("download_error", "not_found");
        router.push(`${pathname}?${params.toString()}`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      let filename = "translation.pdf";
      if (disposition) {
        const utf8Match = disposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/i);
        if (utf8Match) filename = decodeURIComponent(utf8Match[1]);
        else {
          const match = disposition.match(/filename="?([^";\n]+)"?/i);
          if (match) filename = match[1];
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      const params = new URLSearchParams(searchParams.toString());
      if (taskId) params.set("task", taskId);
      params.set("download_error", "not_found");
      router.push(`${pathname}?${params.toString()}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Header />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {downloadError && (
          <p className="shrink-0 bg-amber-100 px-4 py-2 text-center text-sm text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            {downloadError === "login" ? tHome("downloadError") : tHome("downloadErrorNotFound")}
          </p>
        )}
        <div
          className={`flex-shrink-0 overflow-hidden transition-[max-height] duration-300 ${topRowCollapsed ? "max-h-12" : "max-h-[400px]"}`}
        >
          {topRowCollapsed ? (
            <div className="flex h-12 items-center justify-end border-b border-zinc-200 bg-zinc-50 px-4 dark:border-zinc-700 dark:bg-zinc-950 sm:px-6">
              <button
                type="button"
                onClick={() => setTopRowCollapsed(false)}
                aria-label={tHome("expand")}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <ChevronDown size={20} />
                <span className="text-sm font-medium">{tHome("expand")}</span>
              </button>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
                <div className="min-h-[88px] flex-1 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                  <UploadDropzone
                    onUploaded={handleUploaded}
                    initialFile={lastUploadedFile}
                  />
                  <div className="border-t border-zinc-100 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    {tHome.rich
                      ? tHome.rich("uploadFileNotice", {
                          strong: (chunks) => <span className="font-medium">{chunks}</span>,
                        })
                      : t("uploading") /* fallback, should not happen */}
                  </div>
                  {documentId && filename && (
                    <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400" title={filename}>
                        {tHome("currentDocument")}: {filename.length > 32 ? `${filename.slice(0, 29)}…` : filename}
                      </span>
                      <button
                        type="button"
                        onClick={handleDeleteDocument}
                        disabled={!!deletingDocId}
                        className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        title={tHome("deleteDocumentPermanently")}
                      >
                        {deletingDocId ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        <span>{tHome("deleteDocumentPermanently")}</span>
                      </button>
                    </div>
                  )}
                </div>
                {documentId && (
                  <div className="flex flex-[1.5] flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
                    <TranslationForm
                      documentId={documentId}
                      onTaskCreated={handleTaskCreated}
                      compact
                      taskStatus={taskStatus}
                      sourceFileRef={sourceFileRef}
                    />
                  </div>
                )}
                <HistoryPanel onSelectTask={(tid) => { setTaskId(tid); updateTaskInUrl(tid); }} />
                <button
                  type="button"
                  onClick={() => setTopRowCollapsed(true)}
                  aria-label={tHome("collapse")}
                  className="flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  <ChevronUp size={20} />
                </button>
              </div>

              {taskId && (
                <div className="mt-3 flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white/80 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900/80">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {taskStatus && statusLabel(taskStatus)}
                      {phaseMessage && ` · ${phaseMessage}`}
                      {(taskStatus === "queued" || taskStatus === "processing") && taskDetail?.progress_current != null && taskDetail?.progress_total != null && ` (${taskDetail.progress_current}/${taskDetail.progress_total})`}
                    </span>
                    {(taskStatus === "queued" || taskStatus === "processing") && (
                      <span className="font-medium">{taskProgress}%</span>
                    )}
                  </div>
                  <div className="h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <div
                      className="h-1 rounded-full bg-zinc-600 dark:bg-zinc-400 transition-[width] duration-500"
                      style={{ width: `${taskProgress}%` }}
                    />
                  </div>
                  {(taskStatus === "queued" || taskStatus === "processing") && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {tHome("translationPatience")}
                    </p>
                  )}
                  {taskStatus === "failed" && (taskView?.task?.error_message || taskView?.task?.error_code) && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {taskView.task.error_message ??
                        (taskView.task.error_code ? tErrors(taskView.task.error_code as any) : "")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden px-4 pb-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-[1600px] flex-1 min-h-0 gap-4">
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <p className="shrink-0 px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {tHome("sourceLabel")}
                </p>
                <div className="min-h-0 flex-1 overflow-auto">
                  <PdfViewerPane
                    fileUrl={sourcePdfUrl || ""}
                    mode="source"
                    page={currentPage}
                    onPageChange={setCurrentPage}
                  />
                </div>
              </div>
              <div className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <p className="shrink-0 px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {tHome("targetLabel")}
                </p>
                <div className="min-h-0 flex-1 overflow-auto">
                  {taskStatus === "completed" && targetPdfUrl && !isPageTranslated ? (
                    <div className="flex h-full min-h-[300px] items-center justify-center">
                      <span className="text-zinc-500">{tPdfViewer("pageNotTranslated")}</span>
                    </div>
                  ) : (
                    <PdfViewerPane
                      fileUrl={targetPdfUrl || ""}
                      mode="target"
                      placeholder={
                        taskId && !targetPdfUrl
                          ? taskStatus === "processing" || taskStatus === "queued"
                            ? t("targetPlaceholder")
                            : tPdfViewer("noPdf")
                          : undefined
                      }
                      page={targetPdfUrl ? targetPageInPdf : undefined}
                      onPageChange={targetPdfUrl ? handleRightPageChange : undefined}
                    />
                  )}
                </div>
                {taskStatus === "completed" && targetPdfUrl && downloadUrl && (
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading}
                    className="absolute bottom-4 right-4 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white shadow transition-colors hover:bg-zinc-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-700 dark:hover:bg-zinc-600"
                  >
                    {downloading ? (
                      <>
                        <Loader2 size={18} className="animate-spin shrink-0" />
                        <span>{tHome("downloading")}</span>
                      </>
                    ) : (
                      <>
                        <Download size={18} className="shrink-0" />
                        <span>{tHome("download")}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
