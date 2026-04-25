'use client';

import Image from 'next/image';
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
      <div className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/90 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-semibold',
                TRANSLATE_PRIMARY_CTA_CLASSNAME
              )}
              onClick={() => router.push('/translate')}
            >
              PDF Translate
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => router.push('/ocrtranslator')}
            >
              PDF OCR
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              onClick={() => router.push('/pricing')}
            >
              Pricing
            </button>
          </div>
        </div>
      </div>

      <TranslateLandingSections
        onUploaded={handleUploaded}
        initialFile={lastUploadedFile}
        sourceLang={sourceLang}
        targetLang={targetLang}
        onSourceLangChange={setSourceLang}
        onTargetLangChange={setTargetLang}
        onRequireSignIn={handleRequireSignInForUpload}
      />

      <div className="border-t border-zinc-200/80 bg-zinc-50/80 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              上传完成后，选择下一步
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {uploadedHint || '请先上传文档，再进入 Translate 或 PDF OCR。'}
            </p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/35 dark:text-violet-200">
              <Image src="/brand/local/generalocr.svg" alt="" width={14} height={14} />
              扫描件/图片型 PDF 建议使用 PDF OCR；可复制文本优先 Translate。
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={goTranslate}
              disabled={!uploadedDocumentId}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50',
                TRANSLATE_PRIMARY_CTA_CLASSNAME
              )}
            >
              跳转 Translate
            </button>
            <button
              type="button"
              onClick={goOcr}
              disabled={!uploadedDocumentId}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              跳转 PDF OCR
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
