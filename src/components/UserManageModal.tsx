import React, { useState } from 'react';
import { UserProfile, UserRole } from '../types';
import { IconRenderer } from './Icons';
import { motion } from 'motion/react';
import { auth, rtdb } from '../firebase';
import { ref, update, remove } from 'firebase/database';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { showToast } from './Toast';
import { ConfirmationModal } from './ConfirmationModal';
import { trimWhitespace, sanitizePhone } from '../utils/sanitizer';

interface UserManageModalProps {
  user: UserProfile | null;
  onClose: () => void;
}

export function UserManageModal({ user, onClose }: UserManageModalProps) {
  const [name, setName] = useState(user?.name || '');
  const [role, setRole] = useState<UserRole>(user?.role || 'user');
  const [password, setPassword] = useState(user?.password || '');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  if (!user) return null;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Sanitize user data before updating
      const sanitizedName = trimWhitespace(name);
      const sanitizedPassword = trimWhitespace(password);

      await update(ref(rtdb, `users/${user.uid}`), { 
        name: sanitizedName, 
        role, 
        password: sanitizedPassword 
      });
      showToast('User updated successfully!');
      onClose();
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginAsUser = async () => {
    if (!user.password) {
      showToast('No password stored for this user. Cannot login as user.', 'error');
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, user.email, user.password);
      showToast(`Logged in as ${user.name}`);
      window.location.href = '/'; // Force reload to apply new auth state
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await remove(ref(rtdb, `users/${user.uid}`));
      showToast('User deleted successfully!');
      onClose();
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-2xl relative overflow-hidden shadow-2xl max-h-[90vh] flex flex-col sm:max-h-[80vh]"
      >
        <div className="sticky top-0 z-10 p-4 sm:p-6 bg-navy text-white flex justify-between items-center">
          <h3 className="text-xl sm:text-2xl font-bold">Manage User</h3>
          <button onClick={onClose} className="hover:rotate-90 transition-all">
            <IconRenderer name="x" className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
          <div className="text-center">
            <img src={user.avatar} className="w-20 h-20 sm:w-24 sm:h-24 rounded-full mx-auto border-4 border-primary shadow-lg object-cover" />
            <p className="text-slate-400 mt-2 text-xs sm:text-sm break-all">{user.email}</p>
          </div>

          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase">Name</label>
              <input 
                type="text" 
                className="input-field py-2" 
                value={name} 
                onChange={e => setName(e.target.value)} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase">Role</label>
              <select 
                className="input-field py-2" 
                value={role} 
                onChange={e => setRole(e.target.value as UserRole)}
              >
                <option value="user">User</option>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="space-y-1 relative">
              <label className="text-xs font-bold text-slate-400 uppercase">Password</label>
              <div className="relative">
                <input 
                  type={showPass ? 'text' : 'password'} 
                  className="input-field py-2 pr-10" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                />
                <button 
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors"
                >
                  <IconRenderer name={showPass ? 'eye' : 'eye-slash'} className="w-4 h-4" />
                </button>
              </div>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="btn-primary w-full py-2 sm:py-3 text-sm sm:text-base"
            >
              {loading ? 'Updating...' : 'Update User'}
            </button>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button 
              onClick={handleLoginAsUser}
              disabled={loading}
              className="py-2 sm:py-3 bg-navy text-white font-bold rounded-xl transition-all hover:bg-navy-light flex items-center justify-center gap-2 text-xs sm:text-sm"
            >
              <IconRenderer name="right-to-bracket" className="w-4 h-4" />
              <span>Login as User</span>
            </button>
            <button 
              onClick={() => setIsDeleteConfirmOpen(true)}
              disabled={loading}
              className="py-2 sm:py-3 text-red-500 font-bold hover:bg-red-50 rounded-xl transition-all border border-red-100 text-xs sm:text-sm"
            >
              Delete User
            </button>
          </div>
        </div>

        <ConfirmationModal 
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          onConfirm={handleDelete}
          title="Delete User"
          message={`Are you sure you want to delete ${user.name}? This will permanently remove their account from the system.`}
          type="danger"
        />
      </motion.div>
    </div>
  );
}
