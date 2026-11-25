URGENT: Fix the new Hostinger 503 error in ZIP (37). Inspect exact clauses before editing.

1. "server.js:20–22" — TSX ESM bootstrap.
2. "server.js:23–2169" — remove obsolete legacy server implementation from the bootstrap entry; retain only a minimal, reliable bootstrap that starts "server.ts" exactly once.
3. "server.ts" — verify imports, initialization, "startServer()" and startup error handling.
4. "package.json:4–8" — verify ESM configuration and installed TSX startup dependency.
5. Root ".htaccess" — currently proxies to "127.0.0.1:3000".
6. "server.ts" — currently listens on "process.env.PORT || 3000".

CRITICAL: Verify Hostinger's actual PORT matches the Apache proxy port. Fix the mismatch if present; do not hardcode an incorrect port.

Check all startup imports and runtime exceptions. Ensure no duplicate server, circular import, missing module or failed initialization.

Test actual Node.js startup, HTTP "/", "/favicon.ico", "/api/health" (if registered), and digital-resource API routes. Preserve existing API functionality.

Do not change Firebase data, database rules, UI or unrelated features. No Python, terminal or CLI. Build and runtime verification are both mandatory. Report exact modified files and actual test results. Never claim deployment success without verification.import { auth, storage } from '../firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFriendlyErrorMessage } from '../utils/errorHandler';

export const MAX_SERVICE_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

export const DIGITAL_MIME_TO_EXTENSIONS: Record<string, ReadonlySet<string>> = {
  'application/pdf': new Set(['pdf']),
  'application/zip': new Set(['zip']),
  'application/x-zip-compressed': new Set(['zip']),
  'application/msword': new Set(['doc']),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': new Set(['docx']),
  'application/vnd.ms-excel': new Set(['xls']),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': new Set(['xlsx']),
  'application/vnd.ms-powerpoint': new Set(['ppt']),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': new Set(['pptx']),
};

export const MAX_DIGITAL_FILE_SIZE = 5 * 1024 * 1024;

export interface UploadFileOptions {
  category?: string;
  uploadId?: string;
  maxSizeBytes?: number;
  allowUnauthenticated?: boolean;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase().trim() : '';
}

async function validateUploadFile(file: File, maxSizeBytes?: number, allowUnauthenticated?: boolean, category?: string): Promise<DigitalUploadValidation> {
  if (!allowUnauthenticated && !auth.currentUser) {
    throw new Error('Authentication required to upload files.');
  }
  if (file.size <= 0) {
    throw new Error(`File "${file.name}" is empty.`);
  }
  const policyLimit = category === 'digital-products' ? MAX_DIGITAL_FILE_SIZE : MAX_SERVICE_FILE_SIZE;
  const effectiveLimit = Math.min(maxSizeBytes ?? policyLimit, policyLimit);
  if (file.size > effectiveLimit) {
    throw new Error(`File "${file.name}" exceeds the ${Math.round(effectiveLimit / (1024 * 1024))} MB limit.`);
  }

  const cleanExt = getFileExtension(file.name);
  const mime = (file.type || '').toLowerCase().trim();

  if (category === 'digital-products') {
    return validateDigitalUploadFile(file);
  }

  const genericMimeToExtension: Record<string, ReadonlySet<string>> = {
    'application/pdf': new Set(['pdf']),
    'image/jpeg': new Set(['jpg', 'jpeg']),
    'image/png': new Set(['png']),
    'image/webp': new Set(['webp']),
  };
  if (!cleanExt || !ALLOWED_EXTENSIONS.has(cleanExt)) {
    throw new Error(`Invalid file type "${file.name}". Only PDF and standard image formats (JPG, PNG, WEBP) are allowed.`);
  }
  if (mime && (!ALLOWED_MIME_TYPES.has(mime) || !genericMimeToExtension[mime]?.has(cleanExt))) {
    throw new Error(`Invalid file type "${file.name}". The file extension does not match its MIME type.`);
  }
  if (!mime) {
    throw new Error(`Invalid file type "${file.name}". A supported MIME type is required.`);
  }
  return { cleanExt, mime };
}

function uploadOnceResumable(
  file: File,
  cleanExt: string,
  contentType: string,
  options: UploadFileOptions,
  filePath: string
): Promise<string> {
  const {
    onProgress,
    signal,
    timeoutMs = 45000,
  } = options;

  if (signal?.aborted) {
    return Promise.reject(new DOMException('Upload cancelled', 'AbortError'));
  }

  const storageRef = ref(storage, filePath);
  const metadata = {
    contentType,
  };

  return new Promise<string>((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, metadata);
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const failWith = (err: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      try { uploadTask.cancel(); } catch {}
      failWith(new DOMException('Upload cancelled', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      try { uploadTask.cancel(); } catch {}
      failWith(new Error(`Upload timed out for "${file.name}". Please check your connection and try again.`));
    }, timeoutMs);

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (settled) return;
        const pct = snapshot.totalBytes > 0
          ? Math.min(99, Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100))
          : 0;
        onProgress?.(pct);
      },
      (error) => {
        failWith(error);
      },
      async () => {
        if (settled) return;
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          onProgress?.(100);
          settled = true;
          cleanup();
          resolve(downloadURL);
        } catch (err) {
          failWith(err);
        }
      }
    );
  });
}

