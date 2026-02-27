import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, rtdb } from '../firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { ref, get, query, orderByChild, equalTo } from 'firebase/database';
import { showToast } from '../components/Toast';
import { IconRenderer } from '../components/Icons';
import { motion } from 'motion/react';

export function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      let loginEmail = identifier;
      const isPhone = /^\+?[\d\s-]{10,}$/.test(identifier);
      
      if (isPhone) {
        const usersRef = ref(rtdb, 'users');
        const snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(identifier)));
        if (snapshot.exists()) {
          const userData = Object.values(snapshot.val())[0] as any;
          loginEmail = userData.email;
        } else {
          throw new Error('No account found with this phone number.');
        }
      }

      await signInWithEmailAndPassword(auth, loginEmail, password);
      showToast('Login Successful!');
      navigate('/');
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
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
                className="w-full pl-10 pr-4 py-3 outline-none bg-transparent"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
              />
            </div>

            <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
              <IconRenderer name="lock" className="absolute left-2 top-3 text-slate-400" />
              <input 
                type={showPass ? 'text' : 'password'} 
                placeholder="Password" 
                required 
                className="w-full pl-10 pr-10 py-3 outline-none bg-transparent"
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

            <div className="text-right">
              <Link to="/forgot-password" title="Forgot Password" className="text-xs font-bold text-slate-400 hover:text-primary transition-all">
                Forgot Password?
              </Link>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-linear-to-br from-navy to-navy-light text-white py-4 rounded-xl font-bold shadow-lg shadow-navy/25 transition-all hover:-translate-y-1 disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          <div className="mt-8 text-center p-5 bg-linear-to-br from-primary/5 to-navy/5 rounded-2xl border border-primary/10">
            <p className="text-slate-500 text-sm mb-2">New to India Cyber Cafe?</p>
            <Link 
              to="/register" 
              className="text-primary font-bold hover:text-primary-dark transition-all inline-block bg-primary/10 px-6 py-2 rounded-lg border border-primary/20"
            >
              Create Account
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
