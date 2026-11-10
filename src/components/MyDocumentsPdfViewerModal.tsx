import React, { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { driveClient } from '../services/driveClient';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface MyDocumentsPdfViewerModalProps {
  fileId: string;
  fileName: string;
  onClose: () => void;
}

function getPdfErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes('password')) return 'This PDF is password protected and cannot be previewed here.';
  if (message.includes('auth') || message.includes('sign in') || message.includes('token') || message.includes('401')) {
    return 'Authentication required. Please sign in with your Google account to preview this document.';
  }
  if (message.includes('permission') || message.includes('unauthorized') || message.includes('forbidden') || message.includes('403')) {
    return 'Permission denied. Please verify your Google Drive connection matches your logged-in account.';
  }
  if (message.includes('not a valid pdf')) {
    return 'The file does not appear to be a valid PDF document.';
  }
  return error instanceof Error ? error.message : 'Unable to load PDF preview. Please try again or download the file.';
}

function isMobileDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getDefaultZoom(): number {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 0.6 : 1;
}

export function MyDocumentsPdfViewerModal({
  fileId,
  fileName,
  onClose,
}: MyDocumentsPdfViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);
  const activeBlobRef = useRef<Blob | null>(null);

  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(getDefaultZoom);
  const [rotation, setRotation] = useState(0);

  const [fetching, setFetching] = useState(true);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  // 1. Fetch PDF buffer using authenticated Firebase ID token and initialize PDF.js
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    setFetching(true);
    setLoading(true);
    setError(null);
    setPageNumber(1);
    setPageCount(0);
    setZoom(getDefaultZoom());
    setRotation(0);

    const loadAuthenticatedPdf = async () => {
      try {
        // Reuse authenticated fetch logic
        const { buffer, blob, blobUrl } = await driveClient.getPreviewPdfBytes(fileId);

        if (cancelled) {
          window.URL.revokeObjectURL(blobUrl);
          return;
        }

        // Store active blob & blobUrl for instantaneous download and print
        if (activeBlobUrlRef.current) {
          window.URL.revokeObjectURL(activeBlobUrlRef.current);
        }
        activeBlobUrlRef.current = blobUrl;
        activeBlobRef.current = blob;

        const uint8Data = new Uint8Array(buffer);

        // Verify magic bytes for PDF (%PDF)
        if (
          uint8Data.length < 4 ||
          uint8Data[0] !== 0x25 ||
          uint8Data[1] !== 0x50 ||
          uint8Data[2] !== 0x44 ||
          uint8Data[3] !== 0x46
        ) {
          throw new Error('The file does not appear to be a valid PDF document.');
        }

        // Load document into PDF.js directly from in-memory bytes
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
      } catch (err: any) {
        if (!cancelled) {
          console.warn('[MyDocumentsPdfViewer] Load error:', err);
          setFetching(false);
          setLoading(false);
          setError(getPdfErrorMessage(err));
        }
      }
    };

    void loadAuthenticatedPdf();

    // Cleanup resources on unmount or retry
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      if (loadingTask) void loadingTask.destroy();
      if (pdfRef.current) {
        pdfRef.current.cleanup();
        pdfRef.current = null;
      }
      if (activeBlobUrlRef.current) {
        window.URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
      activeBlobRef.current = null;
    };
  }, [fileId, retryTrigger]);

  // 2. Render Page to Canvas
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
          console.warn('[MyDocumentsPdfViewer] Render error:', renderError);
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

  // 3. Keyboard shortcuts (Escape, Left Arrow, Right Arrow)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setPageNumber(p => Math.max(1, p - 1));
      if (event.key === 'ArrowRight') setPageNumber(p => Math.min(pageCount || 1, p + 1));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pageCount]);

  // 4. Download handler (reuses already loaded authenticated blob or triggers authenticated download)
  const handleDownload = async () => {
    setDownloading(true);
    try {
      if (activeBlobRef.current) {
        const url = window.URL.createObjectURL(activeBlobRef.current);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 1500);
      } else {
        await driveClient.triggerFileDownload(fileId, fileName);
      }
    } catch (err: any) {
      console.error('[MyDocumentsPdfViewer] Download error:', err);
    } finally {
      setDownloading(false);
    }
  };

  // 5. Print handler using active authenticated blob URL
  const handlePrint = () => {
    if (!activeBlobUrlRef.current) return;
    const printWindow = window.open(activeBlobUrlRef.current, '_blank');
    if (!printWindow) return;

    if (isMobileDevice()) {
      printWindow.focus();
      return;
    }

    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (err) {
        console.warn('[MyDocumentsPdfViewer] Print notice:', err);
      }
    }, 800);
  };

  // 6. Retry handler
  const handleRetry = () => {
    setError(null);
    setRetryTrigger(prev => prev + 1);
  };

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
              {fileName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF preview"
            title="Close and return to documents"
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Toolbar */}
        <div className="flex shrink-0 flex-nowrap items-center justify-between gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-2 sm:flex-wrap sm:gap-3 sm:px-6 sm:py-3">
          {/* Page Navigation */}
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setPageNumber(p => Math.max(1, p - 1))}
              disabled={loading || pageNumber <= 1}
              aria-label="Previous page"
              title="Previous page"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent sm:p-2 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <span className="min-w-10 text-center text-xs font-semibold text-slate-700 sm:min-w-14 sm:text-sm">
              {loading ? '...' : `${pageNumber}/${pageCount}`}
            </span>
            <button
              type="button"
              onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))}
              disabled={loading || pageNumber >= pageCount}
              aria-label="Next page"
              title="Next page"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent sm:p-2 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>

          {/* Controls: Zoom, Rotate, Print, Download */}
          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0 sm:gap-2">
            <button
              type="button"
              onClick={() => setZoom(val => Math.max(0.4, Number((val - 0.1).toFixed(1))))}
              disabled={loading}
              aria-label="Zoom out"
              title="Zoom out"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2 cursor-pointer"
            >
              <Minus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <span className="w-10 text-center text-[11px] font-semibold text-slate-600 sm:w-12 sm:text-sm">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom(val => Math.min(2.5, Number((val + 0.1).toFixed(1))))}
              disabled={loading}
              aria-label="Zoom in"
              title="Zoom in"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <div className="mx-0.5 h-5 w-px bg-slate-300 sm:mx-1" />

            <button
              type="button"
              onClick={() => setRotation(val => (val + 90) % 360)}
              disabled={loading}
              aria-label="Rotate PDF"
              title="Rotate PDF"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2 cursor-pointer"
            >
              <RotateCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || rendering || !!error || !activeBlobUrlRef.current}
              aria-label="Print PDF"
              title="Print"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm disabled:opacity-40 sm:p-2 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              aria-label="Download PDF"
              title="Download PDF"
              className="rounded-lg p-1.5 text-navy transition hover:bg-white hover:shadow-sm sm:p-2 cursor-pointer disabled:opacity-50"
            >
              {downloading ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4 text-primary" />
              ) : (
                <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <main className="relative min-h-0 flex-1 overflow-auto bg-slate-200">
          {(fetching || loading || rendering) && !error && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
              <LoaderCircle className="mb-3 h-8 w-8 animate-spin text-white" />
              <p className="text-sm font-semibold text-white">
                {fetching ? 'Loading PDF...' : rendering ? 'Rendering page...' : 'Preparing PDF...'}
              </p>
            </div>
          )}

          {error ? (
            <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
              <div className="max-w-md w-full rounded-2xl bg-white p-6 sm:p-8 text-center shadow-xl border border-slate-100">
                <FileWarning className="mx-auto h-12 w-12 text-red-500" />
                <h3 className="mt-4 text-lg font-bold text-navy">Unable to Preview PDF</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{error}</p>

                <div className="mt-6 flex flex-col gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-primary/90 cursor-pointer disabled:opacity-60"
                  >
                    {downloading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin text-white" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    <span>Download PDF File</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRetry}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 cursor-pointer"
                  >
                    <RefreshCw className="h-4 w-4 text-slate-500" />
                    <span>Try Preview Again</span>
                  </button>

                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 cursor-pointer"
                  >
                    <span>Close Preview</span>
                  </button>
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
