import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { IconRenderer } from './Icons';
import { consentService } from '../services/consentService';
import { showToast } from './Toast';

interface ConsentPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ConsentPreferencesModal({ isOpen, onClose }: ConsentPreferencesModalProps) {
  const currentPrefs = consentService.getPreferences();
  const [analytics, setAnalytics] = useState(Boolean(currentPrefs?.analytics));
  const [marketing, setMarketing] = useState(Boolean(currentPrefs?.marketing));

  const handleSave = () => {
    consentService.savePreferences({ analytics, marketing }, window.location.pathname);
    showToast('Your privacy preferences have been updated.', 'success');
    onClose();
  };

  const handleAcceptAll = () => {
    consentService.acceptAll(window.location.pathname);
    setAnalytics(true);
    setMarketing(true);
    showToast('All cookies and tracking preferences accepted.', 'success');
    onClose();
  };

  const handleRejectAll = () => {
    consentService.rejectNonEssential(window.location.pathname);
    setAnalytics(false);
    setMarketing(false);
    showToast('Optional cookies and tracking rejected. Essential functions remain active.', 'info');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-2xl border border-slate-100 p-6 sm:p-8 z-10"
          role="dialog"
          aria-labelledby="cookie-preferences-title"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <IconRenderer name="shield-check" className="h-6 w-6" />
              </div>
              <div>
                <h3 id="cookie-preferences-title" className="text-xl font-bold text-navy">
                  Privacy & Cookie Preferences
                </h3>
                <p className="text-xs text-slate-500">
                  Customise how India Cyber Cafe processes non-essential data
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close preferences"
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              <IconRenderer name="xmark" className="h-5 w-5" />
            </button>
          </div>

          {/* Description */}
          <div className="my-5 text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
            <p>
              Under the Digital Personal Data Protection Act, 2023 principles and the Information Technology Act, 2000, we provide clear choices over what non-essential data is collected. Essential features required to provide services and process transactions always remain active.
            </p>
            <p className="text-xs text-slate-500">
              For complete details, please read our{' '}
              <Link to="/legal/privacy" onClick={onClose} className="text-primary font-semibold hover:underline">
                Privacy Policy
              </Link>{' '}
              and{' '}
              <Link to="/legal/terms" onClick={onClose} className="text-primary font-semibold hover:underline">
                Terms of Service
              </Link>.
            </p>
          </div>

          {/* Categories */}
          <div className="space-y-4">
            {/* 1. Essential */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm sm:text-base text-navy">Strictly Necessary & Essential</span>
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      Always Active
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Required for core website operations, secure session handling, Razorpay payment verification, and service form submissions. These cannot be disabled.
                  </p>
                </div>
                <div className="shrink-0 text-xs font-semibold text-slate-400 px-3 py-1 bg-slate-200 rounded-lg">
                  Required
                </div>
              </div>
            </div>

            {/* 2. Analytics */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 transition hover:border-slate-300">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="font-bold text-sm sm:text-base text-navy">Analytics & Performance</span>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Helps us understand website traffic, error rates, and load performance using aggregated metrics via Google / Firebase Analytics (ID: G-HKXGED0EB0). No advertising profiles are created.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={analytics}
                    onChange={(e) => setAnalytics(e.target.checked)}
                    className="sr-only peer"
                    aria-label="Toggle Analytics cookies"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>

            {/* 3. Marketing */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 transition hover:border-slate-300">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="font-bold text-sm sm:text-base text-navy">Optional Marketing & Updates</span>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Allows us to send informational updates on new government schemes, application deadlines, and exclusive portal discounts. You can unsubscribe at any time.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={marketing}
                    onChange={(e) => setMarketing(e.target.checked)}
                    className="sr-only peer"
                    aria-label="Toggle Marketing updates"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-8 flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-5 border-t border-slate-100">
            <button
              type="button"
              onClick={handleRejectAll}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Reject Non-Essential
            </button>
            <div className="flex w-full sm:w-auto items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-primary text-primary text-xs sm:text-sm font-semibold hover:bg-primary/5 transition"
              >
                Save Preferences
              </button>
              <button
                type="button"
                onClick={handleAcceptAll}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-primary text-white text-xs sm:text-sm font-semibold hover:bg-primary/90 transition shadow-sm"
              >
                Accept All
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
