import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { rtdb } from '../firebase';
import { ProductCategory } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { syncManager } from '../utils/syncManager';
import { generateSlug } from '../utils/slugGenerator';

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
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [hasJsonData, setHasJsonData] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isComponentMounted = true;
    let loadedFromJson = false;

    const loadCategories = async () => {
      try {
        // STEP 1: Try to load from generated JSON first (fast, static)
        console.log('[useProductCategories] Attempting to load from JSON...');
        
        try {
          const jsonResponse = await fetch('/data/product-categories.json', {
            cache: 'no-store',
          });
          
          if (jsonResponse.ok) {
            const jsonData: JSONData = await jsonResponse.json();
            if (jsonData && jsonData.categories && Array.isArray(jsonData.categories)) {
              if (isComponentMounted) {
                console.log(`[useProductCategories] Loaded ${jsonData.categories.length} categories from JSON`);
                setProductCategories(jsonData.categories);
                cacheManager.set('productCategories', jsonData.categories);
                setHasJsonData(true);
                setLoading(false);
                setError(null);
                loadedFromJson = true;
              }
            }
          }
        } catch (jsonError) {
          console.warn('[useProductCategories] JSON fetch failed, falling back to Firebase:', jsonError);
        }

        // STEP 2: JSON unavailable or invalid, use Firebase as fallback
        // Also: reload from Firebase if explicit retry or sync threshold exceeded
        const lastSync = syncManager.getLastSync('productCategories');
        const now = Date.now();
        const SYNC_THRESHOLD = 5 * 60 * 1000; // 5 minutes

        if (loadedFromJson || retryCount > 0 || now - lastSync > SYNC_THRESHOLD) {
          console.log('[useProductCategories] Loading from Firebase...');
          const categoriesRef = ref(rtdb, 'productCategories');
          unsubscribe = onValue(
            categoriesRef,
            (snapshot) => {
              try {
                const data = snapshot.val();
                const categoriesToSet = data
                  ? Object.entries(data).map(([id, val]: [string, any]) => ({
                      id,
                      ...val,
                    }))
                  : [];

                if (isComponentMounted) {
                  setProductCategories(categoriesToSet);
                  cacheManager.set('productCategories', categoriesToSet);
                  syncManager.updateSync('productCategories');
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
              console.error('[useProductCategories] Firebase error:', err);
              const error = err instanceof Error ? err : new Error(String(err));
              if (isComponentMounted) {
                setError(error);
                setLoading(false);
              }
            }
          );
        } else {
          // No sync needed, but also no JSON loaded - use cache if available
          const cachedCategories = cacheManager.get('productCategories');
          if (cachedCategories && cachedCategories.length > 0 && isComponentMounted) {
            console.log('[useProductCategories] Using cached categories');
            setProductCategories(cachedCategories);
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
    const response = await fetch('/api/sync-data/categories', {
      method: 'POST',
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

