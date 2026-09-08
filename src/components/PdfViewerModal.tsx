import { useEffect, useRef, useState } from 'react';
import { Download, FileWarning, LoaderCircle, Minus, Plus, Printer, RotateCw, X, ChevronLeft, ChevronRight } from 'lucide-react';
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

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getDefaultZoom(): number {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 0.6 : 1;
}

export function PdfViewerModal({ title, sourceUrl, downloadUrl, onClose }: PdfViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(getDefaultZoom);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    setLoading(true);
    setFetching(true);
    setError(null);
    setPageNumber(1);
    setPageCount(0);
    setZoom(getDefaultZoom());
    setRotation(0);

    const loadPdf = async () => {
      try {
        const response = await fetch(`/api/pdf-proxy?url=${encodeURIComponent(sourceUrl)}`, {
          headers: { Accept: 'application/pdf' },
        });
        if (!response.ok) throw new Error(response.status === 403 ? 'permission denied' : `PDF fetch failed: ${response.status}`);

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/pdf')) throw new Error('The server did not return a PDF file.');

        const pdfBlob = await response.blob();
        if (cancelled) return;

        objectUrl = URL.createObjectURL(new Blob([pdfBlob], { type: 'application/pdf' }));
        loadingTask = pdfjsLib.getDocument({ url: objectUrl, withCredentials: false });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setFetching(false);
        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          setFetching(false);
          setLoading(false);
          setError(getPdfErrorMessage(loadError));
        }
      }
    };

    void loadPdf();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      if (loadingTask) void loadingTask.destroy();
      if (pdfRef.current) pdfRef.current.cleanup();
      pdfRef.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
    const pdfPrintUrl = `/api/pdf-proxy?url=${encodeURIComponent(sourceUrl)}`;
    const printWindow = window.open(pdfPrintUrl, '_blank');
    if (!printWindow) return;

    if (isMobileDevice()) {
      // Keep the print call inside the tap gesture so mobile Chrome can hand
      // the original PDF to the installed print app.
      printWindow.focus();
      printWindow.print();
      return;
    }
    
    // Trigger print dialog after PDF is loaded
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 1000);
  };

  const browserDownloadUrl = `/api/pdf-proxy?url=${encodeURIComponent(downloadUrl)}`;

  return (
    <div
      className="fixed inset-0 z-[3000] flex h-screen w-screen flex-col bg-slate-200"
      aria-labelledby="pdf-viewer-title"
    >
      <div className="flex h-full w-full flex-col overflow-hidden bg-white">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between bg-gradient-to-r from-navy to-blue-900 px-5 py-4 sm:px-6">
          <h2 id="pdf-viewer-title" className="truncate pr-4 text-base font-bold text-white sm:text-lg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close PDF preview" className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Toolbar */}
        <div className="flex shrink-0 flex-nowrap items-center justify-between gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-2 sm:flex-wrap sm:gap-3 sm:px-6 sm:py-3">
          {/* Page Navigation */}
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button 
              type="button" 
              onClick={() => setPageNumber(page => Math.max(1, page - 1))} 
              disabled={loading || pageNumber <= 1} 
              aria-label="Previous page"
              title="Previous page"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent sm:p-2.5"
            >
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <span className="min-w-10 text-center text-xs font-semibold text-slate-700 sm:min-w-14 sm:text-sm">{loading ? '...' : `${pageNumber}/${pageCount}`}</span>
            <button 
              type="button" 
              onClick={() => setPageNumber(page => Math.min(pageCount, page + 1))} 
              disabled={loading || pageNumber >= pageCount}
              aria-label="Next page"
              title="Next page"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent sm:p-2.5"
            >
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>

          {/* Control Buttons */}
          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0 sm:gap-2">
            <button 
              type="button" 
              onClick={() => setZoom(value => Math.max(0.5, Number((value - 0.1).toFixed(1))))} 
              disabled={loading} 
              aria-label="Zoom out"
              title="Zoom out"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2"
            >
              <Minus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <span className="w-10 text-center text-[11px] font-semibold text-slate-600 sm:w-12 sm:text-sm">{Math.round(zoom * 100)}%</span>
            <button 
              type="button" 
              onClick={() => setZoom(value => Math.min(2.5, Number((value + 0.1).toFixed(1))))} 
              disabled={loading} 
              aria-label="Zoom in"
              title="Zoom in"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2"
            >
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <div className="mx-0.5 h-5 w-px bg-slate-300 sm:mx-1" />
            <button 
              type="button" 
              onClick={() => setRotation(value => (value + 90) % 360)} 
              disabled={loading} 
              aria-label="Rotate PDF"
              title="Rotate PDF"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2"
            >
              <RotateCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <button 
              type="button" 
              onClick={handlePrint} 
              disabled={loading || rendering || !!error} 
              aria-label="Print PDF page"
              title="Print"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2"
            >
              <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <a 
              href={browserDownloadUrl} 
              download={`${title}.pdf`} 
              aria-label="Download PDF"
              title="Download PDF"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm sm:p-2"
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </a>
          </div>
        </div>

        {/* Content Area */}
        <main className="relative min-h-0 flex-1 overflow-auto bg-slate-200 p-4 sm:p-6">
          {(fetching || loading || rendering) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
              <LoaderCircle className="mb-3 h-8 w-8 animate-spin text-white" />
              <p className="text-sm font-semibold text-white">
                {fetching ? 'Loading PDF...' : rendering ? 'Rendering page...' : 'Preparing PDF...'}
              </p>
            </div>
          )}
          {error ? (
            <div className="flex min-h-full items-center justify-center p-6">
              <div className="max-w-md rounded-xl bg-white p-8 text-center shadow-xl">
                <FileWarning className="mx-auto h-12 w-12 text-red-500" />
                <h3 className="mt-4 text-lg font-bold text-navy">Unable to Preview PDF</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{error}</p>
                <a 
                  href={browserDownloadUrl} 
                  download={`${title}.pdf`} 
                  className="btn-primary mx-auto mt-6 inline-flex items-center gap-2 rounded-lg bg-navy px-5 py-2.5 text-white transition hover:bg-blue-900"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </a>
              </div>
            </div>
          ) : (
            <div className="flex min-h-full min-w-full items-start justify-center">
              <canvas ref={canvasRef} className="bg-white shadow-lg" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
