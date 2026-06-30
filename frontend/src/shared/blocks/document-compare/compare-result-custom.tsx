'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

type DiffItem = {
  baseDiffType: string;
  compareDiffType: string;
};

type ResultData = {
  similarity: string | null;
  totalDiff: number | null;
  subTaskList: Array<{
    similarity: string;
    totalDiff: number;
    diffItemList?: DiffItem[];
  }> | null;
};

const FALLBACKS: Record<string, string> = {
  diffSummaryTitle: 'Comparison Summary',
  diffSimilarity: 'Similarity',
  diffTotalItems: 'Differences Found',
  diffAdded: 'Added',
  diffDeleted: 'Deleted',
  diffModified: 'Modified',
  diffLoadError: 'Failed to load summary.',
};

export default function CompareResultCustom({ jobId }: { jobId: string }) {
  const t = useTranslations('pages.contract-comparison');
  const pt = (key: string) => (t.has(key) ? t(key as any) : FALLBACKS[key] || key);

  const [data, setData] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/translator/compare/${jobId}/result`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j.code === 0 && j.data) setData(j.data as ResultData); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [jobId]);

  const subTask = data?.subTaskList?.[0];
  const diffs = subTask?.diffItemList || [];
  const added = diffs.filter((d) => d.compareDiffType === 'add' || d.baseDiffType === 'add').length;
  const deleted = diffs.filter((d) => d.compareDiffType === 'delete' || d.baseDiffType === 'delete').length;
  const modified = diffs.filter((d) => d.compareDiffType === 'modify' || d.baseDiffType === 'modify').length;

  return (
    <div className="mb-4 rounded-xl border-2 border bg-card p-5">
      <h3 className="text-base font-semibold text-foreground mb-4">{pt('diffSummaryTitle')}</h3>
      {loading ? (
        <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-sky-700" /></div>
      ) : data ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
          <div>
            <p className="text-xl font-bold text-sky-700">{data.similarity || subTask?.similarity || '-'}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{pt('diffSimilarity')}</p>
          </div>
          <div>
            <p className="text-xl font-bold text-foreground">{data.totalDiff ?? subTask?.totalDiff ?? 0}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{pt('diffTotalItems')}</p>
          </div>
          <div>
            <p className="text-xl font-bold text-green-600">{added}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{pt('diffAdded')}</p>
          </div>
          <div>
            <p className="text-xl font-bold text-red-600">{deleted}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{pt('diffDeleted')}</p>
          </div>
          <div>
            <p className="text-xl font-bold text-amber-600">{modified}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{pt('diffModified')}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
