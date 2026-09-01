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
 * - Without uid: loads all applications (admin use)
 * - With uid: loads only applications belonging to that user
 * - Optional operatorEmail: also includes applications assigned to that operator
 * Real-time updates are maintained for the current filter
 * 
 * If uid is null, does not subscribe (useful for conditional loading)
 */
export function useApplications(uid?: string | null, operatorEmail?: string) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Don't subscribe if uid is explicitly null (used to conditionally disable loading)
    if (uid === null) {
      setApplications([]);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const loadApplications = () => {
      try {
        setLoading(true);

        if (uid === undefined) {
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
        } else if (uid) {
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
                if (operatorEmail) {
                  const appsRef2 = query(
                    ref(rtdb, 'applications'),
                    orderByChild('assignedTo'),
                    equalTo(operatorEmail)
                  );
                  onValue(
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
                        setApplications(merged.sort((a, b) => (b.date || 0) - (a.date || 0)));
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
    };
  }, [uid, operatorEmail]);

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
        } else {
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
                if (operatorEmail) {
                  const appsRef2 = query(
                    ref(rtdb, 'applications'),
                    orderByChild('assignedTo'),
                    equalTo(operatorEmail)
                  );
                  onValue(
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
                        setApplications(merged.sort((a, b) => (b.date || 0) - (a.date || 0)));
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
    };
  }, [uid, operatorEmail]);

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
