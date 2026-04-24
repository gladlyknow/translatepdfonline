'use client';

import { useState } from 'react';
import { usePreventBackgroundWheel } from '@/shared/hooks/use-prevent-background-wheel';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link, useRouter } from '@/core/i18n/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { LanguageSelector } from './LanguageSelector';
import {
  translateApi,
  type TranslateTaskCreatedMeta,
  type UILang,
} from '@/shared/lib/translate-api';
import {
  TRANSLATE_PRIMARY_CTA_CLASSNAME,
  TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME,
} from '@/config/translate-ui';
import { cn } from '@/shared/lib/utils';
import { estimateTranslatedPages } from '@/shared/lib/translate-billing-estimate';

type TranslateBillingClient = {
  enabled: boolean;
  creditsPerPage: number;
};

type Props = {
  documentId: string;
  onTaskCreated: (taskId: string, meta?: TranslateTaskCreatedMeta) => void;
  /** compact: 旧顶栏横排；workbench: 侧栏纵向 + 大按钮 */
  variant?: 'default' | 'compact' | 'workbench';
  taskStatus?: string | null;
  /** 来自预览/文档的总页数；0 表示尚未加载或未知 */
  documentPageCount?: number;
  /** null = 尚未拉取配置，跳过客户端预检（服务端仍会校验） */
  translateBilling?: TranslateBillingClient | null;
  isLoggedIn?: boolean;
  onRequireSignIn?: () => void;
  /** 与 on* 同时传入则由父组件控制语言（漏斗页与工作台共用） */
  sourceLang?: UILang | '';
  targetLang?: UILang | '';
  onSourceLangChange?: (v: UILang | '') => void;
  onTargetLangChange?: (v: UILang | '') => void;
};

