import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, get, query, orderByChild, equalTo } from 'firebase/database';
import { showToast } from '../components/Toast';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';
import { motion } from 'motion/react';
import { sendEmail, sendEmailToAllAdmins, emailTemplates } from '../services/emailService';
import { trimWhitespace, sanitizeEmail, sanitizePhone } from '../utils/sanitizer';

export function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Sanitize identifier input
      const sanitizedIdentifier = trimWhitespace(identifier);
      
      let resetEmail = sanitizedIdentifier;
      const isPhone = /^\+?[\d\s-]{10,}$/.test(sanitizedIdentifier);
      let userName = 'User';
      let userPassword = '';
      
      // Check if user exists in database
      if (isPhone) {
        // Search by phone
        const sanitizedPhone = sanitizePhone(sanitizedIdentifier, true);
        const usersRef = ref(rtdb, 'users');
        const snapshot = await get(query(usersRef, orderByChild('phone'), equalTo(sanitizedIdentifier)));
        if (snapshot.exists()) {
          const userData = Object.values(snapshot.val())[0] as any;
          resetEmail = sanitizeEmail(userData.email);
          userName = userData.name.trim();
          userPassword = userData.password;
        } else {
          throw new Error('No registered account found with this phone number. Please check and try again.');
        }
      } else {
        // Search by email
        const sanitizedEmailSearch = sanitizeEmail(sanitizedIdentifier);
        const usersRef = ref(rtdb, 'users');
        const snapshot = await get(query(usersRef, orderByChild('email'), equalTo(sanitizedEmailSearch)));
        if (snapshot.exists()) {
          const userData = Object.values(snapshot.val())[0] as any;
          userName = userData.name.trim();
          userPassword = userData.password;
          resetEmail = sanitizeEmail(userData.email);
        } else {
          throw new Error('No registered account found with this email. Please check and try again or register first.');
        }
      }

      // Send password to user with instructions
      sendEmail(resetEmail, 'Your Password - India Cyber Cafe', emailTemplates.userPasswordDelivery(userName, userPassword));
      
      // Notify All Admins
      sendEmailToAllAdmins('Password Reset Requested - India Cyber Cafe', emailTemplates.adminPasswordResetRequest(userName, resetEmail, new Date().toLocaleString()));

      showToast('Password has been sent to your email! Please check your inbox and spam folder.');
      setTimeout(() => navigate('/login'), 2000);
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEO
        title="Forgot Password - Reset Your Account | India Cyber Cafe"
        description="Recover your India Cyber Cafe account by entering your registered email or phone number. Reset your password securely."
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
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-navy">Recover Password</h2>
            <p className="text-slate-400 mt-2">Only for registered users. Enter your registered email or mobile.</p>
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
              {loading ? 'Sending Your Password...' : 'Get My Password'}
            </button>
          </form>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-navy font-semibold mb-2">📧 What will happen next:</p>
            <ul className="text-xs text-slate-600 space-y-1 ml-4">
              <li>✓ Your password will be sent to your registered email</li>
              <li>✓ Check your inbox and spam folder</li>
              <li>✓ Use the password to login</li>
              <li>✓ Change your password from your profile for security</li>
            </ul>
          </div>

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
    </>
  );
}
