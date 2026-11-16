import { useState, useRef, useEffect } from 'react';
import { Application, ApplicationNote, UserProfile } from '../types';
import { IconRenderer } from './Icons';
import { SelectDropdown } from './SelectDropdown';
import { showToast } from './Toast';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Reply, Download, X, ChevronLeft, ChevronRight, Minus, Plus, LoaderCircle, FileWarning } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  assignApplicationOperatorApi,
  updateApplicationPaymentStatusApi,
  type EmailDeliverySummary,
} from '../services/emailService';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
import { trimWhitespace } from '../utils/sanitizer';
import {
  ALLOWED_OPERATOR_STATUSES,
  MAX_NOTE_LENGTH,
  MAX_REPLY_ATTACHMENTS,
  MAX_REPLY_ATTACHMENT_BYTES,
  getApplicationPermissions,
  getOrdinalLabel,
  normalizeApplicationNotes,
  normalizeNoteAttachments,
} from '../utils/permissions';

interface ApplicationDetailsModalProps {
  app: Application | null;
  onClose: () => void;
  currentUser: UserProfile;
  operators: UserProfile[];
}

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const ALLOWED_ATTACHMENT_EXTENSIONS = /\.(pdf|jpe?g|png|webp)$/i;
const MAX_ATTACHMENT_BYTES = MAX_REPLY_ATTACHMENT_BYTES;

function isFileUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.includes('/uploads/');
}

function extractFileUrls(value: unknown): string[] | null {
  if (isFileUrl(value)) {
    return [value.trim()];
  }

  let candidates: unknown[] | null = null;
  if (Array.isArray(value)) {
    candidates = value;
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      candidates = keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => (value as Record<string, unknown>)[k]);
    }
  }

  if (!candidates) return null;

  const nonEmpty = candidates.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  if (nonEmpty.length === 0 || !nonEmpty.every(isFileUrl)) {
    return null;
  }
  return nonEmpty.map((item) => item.trim());
}

const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Server took too long to respond. Your entered data is preserved.');
    }
    throw new Error('Connection failed while saving. Your entered data is preserved.');
  } finally {
    clearTimeout(timer);
  }
}

