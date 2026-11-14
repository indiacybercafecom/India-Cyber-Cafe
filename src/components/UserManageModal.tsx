import React, { useEffect, useState } from 'react';
import { UserProfile, UserRole } from '../types';
import { IconRenderer } from './Icons';
import { SelectDropdown } from './SelectDropdown';
import { motion } from 'motion/react';
import { rtdb } from '../firebase';
import { ref, update, remove } from 'firebase/database';
import { showToast } from './Toast';
import { ConfirmationModal } from './ConfirmationModal';
import { trimWhitespace } from '../utils/sanitizer';
import { isSuperAdmin } from '../utils/permissions';
import { UserAvatar } from './UserAvatar';

interface UserManageModalProps {
  user: UserProfile | null;
  onClose: () => void;
}

export function UserManageModal({ user, onClose }: UserManageModalProps) {
  const [name, setName] = useState(user?.name || '');
  const [role, setRole] = useState<UserRole>(user?.role || 'user');
  const [disabled, setDisabled] = useState<boolean>(Boolean(user?.disabled === true));
  const [loading, setLoading] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    setName(user?.name || '');
    setRole(user?.role || 'user');
    setDisabled(Boolean(user?.disabled === true));
  }, [user]);

  if (!user) return null;

  const targetIsSuperAdmin = isSuperAdmin(user);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const sanitizedName = trimWhitespace(name);
      const nextRole: UserRole = targetIsSuperAdmin ? 'admin' : role;
      const nextDisabled = targetIsSuperAdmin ? false : Boolean(disabled);

      await update(ref(rtdb, `users/${user.uid}`), {
        name: sanitizedName,
        role: nextRole,
        disabled: nextDisabled,
        updatedAt: Date.now(),
      });
      showToast('User updated successfully!');
      onClose();
    } catch (error: any) {
      showToast(error, 'error', 'Failed to update user. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (targetIsSuperAdmin) {
      showToast('Super Admin account cannot be deleted.', 'error');
      return;
    }
    setLoading(true);
    try {
      await remove(ref(rtdb, `users/${user.uid}`));
      showToast('User deleted successfully!');
      onClose();
    } catch (error: any) {
      showToast(error, 'error', 'Failed to delete user. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-2 sm:p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-2xl relative overflow-hidden shadow-2xl flex flex-col max-h-[98vh] sm:max-h-[95vh]"
      >
        <div className="p-4 sm:p-6 bg-white border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-xl sm:text-2xl font-bold text-navy">Manage User</h3>
          <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-all">
            <IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
          <div className="text-center">
            <UserAvatar user={user} className="w-20 h-20 sm:w-24 sm:h-24 rounded-full mx-auto border-4 border-primary shadow-lg object-cover" />
            <p className="text-slate-400 mt-2 text-xs sm:text-sm break-all">{user.email}</p>
            {targetIsSuperAdmin && (
              <span className="inline-block mt-2 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                Super Admin (Protected)
              </span>
            )}
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
              <SelectDropdown
                className="input-field py-2"
                value={targetIsSuperAdmin ? 'admin' : role}
                onChange={value => {
                  if (!targetIsSuperAdmin) setRole(value as UserRole);
                }}
                options={
                  targetIsSuperAdmin
                    ? [{ value: 'admin', label: 'Admin (Super Admin)' }]
                    : [
                        { value: 'user', label: 'User' },
                        { value: 'operator', label: 'Operator' },
                        { value: 'admin', label: 'Admin' },
                      ]
                }
              />
            </div>

            {!targetIsSuperAdmin && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Account Status</label>
                <SelectDropdown
                  className="input-field py-2"
                  value={disabled ? 'disabled' : 'active'}
                  onChange={value => setDisabled(value === 'disabled')}
                  options={[
                    { value: 'active', label: 'Active (Enabled)' },
                    { value: 'disabled', label: 'Disabled (Revoked Access)' },
                  ]}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2 sm:py-3 text-sm sm:text-base"
            >
              {loading ? 'Updating...' : 'Update User'}
            </button>
          </form>

          {!targetIsSuperAdmin && (
            <div className="pt-2 border-t border-slate-100">
              <button
                onClick={() => setIsDeleteConfirmOpen(true)}
                disabled={loading}
                className="w-full py-2 sm:py-3 text-red-500 font-bold hover:bg-red-50 rounded-xl transition-all border border-red-100 text-xs sm:text-sm"
              >
                Delete User
              </button>
            </div>
          )}
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
