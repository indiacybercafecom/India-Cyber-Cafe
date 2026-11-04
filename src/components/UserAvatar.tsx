import React, { useState, useEffect } from 'react';
import { resolveAvatarUrl, DEFAULT_AVATAR } from '../utils/avatar';
import { UserProfile } from '../types';

interface UserAvatarProps {
  user?: Partial<UserProfile> | null;
  authUser?: { photoURL?: string | null } | null;
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
  const resolvedSrc = src || resolveAvatarUrl(user, authUser);
  const [currentSrc, setCurrentSrc] = useState<string>(resolvedSrc);
  const [failed, setFailed] = useState(false);

  // When resolvedSrc changes (e.g. auth user loaded or profile synced), update currentSrc
  useEffect(() => {
    setCurrentSrc(resolvedSrc);
    setFailed(false);
  }, [resolvedSrc]);

  const handleError = () => {
    // If we haven't tried the fallback default avatar yet, try it
    if (currentSrc !== DEFAULT_AVATAR && !failed) {
      setCurrentSrc(DEFAULT_AVATAR);
    } else {
      // Both original and flaticon failed (e.g. offline or CDN blocked), show clean vector fallback
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
