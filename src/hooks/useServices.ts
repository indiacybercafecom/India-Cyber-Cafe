import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove, push } from 'firebase/database';
import { rtdb } from '../firebase';
import { Service } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { syncManager } from '../utils/syncManager';

/**
 * Hook for loading public services data
 * Cache-first strategy: loads from cache immediately, syncs in background
 * Suitable for Home, Services, ServiceDetail pages
 */
export function useServices() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    // STEP 1: Load from cache immediately
    const cachedServices = cacheManager.get('services') || [];
    if (cachedServices.length > 0) {
      setServices(cachedServices);
      setLoading(false);
    }

    // STEP 2: Check if sync is needed
    const lastSync = syncManager.getLastSync('services');
    const now = Date.now();
    const SYNC_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    // Only fetch from Firebase if sync is needed
    if (now - lastSync > SYNC_THRESHOLD) {
      const servicesRef = ref(rtdb, 'services');
      unsubscribe = onValue(
        servicesRef,
        (snapshot) => {
          try {
            const data = snapshot.val();
            const servicesToSet = data
              ? Object.entries(data).map(([id, val]: [string, any]) => ({
                  id,
                  ...val,
                }))
              : [];

            setServices(servicesToSet);
            cacheManager.set('services', servicesToSet);
            syncManager.updateSync('services');
            setLoading(false);
            setError(null);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            setError(error);
            setLoading(false);
          }
        },
        (err) => {
          console.error('Error fetching services:', err);
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          setLoading(false);
        }
      );
    } else {
      // No sync needed, cached data is fresh
      setLoading(false);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const addService = async (service: Service) => {
    await set(ref(rtdb, `services/${service.id}`), service);
    // Update cache
    const updated = [...services, service];
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
  };

  const updateService = async (id: string, data: Partial<Service>) => {
    await update(ref(rtdb, `services/${id}`), data);
    // Update cache
    const updated = services.map((s) => s.id === id ? { ...s, ...data } : s);
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
  };

  const deleteService = async (id: string) => {
    await remove(ref(rtdb, `services/${id}`));
    // Update cache
    const updated = services.filter((s) => s.id !== id);
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
  };

  return {
    services,
    loading,
    error,
    addService,
    updateService,
    deleteService,
  };
}
