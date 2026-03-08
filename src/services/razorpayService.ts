// Razorpay Live Keys
const RAZORPAY_KEY_ID = 'rzp_live_SO0ZFBCZTJT9Tu';
const RAZORPAY_KEY_SECRET = 'D8e9DgdBPgYgiMh7h5MbXXk0';

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
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

export const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (document.getElementById('razorpay-script')) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.id = 'razorpay-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export const initiateRazorpayPayment = async (options: RazorpayOptions) => {
  const scriptLoaded = await loadRazorpayScript();
  
  if (!scriptLoaded) {
    throw new Error('Failed to load Razorpay script');
  }

  if (!window.Razorpay) {
    throw new Error('Razorpay not loaded');
  }

  // Use the key from options, fallback to default if not provided
  const finalOptions: RazorpayOptions = {
    ...options,
    key: options.key || RAZORPAY_KEY_ID,
    theme: {
      color: '#001A57', // Navy color
      ...options.theme
    }
  };

  const razorpay = new window.Razorpay(finalOptions);
  razorpay.open();
};

export const getRazorpayKeyId = () => RAZORPAY_KEY_ID;

export const verifyRazorpayPayment = async (
  paymentId: string,
  orderId: string,
  signature: string
): Promise<boolean> => {
  try {
    const response = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      }),
    });

    const data = await response.json();
    return data.verified || false;
  } catch (error) {
    console.error('Payment verification failed:', error);
    return false;
  }
};
