'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from '@/core/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Clock, CloudUpload, Image, Loader2 } from 'lucide-react';

import { useAppContext } from '@/shared/contexts/app';
import { translateApi, type UILang } from '@/shared/lib/translate-api';
import { UploadDropzone } from '@/shared/components/translate/UploadDropzone';
import { LanguageSelector } from '@/shared/components/translate/LanguageSelector';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Link } from '@/core/i18n/navigation';
import { cn } from '@/shared/lib/utils';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/bmp,image/webp';

type TranslateBillingClient = {
  enabled: boolean;
  creditsPerPage: number;
};

type CreditsModalState = {
  open: boolean;
  need: number | null;
  have: number | null;
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
  const t = useTranslations('pages.image-to-text');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('creditsModalTitle')}</DialogTitle>
          <DialogDescription>
            {need != null && have != null
              ? t('creditsModalIntro', { need, have })
              : t('creditsModalIntroGeneric')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-4">
          <Link
            href="/pricing?group=one-time"
            className="block w-full rounded-lg bg-sky-700 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-sky-600"
          >
            {t('creditsModalBuyPack')}
          </Link>
          <p className="text-xs text-center text-zinc-500">{t('creditsModalPlansHeading')}</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['/pricing?group=monthly', t('creditsModalSubscribeMonthly')],
              ['/pricing?group=quarterly', t('creditsModalSubscribeQuarterly')],
              ['/pricing?group=semi-annual', t('creditsModalSubscribeSemiAnnual')],
              ['/pricing?group=yearly', t('creditsModalSubscribeYearly')],
            ] as const).map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-center text-xs font-medium text-zinc-800 hover:bg-zinc-100"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ImageToTextClient({ children }: { children?: ReactNode }) {
  const t = useTranslations('pages.image-to-text');
  const router = useRouter();
  const { user, setIsShowSignModal } = useAppContext();

  const [documentId, setDocumentId] = useState<string | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<{ name: string; size: number } | null>(null);
  const [targetLang, setTargetLang] = useState<UILang | ''>('');
  const [translateBilling, setTranslateBilling] = useState<TranslateBillingClient | null>(null);
  const [creditsModal, setCreditsModal] = useState<CreditsModalState>({ open: false, need: null, have: null });
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launchLockRef = useRef(false);

  useEffect(() => {
    translateApi
      .getBillingConfig()
      .then((c) =>
        setTranslateBilling({
          enabled: Boolean(c.credits_enabled),
          creditsPerPage: typeof c.credits_per_page === 'number' && c.credits_per_page > 0 ? c.credits_per_page : 10,
        })
      )
      .catch(() => setTranslateBilling(null));
  }, []);

  const handleUploaded = useCallback(
    async (docId: string, filename: string, sizeBytes: number) => {
      setDocumentId(docId);
      setLastUploadedFile({ name: filename, size: sizeBytes });
      setError(null);
    },
    []
  );

  const canStart = Boolean(documentId && targetLang);

  const handleStart = useCallback(async () => {
    if (!documentId || !targetLang || launchLockRef.current) return;
    launchLockRef.current = true;
    setLaunching(true);
    setError(null);

    try {
      if (translateBilling?.enabled) {
        if (!user?.id) {
          setIsShowSignModal(true);
          setLaunching(false);
          launchLockRef.current = false;
          return;
        }
        const balance = await fetchRemainingCreditsFromApi();
        if (balance == null) {
          setError(t('creditsLoadFailed'));
          setLaunching(false);
          launchLockRef.current = false;
          return;
        }
        const need = 1 * translateBilling.creditsPerPage;
        if (balance < need) {
          setCreditsModal({ open: true, need, have: balance });
          setLaunching(false);
          launchLockRef.current = false;
          return;
        }
      }

      const res = await translateApi.createOcrTask(documentId, 'auto', targetLang);
      router.push(`/ocrtranslator?task=${res.task_id}`);
    } catch (err: any) {
      if (err?.status === 401) {
        setIsShowSignModal(true);
      } else if (err?.status === 402) {
        const body = err?.body ?? {};
        setCreditsModal({
          open: true,
          need: typeof body.need === 'number' ? body.need : null,
          have: typeof body.have === 'number' ? body.have : null,
        });
      } else {
        const code = err?.body?.code;
        if (code === 'document_pages_required_for_billing') {
          setError(t('errorPageCountPending'));
        } else {
          setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
      }
    } finally {
      setLaunching(false);
      launchLockRef.current = false;
    }
  }, [documentId, targetLang, translateBilling, user?.id, setIsShowSignModal, router, t]);

  const uploadedHint = lastUploadedFile
    ? `${lastUploadedFile.name} · ${(lastUploadedFile.size / 1024 / 1024).toFixed(2)} MB`
    : '';

  return (
    <>
      <InsufficientCreditsDialog
        open={creditsModal.open}
        onOpenChange={(open) => setCreditsModal((s) => ({ ...s, open }))}
        need={creditsModal.need}
        have={creditsModal.have}
      />

      {/* Children (Hero section) */}
      {children}

      {/* Upload + Controls */}
      <div className="mx-auto mt-10 w-full max-w-3xl px-4">
        <div className="rounded-2xl border-2 border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex justify-end mb-2">
            <Link
              href="/upload#translate-history"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Clock className="h-4 w-4" /> History
            </Link>
          </div>
          <UploadDropzone
            onUploaded={handleUploaded}
            initialFile={lastUploadedFile}
            variant="hero"
            accept={IMAGE_ACCEPT}
            heroLead={t('heroUploadLead')}
            heroSub={t('heroUploadSub')}
            heroHint={t('heroUploadHint')}
            fileTypeLabel="IMG"
            onRequireSignIn={() => setIsShowSignModal(true)}
          />

          {documentId && lastUploadedFile ? (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Image size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800">{lastUploadedFile.name}</p>
                <p className="text-xs text-zinc-500">{(lastUploadedFile.size / 1024 / 1024).toFixed(2)} MB · Ready</p>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0 sm:w-2/3">
              <label className="mb-1.5 block text-sm font-semibold text-foreground">
                {t('selectTargetLang')}
              </label>
              <LanguageSelector
                value={targetLang}
                onChange={setTargetLang}
                placeholderKey="selectTargetLang"
              />
            </div>

            <button
              type="button"
              onClick={handleStart}
              disabled={!canStart || launching}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-bold transition-all sm:w-1/3 sm:px-4',
                TRANSLATE_PRIMARY_CTA_CLASSNAME,
                (!canStart || launching) && 'cursor-not-allowed opacity-50'
              )}
            >
              {launching ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {t('starting')}
                </>
              ) : (
                <>
                  <CloudUpload size={20} />
                  {t('startOcrImage')}
                </>
              )}
            </button>

            {error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-center text-sm text-rose-700">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
