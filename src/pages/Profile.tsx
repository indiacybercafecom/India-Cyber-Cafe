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
import { sanitizeAddress, trimWhitespace } from '../utils/sanitizer';
import { normalizeIndianMobile, checkPhoneRegistered, mapAuthError } from '../services/authService';

interface ProfileProps {
  user: UserProfile;
}

export function Profile({ user }: ProfileProps) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  const [newPass, setNewPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatar, setAvatar] = useState(user.avatar);
  const [address, setAddress] = useState<OrderAddress>(
    user.address || {
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      pincode: '',
      country: 'India',
    }
  );

  // Sync phone and avatar state with user prop if it changes externally via useAuth listener
  useEffect(() => {
    setAvatar(user.avatar);
    setName(user.name);
    setPhone(user.phone || '');
  }, [user.avatar, user.name, user.phone]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showToast('File size too large. Please select an image under 2MB.', 'error');
      return;
    }

    setLoading(true);
    try {
      const url = await uploadFile(file, 'avatars');
      await update(dbRef(rtdb, `users/${user.uid}`), {
        avatar: url,
        updatedAt: Date.now(),
      });
      setAvatar(url);
      showToast('Profile picture updated!');

      sendEmail(
        user.email,
        'Profile Picture Updated - India Cyber Cafe',
        emailTemplates.profileUpdated(user.name, 'Profile Picture')
      ).catch(() => {});
    } catch (error: any) {
      console.error('Upload error:', error);
      showToast(error.message || 'Failed to upload image', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const sanitizedName = trimWhitespace(name);
      const sanitizedAddress = sanitizeAddress(address);
      const sanitizedNewPass = trimWhitespace(newPass);

      let normalizedPhone = '';
      if (phone && phone.trim()) {
        const { valid, normalized, error: phoneErr } = normalizeIndianMobile(phone);
        if (!valid) {
          throw new Error(phoneErr || 'Please enter a valid 10-digit Indian mobile number.');
        }
        normalizedPhone = normalized;

        // Check uniqueness if phone was modified
        if (normalizedPhone !== user.phone) {
          const phoneCheck = await checkPhoneRegistered(normalizedPhone, user.uid);
          if (phoneCheck.inUse) {
            throw new Error('This mobile number is already registered with another account.');
          }
        }
      }

      const updates: Partial<UserProfile> = {
        name: sanitizedName,
        phone: normalizedPhone,
        address: sanitizedAddress,
        profileCompleted: Boolean(normalizedPhone),
        updatedAt: Date.now(),
      };

      await update(dbRef(rtdb, `users/${user.uid}`), updates);

      if (sanitizedNewPass) {
        const currentUser = auth.currentUser;
        if (currentUser) {
          await updatePassword(currentUser, sanitizedNewPass);
          showToast('Password updated successfully!');
        }
      }

      showToast('Profile updated successfully!');

      sendEmail(
        user.email,
        'Profile Details Updated - India Cyber Cafe',
        emailTemplates.profileUpdated(sanitizedName, 'Name, Phone & Address')
      ).catch(() => {});
    } catch (error: any) {
      showToast(mapAuthError(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const isGoogleUser = user.authProvider === 'google';
  const hasNoPhone = !user.phone || !user.phone.trim();

  return (
    <>
      <SEO
        title="My Profile - Account Settings | India Cyber Cafe"
        description="Manage your India Cyber Cafe profile, update personal information, change password, and update delivery address."
        url="https://b.indiacybercafe.com/profile"
        keywords="profile, account settings, user profile, personal information, delivery address"
        ogType="website"
      />
      <div className="max-w-xl mx-auto bg-white p-6 sm:p-10 rounded-3xl shadow-xl space-y-6 sm:space-y-8">
        <div className="text-center space-y-4 sm:space-y-6">
          <div className="relative inline-block group">
            <div className="relative">
              <img
                src={avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}
                className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-primary shadow-2xl object-cover transition-opacity ${
                  loading ? 'opacity-50' : 'opacity-100'
                }`}
                alt={user.name}
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
              title="Change profile picture"
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
            <div className="flex items-center justify-center gap-2">
              <h2 className="text-2xl sm:text-3xl font-bold text-navy">{user.name}</h2>
              {isGoogleUser && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                  Google
                </span>
              )}
            </div>
            <p className="text-sm sm:text-base text-slate-400 mt-1">{user.email}</p>
          </div>
        </div>

        {/* Profile Completion Reminder */}
        {hasNoPhone && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-amber-900">
            <IconRenderer name="info" className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold">Profile Incomplete</p>
              <p className="text-xs sm:text-sm mt-0.5 text-amber-800">
                Please add your mobile number to complete your profile.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          <div className="space-y-1 sm:space-y-2">
            <label className="block font-bold text-navy text-sm sm:text-base">Full Name</label>
            <input
              type="text"
              className="input-field"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-1 sm:space-y-2">
            <div className="flex items-center justify-between">
              <label className="block font-bold text-navy text-sm sm:text-base">Mobile Number</label>
              {user.phone ? (
                <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                  <IconRenderer name="check" className="w-3.5 h-3.5" /> Added
                </span>
              ) : (
                <span className="text-xs text-amber-600 font-semibold">Action required</span>
              )}
            </div>
            <input
              type="tel"
              className={`input-field ${hasNoPhone ? 'border-amber-300 focus:border-amber-500 bg-amber-50/20' : ''}`}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Enter 10-digit mobile number (e.g. 9876543210)"
              disabled={loading}
            />
            {hasNoPhone && (
              <p className="text-xs text-amber-700 font-medium">
                Please add your mobile number to complete your profile.
              </p>
            )}
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
                  onChange={e => setAddress({ ...address, name: e.target.value })}
                  placeholder="Your full name"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1 sm:space-y-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-600">Email</label>
                <input
                  type="email"
                  className="input-field text-sm"
                  value={address.email}
                  onChange={e => setAddress({ ...address, email: e.target.value })}
                  placeholder="Email address"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1 sm:space-y-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-600">Phone</label>
                <input
                  type="tel"
                  className="input-field text-sm"
                  value={address.phone}
                  onChange={e => setAddress({ ...address, phone: e.target.value })}
                  placeholder="Phone number"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1 sm:space-y-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-600">Pincode</label>
                <input
                  type="text"
                  className="input-field text-sm"
                  value={address.pincode}
                  onChange={e => setAddress({ ...address, pincode: e.target.value })}
                  placeholder="Postal code"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">Address Line 1 *</label>
              <input
                type="text"
                className="input-field text-sm"
                value={address.addressLine1}
                onChange={e => setAddress({ ...address, addressLine1: e.target.value })}
                placeholder="Street address, building, etc."
                disabled={loading}
              />
            </div>

            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">Address Line 2 (Optional)</label>
              <input
                type="text"
                className="input-field text-sm"
                value={address.addressLine2 || ''}
                onChange={e => setAddress({ ...address, addressLine2: e.target.value })}
                placeholder="Apartment, floor, etc."
                disabled={loading}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-1 sm:space-y-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-600">City</label>
                <input
                  type="text"
                  className="input-field text-sm"
                  value={address.city}
                  onChange={e => setAddress({ ...address, city: e.target.value })}
                  placeholder="City"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1 sm:space-y-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-600">State</label>
                <input
                  type="text"
                  className="input-field text-sm"
                  value={address.state}
                  onChange={e => setAddress({ ...address, state: e.target.value })}
                  placeholder="State"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-600">Country</label>
              <input type="text" className="input-field text-sm bg-slate-100" value={address.country} disabled />
            </div>
          </div>

          <div className="p-4 sm:p-6 bg-linear-to-br from-primary/5 to-navy/5 rounded-2xl border border-primary/10 space-y-3 sm:space-y-4">
            <h3 className="font-bold text-navy flex items-center gap-2 text-sm sm:text-base">
              <IconRenderer name="lock" className="w-4 h-4" />
              {isGoogleUser ? 'Set Account Password (Optional)' : 'Change Password (Optional)'}
            </h3>
            <p className="text-xs text-slate-500">
              {isGoogleUser
                ? 'You are signed in with Google. You can set a password if you wish to also sign in using Email and Password.'
                : 'Leave blank if you do not want to change your password.'}
            </p>
            <div className="space-y-1 sm:space-y-2">
              <label className="block text-xs sm:text-sm font-semibold text-slate-500">New Password</label>
              <input
                type="password"
                className="input-field"
                value={newPass}
                onChange={e => setNewPass(e.target.value)}
                placeholder="Leave blank to keep current"
                disabled={loading}
              />
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full py-3 sm:py-4 text-base sm:text-lg">
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </>
  );
}
