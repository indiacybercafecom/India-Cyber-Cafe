import { useNavigate, useLocation } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { SEO } from '../components/SEO';
import { Order } from '../types';

export function OrderConfirmation() {
  const navigate = useNavigate();
  const location = useLocation();
  const orderData = location.state as { order: Omit<Order, 'id'>; productName: string } | null;

  if (!orderData) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-slate-600">Order not found</h2>
        <button onClick={() => navigate('/store')} className="btn-primary mt-4">
          Back to Store
        </button>
      </div>
    );
  }

  const { order, productName } = orderData;
  const totalAmount = order.total;

  return (
    <div className="space-y-8">
      <SEO
        title="Order Confirmation - India Cyber Cafe"
        description="Your order has been placed successfully"
      />

      {/* Success Card */}
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <div className="relative w-24 h-24">
            <div className="absolute inset-0 bg-green-100 rounded-full animate-pulse"></div>
            <div className="relative w-full h-full bg-green-500 rounded-full flex items-center justify-center">
              <IconRenderer name="check" className="w-12 h-12 text-white" />
            </div>
          </div>
        </div>

        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-navy mb-2">Order Confirmed!</h1>
          <p className="text-slate-600 text-sm sm:text-base">
            Thank you for your order. A confirmation email has been sent to <br />
            <span className="font-semibold text-navy">{order.email}</span>
          </p>
        </div>
      </div>

      {/* Order Details Card */}
      <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
        {/* Order Header */}
        <div className="border-b border-slate-200 pb-4">
          <p className="text-slate-500 text-xs sm:text-sm mb-2">Order Details</p>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-600 text-xs sm:text-sm">Product</p>
              <p className="text-lg sm:text-xl font-bold text-navy">{productName}</p>
            </div>
            <div className="text-right">
              <p className="text-slate-600 text-xs sm:text-sm">Order Status</p>
              <p className="text-lg sm:text-xl font-bold text-amber-600">Pending</p>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-3">
          {order.items.map((item, idx) => (
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
        <div className="bg-slate-50 rounded-lg p-4 space-y-2 border border-slate-200">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Delivery Address</p>
          <div className="text-xs sm:text-sm text-slate-600 space-y-1">
            <p className="font-semibold text-navy">{order.deliveryAddress.name}</p>
            <p>{order.deliveryAddress.addressLine1}</p>
            {order.deliveryAddress.addressLine2 && <p>{order.deliveryAddress.addressLine2}</p>}
            <p>{order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.pincode}</p>
            <p>{order.deliveryAddress.country}</p>
          </div>
        </div>

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

        {/* Payment Status */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
            <IconRenderer name="clock" className="w-4 h-4" />
            Payment Pending
          </p>
          <p className="text-xs text-amber-800 mt-1">
            You will receive payment instructions via email shortly.
          </p>
        </div>

        {/* Contact Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-blue-900 mb-2">Questions?</p>
          <div className="text-xs text-blue-800 space-y-1">
            <p>📧 Email: support@indiacybercafe.com</p>
            <p>📞 Phone: +91 9203251821</p>
            <p>⏰ Available 24/7</p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-4">
        <button
          onClick={() => navigate('/track')}
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
          <p className="text-[10px] sm:text-xs text-slate-500 mt-1">Your payment is 100% secure</p>
        </div>
      </div>
    </div>
  );
}
