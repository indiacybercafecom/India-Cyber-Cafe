import { useEffect, useState } from 'react';
import { IconRenderer } from './Icons';
import { motion, AnimatePresence } from 'motion/react';
import { getFriendlyErrorMessage } from '../utils/errorHandler';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastCount = 0;
let addToastFn: (msg: unknown, type: 'success' | 'error' | 'info', fallback?: string) => void = () => {};

// Memory cache to prevent duplicate toasts within 1500ms window
const recentToasts = new Map<string, number>();

/**
 * Global User-Friendly Toast Function
 * 
 * Automatically sanitizes errors through getFriendlyErrorMessage so technical codes,
 * stack traces, and database/API names never appear in toasts.
 * Deduplicates identical toasts to prevent UI clutter.
 */
export function showToast(
  messageOrError: unknown,
  type: 'success' | 'error' | 'info' = 'success',
  fallback?: string
) {
  addToastFn(messageOrError, type, fallback);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    addToastFn = (messageOrError, type, fallback) => {
      // 1. Sanitize error messages globally
      let finalMessage = '';
      if (type === 'error' || messageOrError instanceof Error || (typeof messageOrError === 'object' && messageOrError !== null && ('code' in messageOrError || 'message' in messageOrError))) {
        finalMessage = getFriendlyErrorMessage(messageOrError, fallback);
        type = 'error';
      } else if (typeof messageOrError === 'string') {
        finalMessage = messageOrError.trim();
      } else {
        finalMessage = String(messageOrError || '');
      }

      if (!finalMessage) return;

      // 2. Prevent duplicate toasts (Requirement 9)
      const dedupeKey = `${type}:${finalMessage}`;
      const now = Date.now();
      const lastShown = recentToasts.get(dedupeKey);

      if (lastShown && now - lastShown < 1500) {
        return; // Suppress duplicate burst
      }
      recentToasts.set(dedupeKey, now);

      setToasts(prev => {
        // If exact same toast message is already visibly rendered, don't duplicate
        if (prev.some(t => t.message === finalMessage && t.type === type)) {
          return prev;
        }

        const id = `toast-${++toastCount}`;
        const newToast: Toast = { id, message: finalMessage, type };

        setTimeout(() => {
          setToasts(current => current.filter(t => t.id !== id));
          recentToasts.delete(dedupeKey);
        }, 3200);

        return [...prev, newToast];
      });
    };
  }, []);

  return (
    <div
      className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[90%] sm:w-[340px] max-w-sm px-4 sm:px-0 pointer-events-none"
      role="region"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ y: -40, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 350, damping: 22 }}
            className={`pointer-events-auto rounded-xl shadow-xl flex items-start sm:items-center gap-3 font-medium border p-3.5 sm:p-4 text-sm backdrop-blur-md ${
              toast.type === 'success'
                ? 'border-green-200 text-green-800 bg-white/95 shadow-green-900/5'
                : toast.type === 'error'
                ? 'border-red-200 text-red-800 bg-white/95 shadow-red-900/5'
                : 'border-blue-200 text-blue-800 bg-white/95 shadow-blue-900/5'
            }`}
          >
            <div className="shrink-0 flex items-center pt-0.5 sm:pt-0">
              <IconRenderer
                name={toast.type === 'success' ? 'check-circle' : toast.type === 'error' ? 'xmark' : 'info'}
                className={`w-5 h-5 ${
                  toast.type === 'success'
                    ? 'text-green-600'
                    : toast.type === 'error'
                    ? 'text-red-600'
                    : 'text-blue-600'
                }`}
              />
            </div>
            <div className="flex-1 break-words leading-snug">{toast.message}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
