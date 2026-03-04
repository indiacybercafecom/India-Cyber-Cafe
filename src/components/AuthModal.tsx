import React, { useState } from 'react';
import { auth, rtdb } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { ref, set, get, query, orderByChild, equalTo } from 'firebase/database';
import { showToast } from './Toast';
import { IconRenderer } from './Icons';
import { motion, AnimatePresence } from 'motion/react';
import { sendEmail, sendEmailToAllAdmins, emailTemplates } from '../services/emailService';

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
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      let loginEmail = email;
      
      // Check if input is a phone number (simple check: only digits and maybe +)
      const isPhone = /^\+?[\d\s-]{10,}$/.test(email);
      
      if (isPhone) {
        // Find user with this phone number in RTDB
        const usersRef = ref(rtdb, 'users');
        const snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(email)));
        
        if (snapshot.exists()) {
          const userData = Object.values(snapshot.val())[0] as any;
          loginEmail = userData.email;
        } else {
          throw new Error('No account found with this phone number.');
        }
      }

      await signInWithEmailAndPassword(auth, loginEmail, password);
      showToast('Login Successful!');
      onClose();
    } catch (error: any) {
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found') {
        showToast('Invalid credentials. If you haven\'t registered yet, please click "Create Account".', 'error');
      } else {
        showToast(error.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return showToast('Please enter your email', 'error');
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('Password reset link sent to your email!');
      setView('login');
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      
      // Determine role: Specific email gets admin role automatically
      const role = email.toLowerCase() === 'indiacybercafe.com@gmail.com' ? 'admin' : 'user';
      
      await set(ref(rtdb, `users/${user.uid}`), {
        uid: user.uid,
        name,
        email,
        phone,
        role: role,
        avatar: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
        createdAt: Date.now()
      });

      // Send Welcome Email
      sendEmail(email, 'Welcome to India Cyber Cafe', emailTemplates.registration(name));
      
      // Notify All Admins
      sendEmailToAllAdmins('New User Registered - India Cyber Cafe', emailTemplates.adminUserRegistered(name, email, new Date().toLocaleString()));

      showToast(`Account Created Successfully as ${role}!`);
      onClose();
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2500] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-[420px] relative overflow-hidden shadow-2xl border-t-8 border-primary"
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-red-500 transition-all hover:rotate-90"
        >
          <IconRenderer name="x" className="w-6 h-6" />
        </button>

        <div className="p-6 sm:p-10">
          <div className="text-center mb-6 sm:mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-navy">
              {view === 'login' ? 'Login' : view === 'register' ? 'Register' : 'Reset Password'}
            </h2>
            <p className="text-sm sm:text-base text-slate-400 mt-2">
              {view === 'login' ? 'Welcome Back' : view === 'register' ? 'Create Account' : 'Enter your email to receive a reset link'}
            </p>
          </div>

          <form onSubmit={view === 'login' ? handleLogin : view === 'register' ? handleRegister : handleResetPassword} className="space-y-4 sm:space-y-6">
            {view === 'register' && (
              <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
                <IconRenderer name="user" className="absolute left-2 top-3 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Name" 
                  required 
                  className="w-full pl-10 pr-4 py-3 outline-none bg-transparent text-sm sm:text-base"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
            )}

            <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
              <IconRenderer name="envelope" className="absolute left-2 top-3 text-slate-400" />
              <input 
                type="text" 
                placeholder="Email or Mobile" 
                required 
                className="w-full pl-10 pr-4 py-3 outline-none bg-transparent text-sm sm:text-base"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            {view === 'register' && (
              <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
                <IconRenderer name="phone" className="absolute left-2 top-3 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Phone" 
                  required 
                  className="w-full pl-10 pr-4 py-3 outline-none bg-transparent text-sm sm:text-base"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
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
                />
                <button 
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-2 top-3 text-slate-400 hover:text-primary transition-all"
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
                  className="text-[10px] sm:text-xs font-bold text-slate-400 hover:text-primary transition-all"
                >
                  Forgot Password?
                </button>
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-linear-to-br from-navy to-navy-light text-white py-3 sm:py-4 rounded-xl font-bold shadow-lg shadow-navy/25 transition-all hover:-translate-y-1 hover:shadow-xl disabled:opacity-50 text-sm sm:text-base"
            >
              {loading ? 'Processing...' : view === 'login' ? 'Login' : view === 'register' ? 'Register' : 'Send Reset Link'}
            </button>
          </form>

          <div className="mt-6 sm:mt-8 text-center p-4 sm:p-5 bg-linear-to-br from-primary/5 to-navy/5 rounded-2xl border border-primary/10">
            <p className="text-slate-500 text-xs sm:text-sm mb-2">
              {view === 'login' ? 'New to India Cyber Cafe?' : view === 'register' ? 'Already have an account?' : 'Remember your password?'}
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
