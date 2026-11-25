import { auth } from '../firebase';

const CHECKOUT_DRAFT_PREFIX = 'icc_store_checkout_draft_';

export interface StoreCheckoutDraft {
  quantity?: number;
  name?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  specialInstructions?: string;
  updatedAt: number;
}

export function getSafeInternalRedirect(rawRedirect: string | null | undefined, fallback = '/'): string {
  const value = String(rawRedirect || '').trim();
  if (!value || !value.startsWith('/') || value.startsWith('//') || /^\/[\\]/.test(value)) {
    return fallback;
  }
  return value;
}

export function saveCheckoutDraft(productId: string | undefined, draft: Omit<StoreCheckoutDraft, 'updatedAt'>): void {
  if (!productId || typeof window === 'undefined') return;
  try {
    const payload: StoreCheckoutDraft = {
      ...draft,
      updatedAt: Date.now(),
    };
    window.sessionStorage.setItem(`${CHECKOUT_DRAFT_PREFIX}${productId}`, JSON.stringify(payload));
  } catch {}
}

export function loadCheckoutDraft(productId: string | undefined): StoreCheckoutDraft | null {
  if (!productId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${CHECKOUT_DRAFT_PREFIX}${productId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoreCheckoutDraft;
    if (!parsed || (parsed.updatedAt && Date.now() - parsed.updatedAt > 6 * 60 * 60 * 1000)) {
      window.sessionStorage.removeItem(`${CHECKOUT_DRAFT_PREFIX}${productId}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCheckoutDraft(productId: string | undefined): void {
  if (!productId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(`${CHECKOUT_DRAFT_PREFIX}${productId}`);
  } catch {}
}

export function extractDownloadToken(urlOrToken: string): string | null {
  const raw = String(urlOrToken || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{40,60}$/.test(raw)) return raw;
  const match = raw.match(/\/(?:api\/store\/downloads|store\/download)\/([A-Za-z0-9_-]{40,60})(?:[?#]|$)/);
  return match ? match[1] : null;
}

function parseContentDispositionFileName(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {}
  }
  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }
  return fallback;
}

export interface ProtectedDownloadResult {
  ok: boolean;
  status: number;
  fileName?: string;
  error?: string;
  requiresAuth?: boolean;
}

export async function downloadProtectedDigitalFile(
  urlOrToken: string,
  fallbackFileName = 'download.pdf'
): Promise<ProtectedDownloadResult> {
  const token = extractDownloadToken(urlOrToken);
  if (!token) {
    return { ok: false, status: 400, error: 'Invalid download link.' };
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    return {
      ok: false,
      status: 401,
      requiresAuth: true,
      error: 'Please sign in with the account used to purchase this product.',
    };
  }

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken();
  } catch {
    return {
      ok: false,
      status: 401,
      requiresAuth: true,
      error: 'Your login session expired. Please sign in again to download.',
    };
  }

  const response = await fetch(`/api/store/downloads/${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: 'application/pdf, application/octet-stream, application/json',
    },
  });

  if (!response.ok) {
    let errorMessage = 'Could not download this file. Please try again.';
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data?.error) errorMessage = String(data.error);
      } else {
        const text = (await response.text()).trim();
        if (text && text.length < 240) errorMessage = text;
      }
    } catch {}

    return {
      ok: false,
      status: response.status,
      requiresAuth: response.status === 401,
      error: errorMessage,
    };
  }

  const blob = await response.blob();
  const resolvedName = parseContentDispositionFileName(
    response.headers.get('content-disposition'),
    fallbackFileName || 'download.pdf'
  );

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = resolvedName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

  return { ok: true, status: 200, fileName: resolvedName };
}
