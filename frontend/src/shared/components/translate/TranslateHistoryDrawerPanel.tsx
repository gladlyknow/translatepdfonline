'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { History } from 'lucide-react';

import { useRouter } from '@/core/i18n/navigation';
import {
  TRANSLATE_PRIMARY_CTA_CLASSNAME,
  TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME,
} from '@/config/translate-ui';
import { cn } from '@/shared/lib/utils';
import {
  translateApi,
  type DocumentSummary,
  type TaskSummary,
} from '@/shared/lib/translate-api';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { Button } from '@/shared/components/ui/button';

const PAGE_SIZE = 10;

export function TranslateHistoryDrawerPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('translate.historyDrawer');
  const tUpload = useTranslations('translate.upload');
  const router = useRouter();

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [taskPage, setTaskPage] = useState(0);
  const [docPage, setDocPage] = useState(0);

  const refreshDocuments = useCallback(async () => {
    setLoadingDocuments(true);
    try {
      const list = await translateApi.listDocuments();
      setDocuments(list);
      setSelectedDocumentId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
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
    if (!open) return;
    void refreshDocuments();
    void refreshTasks();
  }, [open, refreshDocuments, refreshTasks]);

  useEffect(() => {
    if (open) {
      setTaskPage(0);
      setDocPage(0);
    }
  }, [open]);

  const taskPageCount = useMemo(
    () => Math.max(1, Math.ceil(tasks.length / PAGE_SIZE)),
    [tasks.length]
  );
  const docPageCount = useMemo(
    () => Math.max(1, Math.ceil(documents.length / PAGE_SIZE)),
    [documents.length]
  );

  useEffect(() => {
    setTaskPage((p) => Math.min(p, Math.max(0, taskPageCount - 1)));
  }, [taskPageCount]);

  useEffect(() => {
    setDocPage((p) => Math.min(p, Math.max(0, docPageCount - 1)));
  }, [docPageCount]);

  const selectedFilename = useMemo(
    () => documents.find((d) => d.id === selectedDocumentId)?.filename ?? '',
    [documents, selectedDocumentId]
  );

  const safeTaskPage = Math.min(taskPage, taskPageCount - 1);
  const safeDocPage = Math.min(docPage, docPageCount - 1);
  const shownTasks = tasks.slice(
    safeTaskPage * PAGE_SIZE,
    safeTaskPage * PAGE_SIZE + PAGE_SIZE
  );
  const shownDocuments = documents.slice(
    safeDocPage * PAGE_SIZE,
    safeDocPage * PAGE_SIZE + PAGE_SIZE
  );

  const handleSelectTask = useCallback(
    (task: TaskSummary) => {
      const route = task.preprocess_with_ocr ? '/ocrtranslator' : '/translate';
      router.push(`${route}?task=${encodeURIComponent(task.id)}`);
      onOpenChange(false);
    },
    [router, onOpenChange]
  );

  const goTranslate = useCallback(() => {
    if (!selectedDocumentId) return;
    router.push(`/translate?document=${encodeURIComponent(selectedDocumentId)}`);
    onOpenChange(false);
  }, [router, selectedDocumentId, onOpenChange]);

  const goOcr = useCallback(() => {
    if (!selectedDocumentId) return;
    router.push(`/ocrtranslator?document=${encodeURIComponent(selectedDocumentId)}`);
    onOpenChange(false);
  }, [router, selectedDocumentId, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-lg">
        <SheetHeader className="shrink-0 space-y-1 text-left">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
              <History className="size-5" aria-hidden />
            </span>
            {t('title')}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <section className="rounded-xl border border-zinc-200/90 bg-zinc-50/90 p-4 dark:border-zinc-700 dark:bg-zinc-900/60">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t('introTitle')}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {t('introBody')}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={!selectedDocumentId}
                onClick={goTranslate}
                className={cn(
                  'rounded-lg px-3 py-2.5 text-sm font-semibold',
                  TRANSLATE_PRIMARY_CTA_CLASSNAME,
                  'disabled:pointer-events-none disabled:opacity-40'
                )}
              >
                {t('goTranslate')}
              </button>
              <button
                type="button"
                disabled={!selectedDocumentId}
                onClick={goOcr}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-semibold',
                  TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME,
                  'disabled:pointer-events-none disabled:opacity-40'
                )}
              >
                {t('goOcr')}
              </button>
            </div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {t('currentDocument')}
                {': '}
              </span>
              {selectedDocumentId ? (
                <span className="break-all">{selectedFilename || selectedDocumentId}</span>
              ) : (
                t('noDocumentSelected')
              )}
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t('sectionRecentTasks')}
            </h3>
            {loadingTasks ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('loading')}</p>
            ) : shownTasks.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('emptyTasks')}</p>
            ) : (
              <ul className="space-y-2">
                {shownTasks.map((task) => {
                  const ocr = Boolean(task.preprocess_with_ocr);
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectTask(task)}
                        className="flex w-full flex-col gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-left transition hover:border-sky-300/80 hover:bg-sky-50/40 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-sky-700 dark:hover:bg-sky-950/20"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {task.document_filename || task.id}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              ocr
                                ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200'
                                : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                            )}
                          >
                            {ocr ? t('badgeOcr') : t('badgeTranslate')}
                          </span>
                        </div>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {task.status}
                          {' · '}
                          {ocr ? t('badgeOcr') : t('badgeTranslate')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {tasks.length > PAGE_SIZE ? (
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={safeTaskPage <= 0}
                  onClick={() => setTaskPage((p) => Math.max(0, p - 1))}
                >
                  {t('pagePrev')}
                </Button>
                <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t('pageStatus', {
                    current: safeTaskPage + 1,
                    total: taskPageCount,
                  })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={safeTaskPage >= taskPageCount - 1}
                  onClick={() => setTaskPage((p) => Math.min(taskPageCount - 1, p + 1))}
                >
                  {t('pageNext')}
                </Button>
              </div>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t('sectionUploads')}
            </h3>
            {loadingDocuments ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{tUpload('uploading')}</p>
            ) : shownDocuments.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('emptyUploads')}</p>
            ) : (
              <ul className="space-y-2">
                {shownDocuments.map((doc) => {
                  const selected = doc.id === selectedDocumentId;
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedDocumentId(doc.id)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-xl border px-3 py-3 text-left transition',
                          selected
                            ? 'border-sky-500 bg-sky-50/80 ring-1 ring-sky-200 dark:border-sky-600 dark:bg-sky-950/40 dark:ring-sky-900'
                            : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600 dark:hover:bg-zinc-900'
                        )}
                      >
                        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {doc.filename}
                        </span>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {t('fileSizeMb', {
                            size: (doc.size_bytes / 1024 / 1024).toFixed(2),
                          })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {documents.length > PAGE_SIZE ? (
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={safeDocPage <= 0}
                  onClick={() => setDocPage((p) => Math.max(0, p - 1))}
                >
                  {t('pagePrev')}
                </Button>
                <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t('pageStatus', {
                    current: safeDocPage + 1,
                    total: docPageCount,
                  })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={safeDocPage >= docPageCount - 1}
                  onClick={() => setDocPage((p) => Math.min(docPageCount - 1, p + 1))}
                >
                  {t('pageNext')}
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
