'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { History, FileText, Loader2, XCircle, Trash2 } from 'lucide-react';
import {
  translateApi,
  type TaskSummary,
} from '@/shared/lib/translate-api';
import { usePreventBackgroundWheel } from '@/shared/hooks/use-prevent-background-wheel';

type Props = {
  onSelectTask: (taskId: string) => void;
};

const CANCELLABLE_STATUSES = ['pending', 'processing'];
const DELETABLE_STATUSES = ['completed', 'failed', 'cancelled'];

function taskTimeMs(task: TaskSummary): number {
  const raw = task.updated_at ?? task.created_at;
  if (!raw || typeof raw !== 'string') return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function sortTasksNewestFirst(list: TaskSummary[]): TaskSummary[] {
  return [...list].sort((a, b) => taskTimeMs(b) - taskTimeMs(a));
}

export function HistoryPanel({ onSelectTask }: Props) {
  const t = useTranslations('translate.home');
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [panelRect, setPanelRect] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    placement: 'below' | 'above';
    top?: number;
    bottom?: number;
  } | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const updatePanelPosition = () => {
    if (!buttonRef.current || typeof window === 'undefined') return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const panelWidth = Math.min(320, vw - 16);
    const left = Math.max(
      8,
      Math.min(rect.right - panelWidth, vw - panelWidth - 8)
    );

    const spaceBelow = vh - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    /** 整块面板（标题+列表）高度不得超过该侧视口内可用空间 */
    const hardCap = Math.min(vh - margin * 2, vh * 0.9);
    const belowH = Math.min(hardCap, Math.max(0, spaceBelow - margin));
    const aboveH = Math.min(hardCap, Math.max(0, spaceAbove - margin));
    const useBelow = belowH >= aboveH;
    const rawMax = useBelow ? belowH : aboveH;
    const maxHeight =
      rawMax > 0 ? Math.min(hardCap, rawMax) : Math.min(hardCap, 360);

    if (useBelow) {
      setPanelRect({
        placement: 'below',
        top: rect.bottom + margin,
        left,
        width: panelWidth,
        maxHeight,
      });
    } else {
      setPanelRect({
        placement: 'above',
        bottom: vh - rect.top + margin,
        left,
        width: panelWidth,
        maxHeight,
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();
    const onResize = () => updatePanelPosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    translateApi
      .listTasks()
      .then((data: unknown) => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray((data as { items?: unknown })?.items)
            ? (data as { items: TaskSummary[] }).items
            : Array.isArray((data as { tasks?: unknown })?.tasks)
              ? (data as { tasks: TaskSummary[] }).tasks
              : [];
        setTasks(sortTasksNewestFirst(list));
      })
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [open]);

  usePreventBackgroundWheel(open, panelRef);

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => setOpen(false), 300);
  };

  const handleSelect = (taskId: string) => {
    onSelectTask(taskId);
    setOpen(false);
  };

  const handleCancel = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (cancellingId) return;
    setCancellingId(taskId);
    try {
      await translateApi.cancelTask(taskId);
      setTasks((prev) =>
        prev.map((t) => {
          const id = t.id ?? (t as { task_id?: string }).task_id ?? '';
          return id === taskId ? { ...t, status: 'cancelled' } : t;
        })
      );
    } catch {
      setCancellingId(null);
    } finally {
      setCancellingId(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(taskId);
    try {
      await translateApi.deleteTask(taskId);
      setTasks((prev) =>
        prev.filter((t) => {
          const id = t.id ?? (t as { task_id?: string }).task_id ?? '';
          return id !== taskId;
        })
      );
    } catch {
      setDeletingId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="relative flex items-stretch">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition-colors ${
          open
            ? 'border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900'
            : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600'
        }`}
      >
        <History size={18} />
        <span className="hidden sm:inline">{t('history')}</span>
      </button>

      {open &&
        typeof document !== 'undefined' &&
        panelRect &&
        createPortal(
          <>
            {/* 必须低于 Dialog/Sheet（z-50），否则登录、积分等弹窗会被全屏遮罩挡住 */}
            <div
              className="fixed inset-0 z-40"
              aria-hidden
              onClick={() => setOpen(false)}
            />
            <div
              ref={panelRef}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              className="fixed z-[45] flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              style={{
                left: panelRect.left,
                width: panelRect.width,
                maxHeight: panelRect.maxHeight,
                ...(panelRect.placement === 'below'
                  ? { top: panelRect.top }
                  : { bottom: panelRect.bottom }),
              }}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t('history')}
                </h3>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scrollbar-gutter:stable]">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2
                      size={24}
                      className="animate-spin text-zinc-400"
                    />
                  </div>
                ) : tasks.length === 0 ? (
                  <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    {t('noHistory')}
                  </p>
                ) : (
                  <ul
                    className={
                      panelRect.placement === 'above'
                        ? 'flex flex-col-reverse gap-2'
                        : 'flex flex-col gap-2'
                    }
                  >
                    {tasks.map((task) => {
                      const id =
                        task.id ??
                        (task as { task_id?: string }).task_id ??
                        '';
                      const filename = task.document_filename ?? '';
                      const displayName =
                        filename.length > 28
                          ? `${filename.slice(0, 25)}…`
                          : filename || id.slice(0, 8);
                      const at = task.updated_at ?? task.created_at;
                      const timeLabel =
                        at && typeof at === 'string'
                          ? (() => {
                              const d = new Date(at);
                              const now = Date.now();
                              const diff = now - d.getTime();
                              if (diff < 60_000) return '< 1 min';
                              if (diff < 3600_000)
                                return `${Math.floor(diff / 60_000)} min ago`;
                              if (diff < 86400_000)
                                return `${Math.floor(diff / 3600_000)} h ago`;
                              return d.toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year:
                                  d.getFullYear() !== new Date().getFullYear()
                                    ? 'numeric'
                                    : undefined,
                              });
                            })()
                          : '';
                      const canCancel =
                        CANCELLABLE_STATUSES.includes(task.status) ||
                        task.status === 'queued';
                      const canDelete =
                        DELETABLE_STATUSES.includes(task.status);
                      return (
                        <li key={id}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => handleSelect(id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSelect(id);
                              }
                            }}
                            className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-zinc-100 p-3 text-left transition-colors hover:border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
                          >
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                              <FileText
                                size={16}
                                className="text-zinc-500"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p
                                className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200"
                                title={filename || id}
                              >
                                {displayName}
                              </p>
                              <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                {task.source_lang} → {task.target_lang}
                                {task.page_range
                                  ? ` · pp. ${task.page_range}`
                                  : ''}{' '}
                                · {task.status}
                              </p>
                              {task.page_range_user_input ? (
                                <p className="mt-0.5 text-[10px] leading-snug text-amber-800 dark:text-amber-200/90">
                                  {t('pageRangeAdjustedNotice', {
                                    userRange: task.page_range_user_input,
                                    effectiveRange: task.page_range ?? '',
                                    docPages:
                                      typeof task.document_page_count ===
                                      'number'
                                        ? task.document_page_count
                                        : '—',
                                  })}
                                </p>
                              ) : null}
                              {timeLabel ? (
                                <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                                  {timeLabel}
                                </p>
                              ) : null}
                            </div>
                            <div
                              className="flex shrink-0 items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {canCancel ? (
                                <button
                                  type="button"
                                  onClick={(e) => handleCancel(e, id)}
                                  disabled={cancellingId === id}
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
                                  title={t('cancel')}
                                >
                                  {cancellingId === id ? (
                                    <Loader2
                                      size={12}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <XCircle size={12} className="inline" />
                                  )}
                                  <span className="ml-1">{t('cancel')}</span>
                                </button>
                              ) : null}
                              {canDelete ? (
                                <button
                                  type="button"
                                  onClick={(e) => handleDelete(e, id)}
                                  disabled={deletingId === id}
                                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                                  title={t('delete')}
                                >
                                  {deletingId === id ? (
                                    <Loader2
                                      size={12}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Trash2 size={12} className="inline" />
                                  )}
                                  <span className="ml-1">{t('delete')}</span>
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
