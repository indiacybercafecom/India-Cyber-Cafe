import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { sendEmail, emailTemplates } from '../services/emailService';
import { sanitizePhone } from '../utils/sanitizer';

interface CallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CallbackModal({ isOpen, onClose }: CallbackModalProps) {
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Check localStorage on mount
  useEffect(() => {
    const hasSubmitted = localStorage.getItem('icc_callback_submitted');
    const isDisabled = localStorage.getItem('icc_callback_disabled');
    if (hasSubmitted || isDisabled) {
      setSubmitted(true);
    }
  }, []);

  const validateMobile = (num: string): boolean => {
    return /^[0-9]{10}$/.test(num);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Sanitize phone input
    const sanitizedMobile = sanitizePhone(mobile);

    // Validate
    if (!validateMobile(sanitizedMobile)) {
      showToast('कृपया वैध 10 अंकों का मोबाइल नंबर डालें', 'error');
      return;
    }

    setLoading(true);

    try {
      // Send email to admin
      await sendEmail(
        'indiacybercafe.com@gmail.com',
        `New Call Back Request - ${new Date().toLocaleString('en-IN')}`,
        emailTemplates.callbackRequest(sanitizedMobile)
      );

      showToast('आपकी रिक्वेस्ट भेज दी गई है। हम कुछ ही मिनटों में संपर्क करेंगे।', 'success');
      localStorage.setItem('icc_callback_submitted', 'yes');
      setSubmitted(true);
      setMobile('');
      setTimeout(onClose, 800);
    } catch (error: any) {
      console.error('Callback error:', error);
      showToast('माफ़ करें, अभी कोशिश नहीं कर सके। कुछ समय बाद दोबारा कोशिश करें।', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleMayLater = () => {
    onClose();
    localStorage.setItem('icc_callback_disabled', 'yes');
    setSubmitted(true);
  };

  if (submitted) {
    return null;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-[9990]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9991] w-full max-w-[420px] p-4 max-h-[92vh] overflow-y-auto"
          >
            <div className="bg-white rounded-2xl shadow-2xl overflow-hidden relative border border-gray-100">
              {/* Close Button */}
              <button
                onClick={onClose}
                className="absolute top-3.5 right-3.5 z-20 w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-gray-500 hover:text-gray-800 transition-colors"
                aria-label="Close popup"
              >
                <IconRenderer name="xmark" className="w-5 h-5" />
              </button>

              {/* App Install Banner */}
              <div className="bg-gradient-to-br from-blue-50/80 via-orange-50/50 to-amber-50/70 p-5 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-white shadow-sm p-1.5 flex-shrink-0 border border-orange-100/80 flex items-center justify-center">
                    <img
                      src="https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png"
                      alt="India Cyber Cafe Logo"
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="flex-1 min-w-0 pr-6">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-orange-500 text-white px-1.5 py-0.5 rounded leading-none">
                        Android App
                      </span>
                      <span className="text-xs font-semibold text-amber-700 flex items-center">
                        ★ 4.8
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900 leading-tight">
                      India Cyber Cafe
                    </h3>
                    <p className="text-xs text-gray-500 truncate">
                      Digital Seva & Online Portal
                    </p>
                  </div>
                </div>

                {/* Install Button - Opens Google Play in a new tab */}
                <a
                  href="https://play.google.com/store/apps/details?id=com.indiacybercafe.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3.5 w-full flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-gray-900 to-gray-800 hover:from-black hover:to-gray-900 text-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 group active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2.5">
                    {/* Official Google Play Logo */}
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 512 512" aria-hidden="true">
                      <path fill="#4285F4" d="M48.7 15.6C44.3 20.3 41.7 27.5 41.7 37v438c0 9.5 2.6 16.7 7 21.4l1.2 1.2 245.4-245.4v-5.8L50 14.4l-1.3 1.2z"/>
                      <path fill="#FBBC04" d="M377.2 320.5l-81.9-81.9v-5.8l81.9-81.9 1.8 1 97.1 55.2c27.7 15.7 27.7 41.5 0 57.2l-97.1 55.2-1.8 1z"/>
                      <path fill="#EA4335" d="M379 319.5L295.3 235.8 48.7 482.4c9.2 9.8 24.5 10.9 41.8 1.1l288.5-164"/>
                      <path fill="#34A853" d="M379 160.5L90.5 28.5C73.2 18.7 57.9 19.8 48.7 29.6L295.3 276.2 379 160.5z"/>
                    </svg>
                    <div className="text-left leading-tight">
                      <div className="text-[10px] text-gray-300 uppercase tracking-wide">Get it on</div>
                      <div className="text-sm font-semibold text-white">Google Play</div>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-bold bg-white text-gray-900 px-3 py-1 rounded-lg group-hover:bg-amber-400 transition-colors shadow-xs">
                    Install
                    <IconRenderer name="external-link" className="w-3 h-3" />
                  </span>
                </a>
              </div>

              {/* Divider */}
              <div className="relative px-6 pt-3 pb-1">
                <div className="absolute inset-0 flex items-center px-6">
                  <div className="w-full border-t border-gray-200"></div>
                </div>
                <div className="relative flex justify-center text-[11px] uppercase">
                  <span className="bg-white px-3 text-gray-400 font-semibold tracking-wider">
                    Or Get Instant Call Back
                  </span>
                </div>
              </div>

              {/* Call Back Form Section */}
              <div className="p-6 pt-2">
                {/* Heading & Subheading */}
                <div className="text-center mb-4">
                  <h2 className="text-lg font-bold text-gray-900 mb-1">
                    Instant Service Assistance
                  </h2>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Get expert support within minutes. Simply share your mobile number and we'll contact you right away.
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-3 mb-4">
                  <div>
                    <input
                      type="tel"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value.slice(0, 10))}
                      placeholder="Enter 10-digit mobile number"
                      maxLength={10}
                      inputMode="numeric"
                      required
                      disabled={loading}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold text-sm rounded-xl hover:shadow-md transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Processing...' : 'Request Call Back'}
                  </button>
                </form>

                {/* Trust Line */}
                <div className="text-center text-[11px] text-gray-500 mb-3">
                  <span className="text-green-600 font-semibold">✓ 100% Secure</span>
                  {' '}• Free Support • Instant Assistance
                </div>

                {/* Maybe Later Button */}
                <button
                  onClick={handleMayLater}
                  className="w-full text-xs text-gray-500 hover:text-gray-700 hover:underline transition-colors py-1"
                >
                  Maybe later / Don't show again
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
