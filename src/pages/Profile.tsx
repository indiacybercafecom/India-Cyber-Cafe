import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { auth, rtdb } from '../firebase';
import { ref as dbRef, update } from 'firebase/database';
import { updatePassword } from 'firebase/auth';
import { showToast } from '../components/Toast';
import { IconRenderer } from '../components/Icons';
import { sendEmail } from '../services/emailService';
import { uploadFile } from '../services/uploadService';

interface ProfileProps {
  user: UserProfile;
}

export function Profile({ user }: ProfileProps) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatar, setAvatar] = useState(user.avatar);

  // Sync avatar state with user prop if it changes externally
  useEffect(() => {
    setAvatar(user.avatar);
  }, [user.avatar]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Basic validation
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }

    // Limit file size to 2MB
    if (file.size > 2 * 1024 * 1024) {
      showToast('File size too large. Please select an image under 2MB.', 'error');
      return;
    }

    setLoading(true);
    try {
      const url = await uploadFile(file, 'avatars');
      await update(dbRef(rtdb, `users/${user.uid}`), { avatar: url });
      setAvatar(url);
      showToast('Profile picture updated!');
      
      // Send notification email
      sendEmail(user.email, 'Profile Picture Updated - India Cyber Cafe', `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #FF9933;">Profile Updated</h2>
          <p>Hello <strong>${user.name}</strong>,</p>
          <p>Your profile picture has been successfully updated on India Cyber Cafe.</p>
          <br/>
          <p>Best Regards,<br/>India Cyber Cafe Team</p>
        </div>
      `);
    } catch (error: any) {
      console.error("Upload error:", error);
      showToast(error.message || 'Failed to upload image', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const updates: any = { name, phone };
      await update(dbRef(rtdb, `users/${user.uid}`), updates);

      if (newPass) {
        const currentUser = auth.currentUser;
        if (currentUser) {
          await updatePassword(currentUser, newPass);
          showToast('Password updated!');
        }
      }

      showToast('Profile updated successfully!');
      
      // Send notification email
      sendEmail(user.email, 'Profile Details Updated - India Cyber Cafe', `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #FF9933;">Profile Updated</h2>
          <p>Hello <strong>${name}</strong>,</p>
          <p>Your profile details (Name/Phone) have been successfully updated on India Cyber Cafe.</p>
          <br/>
          <p>Best Regards,<br/>India Cyber Cafe Team</p>
        </div>
      `);
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto bg-white p-6 sm:p-10 rounded-3xl shadow-xl space-y-6 sm:space-y-10">
      <div className="text-center space-y-4 sm:space-y-6">
        <div className="relative inline-block group">
          <div className="relative">
            <img 
              src={avatar || "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
              className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-primary shadow-2xl object-cover transition-opacity ${loading ? 'opacity-50' : 'opacity-100'}`}
              referrerPolicy="no-referrer"
            />
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 rounded-full">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-1" />
              </div>
            )}
          </div>
          <label 
            htmlFor="avatar-upload"
            className="absolute bottom-0 right-0 bg-navy text-white w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center cursor-pointer border-4 border-white hover:scale-110 transition-all shadow-lg"
          >
            <IconRenderer name="camera" className="w-4 h-4 sm:w-5 sm:h-5" />
          </label>
          <input 
            type="file" 
            id="avatar-upload" 
            className="hidden" 
            accept="image/*"
            onChange={handleAvatarChange}
            disabled={loading}
          />
        </div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-navy">{user.name}</h2>
          <p className="text-sm sm:text-base text-slate-400">{user.email}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        <div className="space-y-1 sm:space-y-2">
          <label className="block font-bold text-navy text-sm sm:text-base">Full Name</label>
          <input 
            type="text" 
            className="input-field"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1 sm:space-y-2">
          <label className="block font-bold text-navy text-sm sm:text-base">Phone Number</label>
          <input 
            type="text" 
            className="input-field"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            required
          />
        </div>

        <div className="p-4 sm:p-6 bg-linear-to-br from-primary/5 to-navy/5 rounded-2xl border border-primary/10 space-y-3 sm:space-y-4">
          <h3 className="font-bold text-navy flex items-center gap-2 text-sm sm:text-base">
            <IconRenderer name="lock" className="w-4 h-4" />
            Change Password (Optional)
          </h3>
          <div className="space-y-1 sm:space-y-2">
            <label className="block text-xs sm:text-sm font-semibold text-slate-500">New Password</label>
            <input 
              type="password" 
              className="input-field"
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
              placeholder="Leave blank to keep current"
            />
          </div>
        </div>

        <button 
          type="submit" 
          disabled={loading}
          className="btn-primary w-full py-3 sm:py-4 text-base sm:text-lg"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
