import { useEffect, useState } from 'react';
import { Icons, IconRenderer } from './Icons';
import { motion, AnimatePresence } from 'motion/react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastCount = 0;
let addToastFn: (msg: string, type: 'success' | 'error' | 'info') => void = () => {};

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
  addToastFn(message, type);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    addToastFn = (message, type) => {
      const id = `toast-${toastCount++}`;
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
    };
  }, []);

  return (
    <div className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[90%] sm:w-[320px] max-w-sm px-4 sm:px-0">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ y: -50, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={`bg-white rounded-lg sm:rounded-xl shadow-lg sm:shadow-2xl flex items-start sm:items-center gap-3 sm:gap-4 font-semibold border-2 border-l-4 p-3 sm:p-4 text-sm sm:text-base backdrop-blur-sm ${
              toast.type === 'success' ? 'border-l-green-500 border-r-green-100 border-t-green-100 border-b-green-100 text-green-700 bg-green-50/80' : 
              toast.type === 'error' ? 'border-l-red-500 border-r-red-100 border-t-red-100 border-b-red-100 text-red-700 bg-red-50/80' : 
              'border-l-blue-500 border-r-blue-100 border-t-blue-100 border-b-blue-100 text-blue-700 bg-blue-50/80'
            }`}
          >
            <div className="flex-shrink-0 flex items-center">
              <IconRenderer 
                name={toast.type === 'success' ? 'check-circle' : toast.type === 'error' ? 'xmark' : 'info'} 
                className="w-5 h-5 sm:w-6 sm:h-6" 
              />
            </div>
            <div className="flex-1 break-words">{toast.message}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
