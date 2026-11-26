import { auth, storage } from '../firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFriendlyErrorMessage } from '../utils/errorHandler';
import {
  MAX_DIGITAL_FILE_SIZE,
  getCanonicalDigitalMime,
  getDigitalExtensionError,
  getDigitalFileExtension,
  isAllowedDigitalExtension,
} from '../server/digitalFilePolicy';

export const MAX_SERVICE_FILE_SIZE = 5 * 1024 * 1024;
export { MAX_DIGITAL_FILE_SIZE };

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

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
  return getDigitalFileExtension(fileName);
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
  _cleanExt: string,
  contentType: string,
  options: UploadFileOptions,
  filePath: string
): Promise<string> {
  const {
    onProgress,
    signal,
    timeoutMs = options.category === 'digital-products' ? 180000 : 45000,
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
    let lastBytesTransferred = -1;

    let timer: ReturnType<typeof setTimeout>;
    const resetStallTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { uploadTask.cancel(); } catch {}
        failWith(new Error(`Upload timed out for "${file.name}". Please check your connection and try again.`));
      }, timeoutMs);
    };

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

    resetStallTimer();

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (settled) return;
        if (snapshot.bytesTransferred > lastBytesTransferred) {
          lastBytesTransferred = snapshot.bytesTransferred;
          resetStallTimer();
        }
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

async function uploadDigitalViaServerFallback(
  file: File,
  uploadId: string,
  contentType: string,
  options: UploadFileOptions
): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Admin authentication is required to upload digital files.');
  }
  const idToken = await currentUser.getIdToken();
  const endpoint = `/api/admin/store/digital-upload?fileName=${encodeURIComponent(file.name)}&uploadId=${encodeURIComponent(uploadId)}`;

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const fail = (err: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      try { xhr.abort(); } catch {}
      fail(new DOMException('Upload cancelled', 'AbortError'));
    };

    if (options.signal?.aborted) {
      fail(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.open('POST', endpoint, true);
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Content-Type', contentType || 'application/octet-stream');
    xhr.timeout = Math.max(options.timeoutMs ?? 600000, 180000);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || settled) return;
      const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
      options.onProgress?.(pct);
    };

    xhr.onload = () => {
      if (settled) return;
      let parsed: any = null;
      try {
        parsed = JSON.parse(xhr.responseText || '{}');
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && parsed?.success && parsed?.url) {
        options.onProgress?.(100);
        settled = true;
        cleanup();
        resolve(String(parsed.url));
      } else {
        fail(new Error(parsed?.error || `Server upload failed (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () => fail(new Error('Network error while uploading digital file. Please check your connection and try again.'));
    xhr.ontimeout = () => fail(new Error(`Upload timed out for "${file.name}". Please try again.`));

    xhr.send(file);
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
      // If direct Firebase Storage upload is blocked by older deployed storage.rules
      // (e.g., for .mp3, .mp4, or files > 5MB), seamlessly fall back to the admin server streaming upload.
      if (category === 'digital-products' && String(error?.code || '') === 'storage/unauthorized') {
        try {
          return await uploadDigitalViaServerFallback(file, uploadId, mime, options);
        } catch (fallbackError: any) {
          lastError = fallbackError;
          break;
        }
      }
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
  if (file.size > MAX_DIGITAL_FILE_SIZE) {
    throw new Error(`File "${file.name}" exceeds the ${Math.round(MAX_DIGITAL_FILE_SIZE / (1024 * 1024))} MB limit.`);
  }

  const cleanExt = getFileExtension(file.name);
  if (!isAllowedDigitalExtension(cleanExt)) {
    throw new Error(getDigitalExtensionError(cleanExt));
  }

  // Light content sanity check: reject disguised HTML/SVG payloads masquerading as another type
  try {
    const headBytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const headText = String.fromCharCode(...headBytes).trimStart().toLowerCase();
    if (
      headText.startsWith('<!doctype html') ||
      headText.startsWith('<html') ||
      headText.startsWith('<svg') ||
      headText.startsWith('<script')
    ) {
      throw new Error(`File "${file.name}" contains active web markup and cannot be uploaded as a digital product.`);
    }
  } catch (err: any) {
    if (err?.message?.includes('active web markup')) throw err;
  }

  const canonicalMime = getCanonicalDigitalMime(cleanExt, file.type);
  return { cleanExt, mime: canonicalMime };
}
