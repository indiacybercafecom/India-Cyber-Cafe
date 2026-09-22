import React, { useState, useEffect } from 'react';
import { ShareData, DEFAULT_ICC_IMAGE, getWhatsAppShareUrl, getTelegramShareUrl, getFacebookShareUrl, getTwitterShareUrl, getLinkedInShareUrl, getEmailShareUrl } from '../utils/shareUtils';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ShareData;
}

export function ShareModal({ isOpen, onClose, data }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [imgSrc, setImgSrc] = useState(data.image || DEFAULT_ICC_IMAGE);

  useEffect(() => {
    setImgSrc(data.image || DEFAULT_ICC_IMAGE);
    setCopied(false);
  }, [data]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(data.url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = data.url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      showToast('Link copied to clipboard!', 'success');
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      showToast('Failed to copy link', 'error');
    }
  };

  const handleShareClick = (shareUrl: string) => {
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div 
      className="fixed inset-0 z-[2500] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div 
        className="relative w-full max-w-lg bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-100 overflow-hidden transform transition-all duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <IconRenderer name="share" className="w-4 h-4" />
            </div>
            <div>
              <h3 id="share-modal-title" className="text-base sm:text-lg font-bold text-navy">
                Share {data.category}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-400">Share via social apps or copy link</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close dialog"
          >
            <IconRenderer name="x" className="w-5 h-5" />
          </button>
        </div>

        {/* Item Preview Card */}
        <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-3 sm:gap-4 bg-white p-3 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-xs">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-100 flex items-center justify-center">
              <img 
                src={imgSrc} 
                alt={data.title}
                onError={() => setImgSrc(DEFAULT_ICC_IMAGE)}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  data.category === 'Service' 
                    ? 'bg-blue-100 text-blue-700' 
                    : data.category === 'Sub-Service' 
                    ? 'bg-purple-100 text-purple-700' 
                    : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {data.category}
                </span>
                {data.price !== undefined && (
                  <span className="text-xs font-bold text-primary">
                    ₹{data.price}
                    {data.originalPrice && data.originalPrice > data.price && (
                      <span className="ml-1 text-[10px] text-slate-400 line-through font-normal">
                        ₹{data.originalPrice}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <h4 className="text-sm sm:text-base font-bold text-navy line-clamp-1">
                {data.title}
              </h4>
              {data.description && (
                <p className="text-[11px] sm:text-xs text-slate-500 line-clamp-2 mt-0.5">
                  {data.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Social Share Grid */}
        <div className="p-4 sm:p-6 space-y-4">
          <div>
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
              Instant Social Share
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
              {/* WhatsApp */}
              <button
                onClick={() => handleShareClick(getWhatsAppShareUrl(data.url, data.text))}
                className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border border-emerald-100 bg-emerald-50/50 hover:bg-emerald-100/70 text-emerald-800 transition-all group"
                title="Share on WhatsApp"
              >
                <div className="w-9 h-9 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                  <span className="text-lg font-bold">W</span>
                </div>
                <span className="text-[11px] font-semibold">WhatsApp</span>
              </button>

              {/* Telegram */}
              <button
                onClick={() => handleShareClick(getTelegramShareUrl(data.url, data.text))}
                className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border border-sky-100 bg-sky-50/50 hover:bg-sky-100/70 text-sky-800 transition-all group"
                title="Share on Telegram"
              >
                <div className="w-9 h-9 rounded-full bg-[#0088cc] text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                  <span className="text-lg font-bold">✈</span>
                </div>
                <span className="text-[11px] font-semibold">Telegram</span>
              </button>

              {/* Facebook */}
              <button
                onClick={() => handleShareClick(getFacebookShareUrl(data.url))}
                className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border border-blue-100 bg-blue-50/50 hover:bg-blue-100/70 text-blue-800 transition-all group"
                title="Share on Facebook"
              >
                <div className="w-9 h-9 rounded-full bg-[#1877F2] text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                  <span className="text-lg font-bold">f</span>
                </div>
                <span className="text-[11px] font-semibold">Facebook</span>
              </button>

              {/* X / Twitter */}
              <button
                onClick={() => handleShareClick(getTwitterShareUrl(data.url, data.text))}
                className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 transition-all group"
                title="Share on X"
              >
                <div className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                  <span className="text-sm font-bold">𝕏</span>
                </div>
                <span className="text-[11px] font-semibold">X / Tweet</span>
              </button>

              {/* LinkedIn */}
              <button
                onClick={() => handleShareClick(getLinkedInShareUrl(data.url))}
                className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border border-blue-100 bg-blue-50/50 hover:bg-blue-100/70 text-blue-900 transition-all group"
                title="Share on LinkedIn"
              >
                <div className="w-9 h-9 rounded-full bg-[#0077b5] text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                  <span className="text-sm font-bold">in</span>
                </div>
                <span className="text-[11px] font-semibold">LinkedIn</span>
              </button>

              {/* Email */}
              <button
                onClick={() => handleShareClick(getEmailShareUrl(data.title, data.text, data.url))}
                className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-all group"
                title="Share via Email"
              >
                <div className="w-9 h-9 rounded-full bg-slate-700 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                  <IconRenderer name="mail" className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-semibold">Email</span>
              </button>
            </div>
          </div>

          {/* Copy Link Row */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Copy Direct Link
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  readOnly
                  value={data.url}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-600 text-xs sm:text-sm rounded-xl py-2.5 px-3 font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <button
                onClick={handleCopyLink}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all shrink-0 ${
                  copied
                    ? 'bg-green-600 text-white shadow-xs'
                    : 'bg-primary text-white hover:bg-primary-hover shadow-xs'
                }`}
              >
                <IconRenderer name={copied ? "check" : "copy"} className="w-4 h-4" />
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
