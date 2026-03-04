import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../firebase';
import { showToast } from '../components/Toast';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  useEffect(() => {
    const handleAuth = async () => {
      if (token) {
        try {
          await signInWithCustomToken(auth, token);
          showToast('Logged in with Google successfully!');
          navigate('/profile');
        } catch (error: any) {
          console.error('Firebase Auth Error:', error);
          showToast('Google login failed. Please try again.', 'error');
          navigate('/login');
        }
      } else {
        navigate('/login');
      }
    };

    handleAuth();
  }, [token, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-slate-600 font-medium">Completing your login...</p>
      </div>
    </div>
  );
}