async function fetchRemainingCreditsFromApi(): Promise<number | null> {
  const res = await fetch('/api/user/get-user-credits', {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  if (json.code !== 0) return null;
  const n = json.data?.remainingCredits;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function InsufficientCreditsDialog({
  open,
  onOpenChange,
  need,
  have,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  need: number | null;
  have: number | null;
}) {
  const t = useTranslations('translate.translate');
  const shortfall =
    need != null && have != null ? Math.max(0, need - have) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,32rem)] flex-col gap-0 p-6 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-2 text-left">
          <DialogTitle>{t('creditsModalTitle')}</DialogTitle>
          <DialogDescription className="text-foreground text-left text-sm">
            {shortfall != null
              ? t('creditsModalIntro', {
                  shortfall: String(shortfall),
                  need: String(need),
                  have: String(have),
                })
              : t('creditsModalIntroGeneric')}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          <Button
            asChild
            className={cn(
              'h-auto min-h-10 w-full rounded-xl px-4 py-2.5 text-sm font-semibold whitespace-normal',
              TRANSLATE_PRIMARY_CTA_CLASSNAME
            )}
          >
            <Link href="/pricing?group=one-time">{t('creditsModalBuyPack')}</Link>
          </Button>
          <p className="text-muted-foreground pt-1 text-xs font-medium">
            {t('creditsModalPlansHeading')}
          </p>
          <Button
            asChild
            variant="outline"
            className={cn(
              'h-auto min-h-10 w-full rounded-xl px-4 py-2.5 text-sm font-medium whitespace-normal',
              TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME
            )}
          >
            <Link href="/pricing?group=monthly">
              {t('creditsModalSubscribeMonthly')}
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className={cn(
              'h-auto min-h-10 w-full rounded-xl px-4 py-2.5 text-sm font-medium whitespace-normal',
              TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME
            )}
          >
            <Link href="/pricing?group=quarterly">
              {t('creditsModalSubscribeQuarterly')}
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className={cn(
              'h-auto min-h-10 w-full rounded-xl px-4 py-2.5 text-sm font-medium whitespace-normal',
              TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME
            )}
          >
            <Link href="/pricing?group=semi-annual">
              {t('creditsModalSubscribeSemiAnnual')}
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className={cn(
              'h-auto min-h-10 w-full rounded-xl px-4 py-2.5 text-sm font-medium whitespace-normal',
              TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME
            )}
          >
            <Link href="/pricing?group=yearly">
              {t('creditsModalSubscribeYearly')}
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TranslationForm({
  documentId,
  onTaskCreated,
  variant = 'default',
  taskStatus = null,
  documentPageCount = 0,
  translateBilling = null,
  isLoggedIn = false,
  onRequireSignIn,
  sourceLang: sourceLangProp,
  targetLang: targetLangProp,
  onSourceLangChange,
  onTargetLangChange,
}: Props) {
  const t = useTranslations('translate.translate');
  const tHome = useTranslations('translate.home');
  const tLang = useTranslations('translate.languages');
  const tErrors = useTranslations('translate.errors');
  const router = useRouter();
  const [innerSource, setInnerSource] = useState<UILang | ''>('');
  const [innerTarget, setInnerTarget] = useState<UILang | ''>('');
  const isLangControlled =
    sourceLangProp !== undefined &&
    targetLangProp !== undefined &&
    onSourceLangChange !== undefined &&
    onTargetLangChange !== undefined;
  const sourceLang = isLangControlled ? sourceLangProp : innerSource;
  const targetLang = isLangControlled ? targetLangProp : innerTarget;
  const setSourceLang = isLangControlled ? onSourceLangChange : setInnerSource;
  const setTargetLang = isLangControlled ? onTargetLangChange : setInnerTarget;
  const [pageRange, setPageRange] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const [creditsModal, setCreditsModal] = useState<{
    open: boolean;
    need: number | null;
    have: number | null;
  }>({ open: false, need: null, have: null });
  const [ocrSuggestion, setOcrSuggestion] = useState<{
    documentId: string;
    sourceLang: UILang;
    targetLang: UILang;
  } | null>(null);
  const [ocrNavigating, setOcrNavigating] = useState(false);

  usePreventBackgroundWheel(creditsModal.open, null);

  const taskInProgress =
    taskStatus === 'queued' || taskStatus === 'processing';
  const submitDisabled =
    submitting || taskInProgress || !sourceLang || !targetLang;

  const handleGoOcr = () => {
    if (!ocrSuggestion || ocrNavigating) return;
    setOcrNavigating(true);
    const qs = new URLSearchParams({
      document: ocrSuggestion.documentId,
      source_lang: ocrSuggestion.sourceLang,
      target_lang: ocrSuggestion.targetLang,
    });
    router.push(`/ocrtranslator?${qs.toString()}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceLang || !targetLang) {
      setError(t('selectBothLanguages'));
      return;
    }
    if (sourceLang === targetLang) {
      setError(t('sameLangError'));
      return;
    }
    setSubmitting(true);
    setError(null);
    setLoginHint(null);
    setOcrSuggestion(null);
    setOcrNavigating(false);
    setCreditsModal((s) => ({ ...s, open: false }));
    const rangeTrimmedRaw = pageRange?.trim() || '';
    const rangeTrimmed =
      rangeTrimmedRaw === ''
        ? undefined
        : rangeTrimmedRaw
            .replace(/\u2013|\u2014|\u2212/g, '-')
            .replace(/\s+/g, '');

    if (translateBilling?.enabled) {
      if (!isLoggedIn) {
        onRequireSignIn?.();
        setLoginHint(t('loginRequiredTranslate'));
        setSubmitting(false);
        return;
      }
      const hasRange = Boolean(rangeTrimmed);
      if (!hasRange && documentPageCount < 1) {
        setError(t('documentPagesUnknown'));
        setSubmitting(false);
        return;
      }
      const estPages = estimateTranslatedPages(
        hasRange ? rangeTrimmed : null,
        documentPageCount > 0 ? documentPageCount : null
      );
      const creditsNeeded = estPages * translateBilling.creditsPerPage;
      const balance = await fetchRemainingCreditsFromApi();
      if (balance == null) {
        setError(t('creditsLoadFailed'));
        setSubmitting(false);
        return;
      }
      if (balance < creditsNeeded) {
        setCreditsModal({
          open: true,
          need: creditsNeeded,
          have: balance,
        });
        setError(null);
        setSubmitting(false);
        return;
      }
    }

    try {
      const res = await translateApi.translate(
        documentId,
        sourceLang,
        targetLang,
        rangeTrimmed,
        undefined,
        false
      );
      onTaskCreated(res.task_id, {
        page_range_adjusted: res.page_range_adjusted,
        page_range_effective: res.page_range_effective,
        page_range_user_input: res.page_range_user_input,
        document_page_count: res.document_page_count,
      });
      if (
        res.page_range_adjusted === true &&
        res.page_range_user_input &&
        res.page_range_effective != null
      ) {
        const docPages =
          typeof res.document_page_count === 'number'
            ? res.document_page_count
            : documentPageCount > 0
              ? documentPageCount
              : null;
        toast.message(
          tHome('pageRangeAdjustedNotice', {
            userRange: res.page_range_user_input,
            effectiveRange: res.page_range_effective,
            docPages: docPages ?? '—',
          })
        );
      }
    } catch (e) {
      const err = e as Error & {
        status?: number;
        body?: Record<string, unknown>;
      };
      if (err.status === 401) {
        setLoginHint(t('loginRequiredTranslate'));
        setError(null);
        return;
      }
      if (err.status === 402) {
        const body = err.body ?? {};
        const nNeed = typeof body.need === 'number' ? body.need : null;
        const nHave = typeof body.have === 'number' ? body.have : null;
        setCreditsModal({
          open: true,
          need: nNeed,
          have: nHave,
        });
        setError(null);
        setLoginHint(null);
        return;
      }
      if (err.status === 400) {
        const code =
          typeof err.body?.code === 'string' ? err.body.code : '';
        if (code === 'document_pages_required_for_billing') {
          setError(t('documentPagesUnknown'));
          return;
        }
        if (code === 'page_range_no_overlap') {
          const dpc = err.body?.document_page_count;
          const dp = typeof dpc === 'number' ? dpc : null;
          setError(
            dp != null
              ? tHome('pageRangeNoOverlap', { docPages: dp })
              : (err.message || t('createTaskFailed'))
          );
          return;
        }
      }
      if (err.status === 409) {
        const code =
          typeof err.body?.code === 'string' ? err.body.code : '';
        if (code === 'scan_detected_use_ocr' && sourceLang && targetLang) {
          setError(tErrors('scan_detected_use_ocr'));
          setOcrSuggestion({
            documentId,
            sourceLang,
            targetLang,
          });
          return;
        }
      }
      if (err.status === 403) {
        const msg = err.message || '';
        if (msg.includes('quota') || msg.includes('login')) {
          setLoginHint(t('loginHintQuotaExceeded'));
          setError(null);
          return;
        }
      }
      setError(err instanceof Error ? err.message : t('createTaskFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (variant === 'workbench') {
    return (
      <>
        <InsufficientCreditsDialog
          open={creditsModal.open}
          onOpenChange={(open) => setCreditsModal((s) => ({ ...s, open }))}
          need={creditsModal.need}
          have={creditsModal.have}
        />
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
        <div className="flex flex-col gap-3">
          <LanguageSelector
            value={sourceLang}
            onChange={setSourceLang}
            label={t('sourceLang')}
            placeholderKey="selectSourceLang"
          />
          <LanguageSelector
            value={targetLang}
            onChange={setTargetLang}
            label={t('targetLang')}
            placeholderKey="selectTargetLang"
          />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {sourceLang && targetLang
            ? t('confirmDirection', {
                source: tLang(sourceLang),
                target: tLang(targetLang),
              })
            : t('selectBothLanguages')}
        </p>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t('pageRange')}
          </label>
          <input
            type="text"
            value={pageRange}
            onChange={(e) => setPageRange(e.target.value)}
            placeholder={t('pageRangeExample')}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            aria-label={t('pageRange')}
          />
        </div>
        {(error || loginHint) && (
          <div className="flex flex-col gap-1">
            <span
              className={`text-sm ${
                error
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-700 dark:text-amber-300'
              }`}
            >
              {error ?? loginHint}
            </span>
          </div>
        )}
        {ocrSuggestion && (
          <button
            type="button"
            onClick={handleGoOcr}
            disabled={ocrNavigating}
            className="w-full rounded-xl border border-amber-300 bg-amber-50 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
          >
            <span className="inline-flex items-center gap-1.5">
              {ocrNavigating ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('preprocessWithOcr')}
            </span>
          </button>
        )}
        <button
          type="submit"
          disabled={submitDisabled}
          className={`w-full rounded-xl py-3.5 text-sm font-semibold ${TRANSLATE_PRIMARY_CTA_CLASSNAME}`}
        >
          {submitting || taskInProgress ? t('submitting') : t('startTranslate')}
        </button>
      </form>
      </>
    );
  }

  if (variant === 'compact') {
    return (
      <>
        <InsufficientCreditsDialog
          open={creditsModal.open}
          onOpenChange={(open) => setCreditsModal((s) => ({ ...s, open }))}
          need={creditsModal.need}
          have={creditsModal.have}
        />
      <form
        onSubmit={handleSubmit}
        className="flex w-fit max-w-full flex-col items-center gap-2 sm:gap-3"
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="min-w-0 w-full sm:w-auto sm:max-w-[130px]">
            <LanguageSelector
              value={sourceLang}
              onChange={setSourceLang}
              label={t('sourceLangShort')}
              placeholderKey="selectSourceLang"
              compact
            />
          </div>
          <span
            className="shrink-0 text-zinc-400 dark:text-zinc-500"
            aria-hidden
          >
            ↔
          </span>
          <div className="min-w-0 w-full sm:w-auto sm:max-w-[130px]">
            <LanguageSelector
              value={targetLang}
              onChange={setTargetLang}
              label={t('targetLangShort')}
              placeholderKey="selectTargetLang"
              compact
            />
          </div>
          <button
            type="submit"
            disabled={submitDisabled}
            className="min-h-[32px] shrink-0 whitespace-nowrap rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 max-w-[5rem]"
          >
            {submitting || taskInProgress ? t('submitting') : t('submit')}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {sourceLang && targetLang ? (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t('confirmDirection', {
                source: tLang(sourceLang),
                target: tLang(targetLang),
              })}
            </span>
          ) : (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t('selectBothLanguages')}
            </span>
          )}
          <input
            type="text"
            value={pageRange}
            onChange={(e) => setPageRange(e.target.value)}
            placeholder={t('pageRangeExample')}
            className="min-h-[36px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 sm:w-28"
            aria-label={t('pageRange')}
          />
        </div>
        {(error || loginHint) && (
          <div className="flex flex-col items-center gap-1 text-center">
            <span
              className={`text-sm ${
                error
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-700 dark:text-amber-300'
              }`}
            >
              {error ?? loginHint}
            </span>
          </div>
        )}
        {ocrSuggestion && (
          <button
            type="button"
            onClick={handleGoOcr}
            disabled={ocrNavigating}
            className="min-h-[32px] shrink-0 whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
          >
            <span className="inline-flex items-center gap-1.5">
              {ocrNavigating ? <Loader2 size={12} className="animate-spin" /> : null}
              {t('preprocessWithOcr')}
            </span>
          </button>
        )}
      </form>
      </>
    );
  }

  return (
    <>
      <InsufficientCreditsDialog
        open={creditsModal.open}
        onOpenChange={(open) => setCreditsModal((s) => ({ ...s, open }))}
        need={creditsModal.need}
        have={creditsModal.have}
      />
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <LanguageSelector
          value={sourceLang}
          onChange={setSourceLang}
          label={t('sourceLang')}
          placeholderKey="selectSourceLang"
        />
        <LanguageSelector
          value={targetLang}
          onChange={setTargetLang}
          label={t('targetLang')}
          placeholderKey="selectTargetLang"
        />
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        {sourceLang && targetLang
          ? t('confirmDirection', {
              source: tLang(sourceLang),
              target: tLang(targetLang),
            })
          : t('selectBothLanguages')}
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {t('pageRange')}
        </label>
        <input
          type="text"
          value={pageRange}
          onChange={(e) => setPageRange(e.target.value)}
          placeholder={t('pageRangeExample')}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
      </div>
      {error && (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
        </div>
      )}
      {loginHint && (
        <span className="text-sm text-amber-700 dark:text-amber-300">
          {loginHint}
        </span>
      )}
      {ocrSuggestion && (
        <button
          type="button"
          onClick={handleGoOcr}
          disabled={ocrNavigating}
          className="min-h-[40px] rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
        >
          <span className="inline-flex items-center gap-1.5">
            {ocrNavigating ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('preprocessWithOcr')}
          </span>
        </button>
      )}
      <button
        type="submit"
        disabled={submitDisabled}
        className="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting || taskInProgress ? t('submitting') : t('submit')}
      </button>
    </form>
    </>
  );
}

/** 漏斗页：仅语言选择，状态由父组件持有并与 TranslationForm 共用 */
export function TranslateLanguagePickers({
  sourceLang,
  targetLang,
  onSourceLangChange,
  onTargetLangChange,
  appearance = 'default',
}: {
  sourceLang: UILang | '';
  targetLang: UILang | '';
  onSourceLangChange: (v: UILang | '') => void;
  onTargetLangChange: (v: UILang | '') => void;
  /** 深色 Hero 上的浅色文案与控件 */
  appearance?: 'default' | 'funnelDark';
}) {
  const t = useTranslations('translate.translate');
  const tLang = useTranslations('translate.languages');
  const darkHero = appearance === 'funnelDark';
  const tone = darkHero ? 'darkHero' : 'default';

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LanguageSelector
          value={sourceLang}
          onChange={onSourceLangChange}
          label={t('sourceLang')}
          placeholderKey="selectSourceLang"
          tone={tone}
        />
        <LanguageSelector
          value={targetLang}
          onChange={onTargetLangChange}
          label={t('targetLang')}
          placeholderKey="selectTargetLang"
          tone={tone}
        />
      </div>
      <p
        className={`mt-3 text-center text-sm ${
          darkHero ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'
        }`}
      >
        {sourceLang && targetLang
          ? t('confirmDirection', {
              source: tLang(sourceLang),
              target: tLang(targetLang),
            })
          : t('selectBothLanguages')}
      </p>
    </div>
  );
}
