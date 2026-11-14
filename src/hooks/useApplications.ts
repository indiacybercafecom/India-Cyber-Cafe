import { useState, useEffect } from 'react';
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
} from 'firebase/database';
import { rtdb } from '../firebase';
import { Application } from '../types';
import { isAssignedToOperator } from '../utils/permissions';

const PAGINATION_LIMIT = 50;

/**
 * Hook for loading applications data
 * - disabled: does not subscribe
 * - user: loads only applications belonging to that user
 * - admin: loads all applications
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

  useEffect(() => {
    if (options.mode === 'disabled') {
      setApplications([]);
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
          // Admin: load all applications
          const appsRef = query(ref(rtdb, 'applications'), orderByChild('date'));
          unsubscribe = onValue(
            appsRef,
            (snapshot) => {
              try {
                const data = snapshot.val();
                if (data) {
                  const apps = Object.entries(data)
                    .map(([id, val]: [string, any]) => ({
                      id,
                      ...val,
                    } as Application))
                    .reverse()
                    .slice(0, PAGINATION_LIMIT);

                  setApplications(apps);
                  setError(null);
                } else {
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
          const appsRef = query(
            ref(rtdb, 'applications'),
            orderByChild('uid'),
            equalTo(uid)
          );
          unsubscribe = onValue(
            appsRef,
            (snapshot) => {
              try {
                const data = snapshot.val();
                const apps: Application[] = data
                  ? Object.entries(data)
                      .map(([id, val]: [string, any]) => ({
                        id,
                        ...val,
                      } as Application))
                      .reverse()
                  : [];

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

          const uidQuery = query(
            ref(rtdb, 'applications'),
            orderByChild('assignedToUid'),
            equalTo(options.uid)
          );
          assignedByUidUnsubscribe = onValue(
            uidQuery,
            (snapshot) => {
              const data = snapshot.val();
              const validAssigned: Application[] = data
                ? Object.entries(data)
                    .map(([id, val]: [string, any]) => ({ id, ...val } as Application))
                    .filter((app) => isAssignedToOperator(app, operatorIdentity))
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                : [];
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
    addApplication,
    updateApplication,
    deleteApplication,
  };
}
