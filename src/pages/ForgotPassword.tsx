import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, rtdb } from '../firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { ref, get, query, orderByChild, equalTo } from 'firebase/database';
import { showToast } from '../components/Toast';
import { IconRenderer } from '../components/Icons';
import { motion } from 'motion/react';
import { sendEmail } from '../services/emailService';

export function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      let resetEmail = identifier;
      const isPhone = /^\+?[\d\s-]{10,}$/.test(identifier);
      let userName = 'User';
      
      if (isPhone) {
        const usersRef = ref(rtdb, 'users');
        const snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(identifier)));
        if (snapshot.exists()) {
          const userData = Object.values(snapshot.val())[0] as any;
          resetEmail = userData.email;
          userName = userData.name;
        } else {
          throw new Error('No account found with this phone number.');
        }
      }

      await sendPasswordResetEmail(auth, resetEmail);
      
      // Notify Admin
      sendEmail('icc@indiacybercafe.com', 'Password Reset Requested - India Cyber Cafe', `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #FF9933;">Password Reset Request</h2>
          <p>Admin,</p>
          <p>A user has requested a password reset link:</p>
          <p><strong>Identifier:</strong> ${identifier}</p>
          <p><strong>Resolved Email:</strong> ${resetEmail}</p>
          <br/>
          <p>Best Regards,<br/>India Cyber Cafe System</p>
        </div>
      `);

      showToast('Password reset link sent to your email!');
      navigate('/login');
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
            <h2 className="text-3xl font-bold text-navy">Reset Password</h2>
            <p className="text-slate-400 mt-2">Enter your email or mobile to receive a reset link</p>
          </div>

          <form onSubmit={handleReset} className="space-y-6">
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

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-linear-to-br from-navy to-navy-light text-white py-4 rounded-xl font-bold shadow-lg shadow-navy/25 transition-all hover:-translate-y-1 disabled:opacity-50"
            >
              {loading ? 'Sending Link...' : 'Send Reset Link'}
            </button>
          </form>

          <div className="mt-8 text-center">
            <Link 
              to="/login" 
              className="text-primary font-bold hover:underline text-sm"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
