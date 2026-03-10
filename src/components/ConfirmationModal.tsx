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
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-navy/60 backdrop-blur-md"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 40 }}
            className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-2 bg-linear-to-r from-primary via-navy to-primary animate-loading-bar" />
            
            <div className="p-8 sm:p-12 space-y-8">
              <div className="text-center space-y-4">
                <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-6 rotate-3 hover:rotate-0 transition-transform duration-500">
                  <IconRenderer name="door-open" className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-3xl font-black text-navy tracking-tight">You've Logged Out!</h3>
                <p className="text-slate-500 text-lg">
                  Where would you like to go next? We'd love to see you back soon.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => onChoice('relogin')}
                  className="group relative p-6 rounded-3xl bg-slate-50 border-2 border-transparent hover:border-primary hover:bg-white transition-all text-left"
                >
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-sm group-hover:bg-primary group-hover:text-white transition-all">
                    <IconRenderer name="user" className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-navy text-xl mb-1">Relogin</h4>
                  <p className="text-slate-500 text-sm">Sign back into your account</p>
                </button>

                <button
                  onClick={() => onChoice('home')}
                  className="group relative p-6 rounded-3xl bg-slate-50 border-2 border-transparent hover:border-navy hover:bg-white transition-all text-left"
                >
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-sm group-hover:bg-navy group-hover:text-white transition-all">
                    <IconRenderer name="house" className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-navy text-xl mb-1">Go Home</h4>
                  <p className="text-slate-500 text-sm">Return to the main page</p>
                </button>
              </div>

              <button
                onClick={onClose}
                className="w-full py-4 text-slate-400 font-medium hover:text-navy transition-colors"
              >
                Close this window
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