function isRetryableUploadError(err: any): boolean {
  if (!err || err.name === 'AbortError' || err?.code === 'storage/canceled') return false;
  const code = String(err?.code || '');
  if (code === 'storage/unauthorized' || code === 'storage/invalid-argument') return false;
  return true;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
  });
}

export async function uploadFileWithRetry(
  file: File,
  options: UploadFileOptions = {}
): Promise<string> {
  const { cleanExt, mime } = await validateUploadFile(file, options.maxSizeBytes, options.allowUnauthenticated, options.category);
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const category = options.category ?? 'general';
  const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
  const randomString = Math.random().toString(36).substring(2, 14);
  const uploadId = options.uploadId?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || `${Date.now()}_${randomString}`;
  const filePath = `${safeCategory}/${uploadId}.${cleanExt}`;
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new DOMException('Upload cancelled', 'AbortError');
    }
    try {
      return await uploadOnceResumable(file, cleanExt, mime, options, filePath);
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries && isRetryableUploadError(error)) {
        const delayMs = 400 * Math.pow(2, attempt);
        await waitForRetry(delayMs, options.signal);
        continue;
      }
      break;
    }
  }

  try { await deleteObject(ref(storage, filePath)); } catch {}
  console.error('File Upload Error:', lastError);
  if (lastError?.name === 'AbortError') {
    throw lastError;
  }
  const friendly = getFriendlyErrorMessage(lastError, 'Unable to upload file. Please try again.');
  throw new Error(friendly);
}

export async function uploadFile(file: File, category: string = 'general', maxSizeBytes?: number): Promise<string> {
  return uploadFileWithRetry(file, { category, maxSizeBytes });
}

export async function deleteUploadedDigitalFile(downloadUrl: string): Promise<void> {
  const storageRef = ref(storage, downloadUrl);
  if (!storageRef.fullPath.startsWith('digital-products/')) {
    throw new Error('Refusing to delete a file outside digital product storage.');
  }
  await deleteObject(storageRef);
}

export interface BoundedUploadOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, percent: number) => void;
}

/**
 * Uploads an arbitrary list of file tasks in bounded parallel batches, reporting
 * aggregate progress and cancelling cleanly via AbortSignal.
 */
export async function uploadFilesBounded<TItem, TResult = string>(
  items: TItem[],
  uploader: (item: TItem, index: number, reportItemProgress: (pct: number) => void) => Promise<TResult>,
  options: BoundedUploadOptions = {}
): Promise<TResult[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(items.length, options.concurrency ?? 3));
  const results = new Array<TResult>(items.length);
  const perItemProgress = new Array<number>(items.length).fill(0);
  let completedCount = 0;
  let nextIndex = 0;
  let firstError: any = null;

  const emitAggregate = () => {
    if (!options.onProgress) return;
    const sumPct = perItemProgress.reduce((acc, v) => acc + v, 0);
    const totalPct = Math.min(100, Math.round(sumPct / items.length));
    options.onProgress(completedCount, items.length, totalPct);
  };

  const worker = async () => {
    while (!firstError) {
      if (options.signal?.aborted) {
        firstError = new DOMException('Upload cancelled', 'AbortError');
        return;
      }
      const idx = nextIndex++;
      if (idx >= items.length) return;
      try {
        const res = await uploader(items[idx], idx, (pct) => {
          perItemProgress[idx] = Math.max(perItemProgress[idx], Math.min(100, pct));
          emitAggregate();
        });
        results[idx] = res;
        perItemProgress[idx] = 100;
        completedCount += 1;
        emitAggregate();
      } catch (err) {
        firstError = err;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (firstError) {
    throw firstError;
  }
  return results;
}

export interface DigitalUploadValidation {
  cleanExt: string;
  mime: string;
}

export async function validateDigitalUploadFile(file: File): Promise<DigitalUploadValidation> {
  if (file.size <= 0) throw new Error(`File "${file.name}" is empty.`);
  if (file.size > MAX_DIGITAL_FILE_SIZE) throw new Error(`File "${file.name}" exceeds the 5 MB limit.`);

  const cleanExt = getFileExtension(file.name);
  const canonicalMime = Object.entries(DIGITAL_MIME_TO_EXTENSIONS)
    .find(([, extensions]) => extensions.has(cleanExt))?.[0];
  if (!canonicalMime) {
    throw new Error(`Invalid digital file type "${file.name}". Supported formats are PDF, ZIP, DOC, DOCX, XLS, XLSX, PPT and PPTX.`);
  }

  const declaredMime = (file.type || '').toLowerCase().trim();
  if (declaredMime && declaredMime !== 'application/octet-stream' && !DIGITAL_MIME_TO_EXTENSIONS[declaredMime]?.has(cleanExt)) {
    throw new Error(`Invalid digital file type "${file.name}". The file extension does not match its MIME type.`);
  }

  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const signatureText = String.fromCharCode(...signature);
  const isPdf = cleanExt === 'pdf' && signatureText.startsWith('%PDF-');
  const isZip = ['zip', 'docx', 'xlsx', 'pptx'].includes(cleanExt)
    && signature[0] === 0x50 && signature[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(signature[2])
    && [0x04, 0x06, 0x08].includes(signature[3]);
  const isLegacyOffice = ['doc', 'xls', 'ppt'].includes(cleanExt)
    && signature.slice(0, 8).every((byte, index) => byte === [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1][index]);
  if (!isPdf && !isZip && !isLegacyOffice) {
    throw new Error(`Invalid digital file content in "${file.name}".`);
  }

  return { cleanExt, mime: canonicalMime };
}
