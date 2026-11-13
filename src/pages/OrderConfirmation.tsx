import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { SEO } from '../components/SEO';
import { showToast } from '../components/Toast';
import { Order, OrderItem } from '../types';

const LAST_ORDER_STORAGE_KEY = 'icc_last_order_confirmation';

interface OrderConfirmationState {
  order: Order;
  productName?: string;
  guestTrackingToken?: string;
}

export function OrderConfirmation() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as OrderConfirmationState | null;

  const [orderData, setOrderData] = useState<OrderConfirmationState | null>(() => {
    if (routeState?.order) return routeState;
    if (typeof window !== 'undefined') {
      try {
        const cached = window.sessionStorage.getItem(LAST_ORDER_STORAGE_KEY);
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    return null;
  });

  useEffect(() => {
    if (routeState?.order) {
      setOrderData(routeState);
      try {
        window.sessionStorage.setItem(LAST_ORDER_STORAGE_KEY, JSON.stringify(routeState));
      } catch {}
    }
  }, [routeState]);

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied to clipboard!`, 'success');
    } catch {
      showToast(`${label}: ${value}`, 'info');
    }
  };

  if (!orderData?.order) {
    return (
      <div className="text-center py-20 space-y-4">
        <h2 className="text-2xl font-bold text-slate-700">Order details unavailable</h2>
        <p className="text-slate-500 text-sm max-w-md mx-auto">
          If you recently placed an order, you can look it up anytime using your Order ID and email or mobile number.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <button onClick={() => navigate('/track-order')} className="btn-primary">
            Track Order
          </button>
          <button onClick={() => navigate('/store')} className="btn-outline">
            Back to Store
          </button>
        </div>
      </div>
    );
  }

  const { order, productName, guestTrackingToken } = orderData;
  const items: OrderItem[] = Array.isArray(order.items) ? order.items : (Object.values(order.items || {}) as OrderItem[]);
  const displayProductName = productName || items[0]?.productName || 'Store Product';
  const totalAmount = order.total;
  const isPaidOnline = order.paymentStatus === 'completed';
  const isCod = order.paymentMethod === 'cash';

  const statusBadgeClass =
    order.orderStatus === 'delivered' ? 'text-green-700 bg-green-100' :
    order.orderStatus === 'shipped' ? 'text-blue-700 bg-blue-100' :
    order.orderStatus === 'processing' ? 'text-orange-700 bg-orange-100' :
    order.orderStatus === 'cancelled' ? 'text-red-700 bg-red-100' :
    'text-amber-700 bg-amber-100';

  const trackTarget = order.isGuest
    ? `/track-order?orderId=${encodeURIComponent(order.id)}${guestTrackingToken ? `&token=${encodeURIComponent(guestTrackingToken)}` : ''}`
    : '/track';

  return (
    <div className="space-y-8">
      <SEO
        title="Order Confirmation - India Cyber Cafe"
        description="Your order has been placed successfully"
      />

      {/* Success Header */}
      <div className="text-center space-y-5">
        <div className="flex justify-center">
          <div className="relative w-24 h-24">
            <div className="absolute inset-0 bg-green-100 rounded-full animate-pulse"></div>
            <div className="relative w-full h-full bg-green-500 rounded-full flex items-center justify-center shadow-lg">
              <IconRenderer name="check" className="w-12 h-12 text-white" />
            </div>
          </div>
        </div>

        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-navy mb-2">
            {isPaidOnline ? 'Payment Verified & Order Confirmed!' : 'Order Placed Successfully!'}
          </h1>
          <p className="text-slate-600 text-sm sm:text-base">
            Thank you for ordering with India Cyber Cafe. Confirmation details have been sent to <br />
            <span className="font-semibold text-navy">{order.email || order.deliveryAddress?.email}</span>
          </p>
        </div>

        {/* Order ID Highlight Pill */}
        {order.id && (
          <div className="inline-flex flex-wrap items-center justify-center gap-2 bg-white border border-slate-200 shadow-sm rounded-xl px-4 py-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Order ID:</span>
            <span className="font-mono font-bold text-sm sm:text-base text-navy">{order.id}</span>
            <button
              type="button"
              onClick={() => copyText(order.id, 'Order ID')}
              className="text-xs font-bold text-primary hover:text-navy bg-primary/10 px-2.5 py-1 rounded-lg transition-colors"
            >
              Copy
            </button>
          </div>
        )}
      </div>

      {/* Order Details Card */}
      <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
        {/* Order Header */}
        <div className="border-b border-slate-200 pb-4">
          <p className="text-slate-500 text-xs sm:text-sm mb-2">Order Summary</p>
          <div className="flex justify-between items-start gap-4">
            <div>
              <p className="text-slate-600 text-xs sm:text-sm">Product</p>
              <p className="text-lg sm:text-xl font-bold text-navy">{displayProductName}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-slate-600 text-xs sm:text-sm mb-1">Order Status</p>
              <span className={`inline-block px-3 py-1 rounded-full text-xs sm:text-sm font-bold capitalize ${statusBadgeClass}`}>
                {order.orderStatus || 'pending'}
              </span>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-3">
          {items.map((item: any, idx: number) => (
            <div key={idx} className="flex justify-between items-center text-sm">
              <div>
                <p className="font-semibold text-navy">{item.productName}</p>
                <p className="text-xs text-slate-500">Qty: {item.quantity}</p>
              </div>
              <p className="font-semibold text-navy">₹{(item.discountedPrice || item.price) * item.quantity}</p>
            </div>
          ))}
        </div>

        {/* Delivery Address */}
        {order.deliveryAddress && (
          <div className="bg-slate-50 rounded-lg p-4 space-y-2 border border-slate-200">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Delivery Address</p>
            <div className="text-xs sm:text-sm text-slate-600 space-y-1">
              <p className="font-semibold text-navy">{order.deliveryAddress.name}</p>
              <p>{order.deliveryAddress.addressLine1}</p>
              {order.deliveryAddress.addressLine2 && <p>{order.deliveryAddress.addressLine2}</p>}
              <p>{order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.pincode}</p>
              <p>{order.deliveryAddress.country}</p>
              {order.deliveryAddress.phone && <p className="pt-1 font-medium">Mobile: {order.deliveryAddress.phone}</p>}
            </div>
          </div>
        )}

        {/* Price Summary */}
        <div className="border-t border-slate-200 pt-4 space-y-2 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>₹{order.subtotal}</span>
          </div>
          {order.deliveryCharges > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Delivery Charges</span>
              <span>₹{order.deliveryCharges}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-navy text-base">
            <span>Total Amount</span>
            <span>₹{totalAmount}</span>
          </div>
        </div>

        {/* Dynamic Payment Status */}
        {isPaidOnline ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-1">
            <p className="text-sm font-semibold text-green-900 flex items-center gap-2">
              <IconRenderer name="check-circle" className="w-4 h-4 text-green-600" />
              Payment Completed (Online / Razorpay)
            </p>
            {order.razorpayPaymentId && (
              <p className="text-xs text-green-800 font-mono">
                Transaction Reference: {order.razorpayPaymentId}
              </p>
            )}
          </div>
        ) : isCod ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-1">
            <p className="text-sm font-semibold text-blue-900 flex items-center gap-2">
              <IconRenderer name="truck" className="w-4 h-4 text-blue-600" />
              Cash on Delivery (COD)
            </p>
            <p className="text-xs text-blue-800">
              Please pay <span className="font-bold">₹{totalAmount}</span> in cash/UPI at the time of delivery.
            </p>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
              <IconRenderer name="clock" className="w-4 h-4" />
              Payment Pending Verification
            </p>
            <p className="text-xs text-amber-800 mt-1">
              If your amount was debited, it will sync automatically shortly or you can verify on the Track Order page.
            </p>
          </div>
        )}

        {/* Guest Order Tracking Info */}
        {(order.isGuest || guestTrackingToken) && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
            <p className="text-sm font-bold text-navy flex items-center gap-2">
              <IconRenderer name="shield-check" className="w-4 h-4 text-primary" />
              Guest Order Tracking Details
            </p>
            <p className="text-xs text-slate-600">
              Save your Order ID ({order.id}) to track your delivery anytime using your email or 10-digit mobile number.
            </p>
            {guestTrackingToken && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] font-semibold text-slate-500">Tracking Token:</span>
                <code className="text-[11px] bg-white border border-slate-200 px-2 py-1 rounded font-mono text-navy break-all">
                  {guestTrackingToken}
                </code>
                <button
                  type="button"
                  onClick={() => copyText(guestTrackingToken, 'Tracking Token')}
                  className="text-[11px] font-bold text-primary hover:underline"
                >
                  Copy Token
                </button>
              </div>
            )}
          </div>
        )}

        {/* Contact Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-blue-900 mb-2">Need Help?</p>
          <div className="text-xs text-blue-800 space-y-1">
            <p>Email: support@indiacybercafe.com</p>
            <p>Phone: +91 9203251821</p>
            <p>Available 24/7</p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-4">
        <button
          onClick={() => navigate(trackTarget)}
          className="flex-1 btn-primary py-3 font-semibold"
        >
          Track Order
        </button>
        <button
          onClick={() => navigate('/store')}
          className="flex-1 btn-outline py-3 font-semibold"
        >
          Continue Shopping
        </button>
      </div>

      {/* Info Section */}
      <div className="max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 text-center">
          <IconRenderer name="zap" className="w-6 h-6 text-primary mx-auto mb-2" />
          <p className="text-xs sm:text-sm font-semibold text-slate-700">Fast Processing</p>
          <p className="text-[10px] sm:text-xs text-slate-500 mt-1">Your order will be processed within 24 hours</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 text-center">
          <IconRenderer name="truck" className="w-6 h-6 text-primary mx-auto mb-2" />
          <p className="text-xs sm:text-sm font-semibold text-slate-700">Quick Delivery</p>
          <p className="text-[10px] sm:text-xs text-slate-500 mt-1">Delivered to your doorstep soon</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 text-center">
          <IconRenderer name="shield-check" className="w-6 h-6 text-primary mx-auto mb-2" />
          <p className="text-xs sm:text-sm font-semibold text-slate-700">Secure & Safe</p>
          <p className="text-[10px] sm:text-xs text-slate-500 mt-1">Your order & payment are protected</p>
        </div>
      </div>
    </div>
  );
}
