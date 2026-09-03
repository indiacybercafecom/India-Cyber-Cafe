import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove, push } from 'firebase/database';
import { rtdb } from '../firebase';
import { Service } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { syncManager } from '../utils/syncManager';

interface JSONData {
  version: number;
  generatedAt: string;
  services: Service[];
}

/**
 * Hook for loading public services data
 * JSON-first strategy: loads from generated JSON immediately, falls back to Firebase
 * Auto-syncs JSON after admin CRUD operations
 * Suitable for Home, Services, ServiceDetail pages
 */
export function useServices() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [hasJsonData, setHasJsonData] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isComponentMounted = true;
    let loadedFromJson = false;

    const loadServices = async () => {
      try {
        // STEP 1: Try to load from generated JSON first (fast, static)
        console.log('[useServices] Attempting to load from JSON...');
        
        try {
          const jsonResponse = await fetch('/data/services.json', {
            cache: 'no-store',
          });
          
          if (jsonResponse.ok) {
            const jsonData: JSONData = await jsonResponse.json();
            if (jsonData && jsonData.services && Array.isArray(jsonData.services)) {
              if (isComponentMounted) {
                console.log(`[useServices] Loaded ${jsonData.services.length} services from JSON`);
                setServices(jsonData.services);
                cacheManager.set('services', jsonData.services);
                setHasJsonData(true);
                setLoading(false);
                setError(null);
                loadedFromJson = true;
              }
            }
          }
        } catch (jsonError) {
          console.warn('[useServices] JSON fetch failed, falling back to Firebase:', jsonError);
        }

        // STEP 2: JSON unavailable or invalid, use Firebase as fallback
        // Also: reload from Firebase if explicit retry or sync threshold exceeded
        const lastSync = syncManager.getLastSync('services');
        const now = Date.now();
        const SYNC_THRESHOLD = 5 * 60 * 1000; // 5 minutes

        if (loadedFromJson || retryCount > 0 || now - lastSync > SYNC_THRESHOLD) {
          console.log('[useServices] Loading from Firebase...');
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

                if (isComponentMounted) {
                  setServices(servicesToSet);
                  cacheManager.set('services', servicesToSet);
                  syncManager.updateSync('services');
                  setLoading(false);
                  setError(null);
                }
              } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                if (isComponentMounted) {
                  setError(error);
                  setLoading(false);
                }
              }
            },
            (err) => {
              console.error('[useServices] Firebase error:', err);
              const error = err instanceof Error ? err : new Error(String(err));
              if (isComponentMounted) {
                setError(error);
                setLoading(false);
              }
            }
          );
        } else {
          // No sync needed, but also no JSON loaded - use cache if available
          const cachedServices = cacheManager.get('services');
          if (cachedServices && cachedServices.length > 0 && isComponentMounted) {
            console.log('[useServices] Using cached services');
            setServices(cachedServices);
            setLoading(false);
          } else if (isComponentMounted) {
            setLoading(false);
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (isComponentMounted) {
          setError(error);
          setLoading(false);
        }
      }
    };

    loadServices();

    return () => {
      isComponentMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [retryCount]);

  const retry = () => {
    setError(null);
    setLoading(true);
    setRetryCount((count) => count + 1);
  };

  const addService = async (service: Service) => {
    await set(ref(rtdb, `services/${service.id}`), service);
    // Update local state and cache
    const updated = [...services, service];
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
  };

  const updateService = async (id: string, data: Partial<Service>) => {
    await update(ref(rtdb, `services/${id}`), data);
    // Update local state and cache
    const updated = services.map((s) => s.id === id ? { ...s, ...data } : s);
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
  };

  const deleteService = async (id: string) => {
    await remove(ref(rtdb, `services/${id}`));
    // Update local state and cache
    const updated = services.filter((s) => s.id !== id);
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
  };

  return {
    services,
    loading,
    error,
    retry,
    addService,
    updateService,
    deleteService,
  };
}

