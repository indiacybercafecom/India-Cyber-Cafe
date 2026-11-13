import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, update, remove, get, query, orderByChild, equalTo } from 'firebase/database';
import { auth, rtdb } from '../firebase';
import { Order } from '../types';

const PAGINATION_LIMIT = 150;

export function toRtdbOrderKey(orderId: string): string {
  return String(orderId || '').trim().replace(/[/.#$[\]]/g, '-');
}

async function resolveOrderRtdbPath(orderId: string): Promise<string> {
  const flatKey = toRtdbOrderKey(orderId);
  try {
    const flatSnap = await get(ref(rtdb, `orders/${flatKey}`));
    if (flatSnap.exists()) {
      return `orders/${flatKey}`;
    }
    if (flatKey !== orderId) {
      const legacySnap = await get(ref(rtdb, `orders/${orderId}`));
      if (legacySnap.exists()) {
        return `orders/${orderId}`;
      }
    }
  } catch (err) {
    console.warn('resolveOrderRtdbPath notice:', err);
  }
  return `orders/${flatKey}`;
}

function extractOrders(obj: any, prefix: string = ''): Order[] {
  const result: Order[] = [];
  if (!obj || typeof obj !== 'object') return result;

  for (const [key, value] of Object.entries(obj)) {
    if (
      value &&
      typeof value === 'object' &&
      ('email' in value || 'items' in value || 'total' in value)
    ) {
      const orderId = (value as any).id || (prefix ? `${prefix}/${key}` : key);
      result.push({
        id: orderId,
        ...(value as any),
      } as Order);
    } else if (value && typeof value === 'object') {
      const nestedPrefix = prefix ? `${prefix}/${key}` : key;
      result.push(...extractOrders(value, nestedPrefix));
    }
  }
  return result;
}

function mergeAndSortOrders(lists: Order[][]): Order[] {
  const map = new Map<string, Order>();
  for (const list of lists) {
    for (const ord of list) {
      if (!ord || !ord.id) continue;
      const existing = map.get(ord.id);
      if (!existing) {
        map.set(ord.id, ord);
      } else {
        const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
        const incomingTime = new Date(ord.updatedAt || ord.createdAt || 0).getTime();
        if (incomingTime >= existingTime) {
          map.set(ord.id, ord);
        }
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, PAGINATION_LIMIT);
}

export type OrderLoadOptions =
  | { mode: 'disabled' }
  | { mode: 'user'; uid: string }
  | { mode: 'admin' };

export function useOrders(options?: OrderLoadOptions | null) {
  const mode = options?.mode ?? 'disabled';
  const userUid = options?.mode === 'user' ? options.uid : null;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(mode !== 'disabled');
  const [error, setError] = useState<Error | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const refresh = useCallback(() => {
    setReloadNonce(n => n + 1);
  }, []);

  useEffect(() => {
    if (mode === 'disabled') {
      setOrders([]);
      setLoading(false);
      setError(null);
      return;
    }

    let isActive = true;
    let unsubUid: (() => void) | null = null;
    let unsubLegacy: (() => void) | null = null;
    let unsubAdmin: (() => void) | null = null;

    if (mode === 'admin') {
      setLoading(true);
      unsubAdmin = onValue(
        ref(rtdb, 'orders'),
        (snapshot) => {
          if (!isActive) return;
          try {
            const data = snapshot.val();
            const parsed = data ? mergeAndSortOrders([extractOrders(data)]) : [];
            setOrders(parsed);
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
          } finally {
            setLoading(false);
          }
        },
        (err) => {
          if (!isActive) return;
          console.error('Error fetching admin orders:', err);
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      );

      return () => {
        isActive = false;
        if (unsubAdmin) unsubAdmin();
      };
    }

    // Customer mode: fetch authoritative orders from `/api/store/orders/my`
    // AND maintain live RTDB listeners for both `uid` and legacy `userId`
    if (mode === 'user' && userUid) {
      setLoading(true);
      setError(null);

      let apiOrders: Order[] = [];
      let rtdbUidOrders: Order[] = [];
      let rtdbLegacyOrders: Order[] = [];
      let apiSettled = false;

      const publishMerged = () => {
        if (!isActive) return;
        const merged = mergeAndSortOrders([apiOrders, rtdbUidOrders, rtdbLegacyOrders]);
        setOrders(merged);
        if (apiSettled) {
          setLoading(false);
        }
      };

      const fetchMyOrdersFromApi = async () => {
        try {
          const currentUser = auth.currentUser;
          if (!currentUser) {
            apiSettled = true;
            publishMerged();
            return;
          }
          const token = await currentUser.getIdToken();
          const resp = await fetch('/api/store/orders/my', {
            headers: { Authorization: `Bearer ${token}` }
          });

          if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to load orders.');
          }

          const data = await resp.json();
          if (Array.isArray(data.orders)) {
            apiOrders = data.orders;
          }
          if (isActive) setError(null);
        } catch (err) {
          console.error('Error loading user orders from backend:', err);
          if (isActive && rtdbUidOrders.length === 0 && rtdbLegacyOrders.length === 0) {
            setError(err instanceof Error ? err : new Error('Failed to load orders.'));
          }
        } finally {
          apiSettled = true;
          publishMerged();
        }
      };

      fetchMyOrdersFromApi();

      const uidQuery = query(ref(rtdb, 'orders'), orderByChild('uid'), equalTo(userUid));
      unsubUid = onValue(
        uidQuery,
        (snapshot) => {
          const data = snapshot.val();
          rtdbUidOrders = data ? extractOrders(data) : [];
          publishMerged();
        },
        (err) => {
          console.warn('RTDB uid orders listener notice:', err);
        }
      );

      const legacyQuery = query(ref(rtdb, 'orders'), orderByChild('userId'), equalTo(userUid));
      unsubLegacy = onValue(
        legacyQuery,
        (snapshot) => {
          const data = snapshot.val();
          rtdbLegacyOrders = data ? extractOrders(data) : [];
          publishMerged();
        },
        (err) => {
          console.warn('RTDB userId orders listener notice:', err);
        }
      );

      return () => {
        isActive = false;
        if (unsubUid) unsubUid();
        if (unsubLegacy) unsubLegacy();
      };
    }

    setLoading(false);
    return undefined;
  }, [mode, userUid, reloadNonce]);

  const updateOrder = async (id: string, data: Partial<Order>) => {
    const targetPath = await resolveOrderRtdbPath(id);
    return await update(ref(rtdb, targetPath), data);
  };

  const deleteOrder = async (id: string) => {
    const targetPath = await resolveOrderRtdbPath(id);
    return await remove(ref(rtdb, targetPath));
  };

  return {
    orders,
    loading,
    error,
    refresh,
    retry: refresh,
    updateOrder,
    deleteOrder,
  };
}
