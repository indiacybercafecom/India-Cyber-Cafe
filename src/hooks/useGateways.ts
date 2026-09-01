import { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove, push } from 'firebase/database';
import { rtdb } from '../firebase';
import { PaymentGateway } from '../types';

/**
 * Hook for loading payment gateways data
 * On-demand loading - loads only when explicitly needed (during Apply/Checkout)
 * Not cached globally - each instance maintains its own state
 */
export function useGateways(enabled = false) {
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setGateways([]);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const loadGateways = () => {
      try {
        setLoading(true);

        const gatewaysRef = ref(rtdb, 'gateways');
        unsubscribe = onValue(
          gatewaysRef,
          (snapshot) => {
            try {
              const data = snapshot.val();
              const gatewaysToSet = data
                ? Object.entries(data).map(([id, val]: [string, any]) => ({
                    id,
                    ...val,
                  } as PaymentGateway))
                : [];

              setGateways(gatewaysToSet);
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
            console.error('Error fetching gateways:', err);
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

    loadGateways();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [enabled]);

  const addGateway = async (gateway: PaymentGateway) => {
    const newRef = push(ref(rtdb, 'gateways'));
    return await set(newRef, { ...gateway, id: newRef.key });
  };

  const updateGateway = async (id: string, data: Partial<PaymentGateway>) => {
    return await update(ref(rtdb, `gateways/${id}`), data);
  };

  const deleteGateway = async (id: string) => {
    return await remove(ref(rtdb, `gateways/${id}`));
  };

  return {
    gateways,
    loading,
    error,
    addGateway,
    updateGateway,
    deleteGateway,
  };
}
