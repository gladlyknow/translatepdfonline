'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/core/i18n/navigation';
import { useTranslations } from 'next-intl';

import { HistoryPanel } from '@/shared/components/translate/HistoryPanel';
import { TranslateLandingSections } from '@/shared/components/translate/TranslateLandingSections';
import { translateApi, type UILang, type DocumentSummary } from '@/shared/lib/translate-api';

export function UploadPageClient() {
  const tHome = useTranslations('translate.home');
  const tUpload = useTranslations('translate.upload');
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
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);

  const refreshDocuments = useCallback(async () => {
    setLoadingDocuments(true);
    try {
      const list = await translateApi.listDocuments();
      setDocuments(list);
    } catch {
      setDocuments([]);
    } finally {
      setLoadingDocuments(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    const scrollToHistoryAnchor = () => {
      if (typeof window === 'undefined') return;
      if (window.location.hash !== '#translate-history') return;
      const el = document.getElementById('translate-history');
      if (!el) return;
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    };
    scrollToHistoryAnchor();
    window.addEventListener('hashchange', scrollToHistoryAnchor);
    return () => {
      window.removeEventListener('hashchange', scrollToHistoryAnchor);
    };
  }, []);

  const handleUploaded = useCallback(
    async (documentId: string, filename: string, sizeBytes: number) => {
      setLastUploadedFile({ name: filename, size: sizeBytes });
      setUploadedDocumentId(documentId);
      await refreshDocuments();
    },
    [refreshDocuments]
  );

  const handleSelectTaskFromHistory = useCallback(
    (taskId: string) => {
      router.push(`/translate?task=${encodeURIComponent(taskId)}`);
    },
    [router]
  );

  const handleRequireSignInForUpload = useCallback(() => {
    const qs = searchParams.toString();
    const redirectTo = qs ? `${pathname}?${qs}` : pathname;
    router.push(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
  }, [searchParams, pathname, router]);

  const selectedDocumentId = uploadedDocumentId ?? documents[0]?.id ?? null;
  const selectedFilename = useMemo(
    () => documents.find((d) => d.id === selectedDocumentId)?.filename ?? '',
    [documents, selectedDocumentId]
  );

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
      />

      <section className="border-t border-zinc-200 bg-white px-4 py-8 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              上传后请选择处理模式
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Translate：标准版式保留翻译流程；OCR Translator：适合扫描件/图片型 PDF，支持可视化块编辑。
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!selectedDocumentId}
                onClick={() => {
                  if (!selectedDocumentId) return;
                  router.push(`/translate?document=${encodeURIComponent(selectedDocumentId)}`);
                }}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-blue-600"
              >
                去 Translate
              </button>
              <button
                type="button"
                disabled={!selectedDocumentId}
                onClick={() => {
                  if (!selectedDocumentId) return;
                  router.push(`/ocrtranslator?document=${encodeURIComponent(selectedDocumentId)}`);
                }}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              >
                去 OCR Translator
              </button>
            </div>
            {selectedDocumentId ? (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                当前文档：{selectedFilename || selectedDocumentId}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {tHome('history')}
              </p>
              <div id="translate-history" className="scroll-mt-24">
                <HistoryPanel onSelectTask={handleSelectTaskFromHistory} />
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                已上传文档
              </p>
              {loadingDocuments ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{tUpload('uploading')}</p>
              ) : documents.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{tHome('noHistory')}</p>
              ) : (
                <ul className="space-y-2">
                  {documents.slice(0, 12).map((doc) => (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => setUploadedDocumentId(doc.id)}
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">{doc.filename}</p>
                        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                          {(doc.size_bytes / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

