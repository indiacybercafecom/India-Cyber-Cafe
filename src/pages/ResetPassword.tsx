import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';
import { showToast } from '../components/Toast';
import { motion } from 'motion/react';
import { verifyPasswordReset, confirmPasswordUpdate } from '../services/authService';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Extract oobCode from standard search params or hash (Firebase sometimes passes in hash)
  const [oobCode, setOobCode] = useState<string>('');
  const [verifying, setVerifying] = useState(true);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  // Form states
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState(5);

  useEffect(() => {
    // 1. Look in URL search params (e.g. ?oobCode=... or ?code=...)
    let code = searchParams.get('oobCode') || searchParams.get('code');

    // 2. Fallback to hash parameters if present
    if (!code && typeof window !== 'undefined' && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
      code = hashParams.get('oobCode') || hashParams.get('code');
    }

    // 3. Fallback to window.location.search directly
    if (!code && typeof window !== 'undefined' && window.location.search) {
      const urlParams = new URLSearchParams(window.location.search);
      code = urlParams.get('oobCode') || urlParams.get('code');
    }

    if (!code) {
      setVerifying(false);
      setCodeError('No password recovery token found. The link may be incomplete or invalid.');
      return;
    }

    setOobCode(code);

    // Verify token with Firebase
    verifyPasswordReset(code)
      .then(res => {
        if (res.success && res.email) {
          setVerifiedEmail(res.email);
        } else {
          setCodeError(res.error || 'This password reset link is invalid, expired, or has already been used.');
        }
      })
      .catch(() => {
        setCodeError('Unable to verify this password reset link. Please request a new one.');
      })
      .finally(() => {
        setVerifying(false);
      });
  }, [searchParams]);

  // Handle countdown on success
  useEffect(() => {
    if (!resetSuccess) return;

    if (redirectCountdown <= 0) {
      navigate('/login');
      return;
    }

    const timer = setInterval(() => {
      setRedirectCountdown(prev => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [resetSuccess, redirectCountdown, navigate]);

  // Password strength checks
  const isMinLength = password.length >= 6;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const isMatch = password.length > 0 && password === confirmPassword;
  const isFormValid = isMinLength && hasLetter && hasNumber && isMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isMinLength) {
      showToast('Password must be at least 6 characters long.', 'info');
      return;
    }
    if (!hasLetter || !hasNumber) {
      showToast('Password should contain both letters and numbers.', 'info');
      return;
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match. Please re-enter.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await confirmPasswordUpdate(oobCode, password);
      if (res.success) {
        setResetSuccess(true);
        showToast('Password updated successfully!');
      } else {
        showToast(res.error || 'Failed to update password. Please try again.', 'error');
      }
    } catch (err: any) {
      showToast(err, 'error', 'Unable to reset password right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SEO
        title="Set New Password - Account Recovery | India Cyber Cafe"
        description="Choose a secure new password for your India Cyber Cafe account."
        url="https://b.indiacybercafe.com/reset-password"
        keywords="reset password, new password, account recovery"
        ogType="website"
      />

      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white rounded-3xl w-full max-w-[440px] shadow-2xl border-t-8 border-primary overflow-hidden"
        >
          <div className="p-8 sm:p-10">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-primary">
                <IconRenderer name="lock" className="w-7 h-7" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-navy">
                {resetSuccess ? 'Password Reset Complete' : 'Set New Password'}
              </h2>
              <p className="text-slate-400 mt-2 text-xs sm:text-sm">
                {resetSuccess
                  ? 'Your account password has been updated securely.'
                  : 'Enter and confirm your new secure password below.'}
              </p>
            </div>

            {/* Verifying State */}
            {verifying && (
              <div className="py-12 text-center space-y-4">
                <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm font-medium text-slate-600">Verifying security token...</p>
              </div>
            )}

            {/* Invalid or Expired Token State */}
            {!verifying && codeError && !resetSuccess && (
              <div className="space-y-6">
                <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
                  <div className="flex items-start gap-3">
                    <IconRenderer name="info" className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold mb-1">Invalid or Expired Link</p>
                      <p className="text-xs sm:text-sm leading-relaxed">{codeError}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Link
                    to="/forgot-password"
                    className="block text-center w-full bg-linear-to-br from-navy to-navy-light text-white py-3.5 rounded-xl font-bold text-sm shadow-md hover:-translate-y-0.5 transition-all"
                  >
                    Request a New Reset Link
                  </Link>
                  <Link
                    to="/login"
                    className="block text-center w-full py-2.5 text-slate-500 hover:text-navy text-sm font-medium transition-colors"
                  >
                    Back to Login
                  </Link>
                </div>
              </div>
            )}

            {/* Success State */}
            {!verifying && resetSuccess && (
              <div className="space-y-6">
                <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">
                  <div className="flex items-start gap-3">
                    <IconRenderer name="check" className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold mb-1">Success!</p>
                      <p className="text-xs sm:text-sm leading-relaxed">
                        Your password has been changed. You will be automatically redirected to the login page in{' '}
                        <span className="font-bold text-emerald-700">{redirectCountdown} seconds</span>.
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="w-full bg-linear-to-br from-navy to-navy-light text-white py-4 rounded-xl font-bold shadow-lg shadow-navy/25 hover:-translate-y-0.5 transition-all text-sm sm:text-base cursor-pointer"
                >
                  Sign In Now
                </button>
              </div>
            )}

            {/* Reset Form */}
            {!verifying && !codeError && !resetSuccess && (
              <form onSubmit={handleSubmit} className="space-y-5">
                {verifiedEmail && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 text-xs text-slate-600">
                    <IconRenderer name="envelope" className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">
                      Account: <strong className="text-navy">{verifiedEmail}</strong>
                    </span>
                  </div>
                )}

                {/* New Password */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    New Password
                  </label>
                  <div className="relative border-b-2 border-slate-200 focus-within:border-primary transition-all">
                    <IconRenderer name="lock" className="absolute left-2 top-3 text-slate-400 w-4 h-4" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="At least 6 characters"
                      required
                      minLength={6}
                      className="w-full pl-9 pr-10 py-2.5 outline-none bg-transparent text-sm"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600 text-xs px-1 py-0.5"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Confirm New Password
                  </label>
                  <div className="relative border-b-2 border-slate-200 focus-within:border-primary transition-all">
                    <IconRenderer name="lock" className="absolute left-2 top-3 text-slate-400 w-4 h-4" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Repeat new password"
                      required
                      minLength={6}
                      className="w-full pl-9 pr-10 py-2.5 outline-none bg-transparent text-sm"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600 text-xs px-1 py-0.5"
                    >
                      {showConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {/* Password Criteria Checklist */}
                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs">
                  <div className={`flex items-center gap-1.5 ${isMinLength ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{isMinLength ? '✓' : '•'}</span>
                    <span>At least 6 characters</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasLetter && hasNumber ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{hasLetter && hasNumber ? '✓' : '•'}</span>
                    <span>Mix of letters and numbers</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${isMatch ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{isMatch ? '✓' : '•'}</span>
                    <span>Passwords match</span>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={submitting || !isFormValid}
                  className="w-full bg-linear-to-br from-navy to-navy-light text-white py-4 rounded-xl font-bold shadow-lg shadow-navy/25 transition-all hover:-translate-y-0.5 disabled:opacity-50 text-sm sm:text-base cursor-pointer disabled:cursor-not-allowed"
                >
                  {submitting ? 'Updating Password...' : 'Save New Password'}
                </button>

                <div className="text-center pt-2">
                  <Link
                    to="/login"
                    className="text-primary font-bold hover:text-primary-dark text-xs sm:text-sm inline-flex items-center gap-1 transition-all"
                  >
                    <span>← Cancel and return to Login</span>
                  </Link>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
