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

const PAGINATION_LIMIT = 50;

/**
 * Hook for loading applications data
 * - disabled: does not subscribe
 * - user: loads only applications belonging to that user
 * - admin: loads all applications
 * - operator: loads the user's applications and applications assigned to them
 * Real-time updates are maintained for the current filter
 * 
 * If uid is null, does not subscribe (useful for conditional loading)
 */
export type ApplicationLoadOptions =
  | { mode: 'disabled' }
  | { mode: 'user'; uid: string }
  | { mode: 'admin' }
  | { mode: 'operator'; uid: string; operatorEmail: string };

export function useApplications(options: ApplicationLoadOptions) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(options.mode !== 'disabled');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (options.mode === 'disabled') {
      setApplications([]);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let assignedUnsubscribe: (() => void) | null = null;

    const loadApplications = () => {
      try {
        setLoading(true);

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
        } else if (options.mode === 'user' || options.mode === 'operator') {
          const uid = options.uid;
          // User: load only their applications
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
                let apps: Application[] = [];

                if (data) {
                  apps = Object.entries(data)
                    .map(([id, val]: [string, any]) => ({
                      id,
                      ...val,
                    } as Application))
                    .reverse();
                }

                // If user is operator, also include applications assigned to them
                if (options.mode === 'operator') {
                  const appsRef2 = query(
                    ref(rtdb, 'applications'),
                    orderByChild('assignedTo'),
                    equalTo(options.operatorEmail)
                  );
                  assignedUnsubscribe = onValue(
                    appsRef2,
                    (snapshot2) => {
                      const data2 = snapshot2.val();
                      if (data2) {
                        const assignedApps = Object.entries(data2).map(
                          ([id, val]: [string, any]) => ({
                            id,
                            ...val,
                          } as Application)
                        );
                        // Merge and deduplicate
                        const merged = [...apps];
                        for (const app of assignedApps) {
                          if (!merged.find((a) => a.id === app.id)) {
                            merged.push(app);
                          }
                        }
                        setApplications(merged.sort((a, b) =>
                          new Date(b.date).getTime() - new Date(a.date).getTime()
                        ));
                      } else {
                        setApplications(apps);
                      }
                    },
                    (err) => {
                      console.error('Error fetching assigned applications:', err);
                      setApplications(apps);
                    }
                  );
                } else {
                  setApplications(apps);
                }

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
      if (assignedUnsubscribe) assignedUnsubscribe();
    };
  }, [
    options.mode,
    options.mode === 'user' || options.mode === 'operator' ? options.uid : null,
    options.mode === 'operator' ? options.operatorEmail : null,
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
