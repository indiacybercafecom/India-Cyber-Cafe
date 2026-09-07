import { useEffect, useRef, useState } from 'react';
import { Download, FileWarning, LoaderCircle, Minus, Plus, Printer, RotateCw, X } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfViewerModalProps {
  title: string;
  sourceUrl: string;
  downloadUrl: string;
  onClose: () => void;
}

function getPdfErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes('password')) return 'This PDF is password protected and cannot be previewed here.';
  if (message.includes('cors') || message.includes('network') || message.includes('failed to fetch')) {
    return 'The PDF could not be reached. Check that the file is publicly viewable and try again.';
  }
  if (message.includes('permission') || message.includes('unauthorized') || message.includes('forbidden')) {
    return 'This PDF is not publicly accessible. Update the file sharing permission and try again.';
  }
  return 'This PDF could not be loaded. Please try again or download the file.';
}

export function PdfViewerModal({ title, sourceUrl, downloadUrl, onClose }: PdfViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjsLib.getDocument({ url: sourceUrl, withCredentials: false });

    setLoading(true);
    setError(null);
    setPageNumber(1);
    setPageCount(0);
    setZoom(1);
    setRotation(0);

    loadingTask.promise.then(pdf => {
      if (cancelled) {
        return;
      }
      pdfRef.current = pdf;
      setPageCount(pdf.numPages);
      setLoading(false);
    }).catch(loadError => {
      if (!cancelled) {
        setLoading(false);
        setError(getPdfErrorMessage(loadError));
      }
    });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      pdfRef.current = null;
      void loadingTask.destroy();
    };
  }, [sourceUrl]);

  useEffect(() => {
    let cancelled = false;
    const renderPage = async () => {
      const pdf = pdfRef.current;
      const canvas = canvasRef.current;
      if (!pdf || !canvas || loading) return;

      setRendering(true);
      renderTaskRef.current?.cancel();

      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: zoom, rotation });
        const devicePixelRatio = window.devicePixelRatio || 1;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is not supported by this browser.');

        canvas.width = viewport.width * devicePixelRatio;
        canvas.height = viewport.height * devicePixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (renderError) {
        if (!cancelled && (renderError as { name?: string }).name !== 'RenderingCancelledException') {
          setError(getPdfErrorMessage(renderError));
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [loading, pageNumber, rotation, zoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setPageNumber(page => Math.max(1, page - 1));
      if (event.key === 'ArrowRight') setPageNumber(page => Math.min(pageCount, page + 1));
    };

    window.document.addEventListener('keydown', handleKeyDown);
    return () => window.document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pageCount]);

  const handlePrint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const printFrame = window.document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.srcdoc = `<html><head><title>${title}</title></head><body style="margin:0;text-align:center"><img src="${canvas.toDataURL('image/png')}" style="max-width:100%;height:auto" /></body></html>`;
    printFrame.onload = () => {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
      window.setTimeout(() => printFrame.remove(), 1000);
    };
    window.document.body.appendChild(printFrame);
  };

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-viewer-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
          <h2 id="pdf-viewer-title" className="truncate pr-4 text-base font-semibold text-navy sm:text-lg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close PDF preview" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-navy">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:justify-between sm:px-5">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPageNumber(page => Math.max(1, page - 1))} disabled={loading || pageNumber <= 1} className="rounded-lg px-3 py-2 font-semibold text-navy hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <span className="min-w-20 text-center font-semibold text-slate-600">{loading ? '...' : `${pageNumber} / ${pageCount}`}</span>
            <button type="button" onClick={() => setPageNumber(page => Math.min(pageCount, page + 1))} disabled={loading || pageNumber >= pageCount} className="rounded-lg px-3 py-2 font-semibold text-navy hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setZoom(value => Math.max(0.5, Number((value - 0.1).toFixed(1))))} disabled={loading} aria-label="Zoom out" className="rounded-lg p-2 text-navy hover:bg-white disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <span className="w-12 text-center font-semibold text-slate-600">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom(value => Math.min(2.5, Number((value + 0.1).toFixed(1))))} disabled={loading} aria-label="Zoom in" className="rounded-lg p-2 text-navy hover:bg-white disabled:opacity-40"><Plus className="h-4 w-4" /></button>
            <button type="button" onClick={() => setRotation(value => (value + 90) % 360)} disabled={loading} aria-label="Rotate PDF" className="rounded-lg p-2 text-navy hover:bg-white disabled:opacity-40"><RotateCw className="h-4 w-4" /></button>
            <button type="button" onClick={handlePrint} disabled={loading || rendering || !!error} aria-label="Print PDF page" className="rounded-lg p-2 text-navy hover:bg-white disabled:opacity-40"><Printer className="h-4 w-4" /></button>
            <a href={downloadUrl} download={`${title}.pdf`} target="_blank" rel="noopener noreferrer" aria-label="Download PDF" className="rounded-lg p-2 text-navy hover:bg-white"><Download className="h-4 w-4" /></a>
          </div>
        </div>

        <main className="relative min-h-0 flex-1 overflow-auto bg-slate-700 p-3 sm:p-6">
          {(loading || rendering) && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-700/80 text-sm font-semibold text-white"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />{loading ? 'Loading PDF...' : 'Rendering page...'}</div>}
          {error ? <div className="flex min-h-full items-center justify-center p-6"><div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-xl"><FileWarning className="mx-auto h-10 w-10 text-red-500" /><h3 className="mt-3 text-lg font-bold text-navy">Unable to preview PDF</h3><p className="mt-2 text-sm leading-relaxed text-slate-500">{error}</p><a href={downloadUrl} download={`${title}.pdf`} target="_blank" rel="noopener noreferrer" className="btn-primary mx-auto mt-5 inline-flex items-center gap-2"><Download className="h-4 w-4" />Download PDF</a></div></div> : <div className="flex min-h-full min-w-full items-start justify-center"><canvas ref={canvasRef} className="bg-white shadow-xl" /></div>}
        </main>
      </div>
    </div>
  );
}
