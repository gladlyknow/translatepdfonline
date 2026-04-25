'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/core/i18n/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/shared/lib/utils';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';
import { TranslateLandingSections } from '@/shared/components/translate/TranslateLandingSections';
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

  const goTranslate = useCallback(() => {
    if (!uploadedDocumentId) return;
    router.push(`/translate?document=${encodeURIComponent(uploadedDocumentId)}`);
  }, [router, uploadedDocumentId]);

  const goOcr = useCallback(() => {
    if (!uploadedDocumentId) return;
    router.push(`/ocrtranslator?document=${encodeURIComponent(uploadedDocumentId)}`);
  }, [router, uploadedDocumentId]);

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
              onClick={() => router.push('/translate')}
            >
              {tHome('uploadPdfTranslateCta')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => router.push('/ocrtranslator')}
            >
              {tHome('uploadPdfOcrCta')}
            </button>
          </div>
        }
        uploadAreaHint={<span>{tHome('uploadOcrHint')}</span>}
        postUploadActions={
          uploadedDocumentId ? (
            <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80">
              <span className="max-w-[40ch] truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {uploadedHint}
              </span>
              <button
                type="button"
                onClick={goTranslate}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold',
                  TRANSLATE_PRIMARY_CTA_CLASSNAME
                )}
              >
                {tHome('goToTranslate')}
              </button>
              <button
                type="button"
                onClick={goOcr}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                {tHome('goToPdfOcr')}
              </button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
