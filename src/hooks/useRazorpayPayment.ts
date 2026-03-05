import { useState, useCallback } from 'react';

export interface PaymentResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export const useRazorpayPayment = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createOrder = useCallback(async (amount: number, notes?: Record<string, string>) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          receipt: `order_${Date.now()}`,
          notes: notes || {},
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create order');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to create order');
      }

      return data.order;
    } catch (err: any) {
      const message = err.message || 'Failed to create payment order';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyPayment = useCallback(
    async (
      orderId: string,
      paymentId: string,
      signature: string
    ): Promise<boolean> => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/razorpay/verify-payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId,
            paymentId,
            signature,
          }),
        });

        if (!response.ok) {
          throw new Error('Signature verification failed');
        }

        const data = await response.json();
        setSuccess(data.success);
        return data.success;
      } catch (err: any) {
        const message = err.message || 'Payment verification failed';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const getPaymentDetails = useCallback(async (paymentId: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/razorpay/payment/${paymentId}`);

      if (!response.ok) {
        throw new Error('Failed to fetch payment details');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch payment details');
      }

      return data.payment;
    } catch (err: any) {
      const message = err.message || 'Failed to fetch payment details';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const refundPayment = useCallback(async (paymentId: string, amount?: number) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/razorpay/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentId,
          amount,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to process refund');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to process refund');
      }

      return data.refund;
    } catch (err: any) {
      const message = err.message || 'Failed to process refund';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    success,
    createOrder,
    verifyPayment,
    getPaymentDetails,
    refundPayment,
  };
};

export default useRazorpayPayment;
