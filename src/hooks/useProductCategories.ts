import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { auth, rtdb } from '../firebase';
import { ProductCategory } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { syncManager } from '../utils/syncManager';
import { generateSlug } from '../utils/slugGenerator';
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
  categories: ProductCategory[];
}

/**
 * Hook for loading product categories data
 * JSON-first strategy: loads from generated JSON immediately, falls back to Firebase
 * Auto-syncs JSON after admin CRUD operations
 * Suitable for Store, Home pages
 */
export function useProductCategories() {
  const initialCategories = typeof window !== 'undefined' && Array.isArray((window as any).__INITIAL_DATA__?.productCategories)
    ? (window as any).__INITIAL_DATA__.productCategories
    : [];
  const [productCategories, setProductCategories] = useState<ProductCategory[]>(initialCategories);
  const [loading, setLoading] = useState(initialCategories.length === 0);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isComponentMounted = true;
    let loadedFromJson = false;
    let firebaseReceived = false;

    const loadCategories = async () => {
      try {
        try {
          checkAndInvalidateFormsCache();
        } catch {}

        if (initialCategories.length === 0) {
          const cachedCategories = cacheManager.get('productCategories');
          if (Array.isArray(cachedCategories) && cachedCategories.length > 0 && isComponentMounted) {
            setProductCategories(prev => (isSameJsonList(prev, cachedCategories) ? prev : cachedCategories));
            setLoading(false);
          }
        }

        // STEP 1: Subscribe to live Firebase RTDB immediately
        const categoriesRef = ref(rtdb, 'productCategories');
        unsubscribe = onValue(
          categoriesRef,
          (snapshot) => {
            try {
              firebaseReceived = true;
              const data = snapshot.val();
              const categoriesToSet = data
                ? Object.entries(data).map(([id, val]: [string, any]) => ({
                    id,
                    ...val,
                  }))
                : [];

              if (isComponentMounted) {
                setProductCategories(prev => (isSameJsonList(prev, categoriesToSet) ? prev : categoriesToSet));
                cacheManager.set('productCategories', categoriesToSet);
                syncManager.updateSync('productCategories');
                setLoading(false);
                setError(null);
              }
            } catch (err) {
              const nextError = err instanceof Error ? err : new Error(String(err));
              if (isComponentMounted) {
                setProductCategories(prev => {
                  if (prev.length === 0) setError(nextError);
                  return prev;
                });
                setLoading(false);
              }
            }
          },
          (err) => {
            console.warn('[useProductCategories] Firebase subscription notice:', err);
            const nextError = err instanceof Error ? err : new Error(String(err));
            if (isComponentMounted) {
              setProductCategories(prev => {
                if (prev.length === 0 && !loadedFromJson) setError(nextError);
                return prev;
              });
              setLoading(false);
            }
          }
        );

        // STEP 2: Fetch fresh no-store JSON snapshot in parallel
        try {
          const jsonResponse = await fetchWithTimeout(`/data/product-categories.json?_t=${Date.now()}`, {
            cache: 'no-store',
            timeoutMs: 8000,
          });

          if (jsonResponse.ok) {
            const jsonData: JSONData = await jsonResponse.json();
            if (jsonData && jsonData.categories && Array.isArray(jsonData.categories)) {
              if (isComponentMounted && !firebaseReceived) {
                setProductCategories(prev => (isSameJsonList(prev, jsonData.categories) ? prev : jsonData.categories));
                cacheManager.set('productCategories', jsonData.categories);
                setLoading(false);
                setError(null);
                loadedFromJson = true;
              }
            }
          }
        } catch (jsonError) {
          console.warn('[useProductCategories] JSON fetch notice:', jsonError);
        }
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        if (isComponentMounted) {
          setError(nextError);
          setLoading(false);
        }
      }
    };

    loadCategories();

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
    console.log('[useProductCategories] Triggering JSON sync...');
    const idToken = await auth.currentUser?.getIdToken();
    const response = await fetch('/api/sync-data/categories', {
      method: 'POST',
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
    });
    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.success) {
      const message = result?.error || result?.message || `JSON sync failed (${response.status})`;
      console.error('[useProductCategories] JSON sync failed:', message);
      throw new Error(message);
    }

    console.log('[useProductCategories] JSON sync completed');
  };

  const addProductCategory = async (
    category: Omit<ProductCategory, 'id'>
  ) => {
    let categoryId = generateSlug(category.name);

    // Append timestamp if category with this slug already exists
    const existingCategory = productCategories.find(
      (c) => c.id === categoryId
    );
    if (existingCategory) {
      const timestamp = Date.now().toString().slice(-6);
      categoryId = `${categoryId}-${timestamp}`;
    }

    await set(ref(rtdb, `productCategories/${categoryId}`), {
      ...category,
      id: categoryId,
    });

    // Update local state and cache
    const newCategory = { ...category, id: categoryId } as ProductCategory;
    const updated = [...productCategories, newCategory];
    setProductCategories(updated);
    cacheManager.set('productCategories', updated);
    syncManager.updateSync('productCategories');
    // Sync JSON after Firebase write
    await triggerJsonSync();
  };

  const updateProductCategory = async (
    id: string,
    data: Partial<ProductCategory>
  ) => {
    await update(ref(rtdb, `productCategories/${id}`), data);

    // Update local state and cache
    const updated = productCategories.map((c: ProductCategory) =>
      c.id === id ? { ...c, ...data } : c
    );
    setProductCategories(updated);
    cacheManager.set('productCategories', updated);
    syncManager.updateSync('productCategories');
    // Sync JSON after Firebase write
    await triggerJsonSync();
  };

  const deleteProductCategory = async (id: string) => {
    await remove(ref(rtdb, `productCategories/${id}`));

    // Update local state and cache
    const updated = productCategories.filter((c: ProductCategory) => c.id !== id);
    setProductCategories(updated);
    cacheManager.set('productCategories', updated);
    syncManager.updateSync('productCategories');
    // Sync JSON after Firebase write
    await triggerJsonSync();
  };

  return {
    productCategories,
    loading,
    error,
    retry,
    addProductCategory,
    updateProductCategory,
    deleteProductCategory,
  };
}

