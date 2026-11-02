import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { showToast } from '../components/Toast';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';
import { motion } from 'motion/react';
import { initiatePasswordReset } from '../services/authService';

const COOLDOWN_KEY = 'icc_pwd_reset_cooldown';

export function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isGoogleAccount, setIsGoogleAccount] = useState(false);
  const [cooldown, setCooldown] = useState<number>(0);
  const navigate = useNavigate();

  // Restore cooldown timestamp from sessionStorage if present
  useEffect(() => {
    const storedExpiry = sessionStorage.getItem(COOLDOWN_KEY);
    if (storedExpiry) {
      const remaining = Math.ceil((parseInt(storedExpiry, 10) - Date.now()) / 1000);
      if (remaining > 0) {
        setCooldown(remaining);
      } else {
        sessionStorage.removeItem(COOLDOWN_KEY);
      }
    }
  }, []);

  // Cooldown timer interval
  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          sessionStorage.removeItem(COOLDOWN_KEY);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  const startCooldown = (seconds = 60) => {
    setCooldown(seconds);
    sessionStorage.setItem(COOLDOWN_KEY, String(Date.now() + seconds * 1000));
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (cooldown > 0) {
      showToast(`Please wait ${cooldown}s before requesting another reset link.`, 'info');
      return;
    }

    setLoading(true);
    setStatusMessage(null);
    setIsGoogleAccount(false);

    try {
      const res = await initiatePasswordReset(identifier);

      if (res.isGoogleAccount) {
        setIsGoogleAccount(true);
        setStatusMessage(res.message);
        showToast(res.message, 'info');
      } else if (res.success) {
        setStatusMessage(res.message);
        startCooldown(60);
        showToast('Password recovery instructions sent!');
      } else {
        showToast(res.message, 'error');
      }
    } catch (error: any) {
      showToast(error, 'error', 'Unable to request password reset right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEO
        title="Forgot Password? - Account Recovery | India Cyber Cafe"
        description="Enter your registered email address or Indian mobile number (+91 or 10-digit) to recover your India Cyber Cafe account securely."
        url="https://b.indiacybercafe.com/forgot-password"
        keywords="forgot password, reset password, account recovery, password reset"
        ogType="website"
      />
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white rounded-3xl w-full max-w-[420px] shadow-2xl border-t-8 border-primary overflow-hidden"
        >
          <div className="p-8 sm:p-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-navy">Forgot Password?</h2>
              <p className="text-slate-400 mt-2 text-sm sm:text-base">
                Enter your registered email address or mobile number to recover your account.
              </p>
            </div>

            {statusMessage ? (
              <div
                className={`p-5 rounded-2xl border mb-6 text-sm leading-relaxed ${
                  isGoogleAccount
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="flex items-start gap-3">
                  <IconRenderer
                    name={isGoogleAccount ? 'info' : 'check'}
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      isGoogleAccount ? 'text-amber-600' : 'text-emerald-600'
                    }`}
                  />
                  <div>
                    <p className="font-semibold mb-1">
                      {isGoogleAccount ? 'Google Sign-In Account' : 'Check Your Inbox'}
                    </p>
                    <p className="text-xs sm:text-sm">{statusMessage}</p>
                  </div>
                </div>

                {isGoogleAccount ? (
                  <div className="mt-4">
                    <Link
                      to="/login"
                      className="block text-center w-full bg-navy text-white py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-navy-light transition-all"
                    >
                      Go to Login with Google
                    </Link>
                  </div>
                ) : (
                  <div className="mt-4 pt-3 border-t border-emerald-200/60 text-xs text-emerald-800 space-y-1">
                    <p>✓ Check both your inbox and spam/junk folders</p>
                    <p>✓ Click the secure reset link sent to your email</p>
                    <p>✓ Choose a strong, new password</p>
                    {cooldown > 0 && (
                      <p className="text-slate-500 pt-1 font-medium">
                        Resend will be available in {cooldown} seconds.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            <form onSubmit={handleReset} className="space-y-6">
              <div>
                <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
                  <IconRenderer name="envelope" className="absolute left-2 top-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Registered Email or Mobile Number"
                    required
                    className="w-full pl-10 pr-4 py-3 outline-none bg-transparent text-sm sm:text-base"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    disabled={loading || cooldown > 0}
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5 pl-2">
                  Accepts email or 10-digit Indian mobile (+91 / 91).
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || cooldown > 0}
                className="w-full bg-linear-to-br from-navy to-navy-light text-white py-4 rounded-xl font-bold shadow-lg shadow-navy/25 transition-all hover:-translate-y-1 disabled:opacity-50 text-sm sm:text-base cursor-pointer disabled:cursor-not-allowed"
              >
                {loading
                  ? 'Sending Reset Link...'
                  : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : 'Send Password Reset Link'}
              </button>
            </form>

            <div className="mt-8 text-center pt-4 border-t border-slate-100">
              <Link
                to="/login"
                className="text-primary font-bold hover:text-primary-dark text-sm inline-flex items-center gap-1 transition-all"
              >
                <span>← Back to Login</span>
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
