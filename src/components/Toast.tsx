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
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[300px]">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className={`bg-white p-4 rounded-xl shadow-2xl flex items-center justify-center gap-3 font-semibold border border-slate-200 ${
              toast.type === 'success' ? 'border-l-4 border-l-green-500 text-green-600' : 
              toast.type === 'error' ? 'border-l-4 border-l-red-500 text-red-600' : 
              'border-l-4 border-l-blue-500 text-blue-600'
            }`}
          >
            <IconRenderer 
              name={toast.type === 'success' ? 'check-circle' : toast.type === 'error' ? 'xmark' : 'info'} 
              className="w-5 h-5" 
            />
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
