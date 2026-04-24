'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/shared/lib/utils';

const PDF_PREVIEW_RESIZE_DEBOUNCE_MS = 140;
/** pdf.js 分块 Range 请求，避免先整包下载大 PDF */
const PDF_RANGE_CHUNK_SIZE = 65536;

type Props = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onActivate?: () => void;
  file: File | null;
  /** 可 Range 的 HTTPS 源地址时优先于整包 `file.arrayBuffer()` */
  sourcePdfUrl?: string | null;
  /** 1-based page number to show for PDF */
  pageNum: number;
  bottomMeta?: string;
  hideHeader?: boolean;
  hideFooter?: boolean;
  labels: {
    collapse: string;
    expand: string;
    noFile: string;
    pdfLoadError: string;
  };
  onPdfPageCountChange?: (count: number) => void;
};

export function ParseResultOriginalPanel({
  collapsed,
  onToggleCollapse,
  onActivate,
  file,
  sourcePdfUrl = null,
  pageNum,
  bottomMeta,
  hideHeader,
  hideFooter,
  labels,
  onPdfPageCountChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const lastRenderTokenRef = useRef(0);
  const activeRenderTaskRef = useRef<any>(null);
  const pdfjsRef = useRef<any>(null);
  const pdfDocRef = useRef<any>(null);
  const pdfDocKeyRef = useRef<string>('');
  const lastPreviewSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [kind, setKind] = useState<'pdf' | 'image' | null>(null);
  const [previewResizeTick, setPreviewResizeTick] = useState(0);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        const prev = lastPreviewSizeRef.current;
        if (Math.abs(w - prev.w) < 2 && Math.abs(h - prev.h) < 2) return;
        lastPreviewSizeRef.current = { w, h };
        setPreviewResizeTick((v) => v + 1);
      }, PDF_PREVIEW_RESIZE_DEBOUNCE_MS);
    });
    ro.observe(host);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    setPdfError(null);
    setPdfLoading(false);
    if (!file) {
      setKind(null);
      setImgUrl(null);
      return;
    }
    const lowerName = file.name.toLowerCase();
    if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
      setKind('pdf');
      setImgUrl(null);
      return;
    }
    if (file.type === 'application/octet-stream' && lowerName.endsWith('.pdf')) {
      setKind('pdf');
      setImgUrl(null);
      return;
    }
    if (
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(lowerName)
    ) {
      setKind('image');
      const u = URL.createObjectURL(file);
      setImgUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setKind(null);
    setImgUrl(null);
  }, [file]);

  useEffect(() => {
    if (kind === 'pdf') return;
    onPdfPageCountChange?.(1);
    if (pdfDocRef.current?.destroy) {
      try {
        void pdfDocRef.current.destroy();
      } catch {
        /* ignore */
      }
    }
    pdfDocRef.current = null;
    pdfDocKeyRef.current = '';
  }, [kind, onPdfPageCountChange]);

  useEffect(() => {
    return () => {
      if (pdfDocRef.current?.destroy) {
        try {
          void pdfDocRef.current.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  useEffect(() => {
    if (collapsed) return;
    if (kind !== 'pdf' || !file) return;
    const useRangeUrl =
      !!sourcePdfUrl &&
      /^https:\/\//i.test(sourcePdfUrl) &&
      (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    const token = ++lastRenderTokenRef.current;
    let cancelled = false;

    const logStageFail = (stage: string, err: unknown) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[translator-pdf-preview]', stage, err);
      }
    };
    const isStale = () => cancelled || token !== lastRenderTokenRef.current;

    (async () => {
      try {
        if (!isStale()) {
          const canvas = canvasRef.current;
          const hasPreview = !!canvas && canvas.width > 0 && canvas.height > 0;
          const sourceKey = useRangeUrl
            ? `url:${sourcePdfUrl}`
            : `${file.name}:${file.size}:${file.lastModified}`;
          const switchedSource = pdfDocKeyRef.current !== sourceKey;
          setPdfLoading(!hasPreview || switchedSource || !!pdfError);
          setPdfError(null);
        }

        let pdfjs = pdfjsRef.current;
        if (!pdfjs) {
          try {
            pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
          } catch (err) {
            logStageFail('import-legacy', err);
            pdfjs = await import('pdfjs-dist');
          }
          pdfjsRef.current = pdfjs;
        }
        if (isStale()) return;
        try {
          if (pdfjs?.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
            try {
              pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
                import.meta.url
              ).toString();
            } catch {
              pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                'pdfjs-dist/build/pdf.worker.min.mjs',
                import.meta.url
              ).toString();
            }
          }
        } catch (err) {
          logStageFail('set-worker-src', err);
        }

        const sourceKey = useRangeUrl
          ? `url:${sourcePdfUrl}`
          : `${file.name}:${file.size}:${file.lastModified}`;
        let pdf = pdfDocKeyRef.current === sourceKey ? pdfDocRef.current : null;
        if (!pdf) {
          if (pdfDocRef.current?.destroy) {
            try {
              await pdfDocRef.current.destroy();
            } catch {
              /* ignore */
            }
          }
          let candidates: Record<string, unknown>[];
          if (useRangeUrl) {
            candidates = [
              {
                url: sourcePdfUrl,
                rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
                disableRange: false,
                disableStream: false,
                withCredentials: false,
                isEvalSupported: false,
              },
              {
                url: sourcePdfUrl,
                rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
                disableRange: false,
                disableStream: false,
                withCredentials: false,
                disableWorker: true,
                isEvalSupported: false,
              },
            ];
          } else {
            const buf = await file.arrayBuffer();
            if (isStale()) return;
            const bytes = new Uint8Array(buf);
            candidates = [
              {
                data: bytes,
                disableWorker: true,
                isEvalSupported: false,
                stopAtErrors: false,
                useWorkerFetch: false,
              },
              {
                data: bytes,
                disableWorker: false,
                useWorkerFetch: false,
              },
            ];
          }
          for (let i = 0; i < candidates.length; i++) {
            try {
              pdf = await pdfjs.getDocument(candidates[i]).promise;
              break;
            } catch (err) {
              logStageFail(`getDocument-${i}`, err);
            }
            if (isStale()) return;
          }
          if (!pdf) throw new Error('all getDocument attempts failed');
          pdfDocRef.current = pdf;
          pdfDocKeyRef.current = sourceKey;
        }
        if (isStale()) return;
        onPdfPageCountChange?.(Math.max(1, Number(pdf.numPages || 1)));

        const p = Math.min(Math.max(1, pageNum), Math.max(1, pdf.numPages));
        const page = await pdf.getPage(p);
        if (isStale()) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const host = previewHostRef.current;
        const availW = Math.max(40, host?.clientWidth ?? baseViewport.width);
        const availH = Math.max(40, host?.clientHeight ?? baseViewport.height);
        const fitScale = Math.max(
          0.2,
          Math.min(availW / baseViewport.width, availH / baseViewport.height)
        );
        const viewport = page.getViewport({ scale: fitScale });

        const canvas = canvasRef.current;
        if (!canvas || isStale()) return;

        const scratch = document.createElement('canvas');
        scratch.width = Math.max(1, Math.floor(viewport.width));
        scratch.height = Math.max(1, Math.floor(viewport.height));
        const scratchCtx = scratch.getContext('2d');
        if (!scratchCtx) throw new Error('canvas context unavailable');

        if (activeRenderTaskRef.current) {
          try {
            activeRenderTaskRef.current.cancel();
          } catch {
            /* ignore */
          }
          activeRenderTaskRef.current = null;
        }
        const task = page.render({ canvasContext: scratchCtx, viewport });
        activeRenderTaskRef.current = task;
        await task.promise;
        if (activeRenderTaskRef.current === task) {
          activeRenderTaskRef.current = null;
        }
        if (isStale()) return;
        canvas.width = scratch.width;
        canvas.height = scratch.height;
        const targetCtx = canvas.getContext('2d');
        if (!targetCtx) throw new Error('canvas context unavailable');
        targetCtx.clearRect(0, 0, canvas.width, canvas.height);
        targetCtx.drawImage(scratch, 0, 0);
        setPdfError(null);
      } catch (err: any) {
        if (isStale() || err?.name === 'RenderingCancelledException') return;
        logStageFail('render', err);
        setPdfError(labels.pdfLoadError);
      } finally {
        if (!isStale()) {
          setPdfLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (activeRenderTaskRef.current) {
        try {
          activeRenderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
        activeRenderTaskRef.current = null;
      }
    };
  }, [
    collapsed,
    file,
    kind,
    labels.pdfLoadError,
    onPdfPageCountChange,
    pageNum,
    previewResizeTick,
    sourcePdfUrl,
  ]);

  if (collapsed) {
    return (
      <div className="border-border/60 flex h-full min-h-0 w-10 shrink-0 flex-col items-center border-r bg-amber-50/70 py-2">
        <button
          type="button"
          className="group relative flex size-8 items-center justify-center rounded-md border-0 bg-transparent transition-all active:translate-y-[1px] active:scale-[0.98]"
          title={labels.expand}
          onClick={onToggleCollapse}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/icons/fold2.svg"
            alt=""
            className="size-5 rotate-180 opacity-70 transition-opacity group-hover:opacity-100"
          />
        </button>
      </div>
    );
  }

  return (
    <div
      data-original-panel="true"
      className="border-border/30 relative flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col border-r bg-[linear-gradient(180deg,rgba(255,251,235,0.92)_0%,rgba(254,243,199,0.58)_100%)]"
      onMouseDown={() => onActivate?.()}
    >
      <button
        type="button"
        title={labels.collapse}
        aria-label={labels.collapse}
        className="group absolute top-2 right-2 z-20 flex size-8 items-center justify-center rounded-md border-0 bg-transparent"
        onClick={onToggleCollapse}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/icons/fold2.svg"
          alt=""
          className="size-5 opacity-70 transition-opacity group-hover:opacity-100"
        />
      </button>
      {hideHeader ? null : (
        <div className="border-border/60 flex h-11 shrink-0 items-center gap-2 border-b px-2 py-1.5 pr-12">
          <span className="text-muted-foreground truncate text-xs font-medium">
            {file?.name || labels.noFile}
          </span>
        </div>
      )}
      <div
        ref={previewHostRef}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden p-0',
          !file &&
            'text-muted-foreground flex items-center justify-center text-center text-xs'
        )}
      >
        {!file ? (
          labels.noFile
        ) : kind === 'pdf' ? (
          <div className="relative flex h-full w-full flex-col items-center justify-center rounded-sm border border-amber-900/10 bg-amber-50/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <canvas
              ref={canvasRef}
              data-pdf-preview-canvas="true"
              className="h-full w-full object-contain rounded-sm bg-amber-50/15"
              aria-label="PDF preview"
            />
            {pdfLoading ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-amber-50/28">
                <p className="text-muted-foreground text-xs">Loading preview...</p>
              </div>
            ) : null}
            {pdfError ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-amber-50/55">
                <p className="text-destructive text-xs">{labels.pdfLoadError}</p>
              </div>
            ) : null}
          </div>
        ) : kind === 'image' && imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgUrl}
            alt=""
            className="mx-auto h-full max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-muted-foreground text-xs">{labels.noFile}</span>
        )}
      </div>
      {hideFooter ? null : (
        <div className="border-border/60 bg-muted/20 text-muted-foreground flex h-8 shrink-0 items-center justify-center border-t px-3 text-xs">
          {bottomMeta || '—'}
        </div>
      )}
    </div>
  );
}
