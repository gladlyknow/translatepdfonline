'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Clock,
  FileText,
  GitCompare,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useRouter } from '@/core/i18n/navigation';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';
import { SeoCarouselSection } from '@/shared/blocks/seo/seo-carousel-section';
import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { cn } from '@/shared/lib/utils';

import RelatedCompareLinks from './related-compare-links';

type HistoryJob = {
  id: string;
  status: string;
  baseFilename: string;
  compareFilename: string;
  baseFormat: string;
  compareFormat: string;
  similarity: string | null;
  totalDiff: number | null;
  errorMessage: string | null;
  createdAt: string;
};

const ALLOWED_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'DOCX',
  'application/msword': 'DOC',
  'application/vnd.ms-wps': 'WPS',
};

const MAX_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FALLBACKS: Record<string, string> = {
  deleteConfirm: 'Are you sure you want to delete this comparison?',
  comparisonDeleted: 'Comparison deleted',
  deleteFailed: 'Failed to delete comparison',
  comparisonComplete: 'Comparison complete!',
  compareFailedTitle: 'Comparison Failed',
  uploadFailed: 'Upload failed',
  startFailed: 'Failed to start comparison',
  comparisonStarted: 'Comparison started! This may take a minute.',
  compareHistory: 'History',
  noHistoryYet: 'No past comparisons yet',
  statusDone: 'Done',
  statusFailed: 'Failed',
  uploadOriginalFile: 'Upload Original File',
  uploadModifiedFile: 'Upload Modified File',
  uploadFormatHint: 'PDF, Word, PNG, JPG, BMP, TIFF (max 50MB)',
  removeFile: 'Remove',
  uploadFilesBtn: 'Upload Files',
  uploading: 'Uploading...',
  filesUploaded:
    'Files uploaded successfully! Click below to start the AI comparison.',
  startCompare: 'Start AI Comparison',
  startingCompare: 'Starting AI Comparison...',
  comparingDocuments: 'Comparing Documents',
  comparingDesc:
    'AI is analyzing both documents and identifying differences. This may take up to a minute.',
  statusSubmitted: 'Submitted',
  statusAnalyzing: 'Analyzing',
  statusComplete: 'Complete',
  compareFailedDesc: 'An unexpected error occurred. Please try again.',
  tryAgain: 'Try Again',
  trustText:
    'Sign-in is required. Files are transferred over encrypted connections and follow the published retention policy.',
  heroTitle: 'Compare Any Two Documents',
  heroText:
    'Upload any two files and let AI detect every insertion, deletion, and modification.',
  howItWorks: 'How It Works',
  howStep1Title: '1. Upload Two Files',
  howStep1Desc:
    'Start your contract comparison by dropping the original and modified documents — our contract comparison tool supports PDF, Word, and images with encrypted US-based transmission.',
  howStep2Title: '2. AI Comparison',
  howStep2Desc:
    'Our AI contract comparison engine aligns both documents and detects every insertion, deletion, and layout shift — professional contract comparison with page-level precision.',
  howStep3Title: '3. Review Side-by-Side',
  howStep3Desc:
    'Complete your contract comparison with color-coded side-by-side highlights — download the contract comparison report built for legal teams managing hundreds of contracts.',
  faqTitle: 'Frequently Asked Questions',
};

