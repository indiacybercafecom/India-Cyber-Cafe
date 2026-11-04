import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  User as FirebaseUser,
  ActionCodeSettings,
} from 'firebase/auth';
import { ref, get, set, update, query, orderByChild, equalTo } from 'firebase/database';
import { auth, rtdb } from '../firebase';
import { UserProfile } from '../types';
import { sanitizeUserProfile, sanitizeEmail, trimWhitespace } from '../utils/sanitizer';
import { sendEmail, sendEmailToAllAdmins, emailTemplates } from './emailService';
import { getFriendlyErrorMessage } from '../utils/errorHandler';
import { shouldSyncGooglePhoto, extractAuthPhotoUrl, getEmailAvatarUrl, DEFAULT_AVATAR } from '../utils/avatar';

// Reusable Google Auth Provider instance
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.addScope('profile');
googleAuthProvider.addScope('email');
googleAuthProvider.setCustomParameters({
  prompt: 'select_account',
});

/**
 * Normalizes and validates a 10-digit Indian mobile number.
 * Accepts numbers with optional '+91', '0', or '91' prefix.
 */
export function normalizeIndianMobile(rawPhone: string): { valid: boolean; normalized: string; error?: string } {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, normalized: '', error: 'Mobile number is required' };
  }

  // Remove spaces, hyphens, parentheses
  let cleaned = rawPhone.trim().replace(/[\s\-\(\)]/g, '');

  // Strip international prefix '+91' or '91' if followed by 10 digits
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  }

  // Validate: must be exactly 10 digits and start with 6, 7, 8, or 9
  if (!/^[6-9]\d{9}$/.test(cleaned)) {
    return {
      valid: false,
      normalized: cleaned,
      error: 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
    };
  }

  return { valid: true, normalized: cleaned };
}

/**
 * Checks if a phone number is already registered to another user profile.
 */
export async function checkPhoneRegistered(
  phoneNumber: string,
  excludeUid?: string
): Promise<{ inUse: boolean; existingUid?: string; existingEmail?: string; isGoogleOnly?: boolean }> {
  try {
    const { valid, normalized } = normalizeIndianMobile(phoneNumber);
    if (!valid) return { inUse: false };

    const usersRef = ref(rtdb, 'users');
    const snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(normalized)));

    if (snapshot.exists()) {
      const users = snapshot.val();
      for (const [uid, data] of Object.entries(users as Record<string, any>)) {
        if (!excludeUid || uid !== excludeUid) {
          return {
            inUse: true,
            existingUid: uid,
            existingEmail: data.email || '',
            isGoogleOnly: data.authProvider === 'google' && !data.password,
          };
        }
      }
    }

    return { inUse: false };
  } catch (err) {
    console.warn('[authService] Error checking phone uniqueness:', err);
    return { inUse: false };
  }
}

// In-memory set to prevent duplicate database writes for the same photo in a single session
const syncedUidsInSession = new Set<string>();

/**
 * Synchronizes the user's latest Google profile photo to Realtime Database.
 * Runs safely in the background, only updates when necessary, and preserves custom uploads.
 */
export async function syncGoogleProfilePhoto(
  uid: string,
  googlePhotoURL: string,
  existingAvatar?: string | null,
  customAvatar?: boolean
): Promise<boolean> {
  if (!uid || !googlePhotoURL) return false;

  const sessionKey = `${uid}:${googlePhotoURL}`;
  if (syncedUidsInSession.has(sessionKey)) return false;

  if (!shouldSyncGooglePhoto(existingAvatar, googlePhotoURL, customAvatar)) {
    return false;
  }

  try {
    syncedUidsInSession.add(sessionKey);
    const userRef = ref(rtdb, `users/${uid}`);
    await update(userRef, {
      avatar: googlePhotoURL,
      updatedAt: Date.now(),
    });
    return true;
  } catch (err) {
    console.warn('[authService] Could not sync Google profile photo to database:', err);
    syncedUidsInSession.delete(sessionKey);
    return false;
  }
}

/**
 * Ensures or creates a user profile in RTDB for an authenticated Firebase user.
 * Preserves all existing data, roles, and records if the profile already exists.
 * Automatically recovers and syncs Google profile photos if missing, placeholder, or updated.
 */
