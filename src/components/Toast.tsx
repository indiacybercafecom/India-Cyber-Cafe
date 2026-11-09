import { useEffect, useState } from 'react';
import { IconRenderer } from './Icons';
import { motion, AnimatePresence, PanInfo, Variants } from 'motion/react';
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

const toastVariants: Variants = {
  initial: { y: -40, opacity: 0, scale: 0.95, x: 0 },
  animate: {
    y: 0,
    opacity: 1,
    scale: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 380, damping: 25 },
  },
  exit: (customDir: number) => {
    if (customDir === 1) {
      // Swiped right: slide right outside the container with fade
      return {
        x: 420,
        opacity: 0,
        scale: 0.95,
        transition: { duration: 0.22, ease: 'easeOut' },
      };
    }
    if (customDir === -1) {
      // Swiped left: slide left outside the container with fade
      return {
        x: -420,
        opacity: 0,
        scale: 0.95,
        transition: { duration: 0.22, ease: 'easeOut' },
      };
    }
    // Default timeout or button dismiss: smooth upward fade
    return {
      y: -20,
      opacity: 0,
      scale: 0.95,
      transition: { duration: 0.2, ease: 'easeOut' },
    };
  },
};

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string, direction?: number) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [swipeDirection, setSwipeDirection] = useState<number>(0);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const thresholdDistance = 75; // Minimum horizontal distance to trigger dismissal
    const thresholdVelocity = 350; // Minimum horizontal velocity (flick) to trigger dismissal
    const { offset, velocity } = info;

    if (offset.x > thresholdDistance || velocity.x > thresholdVelocity) {
      // Swiped right
      setSwipeDirection(1);
      onDismiss(toast.id, 1);
    } else if (offset.x < -thresholdDistance || velocity.x < -thresholdVelocity) {
      // Swiped left
      setSwipeDirection(-1);
      onDismiss(toast.id, -1);
    }
    // If threshold is not reached, dragConstraints smoothly returns toast to x: 0
  };

  return (
    <motion.div
      layout
      key={toast.id}
      custom={swipeDirection}
      variants={toastVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.75}
      onDragEnd={handleDragEnd}
      whileDrag={{ scale: 1.02, cursor: 'grabbing' }}
      role="status"
      aria-live="polite"
      className={`pointer-events-auto select-none touch-pan-y cursor-grab active:cursor-grabbing rounded-xl shadow-xl flex items-center justify-between gap-3 font-medium border p-3.5 sm:p-4 text-sm backdrop-blur-md transition-shadow hover:shadow-2xl overflow-hidden ${
        toast.type === 'success'
          ? 'border-green-200 text-green-800 bg-white/95 shadow-green-900/5'
          : toast.type === 'error'
          ? 'border-red-200 text-red-800 bg-white/95 shadow-red-900/5'
          : 'border-blue-200 text-blue-800 bg-white/95 shadow-blue-900/5'
      }`}
    >
      <div className="shrink-0 flex items-center">
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id, 0);
        }}
        aria-label="Dismiss notification"
        className="shrink-0 p-1 -mr-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors opacity-70 hover:opacity-100 cursor-pointer"
      >
        <IconRenderer name="xmark" className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
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

      // 2. Prevent duplicate toasts
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

        // 3. Automatic 3200ms dismissal
        setTimeout(() => {
          setToasts(current => current.filter(t => t.id !== id));
          recentToasts.delete(dedupeKey);
        }, 3200);

        return [...prev, newToast];
      });
    };
  }, []);

  const handleDismiss = (id: string) => {
    setToasts(current => current.filter(t => t.id !== id));
  };

  return (
    <div
      className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[90%] sm:w-[350px] max-w-sm px-4 sm:px-0 pointer-events-none"
      role="region"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={handleDismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