export default function DocumentCompareClient() {
  const t = useTranslations('pages.contract-comparison');

  const pt = useCallback(
    (key: string, fallback?: string) => {
      if (t.has(key)) return t(key as any);
      return fallback || FALLBACKS[key] || key;
    },
    [t]
  );

  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [compareFile, setCompareFile] = useState<File | null>(null);
  const [job, setJob] = useState<{
    id: string;
    status: string;
    baseFilename: string;
    compareFilename: string;
    baseFormat: string;
    compareFormat: string;
    hasResult: boolean;
    errorMessage: string | null;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragBase, setDragBase] = useState(false);
  const [dragCompare, setDragCompare] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyJobs, setHistoryJobs] = useState<HistoryJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ---- History ----
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const r = await fetch('/api/translator/compare?limit=20', {
        credentials: 'include',
      });
      const j = await r.json();
      if (j.code === 0 && Array.isArray(j.data?.jobs)) {
        setHistoryJobs(j.data.jobs as HistoryJob[]);
      }
    } catch {
      /* ignore */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (historyOpen) fetchHistory();
  }, [historyOpen, fetchHistory]);

  const handleDeleteHistory = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (!confirm(pt('deleteConfirm'))) return;
      try {
        const r = await fetch(`/api/translator/compare/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        const j = await r.json();
        if (j.code === 0) {
          toast.success(pt('comparisonDeleted'));
          setHistoryJobs((prev) => prev.filter((h) => h.id !== id));
        } else {
          toast.error(j.message || pt('deleteFailed'));
        }
      } catch {
        toast.error(pt('deleteFailed'));
      }
    },
    [pt]
  );

  // ---- Polling ----
  const startPoll = useCallback(
    (jobId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      const startTime = Date.now();
      setElapsed(0);
      pollRef.current = setInterval(async () => {
        try {
          setElapsed(Math.floor((Date.now() - startTime) / 1000));
          const r = await fetch(`/api/translator/compare/${jobId}/status`, {
            credentials: 'include',
          });
          const j = await r.json();
          const data = j.data as
            | {
                id: string;
                status: string;
                baseFilename: string;
                compareFilename: string;
                baseFormat: string;
                compareFormat: string;
                hasResult: boolean;
                errorMessage: string | null;
              }
            | undefined;
          if (data) {
            setJob(data);
            if (data.status === 'ready') {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setProcessing(false);
              toast.success(pt('comparisonComplete'));
              router.push(
                `/contract-comparison/${jobId}?from=contract-comparison`
              );
            } else if (data.status === 'failed') {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setProcessing(false);
              toast.error(data.errorMessage || pt('compareFailedTitle'));
            }
          }
        } catch {
          /* keep polling */
        }
      }, 7_000);
    },
    [router, pt]
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ---- Upload & Start ----
  const handleUpload = useCallback(async () => {
    if (!baseFile || !compareFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('baseFile', baseFile);
      fd.append('compareFile', compareFile);
      const r = await fetch('/api/translator/compare', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const j = await r.json();
      if (!r.ok || j.code !== 0)
        throw new Error(j.message || pt('uploadFailed'));
      const data = j.data as {
        job: {
          id: string;
          status: string;
          baseFilename: string;
          compareFilename: string;
          baseFormat: string;
          compareFormat: string;
        };
      };
      setJob({
        id: data.job.id,
        status: 'uploaded',
        baseFilename: data.job.baseFilename,
        compareFilename: data.job.compareFilename,
        baseFormat: data.job.baseFormat,
        compareFormat: data.job.compareFormat,
        hasResult: false,
        errorMessage: null,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : pt('uploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [baseFile, compareFile, pt]);

  const handleStart = useCallback(async () => {
    if (!job) return;
    setStarting(true);
    try {
      const r = await fetch(`/api/translator/compare/${job.id}/start`, {
        method: 'POST',
        credentials: 'include',
      });
      const j = await r.json();
      if (!r.ok || j.code !== 0)
        throw new Error(j.message || pt('startFailed'));
      setJob((prev) => (prev ? { ...prev, status: 'submitted' } : prev));
      setProcessing(true);
      startPoll(job.id);
      toast.success(pt('comparisonStarted'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : pt('startFailed'));
    } finally {
      setStarting(false);
    }
  }, [job, startPoll, pt]);

  const handleRetry = useCallback(() => {
    setJob(null);
    setBaseFile(null);
    setCompareFile(null);
    setProcessing(false);
  }, []);

  const primaryCta = (cls: string) => cn(TRANSLATE_PRIMARY_CTA_CLASSNAME, cls);

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {/* ── Upload Card ── */}
        <div className="bg-card relative rounded-2xl border border-2 p-5 md:p-8">
          {/* History button — top-right corner */}
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-4 right-4 gap-1.5"
            onClick={() => setHistoryOpen(true)}
          >
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">{pt('compareHistory')}</span>
          </Button>

          {/* Card header */}
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-700/10">
              <GitCompare className="size-5 text-sky-700" />
            </div>
            <div>
              <h2 className="text-foreground text-lg font-semibold">
                {pt('heroTitle')}
              </h2>
              <p className="text-muted-foreground text-xs">{pt('heroText')}</p>
            </div>
          </div>

          {!job || job.status === 'uploaded' ? (
            <section className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                {/* Base file */}
                <div
                  className={cn(
                    'relative flex min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors',
                    job
                      ? 'cursor-default border-green-300 bg-green-50/30 dark:bg-green-950/10'
                      : 'cursor-pointer',
                    !job && dragBase
                      ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/10'
                      : !job
                        ? 'border-muted-foreground/25 hover:border-sky-700/50'
                        : '',
                    !job && baseFile
                      ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/10'
                      : ''
                  )}
                  onDragOver={(e) => {
                    if (job) return;
                    e.preventDefault();
                    setDragBase(true);
                  }}
                  onDragLeave={() => {
                    if (!job) setDragBase(false);
                  }}
                  onDrop={(e) => {
                    if (job) return;
                    e.preventDefault();
                    setDragBase(false);
                    const f = e.dataTransfer.files[0];
                    if (f && ALLOWED_EXTENSIONS[f.type]) setBaseFile(f);
                  }}
                  onClick={() => {
                    if (!job) baseInputRef.current?.click();
                  }}
                >
                  {baseFile ? (
                    <div className="text-center">
                      <FileText
                        className={cn(
                          'mx-auto h-10 w-10',
                          job ? 'text-green-500' : 'text-sky-700'
                        )}
                      />
                      <p className="text-foreground mt-2 text-sm font-medium">
                        {baseFile.name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {ALLOWED_EXTENSIONS[baseFile.type] || ''} ·{' '}
                        {formatBytes(baseFile.size)}
                      </p>
                      {!job && (
                        <button
                          className="text-destructive mt-2 text-xs hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBaseFile(null);
                          }}
                        >
                          {pt('removeFile')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center">
                      <Upload className="text-muted-foreground mx-auto h-10 w-10" />
                      <p className="text-foreground mt-2 text-sm font-medium">
                        {pt('uploadOriginalFile')}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {pt('uploadFormatHint')}
                      </p>
                    </div>
                  )}
                  <input
                    ref={baseInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.wps,.png,.jpg,.jpeg,.bmp,.tiff"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setBaseFile(f);
                    }}
                  />
                </div>

                {/* Compare file */}
                <div
                  className={cn(
                    'relative flex min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors',
                    job
                      ? 'cursor-default border-green-300 bg-green-50/30 dark:bg-green-950/10'
                      : 'cursor-pointer',
                    !job && dragCompare
                      ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/10'
                      : !job
                        ? 'border-muted-foreground/25 hover:border-sky-700/50'
                        : '',
                    !job && compareFile
                      ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/10'
                      : ''
                  )}
                  onDragOver={(e) => {
                    if (job) return;
                    e.preventDefault();
                    setDragCompare(true);
                  }}
                  onDragLeave={() => {
                    if (!job) setDragCompare(false);
                  }}
                  onDrop={(e) => {
                    if (job) return;
                    e.preventDefault();
                    setDragCompare(false);
                    const f = e.dataTransfer.files[0];
                    if (f && ALLOWED_EXTENSIONS[f.type]) setCompareFile(f);
                  }}
                  onClick={() => {
                    if (!job) compareInputRef.current?.click();
                  }}
                >
                  {compareFile ? (
                    <div className="text-center">
                      <FileText
                        className={cn(
                          'mx-auto h-10 w-10',
                          job ? 'text-green-500' : 'text-sky-700'
                        )}
                      />
                      <p className="text-foreground mt-2 text-sm font-medium">
                        {compareFile.name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {ALLOWED_EXTENSIONS[compareFile.type] || ''} ·{' '}
                        {formatBytes(compareFile.size)}
                      </p>
                      {!job && (
                        <button
                          className="text-destructive mt-2 text-xs hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompareFile(null);
                          }}
                        >
                          {pt('removeFile')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center">
                      <Upload className="text-muted-foreground mx-auto h-10 w-10" />
                      <p className="text-foreground mt-2 text-sm font-medium">
                        {pt('uploadModifiedFile')}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {pt('uploadFormatHint')}
                      </p>
                    </div>
                  )}
                  <input
                    ref={compareInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.wps,.png,.jpg,.jpeg,.bmp,.tiff"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setCompareFile(f);
                    }}
                  />
                </div>
              </div>

              {job && job.status === 'uploaded' && (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
                  <span className="flex size-5 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white">
                    &#10003;
                  </span>
                  {pt('filesUploaded')}
                </div>
              )}

              <div className="flex justify-center gap-3">
                {!job ? (
                  <button
                    type="button"
                    disabled={!baseFile || !compareFile || uploading}
                    onClick={handleUpload}
                    className={cn(
                      primaryCta(
                        'flex items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-base font-bold'
                      ),
                      (!baseFile || !compareFile || uploading) &&
                        'cursor-not-allowed opacity-50'
                    )}
                  >
                    {uploading ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        {pt('uploading')}
                      </>
                    ) : (
                      <>
                        <Upload size={20} />
                        {pt('uploadFilesBtn')}
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={starting || job.status !== 'uploaded'}
                    onClick={handleStart}
                    className={cn(
                      primaryCta(
                        'flex items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-base font-bold'
                      ),
                      (starting || job.status !== 'uploaded') &&
                        'cursor-not-allowed opacity-50'
                    )}
                  >
                    {starting ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        {pt('startingCompare')}
                      </>
                    ) : (
                      <>
                        <GitCompare size={20} />
                        {pt('startCompare')}
                      </>
                    )}
                  </button>
                )}
              </div>
            </section>
          ) : null}

          {/* Processing */}
          {job &&
            (job.status === 'submitted' || job.status === 'processing') && (
              <section className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-12 w-12 animate-spin text-sky-700" />
                <p className="text-foreground mt-4 text-lg font-medium">
                  {pt('comparingDocuments')}
                </p>
                <p className="text-muted-foreground mt-2 text-sm">
                  {pt('comparingDesc')}
                </p>
                <div className="mt-8 flex items-center gap-4">
                  {[
                    { key: 'submitted', label: pt('statusSubmitted') },
                    { key: 'processing', label: pt('statusAnalyzing') },
                    { key: 'ready', label: pt('statusComplete') },
                  ].map((s, i) => {
                    const isDone =
                      job.status === 'ready' ||
                      (s.key === 'submitted' &&
                        (job.status === 'processing' ||
                          job.status === 'ready')) ||
                      (s.key === 'processing' && job.status === 'ready');
                    const isCurrent = job.status === s.key;
                    return (
                      <div key={s.key} className="flex items-center gap-2">
                        {i > 0 && (
                          <div
                            className={cn(
                              'h-px w-10',
                              isDone ? 'bg-green-400' : 'bg-sky-700/25'
                            )}
                          />
                        )}
                        <span
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                            isDone &&
                              'border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
                            isCurrent &&
                              'border-sky-700 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
                            !isDone &&
                              !isCurrent &&
                              'border-border bg-muted/50 text-muted-foreground/50'
                          )}
                        >
                          {isDone && '✓ '}
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-muted-foreground/60 mt-6 text-xs">
                  Elapsed: {elapsed}s
                </p>
              </section>
            )}

          {/* Failed */}
          {job && job.status === 'failed' && (
            <section className="flex flex-col items-center justify-center py-16">
              <div className="bg-destructive/10 rounded-full p-4">
                <FileText className="text-destructive h-10 w-10" />
              </div>
              <p className="text-foreground mt-4 text-lg font-medium">
                {pt('compareFailedTitle')}
              </p>
              <p className="text-muted-foreground mt-2 max-w-md text-center text-sm">
                {job.errorMessage || pt('compareFailedDesc')}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className={primaryCta(
                  'mt-6 flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold'
                )}
              >
                {pt('tryAgain')}
              </button>
            </section>
          )}
        </div>
        {/* end upload card */}

        {/* History Sheet */}
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent className="flex w-full flex-col sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-sky-700" />
                {pt('compareHistory')}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-sky-700" />
                </div>
              ) : historyJobs.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center text-sm">
                  {pt('noHistoryYet')}
                </p>
              ) : (
                historyJobs.map((h) => (
                  <div
                    key={h.id}
                    className={cn(
                      'cursor-pointer rounded-xl border px-4 py-3 transition-colors',
                      h.status === 'ready'
                        ? 'border-sky-700/30 bg-sky-50/50 hover:bg-sky-100/50 dark:bg-sky-950/10 dark:hover:bg-sky-950/20'
                        : 'border-border bg-muted/30'
                    )}
                    onClick={() => {
                      setHistoryOpen(false);
                      router.push(`/contract-comparison/${h.id}`);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-foreground truncate pr-2 text-sm font-semibold">
                        {h.baseFilename} vs {h.compareFilename}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            h.status === 'ready'
                              ? 'border border-green-300 bg-green-100 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400'
                              : h.status === 'failed'
                                ? 'border border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400'
                                : 'border border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400'
                          )}
                        >
                          {h.status === 'ready'
                            ? pt('statusDone')
                            : h.status === 'failed'
                              ? pt('statusFailed')
                              : h.status}
                        </span>
                        <button
                          className="text-muted-foreground/30 rounded-md p-1 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                          onClick={(e) => handleDeleteHistory(e, h.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                      <span>
                        {h.baseFormat.toUpperCase()} vs{' '}
                        {h.compareFormat.toUpperCase()}
                      </span>
                      {h.similarity && (
                        <span className="font-medium text-sky-700">
                          {h.similarity}
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground/50 mt-1 text-xs">
                      {new Date(h.createdAt).toLocaleString()}
                    </div>
                    {h.status === 'failed' && h.errorMessage && (
                      <div className="mt-1 line-clamp-2 text-xs text-red-600 dark:text-red-400">
                        {h.errorMessage}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Trust Notice */}
        <div className="border-border bg-muted/30 text-muted-foreground rounded-xl border px-4 py-3 text-center text-xs leading-relaxed">
          {pt('trustText')}
        </div>
      </div>

      {/* How It Works — carousel with full-width screenshots + SEO keywords */}
      <SeoCarouselSection
        title={pt('howItWorks')}
        variant="image"
        className="mt-10"
        items={[
          {
            img: '/imgs/features/Contract_Comparison_upload.png',
            title: pt('howStep1Title'),
            desc: pt('howStep1Desc'),
          },
          {
            img: '/imgs/features/Start_AI_Comparison.png',
            title: pt('howStep2Title'),
            desc: pt('howStep2Desc'),
          },
          {
            img: '/imgs/features/contract-comparison-preview.png',
            title: pt('howStep3Title'),
            desc: pt('howStep3Desc'),
          },
        ].map((s, i) => (
          <div key={i}>
            <Image
              src={s.img}
              alt={s.title}
              width={1200}
              height={630}
              className="border-border w-full rounded-xl border"
            />
            <h3 className="text-foreground mt-4 mb-2 text-lg font-semibold">
              {s.title}
            </h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {s.desc}
            </p>
          </div>
        ))}
      />

      {/* SEO Internal Links */}
      <div className="mx-auto w-full max-w-5xl">
        <RelatedCompareLinks />
      </div>
    </div>
  );
}
