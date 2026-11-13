import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove, push } from 'firebase/database';
import { rtdb } from '../firebase';
import { Service } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { syncManager } from '../utils/syncManager';
import { checkAndInvalidateFormsCache } from '../utils/cacheVersionManager';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

function isSameJsonList<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

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
  const initialServices = typeof window !== 'undefined' && Array.isArray((window as any).__INITIAL_DATA__?.services)
    ? (window as any).__INITIAL_DATA__.services
    : [];
  const [services, setServices] = useState<Service[]>(initialServices);
  const [loading, setLoading] = useState(initialServices.length === 0);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isComponentMounted = true;
    let loadedFromJson = false;
    let firebaseReceived = false;

    const loadServices = async () => {
      try {
        try {
          checkAndInvalidateFormsCache();
        } catch {}

        // If no server-injected initial data, seed immediately from valid cache while fetching fresh JSON/RTDB
        if (initialServices.length === 0) {
          const cachedServices = cacheManager.get('services');
          if (Array.isArray(cachedServices) && cachedServices.length > 0 && isComponentMounted) {
            setServices(prev => (isSameJsonList(prev, cachedServices) ? prev : cachedServices));
            setLoading(false);
          }
        }

        // STEP 1: Subscribe to live Firebase RTDB immediately so live data takes precedence when available
        const servicesRef = ref(rtdb, 'services');
        unsubscribe = onValue(
          servicesRef,
          (snapshot) => {
            try {
              firebaseReceived = true;
              const data = snapshot.val();
              const servicesToSet = data
                ? Object.entries(data).map(([id, val]: [string, any]) => ({
                    id,
                    ...val,
                  }))
                : [];

              if (isComponentMounted) {
                setServices(prev => (isSameJsonList(prev, servicesToSet) ? prev : servicesToSet));
                cacheManager.set('services', servicesToSet);
                syncManager.updateSync('services');
                setLoading(false);
                setError(null);
              }
            } catch (err) {
              const nextError = err instanceof Error ? err : new Error(String(err));
              if (isComponentMounted) {
                setServices(prev => {
                  if (prev.length === 0) setError(nextError);
                  return prev;
                });
                setLoading(false);
              }
            }
          },
          (err) => {
            console.warn('[useServices] Firebase subscription notice:', err);
            const nextError = err instanceof Error ? err : new Error(String(err));
            if (isComponentMounted) {
              setServices(prev => {
                if (prev.length === 0 && !loadedFromJson) setError(nextError);
                return prev;
              });
              setLoading(false);
            }
          }
        );

        // STEP 2: Fetch fresh no-store JSON snapshot in parallel (faster initial update if RTDB socket is still connecting)
        try {
          const jsonResponse = await fetchWithTimeout(`/data/services.json?_t=${Date.now()}`, {
            cache: 'no-store',
            timeoutMs: 8000,
          });

          if (jsonResponse.ok) {
            const jsonData: JSONData = await jsonResponse.json();
            if (jsonData && jsonData.services && Array.isArray(jsonData.services)) {
              if (isComponentMounted && !firebaseReceived) {
                setServices(prev => (isSameJsonList(prev, jsonData.services) ? prev : jsonData.services));
                cacheManager.set('services', jsonData.services);
                setLoading(false);
                setError(null);
                loadedFromJson = true;
              }
            }
          }
        } catch (jsonError) {
          console.warn('[useServices] JSON fetch notice:', jsonError);
        }
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        if (isComponentMounted) {
          setError(nextError);
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

  const triggerJsonSync = async () => {
    try {
      console.log('[useServices] Triggering JSON sync...');
      const response = await fetch('/api/sync-data/services', {
        method: 'POST',
      });
      if (response.ok) {
        console.log('[useServices] JSON sync completed');
      } else {
        console.warn('[useServices] JSON sync returned non-ok status:', response.status);
      }
    } catch (err) {
      console.error('[useServices] Error triggering JSON sync:', err);
    }
  };

  const addService = async (service: Service) => {
    await set(ref(rtdb, `services/${service.id}`), service);
    // Update local state and cache
    const updated = [...services, service];
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
    await triggerJsonSync();
  };

  const updateService = async (id: string, data: Partial<Service>) => {
    await update(ref(rtdb, `services/${id}`), data);
    // Update local state and cache
    const updated = services.map((s) => s.id === id ? { ...s, ...data } : s);
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
    await triggerJsonSync();
  };

  const deleteService = async (id: string) => {
    await remove(ref(rtdb, `services/${id}`));
    // Update local state and cache
    const updated = services.filter((s) => s.id !== id);
    setServices(updated);
    cacheManager.set('services', updated);
    syncManager.updateSync('services');
    await triggerJsonSync();
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

