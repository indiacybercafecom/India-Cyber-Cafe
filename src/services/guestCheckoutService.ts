import { rtdb, auth } from '../firebase';
import { ref as dbRef, set } from 'firebase/database';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { sanitizeEmail, sanitizePhone, trimWhitespace } from '../utils/sanitizer';
import { getFriendlyErrorMessage } from '../utils/errorHandler';
import { normalizeIndianMobile } from './authService';

const GUEST_ORDERS_STORAGE_KEY = 'icc_guest_orders';

export interface StoredGuestOrderRef {
  orderId: string;
  email: string;
  phone?: string;
  token?: string;
  createdAt: string;
}

export function saveGuestOrderRef(entry: StoredGuestOrderRef): void {
  if (typeof window === 'undefined' || !entry?.orderId) return;
  try {
    const existing = getStoredGuestOrders().filter(item => item.orderId !== entry.orderId);
    const updated = [entry, ...existing].slice(0, 15);
    window.localStorage.setItem(GUEST_ORDERS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Could not store guest order ref:', err);
  }
}

export function getStoredGuestOrders(): StoredGuestOrderRef[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUEST_ORDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function removeStoredGuestOrder(orderId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const filtered = getStoredGuestOrders().filter(item => item.orderId !== orderId);
    window.localStorage.setItem(GUEST_ORDERS_STORAGE_KEY, JSON.stringify(filtered));
  } catch {}
}

/**
 * Links any guest orders in session storage or matching account email to the authenticated user.
 */
export async function linkGuestOrdersToAuthenticatedUser(): Promise<number> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return 0;

    const idToken = await currentUser.getIdToken();
    const stored = getStoredGuestOrders();
    const guestOrderTokens = stored
      .filter(o => o.orderId && o.token)
      .map(o => ({ orderId: o.orderId, token: o.token }));

    const resp = await fetch('/api/store/orders/link-guest-orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ guestOrderTokens })
    });

    if (!resp.ok) return 0;
    const data = await resp.json();
    if (data.linkedCount > 0 && currentUser.email) {
      const normalizedUserEmail = currentUser.email.toLowerCase().trim();
      for (const item of stored) {
        if (item.email?.toLowerCase().trim() === normalizedUserEmail) {
          removeStoredGuestOrder(item.orderId);
        }
      }
    }
    return Number(data.linkedCount) || 0;
  } catch (err) {
    console.warn('Link guest orders notice:', err);
    return 0;
  }
}

/**
 * Generate a random password
 * @param length - Length of password (default 8)
 */
export function generateRandomPassword(length: number = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Safe non-PII existence lookup by email via backend endpoint (prevents reading restricted /users collection)
 */
export async function findUserByEmail(email: string) {
  try {
    const normalizedEmail = sanitizeEmail(email);
    if (!normalizedEmail) return null;

    const response = await fetch('/api/auth/lookup-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.found) {
        return {
          email: normalizedEmail,
          isGoogleOnly: Boolean(data.isGoogleOnly)
        };
      }
    }
    return null;
  } catch (error) {
    console.error('❌ Error finding user by email:', error);
    return null;
  }
}

/**
 * Safe non-PII existence lookup by phone via backend endpoint
 */
export async function findUserByPhone(phone: string) {
  try {
    const normalizedPhone = sanitizePhone(phone, true);
    const response = await fetch('/api/auth/lookup-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: normalizedPhone }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.found && data.email) {
        return {
          email: data.email,
          phone: normalizedPhone,
          isGoogleOnly: Boolean(data.isGoogleOnly),
        };
      }
    }

    return null;
  } catch (error) {
    console.error('❌ Error finding user by phone:', error);
    return null;
  }
}

/**
 * Create guest user account during checkout
 */
export async function createGuestAccount(
  email: string,
  name: string,
  phone: string
): Promise<{ success: boolean; user?: any; password?: string; error?: string }> {
  try {
    const sanitizedEmail = sanitizeEmail(email);
    const sanitizedName = trimWhitespace(name);
    const { valid, normalized } = normalizeIndianMobile(phone);
    const sanitizedPhone = valid ? normalized : sanitizePhone(phone);

    const randomPassword = generateRandomPassword(8);

    const userCredential = await createUserWithEmailAndPassword(auth, sanitizedEmail, randomPassword);
    const user = userCredential.user;

    await updateProfile(user, { displayName: sanitizedName });

    const userRef = dbRef(rtdb, `users/${user.uid}`);
    const newUser = {
      uid: user.uid,
      email: sanitizedEmail,
      name: sanitizedName,
      phone: sanitizedPhone,
      role: 'user',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${sanitizedEmail}`,
      authProvider: 'password',
      profileCompleted: Boolean(sanitizedPhone),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isGuestCheckout: true
    };

    await set(userRef, newUser);

    if (sanitizedPhone) {
      fetch('/api/auth/sync-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          phone: sanitizedPhone,
          email: sanitizedEmail,
          isGoogleOnly: false
        })
      }).catch(() => {});
    }

    return {
      success: true,
      user: newUser,
      password: randomPassword
    };
  } catch (error: any) {
    console.error('Error creating guest account:', error);
    return {
      success: false,
      error: getFriendlyErrorMessage(error, 'Failed to create account. Please try again.')
    };
  }
}
