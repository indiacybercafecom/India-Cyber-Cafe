import React, { useState, useEffect } from 'react';
import { resolveAvatarUrl, isPlaceholderAvatar, DEFAULT_AVATAR } from '../utils/avatar';
import { UserProfile } from '../types';
import { auth } from '../firebase';

interface UserAvatarProps {
  user?: Partial<UserProfile> | null;
  authUser?: { photoURL?: string | null; email?: string | null; providerData?: any[] } | null;
  src?: string | null;
  alt?: string;
  className?: string;
  onClick?: () => void;
  title?: string;
}

export function UserAvatar({
  user,
  authUser,
  src,
  alt = '',
  className = 'w-10 h-10 rounded-full object-cover',
  onClick,
  title,
}: UserAvatarProps) {
  const effectiveAuth = authUser || auth.currentUser;
  
  // If src is explicitly provided AND is not a generic placeholder, use it.
  // Otherwise resolve through the centralized avatar hierarchy.
  const hasValidExplicitSrc = Boolean(src && !isPlaceholderAvatar(src));
  const resolvedSrc = hasValidExplicitSrc ? src! : resolveAvatarUrl(user, effectiveAuth);

  const [currentSrc, setCurrentSrc] = useState<string>(resolvedSrc);
  const [failed, setFailed] = useState(false);

  // When props change or user/auth is rehydrated, update currentSrc
  useEffect(() => {
    const nextSrc = (src && !isPlaceholderAvatar(src)) ? src : resolveAvatarUrl(user, authUser || auth.currentUser);
    setCurrentSrc(nextSrc);
    setFailed(false);
  }, [src, user, user?.avatar, user?.email, authUser, authUser?.photoURL]);

  const handleError = () => {
    // If the image failed to load and was not the default avatar, fallback to DEFAULT_AVATAR
    if (currentSrc !== DEFAULT_AVATAR && !failed) {
      setCurrentSrc(DEFAULT_AVATAR);
    } else {
      // If even default fails (e.g., offline or network error), display clean vector silhouette
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <div
        onClick={onClick}
        title={title}
        className={`flex items-center justify-center bg-slate-200 text-slate-500 overflow-hidden select-none shrink-0 ${className}`}
      >
        <svg
          className="w-3/5 h-3/5 fill-current"
          viewBox="0 0 24 24"
        >
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      title={title}
      onClick={onClick}
      onError={handleError}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={`object-cover shrink-0 select-none ${className}`}
    />
  );
}