export async function ensureUserProfile(firebaseUser: FirebaseUser, provider: 'google' | 'password' = 'google'): Promise<{ profile: UserProfile; isNew: boolean }> {
  const userRef = ref(rtdb, `users/${firebaseUser.uid}`);
  const snapshot = await get(userRef);

  if (snapshot.exists()) {
    const existing = snapshot.val() as UserProfile;
    // Update timestamp and authProvider if missing without touching role or personal data
    const safeUpdates: Partial<UserProfile> = {
      updatedAt: Date.now(),
    };
    if (!existing.authProvider) {
      safeUpdates.authProvider = provider;
    }
    // Automatically recover and update Google profile photo if missing, placeholder, or outdated
    const candidatePhoto = extractAuthPhotoUrl(firebaseUser) || getEmailAvatarUrl(firebaseUser.email);
    if (candidatePhoto && shouldSyncGooglePhoto(existing.avatar, candidatePhoto, existing.customAvatar)) {
      safeUpdates.avatar = candidatePhoto;
    }
    await update(userRef, safeUpdates);

    return {
      profile: { ...existing, ...safeUpdates },
      isNew: false,
    };
  }

  // Create new profile for Google or external registration
  const userEmail = (firebaseUser.email || '').toLowerCase().trim();
  const isSuperAdmin = userEmail === 'indiacybercafe.com@gmail.com';
  const role = isSuperAdmin ? 'admin' : 'user';
  const phone = firebaseUser.phoneNumber || '';
  const initialPhoto = extractAuthPhotoUrl(firebaseUser) || getEmailAvatarUrl(userEmail) || DEFAULT_AVATAR;

  const newProfile: UserProfile = {
    uid: firebaseUser.uid,
    name: firebaseUser.displayName?.trim() || userEmail.split('@')[0] || 'User',
    email: userEmail,
    phone,
    role,
    avatar: initialPhoto,
    authProvider: provider,
    phoneVerified: Boolean(phone),
    profileCompleted: Boolean(phone),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const sanitized = sanitizeUserProfile(newProfile);
  await set(userRef, sanitized);

  // Send welcome email in background
  if (userEmail) {
    sendEmail(userEmail, 'Welcome to India Cyber Cafe', emailTemplates.registration(newProfile.name)).catch(() => {});
    sendEmailToAllAdmins(
      'New Google User Registered - India Cyber Cafe',
      emailTemplates.adminUserRegistered(newProfile.name, userEmail, phone || 'Not provided', new Date().toLocaleString())
    ).catch(() => {});
  }

  return { profile: sanitized, isNew: true };
}

/**
 * Initiates Google Sign-In with popup, falling back to redirect on mobile / popup blocked.
 */
export async function signInWithGoogle(): Promise<{ success: boolean; user?: FirebaseUser; isNew?: boolean; error?: string }> {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );

  try {
    let result;
    if (isMobile) {
      try {
        result = await signInWithPopup(auth, googleAuthProvider);
      } catch (popupErr: any) {
        if (
          popupErr.code === 'auth/popup-blocked' ||
          popupErr.code === 'auth/cancelled-popup-request' ||
          popupErr.code === 'auth/popup-closed-by-user'
        ) {
          // Fallback to redirect authentication
          await signInWithRedirect(auth, googleAuthProvider);
          return { success: true }; // Page will redirect
        }
        throw popupErr;
      }
    } else {
      result = await signInWithPopup(auth, googleAuthProvider);
    }

    if (result && result.user) {
      const { isNew } = await ensureUserProfile(result.user, 'google');
      return { success: true, user: result.user, isNew };
    }

    return { success: false, error: 'Authentication did not complete.' };
  } catch (error: any) {
    console.error('[authService] Google Sign-in error:', error);
    return { success: false, error: mapAuthError(error) };
  }
}

/**
 * Checks for any pending redirect authentication results on page load.
 */
export async function checkRedirectAuth(): Promise<{ success: boolean; user?: FirebaseUser; isNew?: boolean; error?: string } | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      const { isNew } = await ensureUserProfile(result.user, 'google');
      return { success: true, user: result.user, isNew };
    }
    return null;
  } catch (error: any) {
    console.error('[authService] Redirect auth resolution error:', error);
    return { success: false, error: mapAuthError(error) };
  }
}

/**
 * Password recovery supporting both Email and Mobile number.
 * - Email input: Initiates Firebase sendPasswordResetEmail().
 * - Mobile input: Finds associated email in RTDB (matching 10-digit, +91, or 91 format),
 *   then initiates Firebase sendPasswordResetEmail().
 * - Google-only accounts: Informs user that their account uses Google Sign-In.
 */
