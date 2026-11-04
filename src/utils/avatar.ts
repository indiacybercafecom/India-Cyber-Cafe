/**
 * Centralized Profile Photo and Avatar Resolution Utility
 * 
 * Enforces avatar source priority:
 * 1. User's manually uploaded/custom profile photo, if available.
 * 2. Latest valid Google photoURL for Google-authenticated accounts (photoURL or providerData).
 * 3. Existing valid database avatar.
 * 4. Verified email-based profile photo (for Google / WordPress / Gravatar accounts).
 * 5. Default fallback avatar.
 */

import { md5 } from './md5';
import { auth } from '../firebase';

export const DEFAULT_AVATAR = 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

/**
 * Checks whether an avatar URL is an empty or generic placeholder.
 */
export function isPlaceholderAvatar(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return true;
  const trimmed = url.trim().toLowerCase();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return true;
  return (
    trimmed.includes('cdn-icons-png.flaticon.com/512/149/149071.png') ||
    trimmed.includes('flaticon.com') ||
    trimmed.includes('api.dicebear.com') ||
    trimmed.includes('placeholder') ||
    trimmed.includes('default-avatar') ||
    trimmed.includes('avatar-placeholder')
  );
}

/**
 * Checks if a URL is hosted by Google User Content (Google Account profile photo).
 */
export function isGooglePhotoUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.includes('googleusercontent.com') || trimmed.includes('ggpht.com');
}

/**
 * Extracts the latest photo URL from a Firebase User object, inspecting
 * both root photoURL and providerData (specifically google.com).
 */
export function extractAuthPhotoUrl(authUser?: any): string | null {
  const current = authUser || (typeof auth !== 'undefined' ? auth.currentUser : null);
  if (!current) return null;

  // 1. Direct photoURL on Firebase User
  if (current.photoURL && typeof current.photoURL === 'string' && !isPlaceholderAvatar(current.photoURL)) {
    return current.photoURL.trim();
  }

  // 2. Google provider in providerData
  if (Array.isArray(current.providerData)) {
    const google = current.providerData.find(
      (p: any) => (p?.providerId === 'google.com' || p?.providerId === 'google') && p?.photoURL && !isPlaceholderAvatar(p.photoURL)
    );
    if (google?.photoURL && typeof google.photoURL === 'string' && !isPlaceholderAvatar(google.photoURL)) {
      return google.photoURL.trim();
    }

    // 3. Any provider in providerData with valid photoURL
    const anyP = current.providerData.find(
      (p: any) => p?.photoURL && typeof p.photoURL === 'string' && !isPlaceholderAvatar(p.photoURL)
    );
    if (anyP?.photoURL && typeof anyP.photoURL === 'string' && !isPlaceholderAvatar(anyP.photoURL)) {
      return anyP.photoURL.trim();
    }
  }

  return null;
}

/**
 * Generates an email-based avatar URL using Gravatar (s=200, default=mp).
 */
export function getEmailAvatarUrl(email?: string | null): string | null {
  if (!email || typeof email !== 'string') return null;
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes('@')) return null;
  const hash = md5(cleanEmail);
  return `https://www.gravatar.com/avatar/${hash}?d=mp&s=200`;
}

/**
 * Checks if an avatar is a user's manually uploaded custom photo.
 */
export function isCustomAvatar(user?: { avatar?: string | null; customAvatar?: boolean } | null): boolean {
  if (!user) return false;
  if (user.customAvatar === true) return true;
  // If user has an avatar that is neither empty, placeholder, nor a Google/Gravatar photo, treat as custom upload
  if (
    user.avatar &&
    !isPlaceholderAvatar(user.avatar) &&
    !isGooglePhotoUrl(user.avatar) &&
    !user.avatar.includes('gravatar.com')
  ) {
    return true;
  }
  return false;
}

/**
 * Determines if an existing user record needs to be synchronized with the latest photo.
 */
export function shouldSyncGooglePhoto(
  existingAvatar?: string | null,
  candidatePhotoURL?: string | null,
  customAvatar?: boolean
): boolean {
  if (!candidatePhotoURL || typeof candidatePhotoURL !== 'string' || isPlaceholderAvatar(candidatePhotoURL)) {
    return false;
  }

  // Preserve manually uploaded photos - never overwrite them
  if (customAvatar === true) {
    return false;
  }

  // If existing avatar is completely missing or is a known default placeholder, sync immediately
  if (!existingAvatar || isPlaceholderAvatar(existingAvatar)) {
    return true;
  }

  // If existing avatar has changed or been refreshed
  if (
    existingAvatar.trim() !== candidatePhotoURL.trim() &&
    (isGooglePhotoUrl(existingAvatar) || existingAvatar.includes('gravatar.com'))
  ) {
    return true;
  }

  return false;
}

/**
 * Resolves the active avatar URL using strict priority:
 * 1. User's manually uploaded/custom photo
 * 2. Latest Google photo from Firebase Auth (checks photoURL and providerData)
 * 3. Existing valid database avatar
 * 4. Email-based profile photo (for Google / WordPress / Gravatar linked accounts)
 * 5. Default fallback avatar
 */
export function resolveAvatarUrl(
  user?: { avatar?: string | null; customAvatar?: boolean; authProvider?: string; email?: string | null } | null,
  authUser?: { photoURL?: string | null; email?: string | null; providerData?: any[] } | null
): string {
  // Priority 1: User's manually uploaded custom photo
  if (user?.customAvatar && user.avatar && !isPlaceholderAvatar(user.avatar)) {
    return user.avatar;
  }

  // Priority 2: Latest Google photo from Firebase Auth (checks photoURL and providerData)
  const authPhoto = extractAuthPhotoUrl(authUser);
  if (authPhoto) {
    return authPhoto;
  }

  // Priority 3: Existing database avatar (if not a placeholder)
  if (user?.avatar && !isPlaceholderAvatar(user.avatar)) {
    return user.avatar;
  }

  // Priority 4: Email-based avatar for Google / WordPress / Gravatar linked accounts
  const email = user?.email || authUser?.email;
  const emailAvatar = getEmailAvatarUrl(email);
  if (emailAvatar) {
    return emailAvatar;
  }

  // Priority 5: Default fallback avatar
  return DEFAULT_AVATAR;
}
