"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const CMAP_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`;

function isCrossOriginPdfUrl(url: string): boolean {
  if (typeof window === "undefined") {
    return url.startsWith("http://") || url.startsWith("https://");
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
  mode?: "source" | "target";
  /** 无 PDF 时显示的占位文案（如「译文生成中，请稍候...」） */
  placeholder?: string;
  /** 受控：当前页码（由父组件同步左右 Pane） */
  page?: number;
  /** 受控：翻页时通知父组件 */
  onPageChange?: (page: number) => void;
  /** 非受控时使用的初始页码 */
  initialPage?: number;
};

export function PdfViewerPane({
  fileUrl,
  mode = "source",
  placeholder,
  page: controlledPage,
  onPageChange,
  initialPage = 1,
}: Props) {
  const t = useTranslations("pdfViewer");
  const [numPages, setNumPages] = useState<number | null>(null);
  const [internalPage, setInternalPage] = useState(initialPage);
  const [hasTextLayer, setHasTextLayer] = useState<boolean | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const pageWrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isControlled = controlledPage !== undefined && onPageChange != null;
  const currentPage = isControlled ? controlledPage : internalPage;
  const safePage =
    numPages != null && numPages >= 1
      ? Math.max(1, Math.min(currentPage, numPages))
      : 1;

  const onLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  }, []);

  const onLoadError = useCallback((error: Error) => {
    if (error?.message?.includes("Worker was terminated") || error?.message?.includes("terminated")) {
      return;
    }
    console.error("[PdfViewerPane] load error", error);
  }, []);

  const goPrev = useCallback(() => {
    if (currentPage <= 1) return;
    if (isControlled) onPageChange(currentPage - 1);
    else setInternalPage((p) => Math.max(1, p - 1));
  }, [currentPage, isControlled, onPageChange]);

  const goNext = useCallback(() => {
    if (numPages != null && currentPage >= numPages) return;
    if (isControlled) onPageChange(currentPage + 1);
    else setInternalPage((p) => (numPages != null ? Math.min(numPages, p + 1) : p + 1));
  }, [currentPage, numPages, isControlled, onPageChange]);

  // 根据容器宽度渲染 PDF，避免用 CSS 缩放 canvas 导致模糊（react-pdf 内部已乘 devicePixelRatio）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth || 800);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fileUrl]);

  const isCrossOrigin = isCrossOriginPdfUrl(fileUrl);
  const optionsSame = useMemo(
    () => ({
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      withCredentials: true as const,
      // 译文预览：禁用内嵌字体避免画布乱码，会略微降低字体清晰度；下载的 PDF 不受影响
      ...(mode === "target" ? { disableFontFace: true as const } : {}),
    }),
    [mode],
  );
  const optionsCross = useMemo(
    () => ({
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      withCredentials: false as const,
      ...(mode === "target" ? { disableFontFace: true as const } : {}),
    }),
    [mode],
  );
  const pdfOptions = isCrossOrigin ? optionsCross : optionsSame;

  // 译文默认使用“文本层可见”来规避画布乱码，但当文本层缺失/为空时回退到画布渲染。
  useEffect(() => {
    setHasTextLayer(null);
    const el = pageWrapRef.current;
    if (!el) return;

    let stopped = false;
    const compute = () => {
      if (stopped) return;
      const layer = el.querySelector(".textLayer") as HTMLElement | null;
      if (!layer) return;
      const spans = Array.from(layer.querySelectorAll("span"));
      const hasText = spans.some((s) => (s.textContent || "").trim().length > 0);
      setHasTextLayer(hasText);
    };

    // 首次与异步渲染后都尝试检测
    const id = window.setTimeout(compute, 0);
    const id2 = window.setTimeout(compute, 250);
    const obs = new MutationObserver(() => compute());
    obs.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      stopped = true;
      window.clearTimeout(id);
      window.clearTimeout(id2);
      obs.disconnect();
    };
  }, [fileUrl, mode, safePage]);

  // 统一用画布渲染，保证译文中的图片可见（此前「文本层」模式会隐藏画布导致无图）
  const renderStrategy: "canvas" | "text" = "canvas";

  if (!fileUrl) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
        <span className="text-zinc-500">{placeholder ?? t("noPdf")}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      <Document
        file={fileUrl}
        options={pdfOptions}
        onLoadSuccess={onLoadSuccess}
        onLoadError={onLoadError}
        loading={
          <div className="flex h-96 items-center justify-center">{t("loading")}</div>
        }
        error={
          <div className="flex h-96 items-center justify-center text-red-500">
            {t("loadFailed")}
          </div>
        }
      >
        {numPages != null && numPages >= 1 && (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={goPrev}
                disabled={safePage <= 1}
                className="rounded border px-2 py-1 text-sm disabled:opacity-50"
              >
                {t("prevPage")}
              </button>
              <span className="text-sm">
                {safePage} / {numPages}
              </span>
              <button
                onClick={goNext}
                disabled={safePage >= numPages}
                className="rounded border px-2 py-1 text-sm disabled:opacity-50"
              >
                {t("nextPage")}
              </button>
            </div>
            <div
              className={mode === "target" ? "pdf-viewer-target-pane" : mode === "source" ? "pdf-viewer-source-pane" : undefined}
              data-pdf-mode={mode}
              data-render-strategy={renderStrategy}
              ref={pageWrapRef}
            >
              <Page
                pageNumber={safePage}
                width={containerWidth}
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
