import React, { useState, useCallback } from 'react';
import { AlertCircle, Loader } from 'lucide-react';

interface RazorpayPaymentProps {
  amount: number; // in INR
  orderId?: string;
  description?: string;
  name?: string;
  email?: string;
  phone?: string;
  notes?: Record<string, string>;
  onSuccess?: (response: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export const RazorpayPayment: React.FC<RazorpayPaymentProps> = ({
  amount,
  orderId,
  description = 'Payment',
  name = 'India Cyber Cafe',
  email,
  phone,
  notes,
  onSuccess,
  onError,
  buttonText = 'Pay Now',
  buttonClassName = 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700',
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (document.getElementById('razorpay-script')) {
        resolve(true);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.id = 'razorpay-script';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const createOrder = async (): Promise<string> => {
    try {
      const response = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          receipt: orderId || `order_${Date.now()}`,
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

      return data.order.id;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create payment order');
    }
  };

  const verifyPayment = async (
    razorpayOrderId: string,
    paymentId: string,
    signature: string
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/razorpay/verify-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: razorpayOrderId,
          paymentId,
          signature,
        }),
      });

      if (!response.ok) {
        throw new Error('Signature verification failed');
      }

      const data = await response.json();
      return data.success;
    } catch (err: any) {
      throw new Error(err.message || 'Payment verification failed');
    }
  };

  const handlePayment = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load Razorpay script
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Failed to load Razorpay script');
      }

      // Create order
      const razorpayOrderId = await createOrder();

      // Razorpay options
      const options = {
        key: 'rzp_test_SMaFkoy1k9JEy3', // Test Key ID
        amount: Math.round(amount * 100), // Amount in paise
        currency: 'INR',
        name,
        description,
        order_id: razorpayOrderId,
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            // Verify payment signature
            const isVerified = await verifyPayment(
              response.razorpay_order_id,
              response.razorpay_payment_id,
              response.razorpay_signature
            );

            if (isVerified) {
              if (onSuccess) {
                onSuccess(response);
              }
            } else {
              throw new Error('Payment verification failed');
            }
          } catch (err: any) {
            setError(err.message || 'Payment verification failed');
            if (onError) {
              onError(err);
            }
          }
        },
        prefill: {
          name,
          email,
          contact: phone,
        },
        theme: {
          color: '#3b82f6',
        },
        modal: {
          ondismiss: () => {
            setLoading(false);
          },
        },
      };

      const razorpay = new window.Razorpay(options);
      razorpay.on('payment.failed', (response: { error: any }) => {
        const errorMessage = response.error?.description || 'Payment failed';
        setError(errorMessage);
        if (onError) {
          onError(response.error);
        }
      });
      razorpay.open();
    } catch (err: any) {
      const errorMessage = err.message || 'An error occurred';
      setError(errorMessage);
      if (onError) {
        onError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [amount, orderId, description, name, email, phone, notes, onSuccess, onError]);

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded flex items-start gap-2">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <button
        onClick={handlePayment}
        disabled={loading}
        className={`${buttonClassName} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {loading ? (
          <>
            <Loader className="w-4 h-4 inline mr-2 animate-spin" />
            Processing...
          </>
        ) : (
          buttonText
        )}
      </button>
    </div>
  );
};

export default RazorpayPayment;
