'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FileText, GitCompare, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';
import { useRouter } from '@/core/i18n/navigation';
import CompareResultCustom from './compare-result-custom';
import CompareViewer from './compare-viewer';

type JobData = {
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

const FALLBACKS: Record<string, string> = {
  deleteConfirm: 'Are you sure you want to delete this comparison?',
  comparisonDeleted: 'Comparison deleted',
  deleteFailed: 'Failed to delete comparison',
  comparisonNotFound: 'Comparison not found',
  comparisonNotFoundDesc: 'This comparison may have been deleted or you may not have permission to view it.',
  backToDocCompare: 'Back to Contract Comparison',
  comparingDocuments: 'Comparing Documents',
  comparingDesc: 'AI is analyzing both documents and identifying differences.',
  statusSubmitted: 'Submitted',
  statusAnalyzing: 'Analyzing',
  statusComplete: 'Complete',
  compareFailedTitle: 'Comparison Failed',
  compareFailedDesc: 'An unexpected error occurred. Please try again.',
  newComparison: 'New Comparison',
  retry: 'Retry',
  back: 'Back',
  delete: 'Delete',
  trustText: 'Your files are transmitted over encrypted connections and automatically deleted after processing.',
};

export default function CompareResultPageClient({ jobId }: { jobId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromPage = searchParams.get('from');
  const t = useTranslations('pages.contract-comparison');

  const pt = useCallback(
    (key: string) => {
      if (t.has(key)) return t(key as any);
      return FALLBACKS[key] || key;
    },
    [t]
  );

  const [job, setJob] = useState<JobData | null>(null);
  const [sdkUrl, setSdkUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'not_found' | 'polling' | 'ready' | 'failed'>('loading');
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef<number>(0);

  const backUrl = fromPage ? `/${fromPage}` : '/contract-comparison';

  const handleDelete = useCallback(async () => {
    if (!confirm(pt('deleteConfirm'))) return;
    try {
      const r = await fetch(`/api/translator/compare/${jobId}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json();
      if (j.code === 0) { toast.success(pt('comparisonDeleted')); router.push(backUrl); }
      else { toast.error(j.message || pt('deleteFailed')); }
    } catch { toast.error(pt('deleteFailed')); }
  }, [jobId, router, backUrl, pt]);

  const fetchJob = useCallback(async () => {
    try {
      const r = await fetch(`/api/translator/compare/${jobId}`, { credentials: 'include' });
      const j = await r.json();
      if (j.code === 0 && j.data?.job) {
        const d = j.data.job as JobData;
        setJob(d);
        if (d.status === 'ready') setState('ready');
        else if (d.status === 'failed') setState('failed');
        else setState('polling');
      } else { setState('not_found'); }
    } catch { setState('not_found'); }
  }, [jobId]);

  const fetchSdkUrl = useCallback(async () => {
    try {
      const r = await fetch(`/api/translator/compare/${jobId}/sdk-url`, { credentials: 'include' });
      const j = await r.json();
      if (j.code === 0 && j.data?.sdkUrl) setSdkUrl(j.data.sdkUrl);
    } catch { /* retry later */ }
  }, [jobId]);

  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollStartedAt.current = Date.now();
    setElapsed(0);
    pollRef.current = setInterval(async () => {
      setElapsed(Math.floor((Date.now() - pollStartedAt.current) / 1000));
      try {
        const r = await fetch(`/api/translator/compare/${jobId}/status`, { credentials: 'include' });
        const j = await r.json();
        const data = j.data as JobData | undefined;
        if (data) {
          setJob(data);
          if (data.status === 'ready') { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; setState('ready'); }
          else if (data.status === 'failed') { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; setState('failed'); }
        }
      } catch { /* keep polling */ }
    }, 7_000);
  }, [jobId]);

  useEffect(() => { if (state === 'ready' && !sdkUrl) fetchSdkUrl(); }, [state, sdkUrl, fetchSdkUrl]);
  useEffect(() => { fetchJob(); }, [fetchJob]);
  useEffect(() => { if (state === 'polling') startPoll(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [state, startPoll]);

  if (state === 'loading') {
    return <div className="min-h-dvh w-full flex items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-sky-700" /></div>;
  }

  if (state === 'not_found') {
    return (
      <div className="min-h-dvh w-full bg-background">
        <div className="mx-auto max-w-[1800px] px-4 pt-24 sm:pt-28 pb-8 sm:pb-12">
          <div className="flex flex-col items-center justify-center py-20">
            <FileText className="h-16 w-16 text-muted-foreground/30" />
            <p className="mt-4 text-lg font-medium text-foreground">{pt('comparisonNotFound')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{pt('comparisonNotFoundDesc')}</p>
            <Button className="mt-6" onClick={() => router.push(backUrl)}>{pt('backToDocCompare')}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'polling') {
    return (
      <div className="min-h-dvh w-full bg-background">
        <div className="mx-auto max-w-[1800px] px-4 pt-20 sm:pt-24 pb-4 sm:pb-6">
          <section className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-12 w-12 animate-spin text-sky-700" />
            <p className="mt-4 text-lg font-medium text-foreground">{pt('comparingDocuments')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{pt('comparingDesc')}</p>
            {job && <p className="mt-2 text-xs text-muted-foreground/60">{job.baseFilename} vs {job.compareFilename}</p>}
            <div className="mt-8 flex items-center gap-4">
              {[{ key: 'submitted', label: pt('statusSubmitted') }, { key: 'processing', label: pt('statusAnalyzing') }, { key: 'ready', label: pt('statusComplete') }].map((s, i) => {
                const currentIdx = job ? ['submitted', 'processing', 'ready'].indexOf(job.status) : -1;
                const isDone = currentIdx > i;
                const isCurrent = currentIdx === i || (job && job.status === s.key);
                return (
                  <div key={s.key} className="flex items-center gap-2">
                    {i > 0 && <div className={cn('h-px w-10', isDone ? 'bg-green-400' : 'bg-sky-700/25')} />}
                    <span className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors', isDone && 'border-green-500 bg-green-50 text-green-700', isCurrent && 'border-sky-700 bg-sky-50 text-sky-700', !isDone && !isCurrent && 'border-border bg-muted/50 text-muted-foreground/50')}>{isDone && '✓ '}{s.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-xs text-muted-foreground/60">Elapsed: {elapsed}s</p>
          </section>
        </div>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="min-h-dvh w-full bg-background">
        <div className="mx-auto max-w-[1800px] px-4 pt-20 sm:pt-24 pb-4 sm:pb-6">
          <section className="flex flex-col items-center justify-center py-16">
            <div className="rounded-full bg-destructive/10 p-4"><FileText className="h-10 w-10 text-destructive" /></div>
            <p className="mt-4 text-lg font-medium text-foreground">{pt('compareFailedTitle')}</p>
            <p className="mt-2 text-sm text-muted-foreground max-w-md text-center">{job?.errorMessage || pt('compareFailedDesc')}</p>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => router.push(backUrl)} className={cn(TRANSLATE_PRIMARY_CTA_CLASSNAME, 'inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-5 text-sm font-bold')}>{pt('newComparison')}</button>
              <Button variant="outline" onClick={() => window.location.reload()}>{pt('retry')}</Button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full bg-background">
      <div className="mx-auto max-w-[1800px] px-4 pt-20 sm:pt-24 pb-4 sm:pb-6">
        {/* Header bar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={() => router.push(backUrl)} className="gap-1 text-sm h-8 px-2">&larr; {pt('back')}</Button>
            <span className="text-muted-foreground/30">|</span>
            <FileText className="h-4 w-4 text-sky-700" />
            <span className="font-semibold text-foreground">{job?.baseFilename}</span>
            <span className="text-xs text-muted-foreground/60">{job?.baseFormat?.toUpperCase()}</span>
            <GitCompare className="h-3 w-3 text-muted-foreground/40" />
            <FileText className="h-4 w-4 text-sky-700" />
            <span className="font-semibold text-foreground">{job?.compareFilename}</span>
            <span className="text-xs text-muted-foreground/60">{job?.compareFormat?.toUpperCase()}</span>
            {job?.createdAt && <><span className="text-muted-foreground/30">|</span><span className="text-xs text-muted-foreground/60">{new Date(job.createdAt).toLocaleString()}</span></>}
            {job?.similarity && <><span className="text-muted-foreground/30">|</span><span className="text-xs text-sky-700 font-semibold">Similarity {job.similarity}</span></>}
            {job?.totalDiff != null && <><span className="text-muted-foreground/30">|</span><span className="text-xs font-medium text-foreground">{job.totalDiff} diffs</span></>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => router.push(backUrl)} className={cn(TRANSLATE_PRIMARY_CTA_CLASSNAME, 'inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 px-3 text-xs font-semibold')}>{pt('newComparison')}</button>
            <Button variant="ghost" size="sm" onClick={handleDelete} className="gap-1 h-8 text-muted-foreground/50 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">{pt('delete')}</span></Button>
          </div>
        </div>

        {/* Custom summary panel — i18n translated statistics above SDK iframe */}
        <CompareResultCustom jobId={jobId} />

        {/* SDK iframe — document diff with red highlights (original left panel preserved) */}
        {sdkUrl ? (
          <CompareViewer sdkUrl={sdkUrl} />
        ) : (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-sky-700" /></div>
        )}

        <div className="mt-6 rounded-xl border border-border bg-card px-4 py-3 text-center text-xs text-muted-foreground leading-relaxed">{pt('trustText')}</div>
      </div>
    </div>
  );
}
