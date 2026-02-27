import React, { useState } from 'react';
import { UserProfile, UserRole } from '../types';
import { IconRenderer } from './Icons';
import { motion } from 'motion/react';
import { rtdb } from '../firebase';
import { ref, update, remove } from 'firebase/database';
import { showToast } from './Toast';

interface UserManageModalProps {
  user: UserProfile | null;
  onClose: () => void;
}

export function UserManageModal({ user, onClose }: UserManageModalProps) {
  const [name, setName] = useState(user?.name || '');
  const [role, setRole] = useState<UserRole>(user?.role || 'user');
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await update(ref(rtdb, `users/${user.uid}`), { name, role });
      showToast('User updated successfully!');
      onClose();
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this user?')) return;
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-md relative overflow-hidden shadow-2xl"
      >
        <div className="p-6 bg-navy text-white flex justify-between items-center">
          <h3 className="text-xl font-bold">Manage User</h3>
          <button onClick={onClose} className="hover:rotate-90 transition-all">
            <IconRenderer name="x" className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="text-center">
            <img src={user.avatar} className="w-24 h-24 rounded-full mx-auto border-4 border-primary shadow-lg object-cover" />
            <p className="text-slate-400 mt-2 text-sm">{user.email}</p>
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
            <button 
              type="submit" 
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? 'Updating...' : 'Update User'}
            </button>
          </form>

          <button 
            onClick={handleDelete}
            disabled={loading}
            className="w-full py-3 text-red-500 font-bold hover:bg-red-50 rounded-xl transition-all"
          >
            Delete User
          </button>
        </div>
      </motion.div>
    </div>
  );
}
