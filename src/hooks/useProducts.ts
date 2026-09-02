import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { rtdb } from '../firebase';
import { Product } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { syncManager } from '../utils/syncManager';
import { generateSlug } from '../utils/slugGenerator';

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
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [hasJsonData, setHasJsonData] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isComponentMounted = true;

    const loadProducts = async () => {
      try {
        // STEP 1: Try to load from generated JSON first (fast, static)
        console.log('[useProducts] Attempting to load from JSON...');
        
        try {
          const jsonResponse = await fetch('/data/products.json', {
            cache: 'no-store',
          });
          
          if (jsonResponse.ok) {
            const jsonData: JSONData = await jsonResponse.json();
            if (jsonData && jsonData.products && Array.isArray(jsonData.products)) {
              if (isComponentMounted) {
                console.log(`[useProducts] Loaded ${jsonData.products.length} products from JSON`);
                setProducts(jsonData.products);
                cacheManager.set('products', jsonData.products);
                setHasJsonData(true);
                setLoading(false);
                setError(null);
              }
              return; // Successfully loaded from JSON, no need for Firebase
            }
          }
        } catch (jsonError) {
          console.warn('[useProducts] JSON fetch failed, falling back to Firebase:', jsonError);
        }

        // STEP 2: JSON unavailable or invalid, use Firebase as fallback
        // Also: reload from Firebase if explicit retry or sync threshold exceeded
        const lastSync = syncManager.getLastSync('products');
        const now = Date.now();
        const SYNC_THRESHOLD = 5 * 60 * 1000; // 5 minutes

        if (retryCount > 0 || now - lastSync > SYNC_THRESHOLD) {
          console.log('[useProducts] Loading from Firebase...');
          const productsRef = ref(rtdb, 'products');
          unsubscribe = onValue(
            productsRef,
            (snapshot) => {
              try {
                const data = snapshot.val();
                const productsToSet = data
                  ? Object.entries(data).map(([id, val]: [string, any]) => ({
                      id,
                      ...val,
                    }))
                  : [];

                if (isComponentMounted) {
                  setProducts(productsToSet);
                  cacheManager.set('products', productsToSet);
                  syncManager.updateSync('products');
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
              console.error('[useProducts] Firebase error:', err);
              const error = err instanceof Error ? err : new Error(String(err));
              if (isComponentMounted) {
                setError(error);
                setLoading(false);
              }
            }
          );
        } else {
          // No sync needed, but also no JSON loaded - use cache if available
          const cachedProducts = cacheManager.get('products');
          if (cachedProducts && cachedProducts.length > 0 && isComponentMounted) {
            console.log('[useProducts] Using cached products');
            setProducts(cachedProducts);
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
    try {
      console.log('[useProducts] Triggering JSON sync...');
      const response = await fetch('/api/sync-data/products', {
        method: 'POST',
      });
      if (response.ok) {
        console.log('[useProducts] JSON sync completed');
      } else {
        console.warn('[useProducts] JSON sync returned non-ok status:', response.status);
      }
    } catch (err) {
      console.error('[useProducts] Error triggering JSON sync:', err);
      // Non-fatal: data is still updated in local state and cache
    }
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

