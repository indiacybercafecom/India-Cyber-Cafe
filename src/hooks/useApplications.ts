import { useState, useEffect, useCallback } from 'react';
import {
  ref,
  onValue,
  update,
  remove,
  push,
  set,
  query,
  orderByChild,
  equalTo,
  limitToLast,
} from 'firebase/database';
import { rtdb } from '../firebase';
import { Application } from '../types';
import { isAssignedToOperator } from '../utils/permissions';

const INITIAL_LIMIT = 50;
const PAGE_STEP = 50;

/**
 * Hook for loading applications data with indexed server-side limitToLast queries
 * - disabled: does not subscribe
 * - user: loads only applications belonging to that user
 * - admin: loads paginated applications ordered by date
 * - operator: loads strictly applications assigned to that operator (canonically by assignedToUid)
 */
export type ApplicationLoadOptions =
  | { mode: 'disabled' }
  | { mode: 'user'; uid: string }
  | { mode: 'admin' }
  | { mode: 'operator'; uid: string; operatorEmail?: string };

export function useApplications(options: ApplicationLoadOptions) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(options.mode !== 'disabled');
  const [error, setError] = useState<Error | null>(null);
  const [limitCount, setLimitCount] = useState(INITIAL_LIMIT);
  const [hasMore, setHasMore] = useState(false);

  const loadMore = useCallback(() => {
    setLimitCount((prev) => prev + PAGE_STEP);
  }, []);

  useEffect(() => {
    setLimitCount(INITIAL_LIMIT);
  }, [options.mode, options.mode === 'user' || options.mode === 'operator' ? options.uid : null]);

  useEffect(() => {
    if (options.mode === 'disabled') {
      setApplications([]);
      setHasMore(false);
      setLoading(false);
      setError(null);
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let assignedByUidUnsubscribe: (() => void) | null = null;

    const loadApplications = () => {
      try {
        setLoading(true);
        setError(null);

        if (options.mode === 'admin') {
          const appsRef = query(ref(rtdb, 'applications'), orderByChild('date'), limitToLast(limitCount));
          unsubscribe = onValue(
            appsRef,
            (snapshot) => {
              try {
                const data = snapshot.val();
                if (data) {
                  const entries = Object.entries(data);
                  const apps = entries
                    .map(([id, val]: [string, any]) => ({
                      id,
                      ...val,
                    } as Application))
                    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

                  setHasMore(entries.length >= limitCount);
                  setApplications(apps);
                  setError(null);
                } else {
                  setHasMore(false);
                  setApplications([]);
                }
                setLoading(false);
              } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                setError(error);
                setLoading(false);
              }
            },
            (err) => {
              console.error('Error fetching applications:', err);
              const error = err instanceof Error ? err : new Error(String(err));
              setError(error);
              setLoading(false);
            }
          );
        } else if (options.mode === 'user') {
          const uid = options.uid;
          const userLimit = Math.max(100, limitCount);
          const appsRef = query(
            ref(rtdb, 'applications'),
            orderByChild('uid'),
            equalTo(uid),
            limitToLast(userLimit)
          );
          unsubscribe = onValue(
            appsRef,
            (snapshot) => {
              try {
                const data = snapshot.val();
                const entries = data ? Object.entries(data) : [];
                const apps: Application[] = entries
                  .map(([id, val]: [string, any]) => ({
                    id,
                    ...val,
                  } as Application))
                  .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

                setHasMore(entries.length >= userLimit);
                setApplications(apps);
                setError(null);
                setLoading(false);
              } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                setError(error);
                setLoading(false);
              }
            },
            (err) => {
              console.error('Error fetching user applications:', err);
              const error = err instanceof Error ? err : new Error(String(err));
              setError(error);
              setLoading(false);
            }
          );
        } else if (options.mode === 'operator') {
          const operatorIdentity = {
            uid: options.uid,
            email: options.operatorEmail,
            disabled: false,
          };
          const opLimit = Math.max(100, limitCount);

          const uidQuery = query(
            ref(rtdb, 'applications'),
            orderByChild('assignedToUid'),
            equalTo(options.uid),
            limitToLast(opLimit)
          );
          assignedByUidUnsubscribe = onValue(
            uidQuery,
            (snapshot) => {
              const data = snapshot.val();
              const entries = data ? Object.entries(data) : [];
              const validAssigned: Application[] = entries
                .map(([id, val]: [string, any]) => ({ id, ...val } as Application))
                .filter((app) => isAssignedToOperator(app, operatorIdentity))
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              setHasMore(entries.length >= opLimit);
              setApplications(validAssigned);
              setError(null);
              setLoading(false);
            },
            (err) => {
              console.error('Error fetching operator UID-assigned applications:', err);
              setError(err instanceof Error ? err : new Error(String(err)));
              setLoading(false);
            }
          );
        } else {
          setLoading(false);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setLoading(false);
      }
    };

    loadApplications();

    return () => {
      if (unsubscribe) unsubscribe();
      if (assignedByUidUnsubscribe) assignedByUidUnsubscribe();
    };
  }, [
    options.mode,
    options.mode === 'user' || options.mode === 'operator' ? options.uid : null,
    limitCount,
  ]);

  const addApplication = async (app: Omit<Application, 'id'>) => {
    const newAppRef = push(ref(rtdb, 'applications'));
    return await set(newAppRef, app);
  };

  const updateApplication = async (id: string, data: Partial<Application>) => {
    return await update(ref(rtdb, `applications/${id}`), data);
  };

  const deleteApplication = async (id: string) => {
    return await remove(ref(rtdb, `applications/${id}`));
  };

  return {
    applications,
    loading,
    error,
    hasMore,
    loadMore,
    addApplication,
    updateApplication,
    deleteApplication,
  };
}
