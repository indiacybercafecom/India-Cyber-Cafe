import { useState, useEffect } from 'react';
import { ref, onValue, update, remove, push, set } from 'firebase/database';
import { rtdb } from '../firebase';
import { ProductReview } from '../types';

const PAGINATION_LIMIT = 100;

/**
 * Hook for loading product reviews
 * On-demand loading - loads only when needed (StoreProduct page)
 * Optionally filter by productId
 */
export function useProductReviews(productId?: string) {
  const [productReviews, setProductReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const loadReviews = () => {
      try {
        setLoading(true);

        const reviewsRef = ref(rtdb, 'productReviews');
        unsubscribe = onValue(
          reviewsRef,
          (snapshot) => {
            try {
              const data = snapshot.val();
              let reviews: ProductReview[] = [];

              if (data) {
                reviews = Object.entries(data)
                  .map(([id, val]: [string, any]) => ({
                    id,
                    ...val,
                  } as ProductReview))
                  .filter((r) => r.productId === productId)
                  .slice(0, PAGINATION_LIMIT);
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
  }, [productId]);

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
    addProductReview,
    updateProductReview,
    deleteProductReview,
  };
}
