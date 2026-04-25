'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/core/i18n/navigation';
import { useTranslations } from 'next-intl';
import { History } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { TranslateLandingSections } from '@/shared/components/translate/TranslateLandingSections';
import {
  translateApi,
  type UILang,
  type DocumentSummary,
  type TaskSummary,
} from '@/shared/lib/translate-api';

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

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

  const refreshTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const list = await translateApi.listTasks();
      const sorted = [...list].sort((a, b) => {
        const atA = new Date(a.updated_at ?? a.created_at ?? '').getTime();
        const atB = new Date(b.updated_at ?? b.created_at ?? '').getTime();
        return (Number.isFinite(atB) ? atB : 0) - (Number.isFinite(atA) ? atA : 0);
      });
      setTasks(sorted);
    } catch {
      setTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    if (!historyOpen) return;
    void refreshTasks();
    void refreshDocuments();
  }, [historyOpen, refreshTasks, refreshDocuments]);

  const handleUploaded = useCallback(
    async (documentId: string, filename: string, sizeBytes: number) => {
      setLastUploadedFile({ name: filename, size: sizeBytes });
      setUploadedDocumentId(documentId);
      await refreshDocuments();
      await refreshTasks();
    },
    [refreshDocuments, refreshTasks]
  );

  const handleSelectTaskFromHistory = useCallback(
    (task: TaskSummary) => {
      const route = task.preprocess_with_ocr ? '/ocrtranslator' : '/translate';
      router.push(`${route}?task=${encodeURIComponent(task.id)}`);
      setHistoryOpen(false);
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
  const shownTasks = tasks.slice(0, 12);
  const shownDocuments = documents.slice(0, 12);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex w-full max-w-6xl justify-end">
          <Button type="button" variant="outline" onClick={() => setHistoryOpen(true)}>
            <History className="mr-2 size-4" />
            {tHome('history')}
          </Button>
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

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{tHome('history')}</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
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
                    setHistoryOpen(false);
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
                    setHistoryOpen(false);
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

            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                History
              </p>
              {loadingTasks ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{tUpload('uploading')}</p>
              ) : shownTasks.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{tHome('noHistory')}</p>
              ) : (
                <ul className="space-y-2">
                  {shownTasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectTaskFromHistory(task)}
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                          {task.document_filename || task.id}
                        </p>
                        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                          {task.status}
                          {task.preprocess_with_ocr ? ' · OCR' : ' · Translate'}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                已上传文档
              </p>
              {loadingDocuments ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{tUpload('uploading')}</p>
              ) : shownDocuments.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{tHome('noHistory')}</p>
              ) : (
                <ul className="space-y-2">
                  {shownDocuments.map((doc) => (
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
        </SheetContent>
      </Sheet>
    </div>
  );
}

