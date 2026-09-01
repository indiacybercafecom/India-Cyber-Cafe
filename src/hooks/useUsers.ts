import { useState, useEffect } from 'react';
import { ref, onValue, update, remove } from 'firebase/database';
import { rtdb } from '../firebase';
import { UserProfile } from '../types';

const PAGINATION_LIMIT = 200;

/**
 * Hook for loading users data (admin only)
 * Loads all user profiles from the database
 * Real-time updates are maintained
 */
export function useUsers(enabled = false) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const loadUsers = () => {
      try {
        setLoading(true);

        const usersRef = ref(rtdb, 'users');
        unsubscribe = onValue(
          usersRef,
          (snapshot) => {
            try {
              const data = snapshot.val();
              let users: UserProfile[] = [];

              if (data) {
                users = Object.entries(data)
                  .map(([uid, val]: [string, any]) => ({
                    uid,
                    ...val,
                  } as UserProfile))
                  .slice(0, PAGINATION_LIMIT);
              }

              setUsers(users);
              setError(null);
              setLoading(false);
            } catch (err) {
              const error =
                err instanceof Error ? err : new Error(String(err));
              setError(error);
              setLoading(false);
            }
          },
          (err) => {
            console.error('Error fetching users:', err);
            const error = err instanceof Error ? err : new Error(String(err));
            setError(error);
            setLoading(false);
          }
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setLoading(false);
      }
    };

    loadUsers();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [enabled]);

  const updateUser = async (uid: string, data: Partial<UserProfile>) => {
    return await update(ref(rtdb, `users/${uid}`), data);
  };

  const deleteUser = async (uid: string) => {
    return await remove(ref(rtdb, `users/${uid}`));
  };

  return {
    users,
    loading,
    error,
    updateUser,
    deleteUser,
  };
}
