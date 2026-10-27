import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { IconRenderer } from './Icons';
import { consentService } from '../services/consentService';
import { ConsentPreferencesModal } from './ConsentPreferencesModal';

export function ConsentBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

  useEffect(() => {
    // Only show if user has not yet made an informed choice
    const responded = consentService.hasResponded();
    if (!responded) {
      // Small timeout for smooth initial page load
      const timer = setTimeout(() => setIsVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAcceptAll = () => {
    consentService.acceptAll(window.location.pathname);
    setIsVisible(false);
  };

  const handleRejectNonEssential = () => {
    consentService.rejectNonEssential(window.location.pathname);
    setIsVisible(false);
  };

  const handleOpenPreferences = () => {
    setIsPreferencesOpen(true);
  };

  const handleClosePreferences = () => {
    setIsPreferencesOpen(false);
    if (consentService.hasResponded()) {
      setIsVisible(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {isVisible && (
          <motion.aside
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed bottom-3 left-3 right-3 sm:bottom-6 sm:left-auto sm:right-6 z-[9990] max-w-xl rounded-2xl sm:rounded-3xl bg-white/95 p-4 sm:p-6 shadow-2xl border border-slate-200/80 backdrop-blur-md"
            role="region"
            aria-label="Privacy and Cookie Consent"
          >
            <div className="flex items-start gap-3.5">
              <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <IconRenderer name="shield-check" className="h-5 w-5" />
              </div>
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm sm:text-base font-bold text-navy">
                    Your Privacy Matters to Us
                  </h4>
                  <button
                    onClick={handleRejectNonEssential}
                    aria-label="Dismiss banner"
                    className="sm:hidden text-slate-400 hover:text-slate-600"
                  >
                    <IconRenderer name="xmark" className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  We use strictly necessary cookies to operate India Cyber Cafe and secure payment transactions. With your consent, we also use optional analytics to measure site traffic and enhance service delivery.
                </p>
                <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                  <Link to="/legal/privacy" className="text-primary font-medium hover:underline">
                    Read Privacy Policy
                  </Link>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={handleOpenPreferences}
                    className="text-primary font-medium hover:underline"
                  >
                    Customize Choices
                  </button>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleOpenPreferences}
                className="order-3 sm:order-1 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition text-center"
              >
                Preferences
              </button>
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="order-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Reject Non-Essential
              </button>
              <button
                type="button"
                onClick={handleAcceptAll}
                className="order-1 sm:order-3 px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition shadow-xs"
              >
                Accept All
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <ConsentPreferencesModal
        isOpen={isPreferencesOpen}
        onClose={handleClosePreferences}
      />
    </>
  );
}
