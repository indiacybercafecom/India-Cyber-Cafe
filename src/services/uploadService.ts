import { auth, storage } from '../firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { getFriendlyErrorMessage } from '../utils/errorHandler';

export const MAX_SERVICE_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

const DIGITAL_MIME_TO_EXTENSIONS: Record<string, Set<string>> = {
  'application/pdf': new Set(['pdf']),
  'application/zip': new Set(['zip']),
  'application/x-zip-compressed': new Set(['zip']),
  'application/msword': new Set(['doc']),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': new Set(['docx']),
  'application/vnd.ms-excel': new Set(['xls']),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': new Set(['xlsx']),
  'application/vnd.ms-powerpoint': new Set(['ppt']),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': new Set(['pptx']),
  'text/plain': new Set(['txt']),
  'text/csv': new Set(['csv']),
};

export const MAX_DIGITAL_FILE_SIZE = 5 * 1024 * 1024;

export interface UploadFileOptions {
  category?: string;
  maxSizeBytes?: number;
  allowUnauthenticated?: boolean;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

function validateUploadFile(file: File, maxSizeBytes?: number, allowUnauthenticated?: boolean, category?: string): { cleanExt: string } {
  if (!allowUnauthenticated && !auth.currentUser) {
    throw new Error('Authentication required to upload files.');
  }
  if (file.size <= 0) {
    throw new Error(`File "${file.name}" is empty.`);
  }
  const effectiveLimit = category === 'digital-products'
    ? MAX_DIGITAL_FILE_SIZE
    : (maxSizeBytes ?? MAX_SERVICE_FILE_SIZE);
  if (file.size > effectiveLimit) {
    throw new Error(`File "${file.name}" exceeds the ${Math.round(effectiveLimit / (1024 * 1024))} MB limit.`);
  }

  const cleanExt = (file.name.split('.').pop() || '').toLowerCase().trim();
  const mime = (file.type || '').toLowerCase().trim();

  if (category === 'digital-products') {
    validateDigitalUploadFile(file);
    return { cleanExt };
  }

  if (!ALLOWED_EXTENSIONS.has(cleanExt) || (mime && !ALLOWED_MIME_TYPES.has(mime))) {
    throw new Error(`Invalid file type "${file.name}". Only PDF and standard image formats (JPG, PNG, WEBP) are allowed.`);
  }
  return { cleanExt };
}

function uploadOnceResumable(
  file: File,
  cleanExt: string,
  options: UploadFileOptions
): Promise<string> {
  const {
    category = 'general',
    onProgress,
    signal,
    timeoutMs = 45000,
  } = options;

  if (signal?.aborted) {
    return Promise.reject(new DOMException('Upload cancelled', 'AbortError'));
  }

  const randomString = Math.random().toString(36).substring(2, 14);
  const timestamp = Date.now();
  const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
  const fileName = `${safeCategory}/${timestamp}_${randomString}.${cleanExt}`;
  const storageRef = ref(storage, fileName);
  const metadata = {
    contentType: file.type || 'application/octet-stream',
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

export async function uploadFileWithRetry(
  file: File,
  options: UploadFileOptions = {}
): Promise<string> {
  const { cleanExt } = validateUploadFile(file, options.maxSizeBytes, options.allowUnauthenticated, options.category);
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new DOMException('Upload cancelled', 'AbortError');
    }
    try {
      return await uploadOnceResumable(file, cleanExt, options);
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries && isRetryableUploadError(error)) {
        const delayMs = 400 * Math.pow(2, attempt);
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delayMs);
          if (options.signal) {
            const abortWait = () => {
              clearTimeout(t);
              reject(new DOMException('Upload cancelled', 'AbortError'));
            };
            options.signal.addEventListener('abort', abortWait, { once: true });
          }
        });
        continue;
      }
      break;
    }
  }

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

export function validateDigitalUploadFile(file: File): DigitalUploadValidation {
  if (file.size <= 0) throw new Error(`File "${file.name}" is empty.`);
  if (file.size > MAX_DIGITAL_FILE_SIZE) throw new Error(`File "${file.name}" exceeds the 5 MB limit.`);

  const cleanExt = (file.name.split('.').pop() || '').toLowerCase().trim();
  const mime = (file.type || '').toLowerCase().trim();
  const allowedExtensions = DIGITAL_MIME_TO_EXTENSIONS[mime];
  if (!allowedExtensions || !allowedExtensions.has(cleanExt)) {
    throw new Error(`Invalid digital file type "${file.name}". Supported formats are PDF, ZIP, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT and CSV.`);
  }
  return { cleanExt, mime };
}
