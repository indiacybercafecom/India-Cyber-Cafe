import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { auth, rtdb } from '../firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { showToast } from '../components/Toast';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';
import { motion } from 'motion/react';
import { sendEmail, sendEmailToAllAdmins, emailTemplates } from '../services/emailService';
import { UserProfile } from '../types';

interface RegisterProps {
  user: UserProfile | null;
}

export function Register({ user }: RegisterProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const redirectPath = searchParams.get('redirect') || '/';

  useEffect(() => {
    if (user) {
      navigate(redirectPath, { replace: true });
    }
  }, [user, navigate, redirectPath]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      const role = email.toLowerCase() === 'indiacybercafe.com@gmail.com' ? 'admin' : 'user';
      
      await set(ref(rtdb, `users/${user.uid}`), {
        uid: user.uid,
        name,
        email,
        phone,
        password, // Storing password as requested by admin (Security Note: Usually not recommended)
        role: role,
        avatar: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
        createdAt: Date.now()
      });

      sendEmail(email, 'Welcome to India Cyber Cafe', emailTemplates.registration(name));
      
      // Notify All Admins
      sendEmailToAllAdmins('New User Registered - India Cyber Cafe', emailTemplates.adminUserRegistered(name, email, phone, new Date().toLocaleString()));

      showToast(`Account Created Successfully as ${role}!`);
      navigate(redirectPath);
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEO
        title="Register - Create Account | India Cyber Cafe"
        description="Create your free account at India Cyber Cafe to apply for government services, track applications, and access our store. Secure registration."
        url="https://b.indiacybercafe.com/register"
        keywords="register, create account, sign up, user registration, digital services"
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
            <h2 className="text-3xl font-bold text-navy">Register</h2>
            <p className="text-slate-400 mt-2">Create your India Cyber Cafe account</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
              <IconRenderer name="user" className="absolute left-2 top-3 text-slate-400" />
              <input 
                type="text" 
                placeholder="Full Name" 
                required 
                className="w-full pl-10 pr-4 py-3 outline-none bg-transparent"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
              <IconRenderer name="envelope" className="absolute left-2 top-3 text-slate-400" />
              <input 
                type="email" 
                placeholder="Email Address" 
                required 
                className="w-full pl-10 pr-4 py-3 outline-none bg-transparent"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            <div className="relative border-b-2 border-slate-100 focus-within:border-primary transition-all">
              <IconRenderer name="phone" className="absolute left-2 top-3 text-slate-400" />
              <input 
                type="text" 
                placeholder="Mobile Number" 
                required 
                className="w-full pl-10 pr-4 py-3 outline-none bg-transparent"
                value={phone}
                onChange={e => setPhone(e.target.value)}
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

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-linear-to-br from-navy to-navy-light text-white py-4 rounded-xl font-bold shadow-lg shadow-navy/25 transition-all hover:-translate-y-1 disabled:opacity-50"
            >
              {loading ? 'Creating Account...' : 'Register'}
            </button>
          </form>

          <div className="mt-8 text-center p-5 bg-linear-to-br from-primary/5 to-navy/5 rounded-2xl border border-primary/10">
            <p className="text-slate-500 text-sm mb-2">Already have an account?</p>
            <Link 
              to={`/login?redirect=${encodeURIComponent(redirectPath)}`} 
              className="text-primary font-bold hover:text-primary-dark transition-all inline-block bg-primary/10 px-6 py-2 rounded-lg border border-primary/20"
            >
              Sign In Here
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
    </>
  );
}
