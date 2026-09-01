import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { rtdb } from '../firebase';
import { Product } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { syncManager } from '../utils/syncManager';
import { generateSlug } from '../utils/slugGenerator';

/**
 * Hook for loading public products data
 * Cache-first strategy: loads from cache immediately, syncs in background
 * Suitable for Store, StoreProduct, Home pages
 */
export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    // STEP 1: Load from cache immediately
    const cachedProducts = cacheManager.get('products') || [];
    if (cachedProducts.length > 0) {
      setProducts(cachedProducts);
      setLoading(false);
    }

    // STEP 2: Check if sync is needed
    const lastSync = syncManager.getLastSync('products');
    const now = Date.now();
    const SYNC_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    // Only fetch from Firebase if sync is needed
    if (now - lastSync > SYNC_THRESHOLD) {
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

            setProducts(productsToSet);
            cacheManager.set('products', productsToSet);
            syncManager.updateSync('products');
            setLoading(false);
            setError(null);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            setError(error);
            setLoading(false);
          }
        },
        (err) => {
          console.error('Error fetching products:', err);
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
  };

  const updateProduct = async (id: string, data: Partial<Product>) => {
    await update(ref(rtdb, `products/${id}`), data);

    // Update local state and cache
    const updated = products.map((p: Product) => (p.id === id ? { ...p, ...data } : p));
    setProducts(updated);
    cacheManager.set('products', updated);
    syncManager.updateSync('products');
  };

  const deleteProduct = async (id: string) => {
    await remove(ref(rtdb, `products/${id}`));

    // Update local state and cache
    const updated = products.filter((p: Product) => p.id !== id);
    setProducts(updated);
    cacheManager.set('products', updated);
    syncManager.updateSync('products');
  };

  return {
    products,
    loading,
    error,
    addProduct,
    updateProduct,
    deleteProduct,
  };
}
