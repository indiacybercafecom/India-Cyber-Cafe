import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, update, remove, query, orderByChild, limitToLast } from 'firebase/database';
import { rtdb } from '../firebase';
import { UserProfile } from '../types';

const INITIAL_LIMIT = 200;
const PAGE_STEP = 200;

/**
 * Hook for loading users data (admin only)
 * Uses indexed limitToLast RTDB queries with pagination.
 */
export function useUsers(enabled = false) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [limitCount, setLimitCount] = useState(INITIAL_LIMIT);
  const [hasMore, setHasMore] = useState(false);

  const loadMore = useCallback(() => {
    setLimitCount((prev) => prev + PAGE_STEP);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const loadUsers = () => {
      try {
        setLoading(true);

        const usersRef = query(ref(rtdb, 'users'), orderByChild('createdAt'), limitToLast(limitCount));
        unsubscribe = onValue(
          usersRef,
          (snapshot) => {
            try {
              const data = snapshot.val();
              let usersList: UserProfile[] = [];

              if (data) {
                const entries = Object.entries(data);
                setHasMore(entries.length >= limitCount);
                usersList = entries
                  .map(([uid, val]: [string, any]) => ({
                    uid,
                    ...val,
                  } as UserProfile))
                  .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
              } else {
                setHasMore(false);
              }

              setUsers(usersList);
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
  }, [enabled, limitCount]);

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
    hasMore,
    loadMore,
    updateUser,
    deleteUser,
  };
}
