import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IconRenderer } from './Icons';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'warning'
}: ConfirmationModalProps) {
  const colors = {
    danger: 'text-red-600 bg-red-50 border-red-100 ring-red-500',
    warning: 'text-amber-600 bg-amber-50 border-amber-100 ring-amber-500',
    info: 'text-blue-600 bg-blue-50 border-blue-100 ring-blue-500'
  };

  const icons = {
    danger: 'trash',
    warning: 'circle-exclamation',
    info: 'circle-info'
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100"
          >
            <div className="p-6 sm:p-8 space-y-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center ${colors[type]}`}>
                  <IconRenderer name={icons[type as keyof typeof icons] as any} className="w-8 h-8" />
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-navy">{title}</h3>
                  <p className="text-slate-500 text-sm sm:text-base leading-relaxed">
                    {message}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all order-2 sm:order-1"
                >
                  {cancelText}
                </button>
                <button
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                  className={`flex-1 px-6 py-3 rounded-2xl font-bold text-white transition-all order-1 sm:order-2 shadow-lg hover:shadow-xl active:scale-95 ${
                    type === 'danger' ? 'bg-red-500 hover:bg-red-600 shadow-red-200' : 
                    type === 'warning' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 
                    'bg-primary hover:bg-primary/90 shadow-primary/20'
                  }`}
                >
                  {confirmText}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

interface LogoutChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChoice: (choice: 'relogin' | 'home') => void;
}

export function LogoutChoiceModal({ isOpen, onClose, onChoice }: LogoutChoiceModalProps) {
  const [closeBlocked, setCloseBlocked] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCloseBlocked(false);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCloseWindow = () => {
    try {
      window.close();
    } catch {
      // Browsers block window.close() for non-script-opened tabs
    }
    if (!window.closed) {
      setCloseBlocked(true);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[2000] overflow-y-auto bg-white sm:bg-slate-900/45 sm:backdrop-blur-xs flex justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-success-heading"
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative my-auto w-full max-w-[480px] bg-white sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-xl px-2 py-4 sm:p-8"
          >
            <div className="text-center">
              <div
                className="w-12 h-12 rounded-xl bg-[#FF9933]/12 text-[#FF9933] flex items-center justify-center mx-auto mb-3.5 sm:mb-4"
                aria-hidden="true"
              >
                <IconRenderer name="right-from-bracket" className="w-6 h-6" />
              </div>
              <h2
                id="logout-success-heading"
                className="text-[28px] sm:text-[30px] font-bold text-[#000080] leading-tight tracking-tight"
              >
                You've been logged out
              </h2>
              <p className="mt-2 text-sm sm:text-[15px] text-slate-600 leading-relaxed max-w-[36ch] mx-auto">
                Your session has ended successfully. What would you like to do next?
              </p>
            </div>

            <div className="my-5 sm:my-6 border-t border-slate-200/80" aria-hidden="true" />

            <div className="space-y-3">
              <button
                type="button"
                data-testid="logout-relogin-btn"
                onClick={() => onChoice('relogin')}
                className="group w-full min-h-[44px] flex items-center gap-3.5 p-4 rounded-xl bg-white border border-slate-200 hover:border-[#FF9933] hover:bg-slate-50/80 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF9933] focus-visible:ring-offset-2 transition-colors text-left cursor-pointer"
              >
                <span
                  className="w-11 h-11 rounded-xl bg-[#FF9933]/12 text-[#FF9933] flex items-center justify-center shrink-0 group-hover:bg-[#FF9933] group-hover:text-white transition-colors"
                  aria-hidden="true"
                >
                  <IconRenderer name="user" className="w-5 h-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[17px] sm:text-[18px] font-bold text-[#000080] leading-snug">
                    Sign in again
                  </span>
                  <span className="block text-[13px] sm:text-sm text-slate-600 leading-snug mt-0.5">
                    Continue using your account
                  </span>
                </span>
                <svg
                  className="w-5 h-5 text-slate-400 group-hover:text-[#FF9933] shrink-0 transition-colors"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>

              <button
                type="button"
                data-testid="logout-home-btn"
                onClick={() => onChoice('home')}
                className="group w-full min-h-[44px] flex items-center gap-3.5 p-4 rounded-xl bg-white border border-slate-200 hover:border-[#000080] hover:bg-slate-50/80 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080] focus-visible:ring-offset-2 transition-colors text-left cursor-pointer"
              >
                <span
                  className="w-11 h-11 rounded-xl bg-[#000080]/[0.07] text-[#000080] flex items-center justify-center shrink-0 group-hover:bg-[#000080] group-hover:text-white transition-colors"
                  aria-hidden="true"
                >
                  <IconRenderer name="house" className="w-5 h-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[17px] sm:text-[18px] font-bold text-[#000080] leading-snug">
                    Back to homepage
                  </span>
                  <span className="block text-[13px] sm:text-sm text-slate-600 leading-snug mt-0.5">
                    Explore India Cyber Cafe
                  </span>
                </span>
                <svg
                  className="w-5 h-5 text-slate-400 group-hover:text-[#000080] shrink-0 transition-colors"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>

            <div className="mt-5 text-center space-y-3">
              <button
                type="button"
                data-testid="logout-close-window-btn"
                onClick={handleCloseWindow}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-[#000080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080] focus-visible:ring-offset-2 rounded-lg transition-colors cursor-pointer"
              >
                Close this window
              </button>

              {closeBlocked && (
                <div
                  role="status"
                  data-testid="logout-close-fallback"
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-[13px] text-slate-700 leading-relaxed"
                >
                  <p>
                    Your browser blocked closing this tab automatically. You may safely close it manually, or{' '}
                    <button
                      type="button"
                      data-testid="logout-dismiss-fallback-btn"
                      onClick={onClose}
                      className="inline-flex items-center min-h-[44px] px-1.5 -my-2 font-semibold text-[#000080] underline underline-offset-2 hover:text-[#FF9933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000080] rounded cursor-pointer"
                    >
                      dismiss this overlay
                    </button>
                    .
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