function resolveInternalAttachmentFetchUrl(rawUrl: string, appId?: string): string | null {
  let cleaned = String(rawUrl || '').trim().replace(/&amp;/g, '&');
  if (!cleaned) return null;
  if (cleaned.startsWith('api/operator/attachments/')) {
    cleaned = `/${cleaned}`;
  }
  try {
    const parsed = new URL(cleaned, window.location.origin);
    if (!parsed.pathname.startsWith('/api/operator/attachments/')) {
      return null;
    }
    if (appId && !parsed.searchParams.get('appId')) {
      parsed.searchParams.set('appId', appId);
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

async function detectBlobPreviewKind(blob: Blob, contentTypeHeader: string | null, filename?: string): Promise<'image' | 'pdf' | 'other'> {
  try {
    const headerBuf = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (
      headerBuf.length >= 4 &&
      headerBuf[0] === 0x25 &&
      headerBuf[1] === 0x50 &&
      headerBuf[2] === 0x44 &&
      headerBuf[3] === 0x46
    ) {
      return 'pdf';
    }
    if (
      (headerBuf.length >= 3 && headerBuf[0] === 0xff && headerBuf[1] === 0xd8 && headerBuf[2] === 0xff) ||
      (headerBuf.length >= 8 && headerBuf[0] === 0x89 && headerBuf[1] === 0x50 && headerBuf[2] === 0x4e && headerBuf[3] === 0x47) ||
      (headerBuf.length >= 12 &&
        headerBuf[0] === 0x52 &&
        headerBuf[1] === 0x49 &&
        headerBuf[2] === 0x46 &&
        headerBuf[3] === 0x46 &&
        headerBuf[8] === 0x57 &&
        headerBuf[9] === 0x45 &&
        headerBuf[10] === 0x42 &&
        headerBuf[11] === 0x50)
    ) {
      return 'image';
    }
  } catch {}
  const ct = String(contentTypeHeader || blob.type || '').toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.startsWith('image/')) return 'image';
  const lowerName = String(filename || '').toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'pdf';
  if (/\.(jpe?g|png|webp)$/.test(lowerName)) return 'image';
  return 'other';
}

interface AttachmentPreviewState {
  name: string;
  blob: Blob;
  blobUrl: string;
  kind: 'image' | 'pdf';
}

function AttachmentPreviewOverlay({
  preview,
  onClose,
  onDownload,
}: {
  preview: AttachmentPreviewState;
  onClose: () => void;
  onDownload: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(preview.kind === 'pdf');
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (preview.kind !== 'pdf') return;
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setPdfLoading(true);
    setPdfError(null);
    setPdfPage(1);
    setPdfPageCount(0);

    (async () => {
      try {
        const buffer = await preview.blob.arrayBuffer();
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(buffer),
          cMapPacked: true,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setPdfPageCount(pdf.numPages);
        setPdfLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setPdfError(err?.message || 'Unable to preview PDF. You can still download the file.');
          setPdfLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      if (loadingTask) void loadingTask.destroy();
      if (pdfDocRef.current) {
        pdfDocRef.current.cleanup();
        pdfDocRef.current = null;
      }
    };
  }, [preview]);

  useEffect(() => {
    if (preview.kind !== 'pdf' || !pdfDocRef.current || pdfPageCount === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const pdf = pdfDocRef.current;
        if (!pdf) return;
        const page = await pdf.getPage(pdfPage);
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        renderTaskRef.current?.cancel();
        const pixelRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
        const viewport = page.getViewport({ scale: zoom * 1.25 });
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        const task = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = task;
        await task.promise;
      } catch (err: any) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          setPdfError('Failed to render PDF page. Use Download to open locally.');
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [preview, pdfPage, pdfPageCount, zoom]);

  return (
    <div
      data-testid="attachment-preview-modal"
      onClick={e => e.stopPropagation()}
      className="fixed inset-0 z-[2100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
    >
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-white">
          <h4 className="text-xs sm:text-sm font-bold text-navy truncate">{preview.name}</h4>
          <div className="flex items-center gap-2 shrink-0">
            {preview.kind === 'pdf' && pdfPageCount > 0 && (
              <div className="hidden sm:flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1 text-xs text-slate-700">
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => setZoom(z => Math.max(0.5, Number((z - 0.2).toFixed(1))))}
                  className="p-1 hover:bg-slate-200 rounded"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="min-w-[40px] text-center font-medium">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => setZoom(z => Math.min(2.4, Number((z + 0.2).toFixed(1))))}
                  className="p-1 hover:bg-slate-200 rounded"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <button
              type="button"
              data-testid="attachment-preview-download-btn"
              onClick={onDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy/90 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
            <button
              type="button"
              aria-label="Close attachment preview"
              data-testid="attachment-preview-close-btn"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100 p-3 sm:p-5 flex items-center justify-center min-h-[260px]">
          {preview.kind === 'image' ? (
            <img
              data-testid="attachment-preview-image"
              src={preview.blobUrl}
              alt={preview.name}
              className="max-w-full max-h-[72vh] object-contain rounded-lg shadow-sm bg-white"
            />
          ) : pdfLoading ? (
            <div className="flex flex-col items-center gap-2 text-slate-600 text-xs sm:text-sm py-8">
              <LoaderCircle className="w-6 h-6 animate-spin text-navy" />
              <span>Loading PDF preview...</span>
            </div>
          ) : pdfError ? (
            <div className="flex flex-col items-center gap-3 text-center max-w-sm py-8">
              <FileWarning className="w-8 h-8 text-amber-500" />
              <p className="text-xs sm:text-sm text-slate-600">{pdfError}</p>
              <button
                type="button"
                onClick={onDownload}
                className="px-4 py-2 rounded-xl bg-navy text-white text-xs font-bold"
              >
                Download PDF
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 w-full">
              <canvas
                ref={canvasRef}
                data-testid="attachment-preview-pdf-canvas"
                className="shadow-md bg-white rounded max-w-full"
              />
              {pdfPageCount > 1 && (
                <div className="flex items-center gap-3 bg-white px-3 py-1.5 rounded-full shadow text-xs font-medium text-navy">
                  <button
                    type="button"
                    disabled={pdfPage <= 1}
                    onClick={() => setPdfPage(p => Math.max(1, p - 1))}
                    className="p-1 rounded-full hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span>Page {pdfPage} of {pdfPageCount}</span>
                  <button
                    type="button"
                    disabled={pdfPage >= pdfPageCount}
                    onClick={() => setPdfPage(p => Math.min(pdfPageCount, p + 1))}
                    className="p-1 rounded-full hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ApplicationDetailsModal({ app, onClose, currentUser, operators }: ApplicationDetailsModalProps) {
  const [noteText, setNoteText] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [noteFile, setNoteFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentPreviewState | null>(null);
  const [localStatusOverride, setLocalStatusOverride] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const staffSubmittingRef = useRef(false);
  const staffClientKeyRef = useRef<string | null>(null);

  // User two-way reply state
  const [isReplyExpanded, setIsReplyExpanded] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [replyLoading, setReplyLoading] = useState(false);
  const [localAppendedNotes, setLocalAppendedNotes] = useState<ApplicationNote[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const replySubmittingRef = useRef(false);
  const replyClientKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewAttachment?.blobUrl) {
        URL.revokeObjectURL(previewAttachment.blobUrl);
      }
    };
  }, [previewAttachment]);

  useEffect(() => {
    setPreviewAttachment(null);
    setIsReplyExpanded(false);
    setLocalAppendedNotes([]);
    setLocalStatusOverride(null);
    setReplyText('');
    setReplyFiles([]);
    setReplyLoading(false);
    replySubmittingRef.current = false;
    replyClientKeyRef.current = null;
    setNoteText('');
    setNewStatus('');
    setNoteFile(null);
    setLoading(false);
    staffSubmittingRef.current = false;
    staffClientKeyRef.current = null;
    if (replyFileInputRef.current) replyFileInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [app?.id]);

  useEffect(() => {
    if (localStatusOverride && app?.status === localStatusOverride) {
      setLocalStatusOverride(null);
    }
  }, [app?.status, localStatusOverride]);

  if (!app) return null;

  const perms = getApplicationPermissions(app, currentUser);

  if (!perms.canViewApplication) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
          <h3 className="text-xl font-bold text-navy">Access Denied</h3>
          <p className="text-sm text-slate-600">
            You do not have permission to view this application.
          </p>
          <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} className="btn-primary px-6 py-2.5 text-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  const baseNormalizedNotes = normalizeApplicationNotes(app.notes);
  const existingNoteIds = new Set(baseNormalizedNotes.map(n => n.id).filter(Boolean));
  const existingClientReplyIds = new Set(baseNormalizedNotes.map(n => n.clientReplyId).filter(Boolean));
  const existingClientRequestIds = new Set(baseNormalizedNotes.map(n => n.clientRequestId).filter(Boolean));
  const pendingLocalNotes = localAppendedNotes.filter(
    n =>
      (!n.id || !existingNoteIds.has(n.id)) &&
      (!n.clientReplyId || !existingClientReplyIds.has(n.clientReplyId)) &&
      (!n.clientRequestId || !existingClientRequestIds.has(n.clientRequestId))
  );
  const normalizedNotes = normalizeApplicationNotes([...baseNormalizedNotes, ...pendingLocalNotes]);
  const displayStatus = localStatusOverride || app.status;

  const appendLocalNoteUnique = (incoming: ApplicationNote | null | undefined) => {
    if (!incoming || typeof incoming !== 'object') return;
    setLocalAppendedNotes(prev => {
      const alreadyExists = prev.some(
        n =>
          (incoming.id && n.id === incoming.id) ||
          (incoming.clientReplyId && n.clientReplyId === incoming.clientReplyId) ||
          (incoming.clientRequestId && n.clientRequestId === incoming.clientRequestId)
      );
      return alreadyExists ? prev : [...prev, incoming];
    });
  };

  const triggerBlobDownload = (blobUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename || 'attachment';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenAttachment = async (rawUrl: string, filename?: string) => {
    if (!rawUrl) return;
    const normalizedExternal = rawUrl.trim().replace(/&amp;/g, '&');
    const internalFetchUrl = resolveInternalAttachmentFetchUrl(normalizedExternal, app.id);

    if (!internalFetchUrl) {
      const link = document.createElement('a');
      link.href = normalizedExternal;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      if (filename) link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    setDownloadingAttachment(rawUrl);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Please sign in again to view this attachment.');
      }
      const resp = await fetchWithTimeout(
        internalFetchUrl,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        },
        30000
      );
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Unable to open attachment.');
      }
      const blob = await resp.blob();
      const displayName = filename || 'attachment';
      const kind = await detectBlobPreviewKind(blob, resp.headers.get('Content-Type'), displayName);
      const blobUrl = URL.createObjectURL(blob);

      if (kind === 'image' || kind === 'pdf') {
        setPreviewAttachment({
          name: displayName,
          blob,
          blobUrl,
          kind,
        });
      } else {
        triggerBlobDownload(blobUrl, displayName);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      }
    } catch (err: any) {
      showToast(err?.message || 'Unable to open attachment.', 'error');
    } finally {
      setDownloadingAttachment(null);
    }
  };

  const handleFileChange = (file: File | null) => {
    if (staffSubmittingRef.current || loading) return;
    if (!file) {
      setNoteFile(null);
      staffClientKeyRef.current = null;
      return;
    }
    if (file.size <= 0) {
      showToast('Attachment file is empty or unreadable.', 'error');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showToast('Attachment size must be 5MB or smaller.', 'error');
      return;
    }
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type) && !ALLOWED_ATTACHMENT_EXTENSIONS.test(file.name)) {
      showToast('Only PDF, JPG, PNG, and WEBP attachments are allowed.', 'error');
      return;
    }
    setNoteFile(file);
    staffClientKeyRef.current = null;
  };

  const handleReplyFilesChange = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const incoming = Array.from(fileList);
    const rejectedErrors: string[] = [];
    const validFiles: File[] = [];

    for (const file of incoming) {
      if (file.size <= 0) {
        rejectedErrors.push(`"${file.name}" is empty.`);
        continue;
      }
      if (file.size > MAX_REPLY_ATTACHMENT_BYTES) {
        rejectedErrors.push(`"${file.name}" exceeds the 5MB limit.`);
        continue;
      }
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type) && !ALLOWED_ATTACHMENT_EXTENSIONS.test(file.name)) {
        rejectedErrors.push(`"${file.name}" has an unsupported format (only PDF, JPG, PNG, WEBP allowed).`);
        continue;
      }
      validFiles.push(file);
    }

    if (rejectedErrors.length > 0) {
      showToast(rejectedErrors[0], 'error');
    }

    if (validFiles.length > 0) {
      const existingKeys = new Set(replyFiles.map(f => `${f.name}:${f.size}:${f.lastModified}`));
      const uniqueNew = validFiles.filter(f => !existingKeys.has(`${f.name}:${f.size}:${f.lastModified}`));
      if (replyFiles.length + uniqueNew.length > MAX_REPLY_ATTACHMENTS) {
        showToast(`You can attach up to ${MAX_REPLY_ATTACHMENTS} files per reply.`, 'error');
        const allowedSlots = Math.max(0, MAX_REPLY_ATTACHMENTS - replyFiles.length);
        if (allowedSlots > 0) {
          setReplyFiles(prev => [...prev, ...uniqueNew.slice(0, allowedSlots)]);
          replyClientKeyRef.current = null;
        }
      } else if (uniqueNew.length > 0) {
        setReplyFiles(prev => [...prev, ...uniqueNew]);
        replyClientKeyRef.current = null;
      }
    }

    if (replyFileInputRef.current) {
      replyFileInputRef.current.value = '';
    }
  };

  const removeReplyFile = (index: number) => {
    setReplyFiles(prev => prev.filter((_, i) => i !== index));
    replyClientKeyRef.current = null;
  };

  const handleCancelReply = () => {
    if (replyLoading) return;
    setIsReplyExpanded(false);
    setReplyText('');
    setReplyFiles([]);
    replyClientKeyRef.current = null;
    if (replyFileInputRef.current) {
      replyFileInputRef.current.value = '';
    }
  };

  const handleSendReply = async () => {
    if (replySubmittingRef.current || replyLoading) return;

    if (!perms.canReplyToApplication) {
      showToast('Only the application owner can send replies.', 'error');
      return;
    }

    const sanitizedReply = trimWhitespace(replyText);
    if (sanitizedReply.length > MAX_NOTE_LENGTH) {
      showToast(`Reply must be ${MAX_NOTE_LENGTH} characters or less.`, 'error');
      return;
    }
    if (!sanitizedReply && replyFiles.length === 0) {
      showToast('Please enter a message or attach at least one file.', 'error');
      return;
    }
    if (replyFiles.length > MAX_REPLY_ATTACHMENTS) {
      showToast(`You can attach up to ${MAX_REPLY_ATTACHMENTS} files per reply.`, 'error');
      return;
    }
    for (const file of replyFiles) {
      if (file.size <= 0 || file.size > MAX_REPLY_ATTACHMENT_BYTES) {
        showToast(`"${file.name}" exceeds the 5MB limit or is empty.`, 'error');
        return;
      }
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type) && !ALLOWED_ATTACHMENT_EXTENSIONS.test(file.name)) {
        showToast('Only PDF, JPG, PNG, and WEBP files are allowed.', 'error');
        return;
      }
    }

    replySubmittingRef.current = true;
    setReplyLoading(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Authentication session expired. Please sign in again.');
      }

      if (!replyClientKeyRef.current) {
        replyClientKeyRef.current = `reply_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      }

      let uploadedAttachments: Array<{ url: string; name: string }> = [];
      if (replyFiles.length > 0) {
        const formData = new FormData();
        replyFiles.forEach(file => {
          formData.append('files', file);
        });
        const uploadResp = await fetchWithTimeout(
          `/api/applications/${encodeURIComponent(app.id)}/reply-attachments`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
            body: formData,
          },
          30000
        );
        const uploadData = await uploadResp.json().catch(() => ({}));
        if (!uploadResp.ok || !uploadData.success || !Array.isArray(uploadData.attachments)) {
          throw new Error(uploadData.error || 'Unable to upload files. Your message is still here.');
        }
        uploadedAttachments = uploadData.attachments;
      }

      const resp = await fetchWithTimeout(`/api/applications/${encodeURIComponent(app.id)}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          note: sanitizedReply || undefined,
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
          clientReplyId: replyClientKeyRef.current,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success) {
        throw new Error(data.error || 'Unable to save reply. Your message and files are safe.');
      }

      appendLocalNoteUnique(data.note);

      setReplyText('');
      setReplyFiles([]);
      setIsReplyExpanded(false);
      replyClientKeyRef.current = null;
      if (replyFileInputRef.current) {
        replyFileInputRef.current.value = '';
      }
      showToast('Sent — Reply saved!');
    } catch (error: any) {
      showToast(
        error?.message || 'Unable to send reply.',
        'error',
        'Unable to send reply. Your message and files are preserved.'
      );
    } finally {
      replySubmittingRef.current = false;
      setReplyLoading(false);
    }
  };

  const handleUpdatePaymentStatus = async (status: 'pending' | 'completed') => {
    if (staffSubmittingRef.current || loading) return;
    if (!perms.canUpdatePayment) {
      showToast('Only Admins can update payment status.', 'error');
      return;
    }
    staffSubmittingRef.current = true;
    setLoading(true);
    try {
      const result = await updateApplicationPaymentStatusApi(app.id, status);
      if (result.emailDelivery?.hasFailures) {
        showToast(`Payment status updated to ${status}, but email notification could not be sent.`, 'info');
      } else {
        showToast(`Sent — Payment status updated to ${status}`);
      }
    } catch (error: any) {
      showToast(error?.message || 'Failed to update payment status', 'error');
    } finally {
      staffSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const submitStatusOrNote = async (opts: {
    status?: string;
    note?: string;
    file?: File | null;
    explicitClientRequestId?: string;
  }): Promise<{ note?: ApplicationNote; status?: string; notificationQueued?: boolean; emailDelivery?: EmailDeliverySummary }> => {
    const sanitizedNote = trimWhitespace(opts.note || '');
    const sanitizedStatus = trimWhitespace(opts.status || '');

    if (sanitizedNote.length > MAX_NOTE_LENGTH) {
      throw new Error(`Note must be ${MAX_NOTE_LENGTH} characters or less.`);
    }
    if (sanitizedStatus && !(ALLOWED_OPERATOR_STATUSES as readonly string[]).includes(sanitizedStatus)) {
      throw new Error('Invalid status selected.');
    }

    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      throw new Error('Authentication session expired. Please sign in again.');
    }

    const requestKey =
      opts.explicitClientRequestId ||
      staffClientKeyRef.current ||
      (staffClientKeyRef.current = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

    let attachmentUrl = '';
    let attachmentName = '';

    if (opts.file) {
      if (!perms.canUploadNoteAttachment) {
        throw new Error('You do not have permission to upload attachments.');
      }
      const formData = new FormData();
      formData.append('file', opts.file);
      const uploadResp = await fetchWithTimeout(
        `/api/operator/applications/${encodeURIComponent(app.id)}/upload-attachment`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          body: formData,
        }
      );
      const uploadData = await uploadResp.json().catch(() => ({}));
      const uploadedUrl = uploadData.url || uploadData.attachmentUrl;
      if (uploadResp.ok && uploadData.success && uploadedUrl) {
        attachmentUrl = uploadedUrl;
        attachmentName = uploadData.attachmentName || opts.file.name;
      } else if (uploadResp.status === 503 && uploadData.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
        throw new Error('File upload service unavailable. Note was not saved.');
      } else {
        throw new Error(uploadData.error || 'Unable to upload file. Your note is still here.');
      }
    }

    // Server-authoritative atomic DB save first; background outbox dispatches notifications asynchronously
    const resp = await fetchWithTimeout(`/api/operator/applications/${encodeURIComponent(app.id)}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        status: sanitizedStatus || undefined,
        note: sanitizedNote || undefined,
        attachmentUrl: attachmentUrl || undefined,
        attachmentName: attachmentName || undefined,
        clientRequestId: requestKey,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) {
      throw new Error(data.error || 'Unable to save update. Your note is still here.');
    }

    appendLocalNoteUnique(data.note);
    if (typeof data.status === 'string' && data.status) {
      setLocalStatusOverride(data.status);
    }

    return {
      note: data.note as ApplicationNote | undefined,
      status: data.status as string | undefined,
      notificationQueued: Boolean(data.notificationQueued),
      emailDelivery: data.emailDelivery as EmailDeliverySummary | undefined,
    };
  };

  const handleUpdateStatusDirect = async (status: string) => {
    if (staffSubmittingRef.current || loading) return;
    if (!perms.isAdmin) {
      showToast('Only Admins can use quick status controls.', 'error');
      return;
    }
    staffSubmittingRef.current = true;
    setLoading(true);
    try {
      const quickKey = `quick_${status}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await submitStatusOrNote({ status, explicitClientRequestId: quickKey });
      if (result.emailDelivery?.hasFailures) {
        showToast(`Status updated to ${status}, but one or more email notifications failed.`, 'info');
      } else {
        showToast(`Sent — Status updated to ${status}`);
      }
    } catch (error: any) {
      showToast(
        error?.message || 'Failed to update status',
        'error',
        'Unable to update status. Please try again.'
      );
    } finally {
      staffSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (staffSubmittingRef.current || loading) return;
    if (!perms.canAddNote && !perms.canUpdateStatus) {
      showToast('You do not have permission to update this application.', 'error');
      return;
    }
    if (!noteText.trim() && !newStatus && !noteFile) {
      showToast('Please provide a status update, note, or attachment.', 'error');
      return;
    }

    staffSubmittingRef.current = true;
    setLoading(true);
    try {
      const result = await submitStatusOrNote({
        status: newStatus,
        note: noteText,
        file: noteFile,
      });
      if (result.emailDelivery?.hasFailures) {
        showToast('Update saved, but one or more email notifications could not be delivered.', 'info');
      } else {
        showToast('Sent — Update saved!');
      }
      setNoteText('');
      setNewStatus('');
      setNoteFile(null);
      staffClientKeyRef.current = null;
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      showToast(
        error?.message || 'Unable to save update.',
        'error',
        'Unable to save update. Your entered text and files are preserved.'
      );
    } finally {
      staffSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const handleAssign = async (operatorEmail: string) => {
    if (staffSubmittingRef.current || loading) return;
    if (!perms.canAssignOperator) {
      showToast('Only Admins can assign operators.', 'error');
      return;
    }
    staffSubmittingRef.current = true;
    setLoading(true);
    try {
      const operator = operatorEmail
        ? operators.find(op => op.email.toLowerCase() === operatorEmail.toLowerCase())
        : undefined;

      if (operatorEmail && !operator?.uid) {
        showToast('Unable to resolve canonical Operator UID for this account.', 'error');
        return;
      }

      const result = await assignApplicationOperatorApi(
        app.id,
        operator?.uid || '',
        operatorEmail || ''
      );

      if (result.emailDelivery?.hasFailures) {
        showToast(
          operatorEmail
            ? `Assigned to ${operatorEmail} (one or more email notifications could not be sent).`
            : 'Application unassigned (email notification warning).',
          'info'
        );
      } else {
        showToast(operatorEmail ? `Assigned to ${operatorEmail}` : 'Application unassigned');
      }
    } catch (error: any) {
      showToast(error?.message || 'Failed to update assignment', 'error');
    } finally {
      staffSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processing': return 'bg-orange-500';
      case 'clarification': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'rejected': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  const getRoleBadge = (note: ApplicationNote) => {
    const role = note.authorRole;
    if (role === 'admin') {
      return { label: 'Admin', classes: 'bg-red-100 text-red-700', accentClass: 'border-l-4 border-l-red-500' };
    }
    if (role === 'operator') {
      return { label: 'Operator', classes: 'bg-blue-100 text-blue-700', accentClass: 'border-l-4 border-l-blue-500' };
    }
    if (role === 'user' || note.type === 'reply') {
      return { label: 'User', classes: 'bg-orange-100 text-orange-700', accentClass: 'border-l-4 border-l-orange-500' };
    }
    return null;
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-2 sm:p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-2xl relative overflow-hidden shadow-2xl flex flex-col max-h-[98vh] sm:max-h-[95vh]"
      >
        <div className="p-4 sm:p-6 bg-white border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-xl sm:text-2xl font-bold text-navy">Application Details</h3>
          <button
            type="button"
            aria-label="Close application details"
            data-testid="close-app-modal-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-all"
          >
            <IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Main Info Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 sm:gap-y-3 pb-4 border-b border-slate-100">
            <div className="flex justify-between sm:justify-start gap-2">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">User:</span>
              <span className="text-slate-600 text-xs sm:text-sm">{app.name}</span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Sub-Service:</span>
              <span className="text-slate-600 text-xs sm:text-sm">{app.subserviceName || app.serviceName}</span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Charge:</span>
              <span className="text-slate-600 text-xs sm:text-sm">₹{app.charge}</span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2 items-center">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Status:</span>
              <span
                data-testid="app-status-badge"
                className={`px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold text-white uppercase tracking-wider ${getStatusBadge(displayStatus)}`}
              >
                {displayStatus}
              </span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Payment:</span>
              <span className="text-slate-600 text-xs sm:text-sm capitalize">{app.paymentMethod?.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2 items-center">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Pay Status:</span>
              <span className={`px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold text-white uppercase tracking-wider ${app.paymentStatus === 'completed' ? 'bg-green-500' : 'bg-orange-500'}`}>
                {app.paymentStatus || 'pending'}
              </span>
            </div>
          </div>

          {/* Form Information Section */}
          <div className="space-y-2 sm:space-y-4 pb-4 border-b border-slate-100">
            <h4 className="text-base sm:text-lg font-bold text-navy">Form Information</h4>
            <div className="grid grid-cols-1 gap-1.5 sm:gap-3 bg-slate-50 p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-100">
              {Object.entries(app.details || {}).map(([key, value]) => {
                const fileUrls = extractFileUrls(value);
                return (
                  <div key={key} className="flex flex-col sm:flex-row sm:gap-2 border-b border-slate-200 pb-1 sm:pb-2 last:border-0 last:pb-0">
                    <span className="text-navy font-bold min-w-[120px] sm:min-w-[160px] capitalize text-[10px] sm:text-sm">{key.replace(/_/g, ' ')}:</span>
                    <span className="text-slate-600 text-[10px] sm:text-sm break-words">
                      {fileUrls ? (
                        fileUrls.length === 1 ? (
                          <a href={fileUrls[0]} target="_blank" rel="noreferrer" className="text-primary hover:underline font-bold flex items-center gap-1">
                            <IconRenderer name="external-link" className="w-3 h-3" />
                            View
                          </a>
                        ) : (
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {fileUrls.map((url, index) => (
                              <a
                                key={`${key}-${index}`}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline font-bold inline-flex items-center gap-1"
                              >
                                <IconRenderer name="external-link" className="w-3 h-3" />
                                {`View ${getOrdinalLabel(index)}`}
                              </a>
                            ))}
                          </span>
                        )
                      ) : String(value)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Download Section - Only for completed files */}
          {app.fileUrl && (
            <div className="pt-1 sm:pt-2">
              <button
                type="button"
                onClick={() => handleOpenAttachment(app.fileUrl!, 'completed-file')}
                className="w-full py-2.5 sm:py-3 px-4 sm:px-6 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary hover:text-white transition-all flex items-center justify-center gap-2 shadow-sm text-sm sm:text-base"
              >
                <IconRenderer name="download" className="w-4 h-4 sm:w-5 sm:h-5" />
                Download Completed File
              </button>
            </div>
          )}

          {/* Notes & History */}
          <div className="space-y-2 sm:space-y-4">
            <h4 className="text-base sm:text-lg font-bold text-navy">Notes & History</h4>
            <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 min-h-[80px] sm:min-h-[100px] border border-slate-100 space-y-4">
              {normalizedNotes.length > 0 ? (
                <div className="space-y-3 sm:space-y-4" data-testid="notes-history-list">
                  {normalizedNotes.map((note, i) => {
                    const roleBadge = getRoleBadge(note);
                    const noteAttachments = normalizeNoteAttachments(note);
                    return (
                      <div
                        key={note.id || i}
                        data-testid={`note-item-${note.authorRole || (note.type === 'reply' ? 'user' : 'staff')}`}
                        className={`bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-slate-100 ${roleBadge ? roleBadge.accentClass : ''}`}
                      >
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] sm:text-xs font-bold text-navy">{note.by}</span>
                            {roleBadge && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${roleBadge.classes}`}>
                                {roleBadge.label}
                              </span>
                            )}
                            {note.status && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-100 text-slate-700">
                                {note.status}
                              </span>
                            )}
                          </div>
                          <span className="text-[8px] sm:text-[10px] text-slate-400 shrink-0">{note.time}</span>
                        </div>
                        <p className="text-xs sm:text-sm text-slate-600 whitespace-pre-wrap break-words">{note.text}</p>
                        {noteAttachments.length === 1 && (
                          <button
                            type="button"
                            disabled={downloadingAttachment === noteAttachments[0].url}
                            onClick={() => handleOpenAttachment(noteAttachments[0].url, noteAttachments[0].name)}
                            className="mt-1.5 sm:mt-2 inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-primary hover:underline disabled:opacity-50"
                          >
                            <IconRenderer name="download" className="w-3 h-3" />
                            {downloadingAttachment === noteAttachments[0].url
                              ? 'Downloading...'
                              : (noteAttachments[0].name || 'Attachment')}
                          </button>
                        )}
                        {noteAttachments.length > 1 && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            {noteAttachments.map((att, attIdx) => (
                              <button
                                key={`${note.id || i}-att-${attIdx}`}
                                type="button"
                                title={att.name}
                                disabled={downloadingAttachment === att.url}
                                onClick={() => handleOpenAttachment(att.url, att.name)}
                                className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold text-primary hover:underline disabled:opacity-50"
                              >
                                <IconRenderer name="external-link" className="w-3 h-3" />
                                {downloadingAttachment === att.url
                                  ? 'Opening...'
                                  : `View ${getOrdinalLabel(attIdx)}`}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 text-slate-400 text-xs sm:text-sm italic">
                  No notes yet
                </div>
              )}

              {/* User Reply / Clarification Box (Application Owner Only) */}
              {perms.canReplyToApplication && (
                <div
                  data-testid="user-reply-section"
                  className="pt-3 border-t border-slate-200"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {!isReplyExpanded ? (
                      <motion.div
                        key="reply-trigger"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex items-center justify-start"
                      >
                        <button
                          type="button"
                          data-testid="open-reply-btn"
                          onClick={() => setIsReplyExpanded(true)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-navy text-white text-xs sm:text-sm font-bold hover:bg-navy/90 transition-all shadow-sm cursor-pointer"
                        >
                          <Reply className="w-4 h-4" />
                          <span>Reply</span>
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="user-reply-panel"
                        data-testid="user-reply-panel"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3 pt-1">
                          <div className="flex items-center justify-between gap-2">
                            <h5 className="text-xs sm:text-sm font-bold text-navy flex items-center gap-1.5">
                              <Reply className="w-3.5 h-3.5 text-primary" />
                              Reply / Clarification
                            </h5>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400">
                                Max {MAX_REPLY_ATTACHMENTS} files · 5MB each
                              </span>
                              <button
                                type="button"
                                data-testid="close-reply-btn"
                                aria-label="Close reply form"
                                disabled={replyLoading}
                                onClick={handleCancelReply}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/70 transition-colors disabled:opacity-50"
                              >
                                <IconRenderer name="x" className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div>
                            <textarea
                              data-testid="user-reply-textarea"
                              autoFocus
                              placeholder="Write your reply or clarification..."
                              maxLength={MAX_NOTE_LENGTH}
                              disabled={replyLoading}
                              className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all min-h-[80px] text-xs sm:text-sm disabled:bg-slate-100"
                              value={replyText}
                              onChange={e => {
                                setReplyText(e.target.value);
                                replyClientKeyRef.current = null;
                              }}
                            />
                            <div className="text-[10px] text-slate-400 text-right mt-1">
                              {replyText.length}/{MAX_NOTE_LENGTH}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <button
                              type="button"
                              disabled={replyLoading || replyFiles.length >= MAX_REPLY_ATTACHMENTS}
                              onClick={() => replyFileInputRef.current?.click()}
                              className="w-full p-3 border-2 border-dashed border-orange-200 rounded-xl bg-white hover:bg-orange-50/40 flex items-center justify-center gap-2 cursor-pointer transition-all text-xs font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <IconRenderer name="file-up" className="w-4 h-4 text-navy shrink-0" />
                              <span>
                                {replyFiles.length >= MAX_REPLY_ATTACHMENTS
                                  ? `Maximum ${MAX_REPLY_ATTACHMENTS} files attached`
                                  : 'Attach supporting files (PDF, JPG, PNG, WEBP · max 5MB each)'}
                              </span>
                            </button>
                            <input
                              type="file"
                              multiple
                              data-testid="user-reply-file-input"
                              ref={replyFileInputRef}
                              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={e => handleReplyFilesChange(e.target.files)}
                            />

                            {replyFiles.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {replyFiles.map((file, idx) => (
                                  <div
                                    key={`${file.name}-${file.size}-${idx}`}
                                    data-testid="reply-file-chip"
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-700 max-w-full"
                                  >
                                    <span className="truncate max-w-[180px] font-medium">{file.name}</span>
                                    <button
                                      type="button"
                                      disabled={replyLoading}
                                      aria-label={`Remove ${file.name}`}
                                      onClick={() => removeReplyFile(idx)}
                                      className="text-slate-400 hover:text-red-500 transition-colors p-0.5 disabled:opacity-50"
                                    >
                                      <IconRenderer name="x" className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              data-testid="cancel-reply-btn"
                              onClick={handleCancelReply}
                              disabled={replyLoading}
                              className="px-4 py-2.5 sm:py-3 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold hover:bg-slate-50 transition-all text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              data-testid="send-reply-btn"
                              onClick={handleSendReply}
                              disabled={replyLoading}
                              className="flex-1 py-2.5 sm:py-3 bg-navy text-white font-bold rounded-xl hover:bg-navy/90 transition-all shadow-sm flex items-center justify-center gap-2 text-xs sm:text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              <IconRenderer name="paper-plane" className="w-4 h-4" />
                              {replyLoading ? 'Saving...' : 'Send Reply'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          {/* Add Note & Update Section - Restricted to Admin or Assigned Operator */}
          {(perms.canAddNote || perms.canUpdateStatus) && (
            <div className="space-y-3 sm:space-y-4 pt-4 border-t border-slate-100" data-testid="staff-controls-section">
              <h4 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <IconRenderer name="user-pen" className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                {perms.isAdmin ? 'Admin Controls' : 'Operator Controls'}
              </h4>
              <div className="space-y-3 sm:space-y-4">
                <div>
                  <textarea
                    data-testid="staff-note-textarea"
                    placeholder="Add a note or reason for the user..."
                    maxLength={MAX_NOTE_LENGTH}
                    disabled={loading}
                    className="w-full p-3 sm:p-4 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all min-h-[80px] sm:min-h-[100px] text-xs sm:text-sm disabled:bg-slate-100"
                    value={noteText}
                    onChange={e => {
                      setNoteText(e.target.value);
                      staffClientKeyRef.current = null;
                    }}
                  />
                  <div className="text-[10px] text-slate-400 text-right mt-1">
                    {noteText.length}/{MAX_NOTE_LENGTH}
                  </div>
                </div>

                <div className="p-3 sm:p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-1.5 sm:space-y-2">
                  <label className="text-[10px] sm:text-xs font-bold text-navy">Update Status (Optional):</label>
                  <SelectDropdown
                    className="w-full p-2 sm:p-3 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm outline-none"
                    value={newStatus}
                    disabled={loading}
                    onChange={(val) => {
                      setNewStatus(val);
                      staffClientKeyRef.current = null;
                    }}
                    options={[
                      { value: '', label: 'No Status Change' },
                      { value: 'processing', label: 'Processing' },
                      { value: 'clarification', label: 'Clarification' },
                      { value: 'completed', label: 'Completed' },
                      { value: 'rejected', label: 'Rejected' },
                    ]}
                  />
                </div>

                <div
                  onClick={() => { if (!loading) fileInputRef.current?.click(); }}
                  className={`p-4 sm:p-6 border-2 border-dashed border-orange-200 rounded-xl bg-orange-50/30 flex flex-col items-center justify-center gap-1.5 sm:gap-2 transition-all ${loading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-orange-50'}`}
                >
                  <IconRenderer name="upload" className="w-5 h-5 sm:w-6 sm:h-6 text-navy" />
                  <span className="text-[10px] sm:text-xs font-medium text-slate-600 text-center">
                    {noteFile ? noteFile.name : 'Click to upload attachment (PDF, JPG, PNG, WEBP · max 5MB)'}
                  </span>
                  <input
                    type="file"
                    data-testid="staff-note-file-input"
                    disabled={loading}
                    ref={fileInputRef}
                    accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={e => handleFileChange(e.target.files ? e.target.files[0] : null)}
                  />
                </div>

                <button
                  type="button"
                  data-testid="staff-note-submit-btn"
                  onClick={handleAddNote}
                  disabled={loading}
                  className="w-full py-2.5 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 text-sm sm:text-base disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? 'Saving...' : 'Add Note & Update'}
                </button>
              </div>
            </div>
          )}

          {/* Admin Specific Controls */}
          {perms.isAdmin && (
            <div className="space-y-4 sm:space-y-6 pt-4 border-t border-slate-100">
              <div className="space-y-1.5 sm:space-y-2">
                <label className="text-xs sm:text-sm font-bold text-navy">Assign to Operator:</label>
                <SelectDropdown
                  className="w-full p-2.5 sm:p-3 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm outline-none"
                  value={app.assignedTo || ''}
                  disabled={loading}
                  onChange={handleAssign}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...operators.map(op => ({ value: op.email, label: `${op.name} (${op.email})` })),
                  ]}
                />
                {app.assignedTo && !app.assignedToUid && (
                  <p className="text-[11px] text-amber-700 font-medium bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    Legacy assignment ({app.assignedTo}) has no canonical Operator UID. Re-select an Operator to restore access.
                  </p>
                )}
              </div>

              <div className="space-y-2 sm:space-y-3">
                <h4 className="text-xs sm:text-sm font-bold text-navy">Update Payment Status:</h4>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <button
                    onClick={() => handleUpdatePaymentStatus('completed')}
                    disabled={loading}
                    className="py-2.5 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm disabled:opacity-60"
                  >
                    <IconRenderer name="check" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Mark Paid
                  </button>
                  <button
                    onClick={() => handleUpdatePaymentStatus('pending')}
                    disabled={loading}
                    className="py-2.5 sm:py-3 border-2 border-navy text-navy font-bold rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm disabled:opacity-60"
                  >
                    <IconRenderer name="clock" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Mark Pending
                  </button>
                </div>
              </div>

              <div className="space-y-2 sm:space-y-3">
                <h4 className="text-xs sm:text-sm font-bold text-navy">Quick Status Update:</h4>
                <div className="grid grid-cols-2 gap-2 sm:gap-4">
                  <button
                    onClick={() => handleUpdateStatusDirect('processing')}
                    disabled={loading}
                    className="py-2 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all text-[10px] sm:text-sm disabled:opacity-60"
                  >
                    Processing
                  </button>
                  <button
                    onClick={() => handleUpdateStatusDirect('clarification')}
                    disabled={loading}
                    className="py-2 sm:py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-all text-[10px] sm:text-sm disabled:opacity-60"
                  >
                    Clarification
                  </button>
                  <button
                    onClick={() => handleUpdateStatusDirect('completed')}
                    disabled={loading}
                    className="py-2 sm:py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-all text-[10px] sm:text-sm disabled:opacity-60"
                  >
                    Completed
                  </button>
                  <button
                    onClick={() => handleUpdateStatusDirect('rejected')}
                    disabled={loading}
                    className="py-2 sm:py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all text-[10px] sm:text-sm disabled:opacity-60"
                  >
                    Rejected
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {previewAttachment && (
        <AttachmentPreviewOverlay
          preview={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
          onDownload={() => triggerBlobDownload(previewAttachment.blobUrl, previewAttachment.name)}
        />
      )}
    </div>
  );
}
