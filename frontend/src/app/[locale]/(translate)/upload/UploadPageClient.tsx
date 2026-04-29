'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/core/i18n/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/shared/lib/utils';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';
import { TranslateLandingSections } from '@/shared/components/translate/TranslateLandingSections';
import { translateApi } from '@/shared/lib/translate-api';
import type { UILang } from '@/shared/lib/translate-api';

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

  const canStartTask = Boolean(uploadedDocumentId && sourceLang && targetLang);

  const goTranslate = useCallback(async () => {
    if (!uploadedDocumentId || !sourceLang || !targetLang || launchLockRef.current) return;
    launchLockRef.current = true;
    try {
      setLaunchError(null);
      setLaunchingMode('translate');
      const result = await translateApi.translate(uploadedDocumentId, sourceLang, targetLang);
      const qs = new URLSearchParams({
        task: result.task_id,
        document: uploadedDocumentId,
      });
      router.push(`/translate?${qs.toString()}`);
    } catch {
      setLaunchError(tHome('uploadFirstHint'));
    } finally {
      setLaunchingMode(null);
      launchLockRef.current = false;
    }
  }, [router, sourceLang, tHome, targetLang, uploadedDocumentId]);

  const goOcr = useCallback(async () => {
    if (!uploadedDocumentId || !sourceLang || !targetLang || launchLockRef.current) return;
    launchLockRef.current = true;
    try {
      setLaunchError(null);
      setLaunchingMode('ocr');
      const result = await translateApi.createOcrTask(uploadedDocumentId, sourceLang, targetLang);
      const qs = new URLSearchParams({
        task: result.task_id,
        document: uploadedDocumentId,
        source_lang: sourceLang,
        target_lang: targetLang,
      });
      router.push(`/ocrtranslator?${qs.toString()}`);
    } catch {
      setLaunchError(tHome('uploadFirstHint'));
    } finally {
      setLaunchingMode(null);
      launchLockRef.current = false;
    }
  }, [router, sourceLang, tHome, targetLang, uploadedDocumentId]);

  const uploadedHint = useMemo(() => {
    if (!lastUploadedFile) return '';
    return `${lastUploadedFile.name} · ${(lastUploadedFile.size / 1024 / 1024).toFixed(2)} MB`;
  }, [lastUploadedFile]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <TranslateLandingSections
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
                'rounded-lg px-3 py-1.5 text-sm font-semibold',
                TRANSLATE_PRIMARY_CTA_CLASSNAME
              )}
              onClick={goTranslate}
              disabled={!canStartTask || launchingMode !== null}
            >
              {launchingMode === 'translate'
                ? tHome('downloading')
                : tHome('uploadPdfTranslateCta')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={goOcr}
              disabled={!canStartTask || launchingMode !== null}
            >
              {launchingMode === 'ocr' ? tHome('downloading') : tHome('uploadPdfOcrCta')}
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
