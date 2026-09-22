import React, { useState } from 'react';
import { ShareData } from '../utils/shareUtils';
import { ShareModal } from './ShareModal';
import { IconRenderer } from './Icons';

interface ShareButtonProps {
  data: ShareData;
  label?: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'icon' | 'card-icon';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
}

export function ShareButton({
  data,
  label = 'Share',
  variant = 'outline',
  size = 'md',
  className = '',
  title = 'Share',
}: ShareButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Check if mobile device and Web Share API is available
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    if (isMobileDevice && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: data.title,
          text: data.text,
          url: data.url,
        });
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // User closed the share sheet, no action needed
          return;
        }
        // Fall back to modal if native share throws an error
        setIsModalOpen(true);
      }
    } else {
      // Desktop or unsupported browser: open sleek ShareModal
      setIsModalOpen(true);
    }
  };

  // Base styling for different variants
  const getButtonContent = () => {
    if (variant === 'icon') {
      const sizeClasses = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-11 h-11' : 'w-9 h-9';
      return (
        <button
          type="button"
          onClick={handleShare}
          className={`flex items-center justify-center rounded-full bg-slate-100 hover:bg-primary/10 text-slate-600 hover:text-primary transition-colors cursor-pointer ${sizeClasses} ${className}`}
          title={title}
          aria-label={title}
        >
          <IconRenderer name="share" className="w-4 h-4" />
        </button>
      );
    }

    if (variant === 'card-icon') {
      return (
        <button
          type="button"
          onClick={handleShare}
          className={`w-8 h-8 rounded-full bg-white/90 hover:bg-white text-slate-700 hover:text-primary shadow-sm hover:shadow-md backdrop-blur-xs flex items-center justify-center transition-all cursor-pointer ${className}`}
          title={title}
          aria-label={title}
        >
          <IconRenderer name="share" className="w-3.5 h-3.5" />
        </button>
      );
    }

    const sizeClasses = 
      size === 'sm' 
        ? 'px-2.5 py-1.5 text-xs gap-1.5' 
        : size === 'lg' 
        ? 'px-5 py-3 text-base gap-2.5' 
        : 'px-3.5 py-2 text-sm gap-2';

    const variantClasses = {
      primary: 'bg-primary text-white hover:bg-primary-hover shadow-xs',
      secondary: 'bg-navy text-white hover:bg-slate-800 shadow-xs',
      outline: 'bg-white border border-slate-200 hover:border-primary text-slate-700 hover:text-primary shadow-xs',
      ghost: 'bg-transparent hover:bg-slate-100 text-slate-600 hover:text-primary',
    }[variant as 'primary' | 'secondary' | 'outline' | 'ghost'] || 'bg-white border border-slate-200 text-slate-700';

    return (
      <button
        type="button"
        onClick={handleShare}
        className={`inline-flex items-center justify-center font-bold rounded-xl transition-all cursor-pointer select-none ${sizeClasses} ${variantClasses} ${className}`}
        title={title}
      >
        <IconRenderer name="share" className="w-4 h-4 shrink-0" />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <>
      {getButtonContent()}
      <ShareModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        data={data}
      />
    </>
  );
}
