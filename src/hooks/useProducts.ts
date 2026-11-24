import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove, push, runTransaction } from 'firebase/database';
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

  const saveDigitalResources = async (productId: string, resources: Product['digitalResources'] = []) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Admin authentication is required to save digital downloads.');
    const response = await fetch(`/api/admin/store/products/${encodeURIComponent(productId)}/digital-resources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ resources }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || 'Could not save private download resources.');
    }
  };

  const deleteDigitalResources = async (productId: string) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Admin authentication is required to update digital downloads.');
    const response = await fetch(`/api/admin/store/products/${encodeURIComponent(productId)}/digital-resources`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) throw new Error('Could not remove private download resources.');
  };

  const getDigitalResources = async (productId: string): Promise<Product['digitalResources']> => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Admin authentication is required to load digital downloads.');
    const response = await fetch(`/api/admin/store/products/${encodeURIComponent(productId)}/digital-resources`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error || 'Could not load private download resources.');
    return Array.isArray(result.resources) ? result.resources : [];
  };

  const addProduct = async (product: Omit<Product, 'id'> & { id?: string }) => {
    const productsRef = ref(rtdb, 'products');
    let productId = product.id?.trim() || generateSlug(product.name);
    if (products.some(existing => existing.id === productId)) {
      productId = push(productsRef).key || generateSlug(product.name);
    }
    const { digitalResources = [], ...publicProduct } = product;
    let created = false;
    let matchingExistingRecord = false;

    try {
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        const result = await runTransaction(ref(rtdb, `products/${productId}`), current => {
          if (current !== null) return;
          return { ...publicProduct, id: productId };
        }, { applyLocally: false });
        created = result.committed;
        if (!created && product.id?.trim() === productId) {
          const existing = result.snapshot.val();
          matchingExistingRecord = Boolean(existing
            && existing.name === publicProduct.name
            && existing.permalink === publicProduct.permalink
            && existing.productType === publicProduct.productType
            && existing.price === publicProduct.price
            && existing.category === publicProduct.category);
          if (matchingExistingRecord) break;
        }
        if (!created && !matchingExistingRecord) {
          productId = push(productsRef).key || `${generateSlug(product.name)}-${Date.now()}`;
        }
      }
      if (!created && !matchingExistingRecord) throw new Error('Could not reserve a unique product ID. Please try again.');

      if (product.productType === 'virtual') {
        await saveDigitalResources(productId, digitalResources);
      }
    } catch (error) {
      if (created) {
        try { await remove(ref(rtdb, `products/${productId}`)); } catch {}
        if (product.productType === 'virtual') {
          try { await deleteDigitalResources(productId); } catch {}
        }
      }
      throw error;
    }

    const newProduct = { ...publicProduct, id: productId } as Product;
    const updated = [...products.filter(existing => existing.id !== productId), newProduct];
    setProducts(updated);
    cacheManager.set('products', updated);
    syncManager.updateSync('products');
    await triggerJsonSync();
  };

  const updateProduct = async (id: string, data: Partial<Product>) => {
    const { digitalResources, ...publicData } = data;
    const existingProduct = products.find(product => product.id === id);

    if (data.productType === 'virtual' && digitalResources !== undefined) {
      let previousResources: Product['digitalResources'] = [];
      if (existingProduct?.productType === 'virtual') {
        previousResources = await getDigitalResources(id);
      }
      try {
        await update(ref(rtdb, `products/${id}`), publicData);
        await saveDigitalResources(id, digitalResources);
      } catch (error) {
        try {
          if (existingProduct) await set(ref(rtdb, `products/${id}`), existingProduct);
          else await remove(ref(rtdb, `products/${id}`));
          if (existingProduct?.productType === 'virtual') await saveDigitalResources(id, previousResources || []);
          else await deleteDigitalResources(id);
        } catch {}
        throw error;
      }
    } else if (existingProduct?.productType === 'virtual' && data.productType === 'physical') {
      const previousResources = await getDigitalResources(id);
      try {
        await update(ref(rtdb, `products/${id}`), publicData);
        await deleteDigitalResources(id);
      } catch (error) {
        try {
          if (existingProduct) await set(ref(rtdb, `products/${id}`), existingProduct);
          await saveDigitalResources(id, previousResources || []);
        } catch {}
        throw error;
      }
    } else {
      await update(ref(rtdb, `products/${id}`), publicData);
    }

    const updated = products.map((product: Product) => {
      const publicProduct = { ...product };
      delete publicProduct.digitalResources;
      return publicProduct.id === id ? { ...publicProduct, ...publicData } : publicProduct;
    });
    setProducts(updated);
    cacheManager.set('products', updated);
    syncManager.updateSync('products');
    await triggerJsonSync();
  };

  const deleteProduct = async (id: string) => {
    const existingProduct = products.find(product => product.id === id);
    if (existingProduct?.productType === 'virtual') {
      const previousResources = await getDigitalResources(id);
      try {
        await remove(ref(rtdb, `products/${id}`));
        await deleteDigitalResources(id);
      } catch (error) {
        try {
          await set(ref(rtdb, `products/${id}`), existingProduct);
          await saveDigitalResources(id, previousResources || []);
        } catch {}
        throw error;
      }
    } else {
      await remove(ref(rtdb, `products/${id}`));
    }

    const updated = products.filter((p: Product) => p.id !== id);
    setProducts(updated);
    cacheManager.set('products', updated);
    syncManager.updateSync('products');
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

