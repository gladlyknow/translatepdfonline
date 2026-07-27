'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/core/i18n/navigation';
import { useTranslations } from 'next-intl';

import { History } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';
import { TranslateLandingSections } from '@/shared/components/translate/TranslateLandingSections';
import { translateApi } from '@/shared/lib/translate-api';
import type { UILang } from '@/shared/lib/translate-api';
import { useTranslateHistoryDrawerOptional } from '@/shared/contexts/translate-history-drawer';

export function UploadPageClient() {
  const tHome = useTranslations('translate.home');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sourceLang, setSourceLang] = useState<UILang | ''>('');
  const [targetLang, setTargetLang] = useState<UILang | ''>('');
  const [lastUploadedFile, setLastUploadedFile] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [uploadedDocumentId, setUploadedDocumentId] = useState<string | null>(null);
  const [launchingMode, setLaunchingMode] = useState<'translate' | 'ocr' | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const launchLockRef = useRef(false);
  const historyDrawer = useTranslateHistoryDrawerOptional();

  const handleUploaded = useCallback(
    async (documentId: string, filename: string, sizeBytes: number) => {
      setUploadedDocumentId(documentId);
      setLastUploadedFile({ name: filename, size: sizeBytes });
    },
    []
  );

  const handleRequireSignInForUpload = useCallback(() => {
    const qs = searchParams.toString();
    const redirectTo = qs ? `${pathname}?${qs}` : pathname;
    router.push(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
  }, [searchParams, pathname, router]);

  const canStartOcr = Boolean(uploadedDocumentId && targetLang);

  const resolveActiveDocumentId = useCallback(async (): Promise<string | null> => {
    if (!uploadedDocumentId) return null;
    try {
      const docs = await translateApi.listDocuments({ limit: 30, offset: 0 });
      if (docs.some((d) => d.id === uploadedDocumentId)) return uploadedDocumentId;
      if (lastUploadedFile) {
        const byFile = docs.find(
          (d) =>
            d.filename === lastUploadedFile.name &&
            Number(d.size_bytes) === Number(lastUploadedFile.size)
        );
        if (byFile?.id) return byFile.id;
      }
      return docs[0]?.id ?? null;
    } catch {
      return uploadedDocumentId;
    }
  }, [lastUploadedFile, uploadedDocumentId]);

  const toLaunchError = useCallback(
    (error: unknown): string => {
      const err = error as Error & { status?: number };
      if (err?.status === 404) return tHome('uploadFirstHint');
      if (err instanceof Error && err.message.trim()) return err.message;
      return tHome('uploadFirstHint');
    },
    [tHome]
  );

  const goOcr = useCallback(async () => {
    if (!uploadedDocumentId || !targetLang || launchLockRef.current) return;
    launchLockRef.current = true;
    setLaunchingMode('ocr');
    setLaunchError(null);
    try {
      const resolvedDocumentId = await resolveActiveDocumentId();
      if (!resolvedDocumentId) {
        throw new Error(tHome('uploadFirstHint'));
      }
      if (resolvedDocumentId !== uploadedDocumentId) {
        setUploadedDocumentId(resolvedDocumentId);
      }
      // 直接创建 OCR 任务，跳转到 workbench 并自动开始
      const res = await translateApi.createOcrTask(
        resolvedDocumentId,
        sourceLang || '', // OCR 允许不选源语言
        targetLang
      );
      router.push(`/ocrtranslator?task=${res.task_id}`);
    } catch (error) {
      setLaunchError(toLaunchError(error));
    } finally {
      setLaunchingMode(null);
      launchLockRef.current = false;
    }
  }, [
    resolveActiveDocumentId,
    router,
    sourceLang,
    tHome,
    targetLang,
    toLaunchError,
    uploadedDocumentId,
  ]);

  const uploadedHint = useMemo(() => {
    if (!lastUploadedFile) return '';
    return `${lastUploadedFile.name} · ${(lastUploadedFile.size / 1024 / 1024).toFixed(2)} MB`;
  }, [lastUploadedFile]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <TranslateLandingSections
        funnelToolbar={
          <button
            type="button"
            onClick={() => historyDrawer?.openHistory()}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <History className="h-4 w-4" /> History
          </button>
        }
        onUploaded={handleUploaded}
        initialFile={lastUploadedFile}
        sourceLang={sourceLang}
        targetLang={targetLang}
        onSourceLangChange={setSourceLang}
        onTargetLangChange={setTargetLang}
        onRequireSignIn={handleRequireSignInForUpload}
        heroActions={
          <div className="inline-flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-semibold',
                TRANSLATE_PRIMARY_CTA_CLASSNAME
              )}
              onClick={goOcr}
              disabled={!canStartOcr || launchingMode !== null}
            >
              {launchingMode === 'ocr'
                ? tHome('downloading')
                : tHome('uploadPdfOcrCta')}
            </button>
          </div>
        }
        uploadAreaHint={<span>{tHome('uploadOcrHint')}</span>}
        postUploadActions={
          uploadedDocumentId || launchError ? (
            <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80">
              {uploadedDocumentId ? (
                <span className="max-w-[40ch] truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {uploadedHint}
                </span>
              ) : null}
              {launchError ? (
                <span className="text-[11px] text-rose-600 dark:text-rose-300">{launchError}</span>
              ) : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}
