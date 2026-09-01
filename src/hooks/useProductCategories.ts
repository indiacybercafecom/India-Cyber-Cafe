import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { rtdb } from '../firebase';
import { ProductCategory } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { syncManager } from '../utils/syncManager';
import { generateSlug } from '../utils/slugGenerator';

/**
 * Hook for loading product categories data
 * Cache-first strategy: loads from cache immediately, syncs in background
 * Suitable for Store, Home pages
 */
export function useProductCategories() {
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    // STEP 1: Load from cache immediately
    const cachedCategories = cacheManager.get('productCategories') || [];
    if (cachedCategories.length > 0) {
      setProductCategories(cachedCategories);
      setLoading(false);
    }

    // STEP 2: Check if sync is needed
    const lastSync = syncManager.getLastSync('productCategories');
    const now = Date.now();
    const SYNC_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    // Only fetch from Firebase if sync is needed
    if (now - lastSync > SYNC_THRESHOLD) {
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

            setProductCategories(categoriesToSet);
            cacheManager.set('productCategories', categoriesToSet);
            syncManager.updateSync('productCategories');
            setLoading(false);
            setError(null);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            setError(error);
            setLoading(false);
          }
        },
        (err) => {
          console.error('Error fetching product categories:', err);
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
  };

  const deleteProductCategory = async (id: string) => {
    await remove(ref(rtdb, `productCategories/${id}`));

    // Update local state and cache
    const updated = productCategories.filter((c: ProductCategory) => c.id !== id);
    setProductCategories(updated);
    cacheManager.set('productCategories', updated);
    syncManager.updateSync('productCategories');
  };

  return {
    productCategories,
    loading,
    error,
    addProductCategory,
    updateProductCategory,
    deleteProductCategory,
  };
}
