import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileWarning,
  LoaderCircle,
  Minus,
  Plus,
  Printer,
  RotateCw,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  Eye,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfViewerModalProps {
  title: string;
  sourceUrl?: string;
  downloadUrl?: string;
  onClose: () => void;
  isEmbed?: boolean;
  isLoadingDocument?: boolean;
  documentError?: string | null;
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
  if (message.includes('not a valid pdf')) {
    return 'The source did not return a valid PDF document. Please verify the document link.';
  }
  return 'This PDF could not be loaded. Please try again, use the alternate viewer, or download the file.';
}

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getDefaultZoom(): number {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 0.6 : 1;
}

export function PdfViewerModal({
  title,
  sourceUrl,
  downloadUrl,
  onClose,
  isEmbed = false,
  isLoadingDocument = false,
  documentError = null,
}: PdfViewerModalProps) {
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
  const [isDismissed, setIsDismissed] = useState(false);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [useNativeViewer, setUseNativeViewer] = useState(false);

  const handleClose = () => {
    if (isEmbed) {
      try {
        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
          const payload = {
            type: 'icc-pdf-viewer-close',
            action: 'close',
            source: 'icc-pdf-viewer',
            documentTitle: title,
          };
          window.parent.postMessage(payload, '*');
          window.parent.postMessage({ ...payload, type: 'ICC_PDF_VIEWER_CLOSE' }, '*');
        }
      } catch (postError) {
        console.error('Failed to notify parent window of close action:', postError);
      }

      try {
        if (typeof window !== 'undefined' && window.frameElement) {
          (window.frameElement as HTMLElement).style.display = 'none';
        }
      } catch {
        // Cross-origin restriction
      }

      setIsDismissed(true);
      onClose();
      return;
    }
    onClose();
  };

  const browserDownloadUrl = downloadUrl 
    ? (downloadUrl.startsWith('/') ? downloadUrl : `/api/pdf-proxy?url=${encodeURIComponent(downloadUrl)}`)
    : sourceUrl 
      ? (sourceUrl.startsWith('/') ? sourceUrl : `/api/pdf-proxy?url=${encodeURIComponent(sourceUrl)}`)
      : '#';

  useEffect(() => {
    if (documentError) {
      setError(documentError);
      setFetching(false);
      setLoading(false);
      return;
    }

    if (isLoadingDocument || !sourceUrl) {
      setFetching(true);
      setLoading(true);
      setError(null);
      return;
    }

    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    setLoading(true);
    setFetching(true);
    setError(null);
    setPageNumber(1);
    setPageCount(0);
    setZoom(getDefaultZoom());
    setRotation(0);

    const fetchPdfBuffer = async (url: string): Promise<Uint8Array> => {
      const candidates: string[] = [];

      // 1. If it's a local static path, try direct fetch first
      if (url.startsWith('/')) {
        candidates.push(url);
        candidates.push(`/api/pdf-proxy?url=${encodeURIComponent(url)}`);
      } else {
        candidates.push(`/api/pdf-proxy?url=${encodeURIComponent(url)}`);
      }

      let lastError: Error | null = null;

      for (const targetUrl of candidates) {
        // Attempt with 1 automatic retry
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt > 0) {
              await new Promise(resolve => setTimeout(resolve, 600));
            }
            if (cancelled) throw new Error('Loading cancelled');

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 14000);

            const response = await fetch(targetUrl, {
              signal: controller.signal,
              headers: { Accept: 'application/pdf,application/octet-stream,*/*' },
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error(response.status === 403 ? 'permission denied' : `PDF fetch failed: ${response.status}`);
            }

            const arrayBuf = await response.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuf);

            // Magic bytes check for %PDF
            if (uint8.length >= 4 && uint8[0] === 0x25 && uint8[1] === 0x50 && uint8[2] === 0x44 && uint8[3] === 0x46) {
              return uint8;
            }

            // If local fetch failed, maybe try the next candidate
            throw new Error('The returned file is not a valid PDF document.');
          } catch (err: any) {
            lastError = err;
            if (cancelled) throw err;
          }
        }
      }

      throw lastError || new Error('Failed to load PDF');
    };

    const loadPdf = async () => {
      try {
        const uint8Data = await fetchPdfBuffer(sourceUrl);
        if (cancelled) return;

        // Initialize PDF.js directly with Uint8Array data
        loadingTask = pdfjsLib.getDocument({
          data: uint8Data,
          cMapPacked: true,
          standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
        });

        const pdf = await loadingTask.promise;
        if (cancelled) return;

        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setFetching(false);
        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          console.warn('[PdfViewerModal] PDF load failed:', loadError);
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
    };
  }, [sourceUrl, isLoadingDocument, documentError, reloadTrigger]);

  useEffect(() => {
    let cancelled = false;
    const renderPage = async () => {
      const pdf = pdfRef.current;
      const canvas = canvasRef.current;
      if (!pdf || !canvas || loading || useNativeViewer) return;

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
          console.warn('[PdfViewerModal] Render error:', renderError);
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
  }, [loading, pageNumber, rotation, zoom, useNativeViewer]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
      if (event.key === 'ArrowLeft') setPageNumber(page => Math.max(1, page - 1));
      if (event.key === 'ArrowRight') setPageNumber(page => Math.min(pageCount, page + 1));
    };

    window.document.addEventListener('keydown', handleKeyDown);
    return () => window.document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pageCount, isEmbed, title]);

  const handlePrint = () => {
    if (!sourceUrl) return;
    const pdfPrintUrl = sourceUrl.startsWith('/') ? sourceUrl : `/api/pdf-proxy?url=${encodeURIComponent(sourceUrl)}`;
    const printWindow = window.open(pdfPrintUrl, '_blank');
    if (!printWindow) return;

    if (isMobileDevice()) {
      printWindow.focus();
      printWindow.print();
      return;
    }

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 1000);
  };

  const handleRetry = () => {
    setError(null);
    setUseNativeViewer(false);
    setReloadTrigger(prev => prev + 1);
  };

  if (isDismissed && isEmbed) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[3000] flex h-full w-full flex-col bg-slate-200"
      aria-labelledby="pdf-viewer-title"
    >
      <div className="flex h-full w-full flex-col overflow-hidden bg-white">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between bg-gradient-to-r from-navy to-blue-900 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-2 pr-2">
            <h2 id="pdf-viewer-title" className="truncate text-sm font-bold text-white sm:text-base md:text-lg">
              {title}
            </h2>
            {isEmbed && (
              <span className="hidden rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white/90 uppercase sm:inline-block">
                Embed
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close PDF preview"
            title={isEmbed ? "Close preview" : "Close and return to documents"}
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Toolbar */}
        {!useNativeViewer && (
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
              <span className="min-w-10 text-center text-xs font-semibold text-slate-700 sm:min-w-14 sm:text-sm">
                {loading ? '...' : `${pageNumber}/${pageCount}`}
              </span>
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
                onClick={() => setZoom(value => Math.max(0.4, Number((value - 0.1).toFixed(1))))}
                disabled={loading}
                aria-label="Zoom out"
                title="Zoom out"
                className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2"
              >
                <Minus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <span className="w-10 text-center text-[11px] font-semibold text-slate-600 sm:w-12 sm:text-sm">
                {Math.round(zoom * 100)}%
              </span>
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
                disabled={loading || rendering || !!error || !sourceUrl}
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
                className={`rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm sm:p-2 ${(!downloadUrl && !sourceUrl) || error ? 'pointer-events-none opacity-40' : ''}`}
              >
                <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </a>
            </div>
          </div>
        )}

        {/* Content Area */}
        <main className="relative min-h-0 flex-1 overflow-auto bg-slate-200">
          {(fetching || loading || rendering) && !useNativeViewer && !error && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
              <LoaderCircle className="mb-3 h-8 w-8 animate-spin text-white" />
              <p className="text-sm font-semibold text-white">
                {isLoadingDocument
                  ? 'Loading document...'
                  : fetching
                  ? 'Loading PDF...'
                  : rendering
                  ? 'Rendering page...'
                  : 'Preparing PDF...'}
              </p>
            </div>
          )}

          {useNativeViewer ? (
            <div className="flex h-full w-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2 text-xs text-slate-600">
                <span>Interactive Browser Preview</span>
                <button
                  type="button"
                  onClick={() => setUseNativeViewer(false)}
                  className="font-medium text-primary hover:underline"
                >
                  Switch back to standard canvas viewer
                </button>
              </div>
              <iframe
                src={browserDownloadUrl}
                title={title}
                className="h-full w-full border-0 flex-1 bg-white"
              />
            </div>
          ) : error ? (
            <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
              <div className="max-w-md w-full rounded-2xl bg-white p-6 sm:p-8 text-center shadow-xl border border-slate-100">
                <FileWarning className="mx-auto h-12 w-12 text-red-500" />
                <h3 className="mt-4 text-lg font-bold text-navy">Unable to Preview PDF</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{error}</p>
                
                <div className="mt-6 flex flex-col gap-2.5">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="btn-primary inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try Again
                  </button>

                  {browserDownloadUrl !== '#' && (
                    <button
                      type="button"
                      onClick={() => setUseNativeViewer(true)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Eye className="h-4 w-4 text-slate-500" />
                      Try Browser Viewer
                    </button>
                  )}

                  {browserDownloadUrl !== '#' && (
                    <a
                      href={browserDownloadUrl}
                      download={`${title}.pdf`}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                    >
                      <Download className="h-4 w-4" />
                      Download PDF File
                    </a>
                  )}

                  {isEmbed && typeof window !== 'undefined' && (
                    <a
                      href={window.location.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 pt-1 text-xs font-medium text-slate-500 hover:text-navy"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Full Page in New Tab
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-full min-w-full items-start justify-center p-3 sm:p-6">
              <canvas ref={canvasRef} className="bg-white shadow-lg" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
