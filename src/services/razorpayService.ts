import { getFriendlyErrorMessage } from '../utils/errorHandler';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

// Razorpay Configuration - Frontend Only (Key ID)
// The Key Secret is kept safe on the backend only
const RAZORPAY_KEY_ID = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RAZORPAY_KEY_ID) || (typeof process !== 'undefined' && process.env?.VITE_RAZORPAY_KEY_ID) || 'rzp_live_SO0ZFBCZTJT9Tu';

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  image?: string;
  order_id?: string;
  customer_notification?: number;
  timeout?: number;
  callback_url?: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: {
    [key: string]: string;
  };
  theme?: {
    color?: string;
  };
  handler?: (response: any) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => any;
  }
}

let razorpayScriptPromise: Promise<boolean> | null = null;

export const loadRazorpayScript = (timeoutMs = 12000): Promise<boolean> => {
  if (typeof window !== 'undefined' && typeof window.Razorpay === 'function') {
    return Promise.resolve(true);
  }
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve) => {
    const existing = document.getElementById('razorpay-script') as HTMLScriptElement | null;
    if (existing) {
      if (typeof window.Razorpay === 'function') {
        resolve(true);
        return;
      }
      // Remove stale/failed script tag before retrying cleanly
      existing.remove();
    }

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) {
        razorpayScriptPromise = null;
      }
      resolve(ok);
    };

    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    const script = document.createElement('script');
    script.id = 'razorpay-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => finish(typeof window.Razorpay === 'function');
    script.onerror = () => finish(false);
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
};

export const initiateRazorpayPayment = async (
  options: RazorpayOptions & { onPaymentFailed?: (error: any) => void }
) => {
  try {
    const scriptLoaded = await loadRazorpayScript();

    if (!scriptLoaded) {
      throw new Error('Payment gateway script timed out or failed to load. Please check your internet connection.');
    }

    if (!window.Razorpay) {
      throw new Error('Payment checkout is temporarily unavailable. Please refresh the page and try again.');
    }

    const keyToUse = options.key || RAZORPAY_KEY_ID;
    const { onPaymentFailed, ...restOptions } = options;

    const finalOptions: RazorpayOptions = {
      ...restOptions,
      key: keyToUse,
      theme: {
        color: '#001A57', // Navy color
        ...options.theme
      }
    };

    if (!finalOptions.amount || finalOptions.amount <= 0) {
      throw new Error('Invalid payment amount');
    }
    if (!finalOptions.currency) {
      throw new Error('Currency is required');
    }

    const razorpay = new window.Razorpay(finalOptions);
    if (typeof razorpay?.on === 'function' && onPaymentFailed) {
      razorpay.on('payment.failed', onPaymentFailed);
    }
    razorpay.open();
    return razorpay;
  } catch (error: any) {
    console.error('Payment initialization error:', error);
    throw error;
  }
};

export const getRazorpayKeyId = () => RAZORPAY_KEY_ID;

export const verifyRazorpayPayment = async (
  paymentId: string,
  orderId: string,
  signature: string
): Promise<{ verified: boolean; error?: string }> => {
  try {
    const response = await fetchWithTimeout('/api/verify-razorpay-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      }),
      timeoutMs: 15000,
      timeoutMessage: 'Payment verification timed out. Please retry verification without paying again.'
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        verified: false,
        error: getFriendlyErrorMessage(data.error, 'Payment could not be verified.')
      };
    }

    return {
      verified: data.verified || false,
      error: data.verified ? undefined : 'Payment could not be verified.'
    };
  } catch (error) {
    const errorMsg = getFriendlyErrorMessage(error, 'Payment could not be verified.');
    console.error('Payment verification error:', error);
    return {
      verified: false,
      error: errorMsg
    };
  }
};

export interface PayLinkOrderResponse {
  success: boolean;
  keyId: string;
  order_id: string;
  orderId: string;
  amount: number; // in paise
  amountInRupees: number;
  currency: string;
  receiptId: string;
  reference?: string;
  error?: string;
}

export const createPayLinkOrder = async (
  amount: string | number,
  ref?: string
): Promise<PayLinkOrderResponse> => {
  const response = await fetchWithTimeout('/api/pay-link/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, ref }),
    timeoutMs: 15000,
    timeoutMessage: 'Payment initiation timed out. Please try again.'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(getFriendlyErrorMessage(data.error, 'Unable to start payment. Please try again.'));
  }
  return data;
};

export const verifyPayLinkPayment = async (
  paymentId: string,
  orderId: string,
  signature: string,
  amount: number,
  reference?: string,
  receiptId?: string
): Promise<{ verified: boolean; error?: string; record?: any }> => {
  try {
    const response = await fetchWithTimeout('/api/pay-link/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
        amount,
        reference,
        receiptId
      }),
      timeoutMs: 15000,
      timeoutMessage: 'Payment verification timed out. Please retry verification.'
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        verified: false,
        error: getFriendlyErrorMessage(data.error, 'Payment could not be verified.')
      };
    }

    return {
      verified: data.verified || false,
      record: data.record,
      error: data.verified ? undefined : (getFriendlyErrorMessage(data.error, 'Payment could not be verified.'))
    };
  } catch (error) {
    const errorMsg = getFriendlyErrorMessage(error, 'Payment could not be verified.');
    console.error('Pay-link verification error:', error);
    return {
      verified: false,
      error: errorMsg
    };
  }
};

