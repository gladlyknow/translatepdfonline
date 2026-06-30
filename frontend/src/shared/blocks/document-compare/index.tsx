'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/core/i18n/navigation';
import { toast } from 'sonner';
import Image from 'next/image';
import { Clock, FileText, Loader2, Trash2, Upload, GitCompare } from 'lucide-react';
import { SeoCarouselSection } from '@/shared/blocks/seo/seo-carousel-section';

import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { cn } from '@/shared/lib/utils';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';
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
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
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
  filesUploaded: 'Files uploaded successfully! Click below to start the AI comparison.',
  startCompare: 'Start AI Comparison',
  startingCompare: 'Starting AI Comparison...',
  comparingDocuments: 'Comparing Documents',
  comparingDesc: 'AI is analyzing both documents and identifying differences. This may take up to a minute.',
  statusSubmitted: 'Submitted',
  statusAnalyzing: 'Analyzing',
  statusComplete: 'Complete',
  compareFailedDesc: 'An unexpected error occurred. Please try again.',
  tryAgain: 'Try Again',
  trustText: 'Your files are transmitted over encrypted connections and automatically deleted after processing.',
  heroTitle: 'Compare Any Two Documents',
  heroText: 'Upload any two files and let AI detect every insertion, deletion, and modification.',
  howItWorks: 'How It Works',
  howStep1Title: 'Upload Two Files',
  howStep1Desc: 'Drop the original and modified documents. Works with PDF, Word, or images.',
  howStep2Title: 'AI Compares Everything',
  howStep2Desc: 'Our AI aligns both documents and detects every insertion, deletion, font change, and layout shift.',
  howStep3Title: 'Review Differences',
  howStep3Desc: 'Side-by-side diff view highlights every change with page-level precision.',
  faqTitle: 'Frequently Asked Questions',
  previewTitle: 'See It In Action',
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
    id: string; status: string; baseFilename: string; compareFilename: string;
    baseFormat: string; compareFormat: string; hasResult: boolean; errorMessage: string | null;
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
      const r = await fetch('/api/translator/compare?limit=20', { credentials: 'include' });
      const j = await r.json();
      if (j.code === 0 && Array.isArray(j.data?.jobs)) {
        setHistoryJobs(j.data.jobs as HistoryJob[]);
      }
    } catch { /* ignore */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { if (historyOpen) fetchHistory(); }, [historyOpen, fetchHistory]);

  const handleDeleteHistory = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(pt('deleteConfirm'))) return;
    try {
      const r = await fetch(`/api/translator/compare/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json();
      if (j.code === 0) {
        toast.success(pt('comparisonDeleted'));
        setHistoryJobs((prev) => prev.filter((h) => h.id !== id));
      } else { toast.error(j.message || pt('deleteFailed')); }
    } catch { toast.error(pt('deleteFailed')); }
  }, [pt]);

  // ---- Polling ----
  const startPoll = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const startTime = Date.now();
    setElapsed(0);
    pollRef.current = setInterval(async () => {
      try {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
        const r = await fetch(`/api/translator/compare/${jobId}/status`, { credentials: 'include' });
        const j = await r.json();
        const data = j.data as { id: string; status: string; baseFilename: string; compareFilename: string; baseFormat: string; compareFormat: string; hasResult: boolean; errorMessage: string | null; } | undefined;
        if (data) {
          setJob(data);
          if (data.status === 'ready') {
            if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null;
            setProcessing(false);
            toast.success(pt('comparisonComplete'));
            router.push(`/contract-comparison/${jobId}?from=contract-comparison`);
          } else if (data.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null;
            setProcessing(false);
            toast.error(data.errorMessage || pt('compareFailedTitle'));
          }
        }
      } catch { /* keep polling */ }
    }, 7_000);
  }, [router, pt]);

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  // ---- Upload & Start ----
  const handleUpload = useCallback(async () => {
    if (!baseFile || !compareFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('baseFile', baseFile); fd.append('compareFile', compareFile);
      const r = await fetch('/api/translator/compare', { method: 'POST', credentials: 'include', body: fd });
      const j = await r.json();
      if (!r.ok || j.code !== 0) throw new Error(j.message || pt('uploadFailed'));
      const data = j.data as { job: { id: string; status: string; baseFilename: string; compareFilename: string; baseFormat: string; compareFormat: string } };
      setJob({ id: data.job.id, status: 'uploaded', baseFilename: data.job.baseFilename, compareFilename: data.job.compareFilename, baseFormat: data.job.baseFormat, compareFormat: data.job.compareFormat, hasResult: false, errorMessage: null });
    } catch (e) { toast.error(e instanceof Error ? e.message : pt('uploadFailed')); }
    finally { setUploading(false); }
  }, [baseFile, compareFile, pt]);

  const handleStart = useCallback(async () => {
    if (!job) return;
    setStarting(true);
    try {
      const r = await fetch(`/api/translator/compare/${job.id}/start`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok || j.code !== 0) throw new Error(j.message || pt('startFailed'));
      setJob((prev) => (prev ? { ...prev, status: 'submitted' } : prev));
      setProcessing(true); startPoll(job.id);
      toast.success(pt('comparisonStarted'));
    } catch (e) { toast.error(e instanceof Error ? e.message : pt('startFailed')); }
    finally { setStarting(false); }
  }, [job, startPoll, pt]);

  const handleRetry = useCallback(() => {
    setJob(null); setBaseFile(null); setCompareFile(null); setProcessing(false);
  }, []);

  const primaryCta = (cls: string) => cn(TRANSLATE_PRIMARY_CTA_CLASSNAME, cls);

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {/* ── Upload Card ── */}
        <div className="relative rounded-2xl border-2 border bg-card p-5 md:p-8">
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
          <div className="flex items-center gap-3 mb-6">
            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-700/10">
              <GitCompare className="size-5 text-sky-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{pt('heroTitle')}</h2>
              <p className="text-xs text-muted-foreground">{pt('heroText')}</p>
            </div>
          </div>

          {!job || job.status === 'uploaded' ? (
            <section className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                {/* Base file */}
                <div
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors min-h-[200px]',
                    job ? 'cursor-default border-green-300 bg-green-50/30 dark:bg-green-950/10' : 'cursor-pointer',
                    !job && dragBase ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/10' : !job ? 'border-muted-foreground/25 hover:border-sky-700/50' : '',
                    !job && baseFile ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/10' : ''
                  )}
                  onDragOver={(e) => { if (job) return; e.preventDefault(); setDragBase(true); }}
                  onDragLeave={() => { if (!job) setDragBase(false); }}
                  onDrop={(e) => { if (job) return; e.preventDefault(); setDragBase(false); const f = e.dataTransfer.files[0]; if (f && ALLOWED_EXTENSIONS[f.type]) setBaseFile(f); }}
                  onClick={() => { if (!job) baseInputRef.current?.click(); }}
                >
                  {baseFile ? (
                    <div className="text-center">
                      <FileText className={cn('mx-auto h-10 w-10', job ? 'text-green-500' : 'text-sky-700')} />
                      <p className="mt-2 font-medium text-sm text-foreground">{baseFile.name}</p>
                      <p className="text-xs text-muted-foreground">{ALLOWED_EXTENSIONS[baseFile.type] || ''} · {formatBytes(baseFile.size)}</p>
                      {!job && <button className="mt-2 text-xs text-destructive hover:underline" onClick={(e) => { e.stopPropagation(); setBaseFile(null); }}>{pt('removeFile')}</button>}
                    </div>
                  ) : (
                    <div className="text-center">
                      <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
                      <p className="mt-2 font-medium text-sm text-foreground">{pt('uploadOriginalFile')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{pt('uploadFormatHint')}</p>
                    </div>
                  )}
                  <input ref={baseInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.wps,.png,.jpg,.jpeg,.bmp,.tiff" onChange={(e) => { const f = e.target.files?.[0]; if (f) setBaseFile(f); }} />
                </div>

                {/* Compare file */}
                <div
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors min-h-[200px]',
                    job ? 'cursor-default border-green-300 bg-green-50/30 dark:bg-green-950/10' : 'cursor-pointer',
                    !job && dragCompare ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/10' : !job ? 'border-muted-foreground/25 hover:border-sky-700/50' : '',
                    !job && compareFile ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/10' : ''
                  )}
                  onDragOver={(e) => { if (job) return; e.preventDefault(); setDragCompare(true); }}
                  onDragLeave={() => { if (!job) setDragCompare(false); }}
                  onDrop={(e) => { if (job) return; e.preventDefault(); setDragCompare(false); const f = e.dataTransfer.files[0]; if (f && ALLOWED_EXTENSIONS[f.type]) setCompareFile(f); }}
                  onClick={() => { if (!job) compareInputRef.current?.click(); }}
                >
                  {compareFile ? (
                    <div className="text-center">
                      <FileText className={cn('mx-auto h-10 w-10', job ? 'text-green-500' : 'text-sky-700')} />
                      <p className="mt-2 font-medium text-sm text-foreground">{compareFile.name}</p>
                      <p className="text-xs text-muted-foreground">{ALLOWED_EXTENSIONS[compareFile.type] || ''} · {formatBytes(compareFile.size)}</p>
                      {!job && <button className="mt-2 text-xs text-destructive hover:underline" onClick={(e) => { e.stopPropagation(); setCompareFile(null); }}>{pt('removeFile')}</button>}
                    </div>
                  ) : (
                    <div className="text-center">
                      <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
                      <p className="mt-2 font-medium text-sm text-foreground">{pt('uploadModifiedFile')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{pt('uploadFormatHint')}</p>
                    </div>
                  )}
                  <input ref={compareInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.wps,.png,.jpg,.jpeg,.bmp,.tiff" onChange={(e) => { const f = e.target.files?.[0]; if (f) setCompareFile(f); }} />
                </div>
              </div>

              {job && job.status === 'uploaded' && (
                <div className="flex items-center justify-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2.5">
                  <span className="size-5 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold">&#10003;</span>
                  {pt('filesUploaded')}
                </div>
              )}

              <div className="flex justify-center gap-3">
                {!job ? (
                  <button
                    type="button"
                    disabled={!baseFile || !compareFile || uploading}
                    onClick={handleUpload}
                    className={cn(primaryCta('flex items-center justify-center gap-2 rounded-xl py-3.5 px-8 text-base font-bold'), (!baseFile || !compareFile || uploading) && 'opacity-50 cursor-not-allowed')}
                  >
                    {uploading ? <><Loader2 size={20} className="animate-spin" />{pt('uploading')}</> : <><Upload size={20} />{pt('uploadFilesBtn')}</>}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={starting || job.status !== 'uploaded'}
                    onClick={handleStart}
                    className={cn(primaryCta('flex items-center justify-center gap-2 rounded-xl py-3.5 px-8 text-base font-bold'), (starting || job.status !== 'uploaded') && 'opacity-50 cursor-not-allowed')}
                  >
                    {starting ? <><Loader2 size={20} className="animate-spin" />{pt('startingCompare')}</> : <><GitCompare size={20} />{pt('startCompare')}</>}
                  </button>
                )}
              </div>
            </section>
          ) : null}

          {/* Processing */}
          {job && (job.status === 'submitted' || job.status === 'processing') && (
            <section className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-12 w-12 animate-spin text-sky-700" />
              <p className="mt-4 text-lg font-medium text-foreground">{pt('comparingDocuments')}</p>
              <p className="mt-2 text-sm text-muted-foreground">{pt('comparingDesc')}</p>
              <div className="mt-8 flex items-center gap-4">
                {[{ key: 'submitted', label: pt('statusSubmitted') }, { key: 'processing', label: pt('statusAnalyzing') }, { key: 'ready', label: pt('statusComplete') }].map((s, i) => {
                  const isDone = job.status === 'ready' || (s.key === 'submitted' && (job.status === 'processing' || job.status === 'ready')) || (s.key === 'processing' && job.status === 'ready');
                  const isCurrent = job.status === s.key;
                  return (
                    <div key={s.key} className="flex items-center gap-2">
                      {i > 0 && <div className={cn('h-px w-10', isDone ? 'bg-green-400' : 'bg-sky-700/25')} />}
                      <span className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors', isDone && 'border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400', isCurrent && 'border-sky-700 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300', !isDone && !isCurrent && 'border-border bg-muted/50 text-muted-foreground/50')}>{isDone && '✓ '}{s.label}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-6 text-xs text-muted-foreground/60">Elapsed: {elapsed}s</p>
            </section>
          )}

          {/* Failed */}
          {job && job.status === 'failed' && (
            <section className="flex flex-col items-center justify-center py-16">
              <div className="rounded-full bg-destructive/10 p-4"><FileText className="h-10 w-10 text-destructive" /></div>
              <p className="mt-4 text-lg font-medium text-foreground">{pt('compareFailedTitle')}</p>
              <p className="mt-2 text-sm text-muted-foreground max-w-md text-center">{job.errorMessage || pt('compareFailedDesc')}</p>
              <button type="button" onClick={handleRetry} className={primaryCta('flex items-center justify-center gap-2 rounded-xl py-3 px-6 text-sm font-bold mt-6')}>{pt('tryAgain')}</button>
            </section>
          )}
        </div>{/* end upload card */}

        {/* History Sheet */}
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent className="flex w-full flex-col sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-sky-700" />{pt('compareHistory')}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 flex-1 overflow-y-auto space-y-2">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-sky-700" /></div>
              ) : historyJobs.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">{pt('noHistoryYet')}</p>
              ) : (
                historyJobs.map((h) => (
                  <div key={h.id} className={cn('rounded-xl border px-4 py-3 transition-colors cursor-pointer', h.status === 'ready' ? 'border-sky-700/30 bg-sky-50/50 hover:bg-sky-100/50 dark:bg-sky-950/10 dark:hover:bg-sky-950/20' : 'border-border bg-muted/30')}
                    onClick={() => { setHistoryOpen(false); router.push(`/contract-comparison/${h.id}`); }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground truncate pr-2">{h.baseFilename} vs {h.compareFilename}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', h.status === 'ready' ? 'bg-green-100 text-green-700 border border-green-300 dark:bg-green-950 dark:text-green-400 dark:border-green-800' : h.status === 'failed' ? 'bg-red-100 text-red-700 border border-red-300 dark:bg-red-950 dark:text-red-400 dark:border-red-800' : 'bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800')}>
                          {h.status === 'ready' ? pt('statusDone') : h.status === 'failed' ? pt('statusFailed') : h.status}
                        </span>
                        <button className="p-1 rounded-md text-muted-foreground/30 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors" onClick={(e) => handleDeleteHistory(e, h.id)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{h.baseFormat.toUpperCase()} vs {h.compareFormat.toUpperCase()}</span>
                      {h.similarity && <span className="text-sky-700 font-medium">{h.similarity}</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground/50">{new Date(h.createdAt).toLocaleString()}</div>
                    {h.status === 'failed' && h.errorMessage && <div className="mt-1 text-xs text-red-600 dark:text-red-400 line-clamp-2">{h.errorMessage}</div>}
                  </div>
                ))
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Trust Notice */}
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground leading-relaxed">
          {pt('trustText')}
        </div>
      </div>

      {/* How It Works */}
      <section className="mx-auto w-full max-w-5xl mt-10">
        <h2 className="text-2xl font-bold text-center mb-8 text-foreground">{pt('howItWorks')}</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {[{ step: '1', title: pt('howStep1Title'), desc: pt('howStep1Desc') }, { step: '2', title: pt('howStep2Title'), desc: pt('howStep2Desc') }, { step: '3', title: pt('howStep3Title'), desc: pt('howStep3Desc') }].map((s) => (
            <div key={s.step} className="rounded-2xl border-2 border bg-card p-6 text-center">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-sky-700/10 text-sky-700 text-lg font-bold">{s.step}</div>
              <h3 className="text-base font-semibold text-foreground mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Preview Screenshot */}
      <section className="mx-auto w-full max-w-5xl mt-10">
        <h2 className="text-2xl font-bold text-center mb-6 text-foreground">{pt('previewTitle', 'See It In Action')}</h2>
        <Image
          src="/imgs/features/contract-comparison-preview.png"
          alt="Contract Comparison Preview"
          width={1200}
          height={630}
          className="w-full rounded-xl border border-border shadow-sm"
        />
      </section>

      {/* FAQ — server-rendered for SEO, carousel for UX */}
      <SeoCarouselSection
        title={pt('faqTitle')}
        variant="card"
        items={[1, 2, 3, 4, 5, 6, 7, 8]
          .map((n) => {
            const q = pt(`seoFaq.q${n}`, ''); const a = pt(`seoFaq.a${n}`, '');
            if (!q || !a) return null;
            return (<div key={n} className="px-2"><h3 className="text-base font-semibold text-foreground mb-3">{q}</h3><p className="text-sm text-muted-foreground leading-relaxed">{a}</p></div>);
          })
          .filter(Boolean) as React.ReactNode[]}
        className="mt-10 border-t pt-8"
      />

      {/* SEO Internal Links */}
      <div className="mx-auto w-full max-w-5xl"><RelatedCompareLinks /></div>
    </div>
  );
}
