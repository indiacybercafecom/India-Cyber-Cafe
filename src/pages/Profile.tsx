import React, { useState, useEffect } from 'react';
import { UserProfile, OrderAddress } from '../types';
import { auth, rtdb } from '../firebase';
import { ref as dbRef, update } from 'firebase/database';
import { updatePassword } from 'firebase/auth';
import { showToast } from '../components/Toast';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';
import { sendEmail, emailTemplates } from '../services/emailService';
import { uploadFile } from '../services/uploadService';
import { sanitizeAddress, sanitizePhone, trimWhitespace } from '../utils/sanitizer';

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
  const [address, setAddress] = useState<OrderAddress>(user.address || {
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India'
  });

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
      sendEmail(user.email, 'Profile Picture Updated - India Cyber Cafe', emailTemplates.profileUpdated(user.name, 'Profile Picture'));
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
      // Sanitize all profile data before updating
      const sanitizedName = trimWhitespace(name);
      const sanitizedPhone = sanitizePhone(phone);
      const sanitizedAddress = sanitizeAddress(address);
      const sanitizedNewPass = trimWhitespace(newPass);

      const updates: any = { 
        name: sanitizedName, 
        phone: sanitizedPhone, 
        address: sanitizedAddress 
      };
      await update(dbRef(rtdb, `users/${user.uid}`), updates);

      if (sanitizedNewPass) {
        const currentUser = auth.currentUser;
        if (currentUser) {
          await updatePassword(currentUser, sanitizedNewPass);
          showToast('Password updated!');
        }
      }

      showToast('Profile updated successfully!');
      
      // Send notification email
      sendEmail(user.email, 'Profile Details Updated - India Cyber Cafe', emailTemplates.profileUpdated(sanitizedName, 'Name, Phone & Address'));
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEO
        title="My Profile - Account Settings | India Cyber Cafe"
        description="Manage your India Cyber Cafe profile, update personal information, change password, and update delivery address."
        url="https://b.indiacybercafe.com/profile"
        keywords="profile, account settings, user profile, personal information, delivery address"
        ogType="website"
      />
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

        {/* Address Section */}
        <div className="p-4 sm:p-6 bg-linear-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 space-y-4 sm:space-y-5">
          <h3 className="font-bold text-navy flex items-center gap-2 text-sm sm:text-base">
            <IconRenderer name="map-pin" className="w-4 h-4" />
            Delivery Address
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">Full Name</label>
              <input 
                type="text" 
                className="input-field text-sm"
                value={address.name}
                onChange={e => setAddress({...address, name: e.target.value})}
                placeholder="Your full name"
              />
            </div>
            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">Email</label>
              <input 
                type="email" 
                className="input-field text-sm"
                value={address.email}
                onChange={e => setAddress({...address, email: e.target.value})}
                placeholder="Email address"
              />
            </div>
            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">Phone</label>
              <input 
                type="tel" 
                className="input-field text-sm"
                value={address.phone}
                onChange={e => setAddress({...address, phone: e.target.value})}
                placeholder="Phone number"
              />
            </div>
            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">Pincode</label>
              <input 
                type="text" 
                className="input-field text-sm"
                value={address.pincode}
                onChange={e => setAddress({...address, pincode: e.target.value})}
                placeholder="Postal code"
              />
            </div>
          </div>

          <div className="space-y-1 sm:space-y-2">
            <label className="block text-xs sm:text-sm font-semibold text-slate-600">Address Line 1 *</label>
            <input 
              type="text" 
              className="input-field text-sm"
              value={address.addressLine1}
              onChange={e => setAddress({...address, addressLine1: e.target.value})}
              placeholder="Street address, building, etc."
              required
            />
          </div>

          <div className="space-y-1 sm:space-y-2">
            <label className="block text-xs sm:text-sm font-semibold text-slate-600">Address Line 2 (Optional)</label>
            <input 
              type="text" 
              className="input-field text-sm"
              value={address.addressLine2 || ''}
              onChange={e => setAddress({...address, addressLine2: e.target.value})}
              placeholder="Apartment, floor, etc."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">City *</label>
              <input 
                type="text" 
                className="input-field text-sm"
                value={address.city}
                onChange={e => setAddress({...address, city: e.target.value})}
                placeholder="City"
                required
              />
            </div>
            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">State *</label>
              <input 
                type="text" 
                className="input-field text-sm"
                value={address.state}
                onChange={e => setAddress({...address, state: e.target.value})}
                placeholder="State"
                required
              />
            </div>
          </div>

          <div className="space-y-1 sm:space-y-2">
            <label className="block text-xs sm:text-sm font-semibold text-slate-600">Country</label>
            <input 
              type="text" 
              className="input-field text-sm bg-slate-100"
              value={address.country}
              disabled
            />
          </div>
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
    </>
  );
}
