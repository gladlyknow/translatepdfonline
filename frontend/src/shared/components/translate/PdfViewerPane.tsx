'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const CMAP_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`;

function isCrossOriginPdfUrl(url: string): boolean {
  if (typeof window === 'undefined') {
    return url.startsWith('http://') || url.startsWith('https://');
  }
  try {
    const u = new URL(url, window.location.origin);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

type Props = {
  fileUrl: string;
  mode?: 'source' | 'target';
  placeholder?: string;
  page?: number;
  onPageChange?: (page: number) => void;
  initialPage?: number;
  /** When using single-page slice URLs, pass total pages for "N / total" display and prev/next limits */
  totalPages?: number;
  /** PDF 加载成功后回调（用于大文件 total_pages=0 时把页数回写给积分估算等） */
  onPdfNumPages?: (numPages: number) => void;
  /** 相对容器测量宽度的缩放（双栏共用同一 scale 时由父组件传入） */
  scale?: number;
  minScale?: number;
  maxScale?: number;
  onScaleChange?: (next: number) => void;
  showZoomControls?: boolean;
};

export function PdfViewerPane({
  fileUrl,
  mode = 'source',
  placeholder,
  page: controlledPage,
  onPageChange,
  initialPage = 1,
  totalPages: totalPagesProp,
  onPdfNumPages,
  scale = 1,
  minScale = 0.5,
  maxScale = 2.5,
  onScaleChange,
  showZoomControls = false,
}: Props) {
  const t = useTranslations('translate.pdfViewer');
  const [numPages, setNumPages] = useState<number | null>(null);
  const [internalPage, setInternalPage] = useState(initialPage);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [loadFailedUrl, setLoadFailedUrl] = useState<string | null>(null);
  const pageWrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** 仅量父列宽度，不包含 PDF，避免画布尺寸变化触发 ResizeObserver 与滚动条抖动 */
  const widthMeasureRef = useRef<HTMLDivElement | null>(null);
  const lastWidthRef = useRef<number>(800);

  const isControlled =
    controlledPage !== undefined && onPageChange != null;
  const currentPage = isControlled ? controlledPage : internalPage;
  const effectiveTotal =
    totalPagesProp != null && totalPagesProp >= 1
      ? totalPagesProp
      : numPages;
  const safePage =
    effectiveTotal != null && effectiveTotal >= 1
      ? Math.max(1, Math.min(currentPage, effectiveTotal))
      : 1;

  /** 有 file 时尽量不因 total 与 numPages 短暂空窗卸载整页（减少闪烁） */
  const shouldRenderPage =
    (effectiveTotal != null && effectiveTotal >= 1) ||
    (numPages != null && numPages >= 1);

  useEffect(() => {
    setLoadFailedUrl(null);
    setNumPages(null);
  }, [fileUrl]);

  const onLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setLoadFailedUrl(null);
      onPdfNumPages?.(n);
    },
    [onPdfNumPages]
  );

  const onLoadError = useCallback(
    (error: Error) => {
      if (
        error?.message?.includes('Worker was terminated') ||
        error?.message?.includes('terminated')
      ) {
        return;
      }
      console.error('[PdfViewerPane] load error', error);
      setLoadFailedUrl(fileUrl);
    },
    [fileUrl]
  );

  const goPrev = useCallback(() => {
    if (currentPage <= 1) return;
    if (isControlled) onPageChange?.(currentPage - 1);
    else setInternalPage((p) => Math.max(1, p - 1));
  }, [currentPage, isControlled, onPageChange]);

  const goNext = useCallback(() => {
    const total = totalPagesProp ?? numPages;
    if (total != null && currentPage >= total) return;
    if (isControlled)
      onPageChange?.(currentPage + 1);
    else
      setInternalPage((p) =>
        total != null ? Math.min(total, p + 1) : p + 1
      );
  }, [currentPage, numPages, totalPagesProp, isControlled, onPageChange]);

  useEffect(() => {
    const el = widthMeasureRef.current;
    if (!el) return;

    let debounceTimer: number | undefined;
    let raf1 = 0;
    let raf2 = 0;

    const applyWidth = () => {
      // clientWidth 会随 overflow 区域是否出现纵向滚动条变化约 15–17px，阈值过小会与 PDF 改宽形成来回抖（闪缩）
      const raw = Math.round(el.clientWidth);
      if (raw < 48) return;
      if (Math.abs(raw - lastWidthRef.current) <= 24) return;
      lastWidthRef.current = raw;
      setContainerWidth(raw);
    };

    const scheduleResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(applyWidth, 280);
    };

    raf1 = requestAnimationFrame(() => {
      raf1 = 0;
      raf2 = requestAnimationFrame(() => {
        raf2 = 0;
        applyWidth();
      });
    });

    const ro = new ResizeObserver(scheduleResize);
    ro.observe(el);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      ro.disconnect();
    };
  }, [fileUrl]);

  const isCrossOrigin = isCrossOriginPdfUrl(fileUrl);
  const optionsSame = useMemo(
    () => ({
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      withCredentials: true as const,
      ...(mode === 'target' ? { disableFontFace: true as const } : {}),
    }),
    [mode]
  );
  const optionsCross = useMemo(
    () => ({
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      withCredentials: false as const,
      ...(mode === 'target' ? { disableFontFace: true as const } : {}),
    }),
    [mode]
  );
  const pdfOptions = isCrossOrigin ? optionsCross : optionsSame;

  const renderStrategy: 'canvas' | 'text' = 'canvas';

  const pageWidth = Math.max(
    80,
    Math.round(containerWidth * Math.min(maxScale, Math.max(minScale, scale)))
  );

  const zoomOut = useCallback(() => {
    const next = Math.round((scale - 0.1) * 10) / 10;
    onScaleChange?.(Math.max(minScale, next));
  }, [scale, minScale, onScaleChange]);

  const zoomIn = useCallback(() => {
    const next = Math.round((scale + 0.1) * 10) / 10;
    onScaleChange?.(Math.min(maxScale, next));
  }, [scale, maxScale, onScaleChange]);

  const zoomReset = useCallback(() => {
    onScaleChange?.(1);
  }, [onScaleChange]);

  if (!fileUrl) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
        <span className="text-zinc-500">{placeholder ?? t('noPdf')}</span>
      </div>
    );
  }

  if (loadFailedUrl === fileUrl) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
        <span className="text-red-500">{t('loadFailed')}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-w-0 w-full flex-col gap-2">
      <div
        ref={widthMeasureRef}
        className="h-0 min-h-0 w-full min-w-0 shrink-0 overflow-hidden"
        aria-hidden
      />
      <Document
        file={fileUrl}
        options={pdfOptions}
        onLoadSuccess={onLoadSuccess}
        onLoadError={onLoadError}
        loading={
          <div className="flex h-96 items-center justify-center">
            {t('loading')}
          </div>
        }
        error={
          <div className="flex h-96 items-center justify-center text-red-500">
            {t('loadFailed')}
          </div>
        }
      >
        {shouldRenderPage && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={goPrev}
                disabled={safePage <= 1}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800"
              >
                {t('prevPage')}
              </button>
              <span className="text-sm tabular-nums">
                {safePage} /{' '}
                {effectiveTotal != null && effectiveTotal >= 1
                  ? effectiveTotal
                  : (numPages ?? '…')}
              </span>
              <button
                type="button"
                onClick={goNext}
                disabled={
                  effectiveTotal != null && effectiveTotal >= 1
                    ? safePage >= effectiveTotal
                    : numPages != null
                      ? safePage >= numPages
                      : false
                }
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800"
              >
                {t('nextPage')}
              </button>
              {showZoomControls && onScaleChange && (
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={zoomOut}
                    disabled={scale <= minScale + 0.01}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                    aria-label={t('zoomOut')}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[3rem] text-center text-xs tabular-nums text-zinc-500">
                    {Math.round(scale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={zoomIn}
                    disabled={scale >= maxScale - 0.01}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                    aria-label={t('zoomIn')}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={zoomReset}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                    aria-label={t('zoomReset')}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </div>
            <div
              className={
                mode === 'target'
                  ? 'pdf-viewer-target-pane'
                  : mode === 'source'
                    ? 'pdf-viewer-source-pane'
                    : undefined
              }
              data-pdf-mode={mode}
              data-render-strategy={renderStrategy}
              ref={pageWrapRef}
            >
              <Page
                pageNumber={safePage}
                width={pageWidth}
                renderTextLayer
                renderAnnotationLayer
                renderMode="canvas"
                className="border border-zinc-200 dark:border-zinc-700"
              />
            </div>
          </>
        )}
      </Document>
    </div>
  );
}
