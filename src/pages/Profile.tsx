import React, { useState } from 'react';
import { UserProfile } from '../types';
import { auth, rtdb, storage } from '../firebase';
import { ref as dbRef, update } from 'firebase/database';
import { updatePassword } from 'firebase/auth';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { showToast } from '../components/Toast';
import { IconRenderer } from '../components/Icons';

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

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const sRef = storageRef(storage, `avatars/${user.uid}`);
      const snapshot = await uploadBytes(sRef, file);
      const url = await getDownloadURL(snapshot.ref);
      
      await update(dbRef(rtdb, `users/${user.uid}`), { avatar: url });
      setAvatar(url);
      showToast('Profile picture updated!');
    } catch (error: any) {
      showToast(error.message, 'error');
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
          <img 
            src={avatar || "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
            className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-primary shadow-2xl object-cover"
          />
          <label 
            htmlFor="avatar-upload"
            className="absolute bottom-0 right-0 bg-navy text-white w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center cursor-pointer border-4 border-white hover:scale-110 transition-all"
          >
            <IconRenderer name="camera" className="w-4 h-4 sm:w-5 sm:h-5" />
          </label>
          <input 
            type="file" 
            id="avatar-upload" 
            className="hidden" 
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