export async function initiatePasswordReset(identifier: string): Promise<{
  success: boolean;
  message: string;
  isGoogleAccount?: boolean;
}> {
  const cleaned = trimWhitespace(identifier);
  if (!cleaned) {
    return { success: false, message: 'Please enter your registered email address or mobile number.' };
  }

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned);
  let targetEmail = '';
  let isGoogleOnly = false;

  try {
    if (isEmail) {
      targetEmail = sanitizeEmail(cleaned);
      // Check RTDB to see if account is Google-only
      const usersRef = ref(rtdb, 'users');
      const snapshot = await get(query(usersRef, orderByChild('email'), equalTo(targetEmail)));
      if (snapshot.exists()) {
        const userData = Object.values(snapshot.val())[0] as any;
        if (userData.authProvider === 'google' && !userData.password) {
          isGoogleOnly = true;
        }
      }
    } else {
      // Validate Indian mobile number
      const { valid, normalized, error: phoneErr } = normalizeIndianMobile(cleaned);
      if (!valid) {
        return { success: false, message: phoneErr || 'Please enter a valid mobile number or email address.' };
      }

      // Search RTDB for user with this mobile across standard formats (normalized, +91, 91)
      const usersRef = ref(rtdb, 'users');
      let snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(normalized)));
      
      if (!snapshot.exists()) {
        snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(`+91${normalized}`)));
      }
      if (!snapshot.exists()) {
        snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(`91${normalized}`)));
      }

      if (snapshot.exists()) {
        const userData = Object.values(snapshot.val())[0] as any;
        targetEmail = sanitizeEmail(userData.email || '');
        if (userData.authProvider === 'google' && !userData.password) {
          isGoogleOnly = true;
        }
      }
    }

    if (isGoogleOnly) {
      return {
        success: false,
        isGoogleAccount: true,
        message: 'This account was created with Google Sign-In and does not use a password. Please sign in using "Continue with Google".',
      };
    }

    if (targetEmail) {
      const actionCodeSettings: ActionCodeSettings = {
        url: typeof window !== 'undefined' && window.location.origin
          ? `${window.location.origin}/reset-password`
          : 'https://b.indiacybercafe.com/reset-password',
        handleCodeInApp: true,
      };

      try {
        await sendPasswordResetEmail(auth, targetEmail, actionCodeSettings);
      } catch (actionErr: any) {
        // Fallback to standard email reset if deep linking URL is rejected
        console.warn('[authService] ActionCodeSettings fallback to standard email:', actionErr?.message);
        await sendPasswordResetEmail(auth, targetEmail);
      }
    }

    // Generic response to prevent account enumeration
    return {
      success: true,
      message: 'If an account matches the provided details, password recovery instructions will be sent to the registered email address.',
    };
  } catch (err: any) {
    console.error('[authService] Password reset error:', err);
    // If Firebase reports user not found, still return generic safe response
    if (err.code === 'auth/user-not-found') {
      return {
        success: true,
        message: 'If an account matches the provided details, password recovery instructions will be sent to the registered email address.',
      };
    }
    return { success: false, message: mapAuthError(err) };
  }
}

/**
 * Validates the one-time action code (oobCode) from the password reset email link.
 * Returns the associated email address if the code is valid.
 */
export async function verifyPasswordReset(oobCode: string): Promise<{ success: boolean; email?: string; error?: string }> {
  try {
    const email = await verifyPasswordResetCode(auth, oobCode);
    return { success: true, email };
  } catch (error: any) {
    console.error('[authService] verifyPasswordReset error:', error);
    return { success: false, error: mapAuthError(error) };
  }
}

/**
 * Completes the password reset by applying the new password.
 */
export async function confirmPasswordUpdate(oobCode: string, newPass: string): Promise<{ success: boolean; error?: string }> {
  try {
    await confirmPasswordReset(auth, oobCode, newPass);
    return { success: true };
  } catch (error: any) {
    console.error('[authService] confirmPasswordReset error:', error);
    return { success: false, error: mapAuthError(error) };
  }
}

/**
 * Maps Firebase Auth error codes to user-friendly messages.
 * Delegates to centralized getFriendlyErrorMessage.
 */
export function mapAuthError(error: any): string {
  return getFriendlyErrorMessage(error, 'Something went wrong. Please try again.');
}
