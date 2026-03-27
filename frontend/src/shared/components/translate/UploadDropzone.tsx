'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CloudUpload } from 'lucide-react';
import { useSession } from '@/core/auth/client';
import { translateApi } from '@/shared/lib/translate-api';

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB, must match server

export type UploadedFileStatus = 'idle' | 'uploading' | 'uploaded' | 'failed';

export type UploadedInfo = {
  name: string;
  size: number;
  status: UploadedFileStatus;
};

type Props = {
  onUploaded: (
    documentId: string,
    filename: string,
    sizeBytes: number,
    file?: File
  ) => void;
  initialFile?: { name: string; size: number } | null;
  /** 翻译页顶栏：降低高度，与设置区并排时更协调 */
  compactToolbar?: boolean;
  /** 漏斗首页：大拖拽区 + 营销文案 */
  variant?: 'default' | 'hero';
  /** 与 variant=hero 配合：深色渐变 Hero 上的玻璃态与发光描边 */
  heroTone?: 'light' | 'dark';
};

export function UploadDropzone({
  onUploaded,
  initialFile,
  compactToolbar = false,
  variant = 'default',
  heroTone = 'light',
}: Props) {
  const t = useTranslations('translate.upload');
  const tHome = useTranslations('translate.home');
  const inputId = useId();
  const { data: session, isPending: sessionPending } = useSession();
  const isLoggedIn = Boolean(session?.user);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadedInfo, setUploadedInfo] = useState<UploadedInfo | null>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);

  useEffect(() => {
    if (initialFile) {
      setUploadedInfo({
        name: initialFile.name,
        size: initialFile.size,
        status: 'uploaded',
      });
    } else {
      setUploadedInfo(null);
    }
  }, [initialFile]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!isLoggedIn) {
        setError(t('loginRequired'));
        return;
      }
      if (file.type !== 'application/pdf') {
        setError(t('selectPdfOnly'));
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(t('fileTooLarge'));
        return;
      }
      setUploading(true);
      setError(null);
      setLoginHint(null);
      setUploadedInfo({ name: file.name, size: file.size, status: 'uploading' });
      setUploadProgress(0);
      const progressInterval = setInterval(() => {
        setUploadProgress((p) => Math.min(p + 12, 85));
      }, 200);
      try {
        const presigned = await translateApi.createPresignedUpload(
          file.name,
          file.size
        );
        const putRes = await fetch(presigned.upload_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': 'application/pdf' },
        });
        if (!putRes.ok) {
          throw new Error('Upload to storage failed');
        }
        clearInterval(progressInterval);
        setUploadProgress(100);
        const { document_id } = await translateApi.completePresignedUpload(
          presigned.object_key,
          file.name,
          file.size
        );
        onUploaded(document_id, file.name, file.size, file);
        setUploadedInfo({ name: file.name, size: file.size, status: 'uploaded' });
      } catch (e) {
        clearInterval(progressInterval);
        const err = e as Error & { status?: number };
        if (err.status === 401) {
          setError(t('loginRequired'));
          setUploadedInfo((prev) => (prev ? { ...prev, status: 'failed' } : null));
          return;
        }
        if (err.status === 503) {
          setError(t('storageUnavailable'));
          setUploadedInfo((prev) => (prev ? { ...prev, status: 'failed' } : null));
          return;
        }
        if (err.status === 403) {
          const msg = err.message || '';
          if (
            msg.includes('fingerprint_required') ||
            msg.includes('quota') ||
            msg.includes('login')
          ) {
            setLoginHint(t('loginHintQuotaExceeded'));
            setError(null);
            setUploadedInfo(null);
            return;
          }
        }
        setError(err instanceof Error ? err.message : t('error'));
        setUploadedInfo((prev) =>
          prev ? { ...prev, status: 'failed' } : null
        );
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [onUploaded, t, isLoggedIn]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (!isLoggedIn) {
        setError(t('loginRequired'));
        return;
      }
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile, isLoggedIn, t]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isLoggedIn) {
        setError(t('loginRequired'));
        e.target.value = '';
        return;
      }
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
      e.target.value = '';
    },
    [uploadFile, isLoggedIn, t]
  );

  const hasFile = !!uploadedInfo;
  const statusCopy =
    uploadedInfo?.status === 'uploading'
      ? t('uploading')
      : uploadedInfo?.status === 'uploaded'
        ? t('success')
        : uploadedInfo?.status === 'failed'
          ? t('error')
          : '';

  const disabled = !isLoggedIn || uploading;
  const showLoginRequired = !sessionPending && !isLoggedIn;
  const isHero = variant === 'hero';
  const heroDark = isHero && heroTone === 'dark';
  const minH = isHero
    ? 'min-h-[220px] sm:min-h-[260px]'
    : compactToolbar
      ? 'min-h-[104px]'
      : 'min-h-[160px]';
  const borderTone = heroDark
    ? 'border-white/30 bg-white/5 backdrop-blur-md hover:border-sky-300/50'
    : isHero
      ? 'border-zinc-300 bg-white hover:border-slate-400 dark:border-zinc-600 dark:bg-zinc-900/80 dark:hover:border-zinc-500'
      : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:border-zinc-500';

  const dropzoneInner = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (isLoggedIn) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${minH} ${
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
      } ${
        dragging
          ? heroDark
            ? 'border-sky-400 bg-sky-500/15'
            : 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
          : borderTone
      }`}
    >
      <input
        type="file"
        accept="application/pdf"
        onChange={handleChange}
        disabled={disabled}
        className="hidden"
        id={inputId}
      />
      <label
        htmlFor={disabled ? undefined : inputId}
        className={`flex min-h-[44px] w-full flex-col items-center justify-center gap-2 ${
          isHero ? 'px-6 py-10' : compactToolbar ? 'px-3 py-3' : 'px-4 py-6'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {showLoginRequired ? (
          <span className="text-center text-amber-600 dark:text-amber-400">
            {t('loginRequired')}
          </span>
        ) : hasFile ? (
          <div
            className={`w-full max-w-md rounded-lg border p-3 text-xs shadow-sm ${
              heroDark
                ? 'border-white/15 bg-slate-950/60 text-zinc-100 backdrop-blur-sm'
                : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-8 items-center justify-center rounded text-xs font-semibold ${
                  uploadedInfo.status === 'failed'
                    ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
                    : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
                }`}
              >
                PDF
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{uploadedInfo.name}</div>
                <div className="text-[11px] text-zinc-500">
                  {statusCopy}
                  {uploadedInfo.status !== 'uploading' && (
                    <>
                      {' '}
                      ·{' '}
                      {uploadedInfo.size > 0
                        ? `${(uploadedInfo.size / 1024 / 1024).toFixed(2)} MB`
                        : '— MB'}
                    </>
                  )}
                </div>
              </div>
            </div>
            {uploadedInfo.status === 'uploading' && (
              <div className="mt-3">
                <div className="mb-1 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <div
                    className="h-1 rounded-full bg-blue-500 transition-[width] duration-300 dark:bg-blue-400"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-zinc-500">{t('uploading')}</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {isHero ? (
              <>
                <CloudUpload
                  className={
                    heroDark
                      ? 'h-12 w-12 text-sky-300/90'
                      : 'h-12 w-12 text-slate-400 dark:text-zinc-500'
                  }
                  strokeWidth={1.25}
                  aria-hidden
                />
                <span
                  className={`text-center text-base font-semibold ${
                    heroDark ? 'text-zinc-50' : 'text-slate-800 dark:text-zinc-100'
                  }`}
                >
                  {tHome('heroUploadLead')}
                </span>
                <span
                  className={`max-w-md text-center text-sm ${
                    heroDark ? 'text-zinc-300' : 'text-slate-500 dark:text-zinc-400'
                  }`}
                >
                  {tHome('heroUploadSub')}
                </span>
                <span
                  className={`text-center text-xs ${
                    heroDark ? 'text-zinc-400' : 'text-slate-400 dark:text-zinc-500'
                  }`}
                >
                  {tHome('heroLanguagesHint')}
                </span>
              </>
            ) : (
              <span className="text-center text-zinc-600 dark:text-zinc-400">
                {t('dropzone')}
              </span>
            )}
            {error && (
              <span className="text-sm text-red-600 dark:text-red-400">
                {error}
              </span>
            )}
          </>
        )}
      </label>
      {hasFile && error && uploadedInfo?.status === 'failed' && (
        <p className="mt-1 max-w-md px-2 text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {loginHint && (
        <div className="mt-3 w-full max-w-md rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-900/30 dark:text-amber-100">
          {loginHint}
        </div>
      )}
    </div>
  );

  if (!heroDark) {
    return dropzoneInner;
  }

  return (
    <div className="relative rounded-[1.05rem] p-[2px]">
      <div
        className="pointer-events-none absolute inset-0 rounded-[1.05rem] bg-[conic-gradient(from_180deg_at_50%_50%,#38bdf8_0deg,#6366f1_120deg,#22d3ee_240deg,#38bdf8_360deg)] opacity-70 animate-dropzone-hero-glow"
        aria-hidden
      />
      <div className="relative rounded-2xl bg-slate-950/40 p-[1px] shadow-[0_0_40px_-8px_rgba(56,189,248,0.45)] backdrop-blur-sm">
        {dropzoneInner}
      </div>
    </div>
  );
}
