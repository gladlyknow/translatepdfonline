'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { useRouter } from '@/core/i18n/navigation';
import { useTranslations } from 'next-intl';
import { CloudUpload, Download, Loader2, RotateCcw, FileText, Clock } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { cn } from '@/shared/lib/utils';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';

type JobStatus =
  | 'uploaded'
  | 'submitted'
  | 'processing'
  | 'ready'
  | 'failed';

type Job = {
  id: string;
  status: JobStatus;
  percent: number;
  hasDownload: boolean;
  errorMessage?: string | null;
};

type HistoryJob = {
  id: string;
  status: JobStatus;
  sourceFilename: string;
  percent: number;
  hasDownload: boolean;
  errorMessage?: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 7_000;

export function JpgToWordClient({ children }: { children?: ReactNode }) {
  const t = useTranslations('pages.jpg-to-word');
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyJobs, setHistoryJobs] = useState<HistoryJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPoll();
  }, [stopPoll]);

  const redirectToSignIn = useCallback(() => {
    const redirect =
      typeof window !== 'undefined' ? window.location.pathname : '';
    router.push(`/sign-in?redirect=${encodeURIComponent(redirect)}`);
  }, [router]);

  const handleFile = useCallback(
    (f: File | null) => {
      if (!f) return;
      const okType =
        f.type === 'image/jpeg' ||
        /\.jpe?g$/i.test(f.name);
      if (!okType) {
        toast.error(t('errorInvalidType'));
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(t('errorTooLarge'));
        return;
      }
      setFile(f);
      setJob(null);
      setLogs([]);
    },
    [t]
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragActive(false);
      const f = e.dataTransfer.files?.[0];
      handleFile(f ?? null);
    },
    [handleFile]
  );

  const onPick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      handleFile(f ?? null);
    },
    [handleFile]
  );

  const fetchStatus = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(`/api/doc-convert/jobs/${jobId}/status`, {
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (json.code !== 0) return null;
        const data = json.data as Job;
        return data;
      } catch {
        return null;
      }
    },
    []
  );

  const startPoll = useCallback(
    (jobId: string) => {
      jobIdRef.current = jobId;
      stopPoll();
      pollRef.current = setInterval(async () => {
        const s = await fetchStatus(jobId);
        if (!s) return;
        setJob(s);
        if (s.status === 'ready') {
          stopPoll();
          setProcessing(false);
          addLog(t('logReady'));
          // 自动下载
          window.open(`/api/doc-convert/jobs/${jobId}/download`, '_blank');
        } else if (s.status === 'failed') {
          stopPoll();
          setProcessing(false);
          addLog(t('logFailed'));
          toast.error(s.errorMessage || t('errorGeneric'));
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPoll, fetchStatus, addLog, t]
  );

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/doc-convert/upload', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (json.code !== 0) {
        const msg = String(json.message || '');
        if (msg.includes('no auth') || msg.includes('sign in')) {
          redirectToSignIn();
          return;
        }
        toast.error(msg || t('errorGeneric'));
        return;
      }
      const j = json.data?.job;
      if (!j) return;
      setJob({
        id: j.id,
        status: j.status,
        percent: 0,
        hasDownload: false,
      });
      addLog(t('logUploaded'));
      // 上传完成自动开始转换
      await handleStart(j.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setUploading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, addLog, t, redirectToSignIn]);

  const handleStart = useCallback(
    async (jobId?: string) => {
      const id = jobId ?? job?.id;
      if (!id) return;
      setProcessing(true);
      addLog(t('logSubmitting'));
      try {
        const res = await fetch(`/api/doc-convert/jobs/${id}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceFormat: 'jpg',
            targetFormat: 'word',
          }),
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (json.code !== 0) {
          const msg = String(json.message || '');
          if (msg.includes('no auth') || msg.includes('sign in')) {
            redirectToSignIn();
            return;
          }
          if (
            msg.toLowerCase().includes('insufficient credits') ||
            msg.toLowerCase().includes('credits')
          ) {
            toast.error(t('errorInsufficientCredits'));
            router.push('/pricing');
            return;
          }
          toast.error(msg || t('errorGeneric'));
          return;
        }
        addLog(t('logConverting'));
        startPoll(id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('errorGeneric'));
      } finally {
        // processing 在轮询 ready/failed 时关闭
      }
    },
    [job, addLog, t, startPoll, redirectToSignIn, router]
  );

  const handleDownload = useCallback(() => {
    const id = job?.id;
    if (!id) return;
    setDownloading(true);
    window.open(`/api/doc-convert/jobs/${id}/download`, '_blank');
    setTimeout(() => setDownloading(false), 1500);
  }, [job]);

  const handleRetry = useCallback(() => {
    setFile(null);
    setJob(null);
    setLogs([]);
    stopPoll();
  }, [stopPoll]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/doc-convert/jobs?limit=20', {
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (json.code !== 0) {
        const msg = String(json.message || '');
        if (msg.includes('no auth') || msg.includes('sign in')) {
          setHistoryOpen(false);
          redirectToSignIn();
          return;
        }
        toast.error(msg || t('errorGeneric'));
        setHistoryJobs([]);
        return;
      }
      setHistoryJobs((json.data?.jobs ?? []) as HistoryJob[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setHistoryLoading(false);
    }
  }, [redirectToSignIn, t]);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    void loadHistory();
  }, [loadHistory]);

  const downloadHistoryJob = useCallback((id: string) => {
    window.open(`/api/doc-convert/jobs/${id}/download`, '_blank');
  }, []);

  const retryHistoryJob = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/doc-convert/jobs/${id}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceFormat: 'jpg', targetFormat: 'word' }),
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (json.code !== 0) {
          const msg = String(json.message || '');
          if (msg.includes('no auth') || msg.includes('sign in')) {
            setHistoryOpen(false);
            redirectToSignIn();
            return;
          }
          if (
            msg.toLowerCase().includes('insufficient credits') ||
            msg.toLowerCase().includes('credits')
          ) {
            toast.error(t('errorInsufficientCredits'));
            setHistoryOpen(false);
            router.push('/pricing');
            return;
          }
          toast.error(msg || t('errorGeneric'));
          return;
        }
        toast.success(t('logConverting'));
        await loadHistory();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('errorGeneric'));
      }
    },
    [redirectToSignIn, t, router, loadHistory]
  );

  const statusLabel = useCallback(
    (s: JobStatus) => {
      if (s === 'ready') return t('historyStatusReady');
      if (s === 'failed') return t('historyStatusFailed');
      if (s === 'processing' || s === 'submitted') return t('historyStatusProcessing');
      return t('historyStatusUploaded');
    },
    [t]
  );

  const percent = job?.percent ?? 0;
  const isReady = job?.status === 'ready';
  const isFailed = job?.status === 'failed';

  return (
    <>
      {children}
      <div className="mx-auto mt-10 w-full max-w-3xl px-4">
        <div className="rounded-2xl border-2 border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={openHistory}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Clock className="h-4 w-4" /> {t('historyBtn')}
          </button>
        </div>
        {/* Dropzone */}
        {!file ? (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border px-6 py-12 text-center transition-colors hover:bg-accent/40',
              dragActive && 'border-sky-700 bg-accent/40'
            )}
          >
            <input
              type="file"
              accept="image/jpeg"
              className="hidden"
              onChange={onPick}
            />
            <CloudUpload className="size-10 text-sky-700" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {t('uploadHint')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('uploadSubHint')}
              </p>
            </div>
          </label>
        ) : (
          <div className="space-y-4">
            {/* File info */}
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {file.type} · {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRetry}
                disabled={processing || uploading}
              >
                {t('btnChange')}
              </Button>
            </div>

            {/* Steps */}
            <div className="flex items-center justify-between text-xs">
              <StepDot
                active={!!job || uploading}
                label={t('stepUploaded')}
              />
              <StepLine active={!!job} />
              <StepDot
                active={!!job && !isReady && !isFailed}
                label={t('stepConverting')}
              />
              <StepLine active={isReady} />
              <StepDot active={isReady} label={t('stepReady')} />
            </div>

            {/* Progress bar */}
            {job && !isReady ? (
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-sky-700 transition-all"
                    style={{ width: `${Math.max(5, percent)}%` }}
                  />
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  {percent}%
                </p>
              </div>
            ) : null}

            {/* Logs */}
            {logs.length > 0 ? (
              <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-background p-3">
                {logs.map((l, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {l}
                  </p>
                ))}
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              {!job && !uploading ? (
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploading}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-bold transition-all disabled:opacity-50',
                    TRANSLATE_PRIMARY_CTA_CLASSNAME
                  )}
                >
                  <CloudUpload className="size-5" />
                  {t('btnUploadStart')}
                </button>
              ) : null}
              {uploading ? (
                <button
                  type="button"
                  disabled
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-bold transition-all disabled:opacity-50',
                    TRANSLATE_PRIMARY_CTA_CLASSNAME
                  )}
                >
                  <Loader2 className="size-5 animate-spin" />
                  {t('btnUploading')}
                </button>
              ) : null}
              {job && !isReady && !isFailed && !processing ? (
                <button
                  type="button"
                  disabled
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-bold transition-all disabled:opacity-50',
                    TRANSLATE_PRIMARY_CTA_CLASSNAME
                  )}
                >
                  <Loader2 className="size-5 animate-spin" />
                  {t('btnConverting')}
                </button>
              ) : null}
              {processing ? (
                <button
                  type="button"
                  disabled
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-bold transition-all disabled:opacity-50',
                    TRANSLATE_PRIMARY_CTA_CLASSNAME
                  )}
                >
                  <Loader2 className="size-5 animate-spin" />
                  {t('btnConverting')}
                </button>
              ) : null}
              {isReady ? (
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-bold transition-all disabled:opacity-50',
                    TRANSLATE_PRIMARY_CTA_CLASSNAME
                  )}
                >
                  <Download className="size-5" />
                  {t('btnDownload')}
                </button>
              ) : null}
              {isFailed ? (
                <Button variant="outline" onClick={handleRetry}>
                  <RotateCcw className="size-4" />
                  {t('btnRetry')}
                </Button>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">{t('loginHint')}</p>
          </div>
        )}
      </div>

      {/* History drawer */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col overflow-hidden sm:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>{t('historyTitle')}</SheetTitle>
          </SheetHeader>
          <div className="max-h-[70vh] flex-1 overflow-y-auto px-4 pb-6">
            {historyLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('historyLoading')}
              </div>
            ) : historyJobs.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t('historyEmpty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {historyJobs.map((j) => (
                  <li
                    key={j.id}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:border-sky-300/80 hover:bg-accent/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {j.sourceFilename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {statusLabel(j.status)} ·{' '}
                        {new Date(j.createdAt).toLocaleString()}
                      </p>
                      {j.status === 'failed' && j.errorMessage ? (
                        <p className="mt-1 truncate text-xs text-rose-600">
                          {j.errorMessage}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        j.status === 'ready'
                          ? 'bg-emerald-100 text-emerald-700'
                          : j.status === 'failed'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {statusLabel(j.status)}
                    </span>
                    {j.hasDownload ? (
                      <button
                        type="button"
                        onClick={() => downloadHistoryJob(j.id)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-accent transition-colors"
                      >
                        <Download className="size-3.5" />
                        {t('btnDownload')}
                      </button>
                    ) : null}
                    {j.status === 'failed' ? (
                      <button
                        type="button"
                        onClick={() => retryHistoryJob(j.id)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-accent transition-colors"
                      >
                        <RotateCcw className="size-3.5" />
                        {t('btnRetry')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
    </>
  );
}

function StepDot({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={cn(
          'flex size-6 items-center justify-center rounded-full text-[10px] font-bold',
          active
            ? 'bg-sky-700 text-white'
            : 'bg-muted text-muted-foreground'
        )}
      >
        •
      </span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function StepLine({ active }: { active: boolean }) {
  return (
    <div
      className={cn(
        'h-0.5 flex-1',
        active ? 'bg-sky-700' : 'bg-muted'
      )}
    />
  );
}
