import React, { useState } from 'react';
import { auth, rtdb } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { ref, set, get, query, orderByChild, equalTo } from 'firebase/database';
import { showToast } from './Toast';
import { IconRenderer } from './Icons';
import { GoogleSignInButton } from './GoogleSignInButton';
import { motion } from 'motion/react';
import { sendEmail, sendEmailToAllAdmins, emailTemplates } from '../services/emailService';
import { sanitizeEmail, trimWhitespace, sanitizeUserProfile } from '../utils/sanitizer';
import {
  signInWithGoogle,
  normalizeIndianMobile,
  checkPhoneRegistered,
  initiatePasswordReset,
  mapAuthError,
} from '../services/authService';
import { UserProfile } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [view, setView] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const sanitizedEmail = sanitizeEmail(email);
      const sanitizedPassword = trimWhitespace(password);

      let loginEmail = sanitizedEmail;
      const isPhone = /^\+?[\d\s-]{10,}$/.test(sanitizedEmail);

      if (isPhone) {
        const { valid, normalized } = normalizeIndianMobile(sanitizedEmail);
        const searchPhone = valid ? normalized : sanitizedEmail;
        const usersRef = ref(rtdb, 'users');

        let snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(searchPhone)));
        if (!snapshot.exists() && searchPhone !== sanitizedEmail) {
          snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(sanitizedEmail)));
        }

        if (snapshot.exists()) {
          const userData = Object.values(snapshot.val())[0] as any;
          if (userData.authProvider === 'google' && !userData.password) {
            throw new Error('This account was created with Google Sign-In. Please click "Continue with Google".');
          }
          loginEmail = sanitizeEmail(userData.email);
        } else {
          throw new Error('No account found with this mobile number.');
        }
      }

      await signInWithEmailAndPassword(auth, loginEmail, sanitizedPassword);
      showToast('Login Successful!');
      onClose();
    } catch (error: any) {
      showToast(mapAuthError(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return showToast('Please enter your email or mobile number', 'error');
    setLoading(true);
    try {
      const res = await initiatePasswordReset(email);
      if (res.success) {
        showToast(res.message);
        setView('login');
      } else {
        showToast(res.message, 'error');
      }
    } catch (error: any) {
      showToast(mapAuthError(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const sanitizedEmail = sanitizeEmail(email);
      const sanitizedName = trimWhitespace(name);
      const sanitizedPassword = trimWhitespace(password);

      const { valid, normalized, error: phoneErr } = normalizeIndianMobile(phone);
      if (!valid) {
        throw new Error(phoneErr || 'Please enter a valid 10-digit Indian mobile number.');
      }

      const phoneCheck = await checkPhoneRegistered(normalized);
      if (phoneCheck.inUse) {
        throw new Error('This mobile number is already registered with another account.');
      }

      const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, sanitizedEmail, sanitizedPassword);
      const role = sanitizedEmail === 'indiacybercafe.com@gmail.com' ? 'admin' : 'user';

      const userProfile: UserProfile = {
        uid: firebaseUser.uid,
        name: sanitizedName,
        email: sanitizedEmail,
        phone: normalized,
        password: sanitizedPassword,
        role,
        avatar: 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
        authProvider: 'password',
        phoneVerified: false,
        profileCompleted: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const sanitizedProfile = sanitizeUserProfile(userProfile);
      await set(ref(rtdb, `users/${firebaseUser.uid}`), sanitizedProfile);

      sendEmail(sanitizedEmail, 'Welcome to India Cyber Cafe', emailTemplates.registration(sanitizedName)).catch(() => {});
      sendEmailToAllAdmins(
        'New User Registered - India Cyber Cafe',
        emailTemplates.adminUserRegistered(sanitizedName, sanitizedEmail, normalized, new Date().toLocaleString())
      ).catch(() => {});

      showToast(`Account Created Successfully as ${role}!`);
      onClose();
    } catch (error: any) {
      showToast(mapAuthError(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle();
      if (res.success && res.user) {
        showToast(res.isNew ? 'Account created with Google! Welcome!' : 'Login Successful!');
        onClose();
      } else if (res.error) {
        showToast(res.error, 'error');
      }
    } catch (err: any) {
      showToast(mapAuthError(err), 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-[420px] relative overflow-hidden shadow-2xl border-t-8 border-primary"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-red-500 transition-all hover:rotate-90"
          aria-label="Close modal"
        >
          <IconRenderer name="x" className="w-6 h-6" />
        </button>

        <div className="p-6 sm:p-10">
          <div className="text-center mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-navy">
              {view === 'login' ? 'Login' : view === 'register' ? 'Register' : 'Reset Password'}
            </h2>
            <p className="text-sm sm:text-base text-slate-400 mt-2">
              {view === 'login'
                ? 'Welcome Back to India Cyber Cafe'
                : view === 'register'
                  ? 'Create your account'
                  : 'Enter your email or mobile to recover account'}
            </p>
          </div>

          <form
            onSubmit={view === 'login' ? handleLogin : view === 'register' ? handleRegister : handleResetPassword}
            className="space-y-4 sm:space-y-5"
          >
            {view === 'register' && (
              <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
                <IconRenderer name="user" className="absolute left-2 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Full Name"
                  required
                  className="w-full pl-10 pr-4 py-3 outline-none bg-transparent text-sm sm:text-base"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={loading || googleLoading}
                />
              </div>
            )}

            <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
              <IconRenderer name="envelope" className="absolute left-2 top-3 text-slate-400" />
              <input
                type={view === 'register' ? 'email' : 'text'}
                placeholder={view === 'register' ? 'Email Address' : 'Email or Mobile'}
                required
                className="w-full pl-10 pr-4 py-3 outline-none bg-transparent text-sm sm:text-base"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading || googleLoading}
              />
            </div>

            {view === 'register' && (
              <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
                <IconRenderer name="phone" className="absolute left-2 top-3 text-slate-400" />
                <input
                  type="tel"
                  placeholder="Mobile Number"
                  required
                  className="w-full pl-10 pr-4 py-3 outline-none bg-transparent text-sm sm:text-base"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  disabled={loading || googleLoading}
                />
              </div>
            )}

            {view !== 'forgot' && (
              <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
                <IconRenderer name="lock" className="absolute left-2 top-3 text-slate-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="Password"
                  required
                  className="w-full pl-10 pr-10 py-3 outline-none bg-transparent text-sm sm:text-base"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading || googleLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-2 top-3 text-slate-400 hover:text-primary transition-all"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  <IconRenderer name={showPass ? 'eye' : 'eye-slash'} className="w-5 h-5" />
                </button>
              </div>
            )}

            {view === 'login' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setView('forgot')}
                  className="text-xs font-bold text-slate-400 hover:text-primary transition-all"
                >
                  Forgot Password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full bg-linear-to-br from-navy to-navy-light text-white py-3.5 sm:py-4 rounded-xl font-bold shadow-lg shadow-navy/25 transition-all hover:-translate-y-1 hover:shadow-xl disabled:opacity-50 text-sm sm:text-base"
            >
              {loading
                ? 'Processing...'
                : view === 'login'
                  ? 'Login'
                  : view === 'register'
                    ? 'Register'
                    : 'Send Password Reset Link'}
            </button>

            {view !== 'forgot' && (
              <GoogleSignInButton
                onClick={handleGoogleAuth}
                loading={googleLoading}
                disabled={loading}
                className="mt-3 sm:mt-4"
                text="Continue with Google"
              />
            )}
          </form>

          <div className="mt-6 sm:mt-8 text-center p-4 sm:p-5 bg-linear-to-br from-primary/5 to-navy/5 rounded-2xl border border-primary/10">
            <p className="text-slate-500 text-xs sm:text-sm mb-2">
              {view === 'login'
                ? 'New to India Cyber Cafe?'
                : view === 'register'
                  ? 'Already have an account?'
                  : 'Remember your password?'}
            </p>
            <button
              onClick={() => setView(view === 'login' ? 'register' : 'login')}
              className="text-primary text-sm sm:text-base font-bold hover:text-primary-dark transition-all bg-primary/10 px-4 py-2 rounded-lg border border-primary/20 hover:shadow-md"
            >
              {view === 'login' ? 'Create Account' : 'Sign In Here'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
