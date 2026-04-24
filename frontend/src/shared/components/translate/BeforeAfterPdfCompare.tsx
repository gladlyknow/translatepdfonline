'use client';

import { useCallback, useId, useState } from 'react';
import { useTranslations } from 'next-intl';

const DEFAULT_BEFORE = '/translate-compare/before.svg';
const DEFAULT_AFTER = '/translate-compare/after.svg';

type Props = {
  beforeSrc?: string;
  afterSrc?: string;
  className?: string;
  imageFit?: 'cover' | 'contain';
};

/**
 * 拖拽或滑动控制左右对比（Before / After），用于翻译漏斗「Magic Moment」。
 */
export function BeforeAfterPdfCompare({
  beforeSrc = DEFAULT_BEFORE,
  afterSrc = DEFAULT_AFTER,
  className = '',
  imageFit = 'cover',
}: Props) {
  const t = useTranslations('translate.home');
  const labelId = useId();
  const [pct, setPct] = useState(52);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);

  const mergeAspectFromNaturalSize = useCallback((w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const r = w / h;
    setImageAspectRatio((prev) => (prev == null ? r : Math.max(prev, r)));
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPct((p) => Math.max(0, p - 5));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setPct((p) => Math.min(100, p + 5));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setPct(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setPct(100);
    }
  }, []);

  const ar = imageAspectRatio ?? 16 / 10;
  const maxBoxH = 'min(360px, 70vh)';
  /** 高度封顶时按宽高比收缩宽度，避免 max-h 与 aspect-ratio 冲突 */
  const frameStyle: React.CSSProperties = {
    aspectRatio: ar,
    maxHeight: maxBoxH,
    width: `min(100%, calc(${maxBoxH} * (${ar})))`,
  };

  const imgClass =
    imageFit === 'contain'
      ? 'absolute inset-0 h-full w-full object-contain object-left bg-zinc-50 dark:bg-zinc-900'
      : 'absolute inset-0 h-full w-full object-cover object-left';

  return (
    <section
      className={`w-full ${className}`}
      aria-labelledby={labelId}
    >
      <h2
        id={labelId}
        className="mb-4 text-center text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-xl"
      >
        {t('compareTitle')}
      </h2>
      <p className="mb-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {t('compareHint')}
      </p>

      <div className="mx-auto flex w-full max-w-3xl justify-center">
        <div
          className="relative w-full overflow-hidden rounded-xl border border-zinc-200 bg-white/90 shadow-[0_8px_30px_-12px_rgba(14,165,233,0.2)] dark:border-white/10 dark:bg-slate-900/50 dark:shadow-[0_0_40px_-12px_rgba(56,189,248,0.35)]"
          style={frameStyle}
          onKeyDown={onKeyDown}
        >
          {/* Before — full frame */}
          <img
            src={beforeSrc}
            alt=""
            onLoad={(e) => {
              const el = e.currentTarget;
              mergeAspectFromNaturalSize(el.naturalWidth, el.naturalHeight);
            }}
            className={imgClass}
            draggable={false}
          />
          <span className="pointer-events-none absolute left-2 top-2 z-[5] rounded bg-black/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-200">
            {t('compareBeforeLabel')}
          </span>

          {/* After — clipped from the left; reveals Before on the left */}
          <div
            className="absolute inset-0"
            style={{ clipPath: `inset(0 0 0 ${pct}%)` }}
          >
            <img
              src={afterSrc}
              alt=""
              onLoad={(e) => {
                const el = e.currentTarget;
                mergeAspectFromNaturalSize(el.naturalWidth, el.naturalHeight);
              }}
              className={imgClass}
              draggable={false}
            />
          </div>
          <span className="pointer-events-none absolute right-2 top-2 z-[5] rounded bg-black/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-200">
            {t('compareAfterLabel')}
          </span>

          {/* Divider */}
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-zinc-700/90 shadow-[0_0_8px_rgba(0,0,0,0.15)] dark:bg-white/90 dark:shadow-[0_0_12px_rgba(255,255,255,0.6)]"
            style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-600 bg-white shadow-lg dark:border-white dark:bg-slate-900/90"
            style={{ left: `${pct}%`, top: '50%' }}
            aria-hidden
          />

          <input
            type="range"
            min={0}
            max={100}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
            aria-label={t('compareSliderAria')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${pct}%`}
          />
        </div>
      </div>
    </section>
  );
}
