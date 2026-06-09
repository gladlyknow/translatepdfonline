import React, { useState, useEffect } from "react";
import * as pdfjs from "pdfjs-dist";
import { Loader2, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";

// Setup PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

interface PdfPreviewProps {
  file: File | Blob | null;
}

export function PdfPreview({ file }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!file) {
      setNumPages(0);
      setPageNumber(1);
      return;
    }

    const loadPdf = async () => {
      setLoading(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        setNumPages(pdf.numPages);
        renderPage(pdf, 1);
      } catch (err) {
        console.error("Error loading PDF preview:", err);
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
  }, [file]);

  const renderPage = async (pdf: any, pageNum: number) => {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;
  };

  const changePage = async (offset: number) => {
    if (!file) return;
    const newPage = pageNumber + offset;
    if (newPage >= 1 && newPage <= numPages) {
      setPageNumber(newPage);
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      renderPage(pdf, newPage);
    }
  };

  if (!file) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-black/20 bg-white/50 rounded-[32px] border border-dashed border-black/5">
        <Maximize2 size={48} strokeWidth={1} />
        <p className="mt-4 font-medium">PDF Preview Area</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-black/5 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-black/30">Preview</span>
          <div className="h-4 w-px bg-black/10" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">Page {pageNumber} / {numPages}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => changePage(-1)}
            disabled={pageNumber <= 1}
            className="p-1.5 hover:bg-black/5 rounded-full disabled:opacity-20 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => changePage(1)}
            disabled={pageNumber >= numPages}
            className="p-1.5 hover:bg-black/5 rounded-full disabled:opacity-20 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 flex justify-center bg-[#F9F9F9] scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-emerald-600" size={24} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <canvas ref={canvasRef} className="shadow-xl rounded-sm max-w-full max-h-full object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}

import { useRef } from "react";
