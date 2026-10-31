import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { auth, rtdb } from '../firebase';
import { signInWithEmailAndPassword, User as FirebaseUser } from 'firebase/auth';
import { ref, get, query, orderByChild, equalTo } from 'firebase/database';
import { showToast } from '../components/Toast';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { motion } from 'motion/react';
import { UserProfile } from '../types';
import { sanitizeEmail, trimWhitespace } from '../utils/sanitizer';
import { signInWithGoogle, normalizeIndianMobile, mapAuthError } from '../services/authService';

interface LoginProps {
  user: UserProfile | null;
  authUser: FirebaseUser | null;
  authLoading: boolean;
}

export function Login({ authUser, authLoading }: LoginProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const redirectPath = searchParams.get('redirect') || '/';

  useEffect(() => {
    if (!authLoading && authUser) {
      navigate(redirectPath, { replace: true });
    }
  }, [authUser, authLoading, navigate, redirectPath]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const sanitizedIdentifier = trimWhitespace(identifier);
      const sanitizedPassword = trimWhitespace(password);

      let loginEmail = sanitizedIdentifier;
      const isPhone = /^\+?[\d\s-]{10,}$/.test(sanitizedIdentifier);

      if (isPhone) {
        const { valid, normalized } = normalizeIndianMobile(sanitizedIdentifier);
        const searchPhone = valid ? normalized : sanitizedIdentifier;
        const usersRef = ref(rtdb, 'users');

        let snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(searchPhone)));
        if (!snapshot.exists() && searchPhone !== sanitizedIdentifier) {
          snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(sanitizedIdentifier)));
        }

        if (snapshot.exists()) {
          const userData = Object.values(snapshot.val())[0] as any;
          if (userData.authProvider === 'google' && !userData.password) {
            throw new Error('This account was created with Google Sign-In. Please click "Continue with Google" below.');
          }
          loginEmail = sanitizeEmail(userData.email);
        } else {
          throw new Error('No account found with this phone number.');
        }
      } else {
        loginEmail = sanitizeEmail(sanitizedIdentifier);
      }

      await signInWithEmailAndPassword(auth, loginEmail, sanitizedPassword);
      showToast('Login Successful!');
    } catch (error: any) {
      console.error('Login Error:', error.code, error.message);
      showToast(mapAuthError(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle();
      if (res.success) {
        if (res.user) {
          showToast(res.isNew ? 'Account created with Google! Welcome!' : 'Login Successful!');
          navigate(redirectPath, { replace: true });
        }
      } else if (res.error) {
        showToast(res.error, 'error');
      }
    } catch (err: any) {
      showToast(mapAuthError(err), 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <>
      <SEO
        title="Login - Sign In to Your Account | India Cyber Cafe"
        description="Login to your India Cyber Cafe account to track applications, manage orders, and access digital services. Secure login with email, mobile, or Google."
        url="https://b.indiacybercafe.com/login"
        keywords="login, sign in, user login, account access, digital services, google sign in"
        ogType="website"
      />
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white rounded-3xl w-full max-w-[420px] shadow-2xl border-t-8 border-primary overflow-hidden"
        >
          <div className="p-8 sm:p-10">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-navy">Login</h2>
              <p className="text-slate-400 mt-2">Welcome Back to India Cyber Cafe</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
                <IconRenderer name="envelope" className="absolute left-2 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Email or Mobile"
                  required
                  className="w-full pl-10 pr-4 py-3 outline-none bg-transparent text-sm sm:text-base"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  disabled={loading || googleLoading}
                />
              </div>

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

              <div className="text-right">
                <Link
                  to="/forgot-password"
                  title="Forgot Password"
                  className="text-xs font-bold text-slate-400 hover:text-primary transition-all"
                >
                  Forgot Password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="w-full bg-linear-to-br from-navy to-navy-light text-white py-4 rounded-xl font-bold shadow-lg shadow-navy/25 transition-all hover:-translate-y-1 disabled:opacity-50 text-sm sm:text-base"
              >
                {loading ? 'Logging in...' : 'Login'}
              </button>

              <GoogleSignInButton
                onClick={handleGoogleSignIn}
                loading={googleLoading}
                disabled={loading}
                className="mt-4"
                text="Continue with Google"
              />
            </form>

            <div className="mt-8 text-center p-5 bg-linear-to-br from-primary/5 to-navy/5 rounded-2xl border border-primary/10">
              <p className="text-slate-500 text-sm mb-2">New to India Cyber Cafe?</p>
              <Link
                to={`/register?redirect=${encodeURIComponent(redirectPath)}`}
                className="text-primary font-bold hover:text-primary-dark transition-all inline-block bg-primary/10 px-6 py-2 rounded-lg border border-primary/20"
              >
                Create Account
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
