import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, update, remove, push, set, query, orderByChild, equalTo, limitToLast } from 'firebase/database';
import { rtdb } from '../firebase';
import { ProductReview } from '../types';

const INITIAL_LIMIT = 100;
const PAGE_STEP = 100;

/**
 * Hook for loading product reviews
 * Uses indexed server-side productId filtering and limitToLast pagination.
 */
export function useProductReviews(productId?: string, loadAll = false) {
  const [productReviews, setProductReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [limitCount, setLimitCount] = useState(INITIAL_LIMIT);
  const [hasMore, setHasMore] = useState(false);

  const loadMore = useCallback(() => {
    setLimitCount((prev) => prev + PAGE_STEP);
  }, []);

  useEffect(() => {
    setLimitCount(INITIAL_LIMIT);
  }, [productId, loadAll]);

  useEffect(() => {
    if (!productId && !loadAll) {
      setProductReviews([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const loadReviews = () => {
      try {
        setLoading(true);

        const reviewsRef = !loadAll && productId
          ? query(ref(rtdb, 'productReviews'), orderByChild('productId'), equalTo(productId), limitToLast(limitCount))
          : query(ref(rtdb, 'productReviews'), orderByChild('productId'), limitToLast(limitCount));

        unsubscribe = onValue(
          reviewsRef,
          (snapshot) => {
            try {
              const data = snapshot.val();
              let reviews: ProductReview[] = [];

              if (data) {
                const entries = Object.entries(data);
                setHasMore(entries.length >= limitCount);
                reviews = entries
                  .map(([id, val]: [string, any]) => ({
                    id,
                    ...val,
                  } as ProductReview))
                  .filter((r) => loadAll || r.productId === productId)
                  .sort((a: any, b: any) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
              } else {
                setHasMore(false);
              }

              setProductReviews(reviews);
              setError(null);
              setLoading(false);
            } catch (err) {
              const error =
                err instanceof Error ? err : new Error(String(err));
              setError(error);
              setLoading(false);
            }
          },
          (err) => {
            console.error('Error fetching product reviews:', err);
            const error = err instanceof Error ? err : new Error(String(err));
            setError(error);
            setLoading(false);
          }
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setLoading(false);
      }
    };

    loadReviews();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [productId, loadAll, limitCount]);

  const addProductReview = async (review: Omit<ProductReview, 'id'>) => {
    const newRef = push(ref(rtdb, 'productReviews'));
    return await set(newRef, { ...review, id: newRef.key });
  };

  const updateProductReview = async (
    id: string,
    data: Partial<ProductReview>
  ) => {
    return await update(ref(rtdb, `productReviews/${id}`), data);
  };

  const deleteProductReview = async (id: string) => {
    return await remove(ref(rtdb, `productReviews/${id}`));
  };

  return {
    productReviews,
    loading,
    error,
    hasMore,
    loadMore,
    addProductReview,
    updateProductReview,
    deleteProductReview,
  };
}
