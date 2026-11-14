import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { auth, rtdb } from '../firebase';
import { Product } from '../types';
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
  products: Product[];
}

/**
 * Hook for loading public products data
 * JSON-first strategy: loads from generated JSON immediately, falls back to Firebase
 * Auto-syncs JSON after admin CRUD operations
 * Suitable for Store, StoreProduct, Home pages
 */
export function useProducts() {
  const initialProducts = typeof window !== 'undefined' && Array.isArray((window as any).__INITIAL_DATA__?.products)
    ? (window as any).__INITIAL_DATA__.products
    : [];
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [loading, setLoading] = useState(initialProducts.length === 0);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isComponentMounted = true;
    let loadedFromJson = false;
    let firebaseReceived = false;

    const loadProducts = async () => {
      try {
        try {
          checkAndInvalidateFormsCache();
        } catch {}

        if (initialProducts.length === 0) {
          const cachedProducts = cacheManager.get('products');
          if (Array.isArray(cachedProducts) && cachedProducts.length > 0 && isComponentMounted) {
            setProducts(prev => (isSameJsonList(prev, cachedProducts) ? prev : cachedProducts));
            setLoading(false);
          }
        }

        // STEP 1: Subscribe to live Firebase RTDB immediately
        const productsRef = ref(rtdb, 'products');
        unsubscribe = onValue(
          productsRef,
          (snapshot) => {
            try {
              firebaseReceived = true;
              const data = snapshot.val();
              const productsToSet = data
                ? Object.entries(data).map(([id, val]: [string, any]) => ({
                    id,
                    ...val,
                  }))
                : [];

              if (isComponentMounted) {
                setProducts(prev => (isSameJsonList(prev, productsToSet) ? prev : productsToSet));
                cacheManager.set('products', productsToSet);
                syncManager.updateSync('products');
                setLoading(false);
                setError(null);
              }
            } catch (err) {
              const nextError = err instanceof Error ? err : new Error(String(err));
              if (isComponentMounted) {
                setProducts(prev => {
                  if (prev.length === 0) setError(nextError);
                  return prev;
                });
                setLoading(false);
              }
            }
          },
          (err) => {
            console.warn('[useProducts] Firebase subscription notice:', err);
            const nextError = err instanceof Error ? err : new Error(String(err));
            if (isComponentMounted) {
              setProducts(prev => {
                if (prev.length === 0 && !loadedFromJson) setError(nextError);
                return prev;
              });
              setLoading(false);
            }
          }
        );

        // STEP 2: Fetch fresh no-store JSON snapshot in parallel
        try {
          const jsonResponse = await fetchWithTimeout(`/data/products.json?_t=${Date.now()}`, {
            cache: 'no-store',
            timeoutMs: 8000,
          });

          if (jsonResponse.ok) {
            const jsonData: JSONData = await jsonResponse.json();
            if (jsonData && jsonData.products && Array.isArray(jsonData.products)) {
              if (isComponentMounted && !firebaseReceived) {
                setProducts(prev => (isSameJsonList(prev, jsonData.products) ? prev : jsonData.products));
                cacheManager.set('products', jsonData.products);
                setLoading(false);
                setError(null);
                loadedFromJson = true;
              }
            }
          }
        } catch (jsonError) {
          console.warn('[useProducts] JSON fetch notice:', jsonError);
        }
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        if (isComponentMounted) {
          setError(nextError);
          setLoading(false);
        }
      }
    };

    loadProducts();

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
    console.log('[useProducts] Triggering JSON sync...');
    const idToken = await auth.currentUser?.getIdToken();
    const response = await fetch('/api/sync-data/products', {
      method: 'POST',
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
    });
    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.success) {
      const message = result?.error || result?.message || `JSON sync failed (${response.status})`;
      console.error('[useProducts] JSON sync failed:', message);
      throw new Error(message);
    }

    console.log('[useProducts] JSON sync completed');
  };

  const addProduct = async (product: Omit<Product, 'id'>) => {
    let productId = generateSlug(product.name);

    // Append timestamp if product with this slug already exists
    const existingProduct = products.find((p) => p.id === productId);
    if (existingProduct) {
      const timestamp = Date.now().toString().slice(-6);
      productId = `${productId}-${timestamp}`;
    }

    await set(ref(rtdb, `products/${productId}`), {
      ...product,
      id: productId,
    });

    // Update local state and cache
    const newProduct = { ...product, id: productId } as Product;
    const updated = [...products, newProduct];
    setProducts(updated);
    cacheManager.set('products', updated);
    syncManager.updateSync('products');
    // Sync JSON after Firebase write
    await triggerJsonSync();
  };

  const updateProduct = async (id: string, data: Partial<Product>) => {
    await update(ref(rtdb, `products/${id}`), data);

    // Update local state and cache
    const updated = products.map((p: Product) => (p.id === id ? { ...p, ...data } : p));
    setProducts(updated);
    cacheManager.set('products', updated);
    syncManager.updateSync('products');
    // Sync JSON after Firebase write
    await triggerJsonSync();
  };

  const deleteProduct = async (id: string) => {
    await remove(ref(rtdb, `products/${id}`));

    // Update local state and cache
    const updated = products.filter((p: Product) => p.id !== id);
    setProducts(updated);
    cacheManager.set('products', updated);
    syncManager.updateSync('products');
    // Sync JSON after Firebase write
    await triggerJsonSync();
  };

  return {
    products,
    loading,
    error,
    retry,
    addProduct,
    updateProduct,
    deleteProduct,
  };
}

