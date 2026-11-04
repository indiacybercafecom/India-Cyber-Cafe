/**
 * Centralized Profile Photo and Avatar Resolution Utility
 * 
 * Enforces avatar source priority:
 * 1. User's manually uploaded/custom profile photo, if available.
 * 2. Latest valid Google photoURL for Google-authenticated accounts.
 * 3. Existing valid database avatar.
 * 4. Default fallback avatar.
 */

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
 * Checks if an avatar is a user's manually uploaded custom photo.
 */
export function isCustomAvatar(user?: { avatar?: string | null; customAvatar?: boolean } | null): boolean {
  if (!user) return false;
  if (user.customAvatar === true) return true;
  // If user has an avatar that is neither empty, placeholder, nor a Google photo, treat as custom upload
  if (user.avatar && !isPlaceholderAvatar(user.avatar) && !isGooglePhotoUrl(user.avatar)) {
    return true;
  }
  return false;
}

/**
 * Determines if an existing user record needs to be synchronized with the latest Google photo.
 */
export function shouldSyncGooglePhoto(
  existingAvatar?: string | null,
  googlePhotoURL?: string | null,
  customAvatar?: boolean
): boolean {
  // If no Google photo is provided, no sync needed
  if (!googlePhotoURL || typeof googlePhotoURL !== 'string' || isPlaceholderAvatar(googlePhotoURL)) {
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

  // If existing avatar is a Google photo but has changed or been refreshed, sync
  if (existingAvatar.trim() !== googlePhotoURL.trim() && isGooglePhotoUrl(existingAvatar)) {
    return true;
  }

  return false;
}

/**
 * Resolves the active avatar URL using strict priority:
 * 1. User's manually uploaded/custom photo
 * 2. Latest valid Google photoURL (from authUser or google provider)
 * 3. Existing valid database avatar
 * 4. Default fallback avatar
 */
export function resolveAvatarUrl(
  user?: { avatar?: string | null; customAvatar?: boolean; authProvider?: string } | null,
  authUser?: { photoURL?: string | null } | null
): string {
  // Priority 1: User's manually uploaded custom photo
  if (user?.customAvatar && user.avatar && !isPlaceholderAvatar(user.avatar)) {
    return user.avatar;
  }

  // Priority 2: Latest Google photo from Firebase Auth
  if (authUser?.photoURL && !isPlaceholderAvatar(authUser.photoURL)) {
    return authUser.photoURL;
  }

  // Priority 3: Existing database avatar (if not a placeholder)
  if (user?.avatar && !isPlaceholderAvatar(user.avatar)) {
    return user.avatar;
  }

  // Priority 4: Default fallback avatar
  return DEFAULT_AVATAR;
}
