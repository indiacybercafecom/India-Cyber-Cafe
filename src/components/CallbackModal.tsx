import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { sendEmail, emailTemplates } from '../services/emailService';

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

    const trimmedMobile = mobile.trim();

    // Validate
    if (!validateMobile(trimmedMobile)) {
      showToast('कृपया वैध 10 अंकों का मोबाइल नंबर डालें', 'error');
      return;
    }

    setLoading(true);

    try {
      // Send email to admin
      await sendEmail(
        'indiacybercafe.com@gmail.com',
        `New Call Back Request - ${new Date().toLocaleString('en-IN')}`,
        emailTemplates.callbackRequest(trimmedMobile)
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
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9991] w-full max-w-[420px] p-4"
          >
            <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
              {/* Close Button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close popup"
              >
                <IconRenderer name="xmark" className="w-6 h-6" />
              </button>

              {/* Content */}
              <div className="p-10 pt-8">
                {/* Icon */}
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center text-white text-2xl mx-auto mb-5">
                  📞
                </div>

                {/* Heading */}
                <h2 className="text-2xl font-semibold text-center text-gray-900 mb-2">
                  Instant Service Assistance
                </h2>

                {/* Subheading */}
                <p className="text-sm text-center text-gray-600 mb-6 leading-relaxed">
                  Get expert support within minutes. Simply share your mobile number and we'll contact you right away.
                </p>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4 mb-6">
                  <div>
                    <input
                      type="tel"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value.slice(0, 10))}
                      placeholder="Enter your 10-digit mobile number"
                      maxLength={10}
                      inputMode="numeric"
                      required
                      disabled={loading}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all disabled:opacity-50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:shadow-lg transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Processing...' : 'Request Call Back'}
                  </button>
                </form>

                {/* Trust Line */}
                <div className="text-center text-xs text-gray-500 mb-4">
                  <span className="text-green-600 font-semibold">✓ 100% Secure</span>
                  {' '}• No Spam • Instant Support
                </div>

                {/* Maybe Later Button */}
                <button
                  onClick={handleMayLater}
                  className="w-full text-sm text-gray-600 hover:text-gray-800 hover:underline transition-colors py-2"
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
