import { useState, useEffect } from 'react';
import { ref, onValue, update, remove, push, set } from 'firebase/database';
import { rtdb } from '../firebase';
import { Order } from '../types';

const PAGINATION_LIMIT = 100;

/**
 * Hook for loading orders data
 * - Without uid: loads all orders (admin use)
 * - With uid: loads only orders belonging to that user
 * Real-time updates are maintained for the current filter
 * 
 * If uid is null, does not subscribe (useful for conditional loading)
 */
export function useOrders(uid?: string | null) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Don't subscribe if uid is explicitly null (used to conditionally disable loading)
    if (uid === null) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const loadOrders = () => {
      try {
        setLoading(true);

        const ordersRef = ref(rtdb, 'orders');
        unsubscribe = onValue(
          ordersRef,
          (snapshot) => {
            try {
              const data = snapshot.val();
              let orders: Order[] = [];

              if (data) {
                const extractOrders = (
                  obj: any,
                  prefix: string = ''
                ): Order[] => {
                  const result: Order[] = [];
                  if (!obj || typeof obj !== 'object') return result;

                  for (const [key, value] of Object.entries(obj)) {
                    if (
                      value &&
                      typeof value === 'object' &&
                      ('email' in value || 'items' in value || 'total' in value)
                    ) {
                      const orderId =
                        (value as any).id ||
                        (prefix ? `${prefix}/${key}` : key);
                      result.push({
                        id: orderId,
                        ...(value as any),
                      } as Order);
                    } else if (value && typeof value === 'object') {
                      const nestedPrefix = prefix
                        ? `${prefix}/${key}`
                        : key;
                      result.push(...extractOrders(value, nestedPrefix));
                    }
                  }
                  return result;
                };

                orders = extractOrders(data)
                  .slice(0, PAGINATION_LIMIT);
              }

              // Filter by user if uid provided
              const filtered = uid
                ? orders.filter((o) => o.uid === uid)
                : orders;

              setOrders(filtered);
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
            console.error('Error fetching orders:', err);
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

    loadOrders();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [uid]);

  const addOrder = async (order: Omit<Order, 'id'> | Order) => {
    // Validate that uid is not undefined (Firebase doesn't allow undefined values)
    if (!order.uid) {
      throw new Error('User ID is required to place an order');
    }

    // Remove any undefined values from the order object
    const cleanOrder = Object.fromEntries(
      Object.entries(order).filter(([_, value]) => value !== undefined)
    );

    // If order has custom id (e.g., from generateOrderId), use it
    const orderId = 'id' in order && order.id ? order.id : undefined;

    if (orderId) {
      return await set(ref(rtdb, `orders/${orderId}`), {
        ...cleanOrder,
        id: orderId,
      });
    } else {
      const newRef = push(ref(rtdb, 'orders'));
      return await set(newRef, { ...cleanOrder, id: newRef.key });
    }
  };

  const updateOrder = async (id: string, data: Partial<Order>) => {
    return await update(ref(rtdb, `orders/${id}`), data);
  };

  const deleteOrder = async (id: string) => {
    return await remove(ref(rtdb, `orders/${id}`));
  };

  return {
    orders,
    loading,
    error,
    addOrder,
    updateOrder,
    deleteOrder,
  };
}
