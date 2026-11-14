import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Application, PaymentGateway, UserProfile, Order, OrderItem } from '../types';
import { IconRenderer } from '../components/Icons';
import { SelectDropdown } from '../components/SelectDropdown';
import { SEO } from '../components/SEO';
import { showToast } from '../components/Toast';
import { utils, writeFile } from 'xlsx';
import { OrderDetailModal } from '../components/OrderDetailModal';
import { loadRazorpayScript } from '../services/razorpayService';
import { getStoredGuestOrders, StoredGuestOrderRef } from '../services/guestCheckoutService';
import { auth } from '../firebase';
import { isAdminUser } from '../utils/permissions';

interface TrackProps {
  applications: Application[];
  orders?: Order[];
  user: UserProfile | null;
  gateways: PaymentGateway[];
  onViewDetails: (app: Application) => void;
  onUpdateApp: (id: string, data: Partial<Application>) => Promise<void>;
  ordersLoading?: boolean;
  ordersError?: Error | null;
  onRetryOrders?: () => void;
  applicationsLoading?: boolean;
  applicationsError?: Error | null;
  guestOnly?: boolean;
}

function getOrderItems(order: Order): OrderItem[] {
  return Array.isArray(order.items) ? order.items : (Object.values(order.items || {}) as OrderItem[]);
}

export function Track({
  applications,
  orders = [],
  user,
  gateways,
  onViewDetails,
  onUpdateApp,
  ordersLoading = false,
  ordersError = null,
  onRetryOrders,
  applicationsLoading = false,
  applicationsError = null,
  guestOnly = false
}: TrackProps) {
  const { applicationId } = useParams<{ applicationId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<'all' | 'applications' | 'orders'>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isOrderDetailModalOpen, setIsOrderDetailModalOpen] = useState(false);

  // Guest Order Tracking state
  const [guestOrderId, setGuestOrderId] = useState(() => searchParams.get('orderId') || '');
  const [guestVerifier, setGuestVerifier] = useState(
    () => searchParams.get('token') || searchParams.get('email') || searchParams.get('phone') || ''
  );
  const [guestLookupLoading, setGuestLookupLoading] = useState(false);
  const [guestLookupError, setGuestLookupError] = useState<string | null>(null);
  const [guestTrackedOrder, setGuestTrackedOrder] = useState<Order | null>(null);
  const [storedGuestOrders, setStoredGuestOrders] = useState<StoredGuestOrderRef[]>([]);

  useEffect(() => {
    setStoredGuestOrders(getStoredGuestOrders());
  }, []);

  const performGuestLookup = useCallback(async (orderIdVal: string, verifierVal: string) => {
    const cleanOrderId = orderIdVal.trim();
    const cleanVerifier = verifierVal.trim();

    if (!cleanOrderId) {
      setGuestLookupError('Please enter your Order ID.');
      return;
    }
    if (!cleanVerifier) {
      setGuestLookupError('Please enter your email, 10-digit mobile number, or tracking token.');
      return;
    }

    const payload: Record<string, string> = { orderId: cleanOrderId };
    const digitsOnly = cleanVerifier.replace(/\D/g, '');
    if (cleanVerifier.includes('@')) {
      payload.email = cleanVerifier.toLowerCase();
    } else if (/^(?:\+?91|0)?\d{10}$/.test(digitsOnly) && digitsOnly.length >= 10) {
      payload.phone = digitsOnly.slice(-10);
    } else {
      payload.token = cleanVerifier;
    }

    setGuestLookupLoading(true);
    setGuestLookupError(null);
    try {
      const resp = await fetch('/api/store/orders/guest-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success || !data.order) {
        setGuestTrackedOrder(null);
        setGuestLookupError(data.error || 'Could not find a matching order.');
        return;
      }
      setGuestTrackedOrder(data.order as Order);
    } catch {
      setGuestLookupError('Network error while checking order status. Please try again.');
    } finally {
      setGuestLookupLoading(false);
    }
  }, []);

  // Auto-lookup if query parameters provide orderId + verifier
  useEffect(() => {
    const qpOrderId = searchParams.get('orderId');
    const qpVerifier = searchParams.get('token') || searchParams.get('email') || searchParams.get('phone');
    if (qpOrderId && qpVerifier) {
      setGuestOrderId(qpOrderId);
      setGuestVerifier(qpVerifier);
      performGuestLookup(qpOrderId, qpVerifier);
    }
  }, [searchParams, performGuestLookup]);

  useEffect(() => {
    if (applicationId && applications.length > 0) {
      const app = applications.find(a => a.id === applicationId);
      if (app) {
        onViewDetails(app);
      }
    }
  }, [applicationId, applications]);

  // Accept canonical uid, legacy userId, email-linked orders, and admin-scoped view
  const userOrders = isAdminUser(user)
    ? orders
    : orders.filter(o =>
        !user?.uid ||
        o.uid === user.uid ||
        o.userId === user.uid ||
        (user.email && o.email?.toLowerCase().trim() === user.email.toLowerCase().trim())
      );

  const filteredApps = applications.filter(app => {
    const matchesSearch =
      (app.id || '').toLowerCase().includes(search.toLowerCase()) ||
      (app.serviceName || '').toLowerCase().includes(search.toLowerCase()) ||
      ((app.subserviceName && app.subserviceName.toLowerCase()) || '').includes(search.toLowerCase());

    const matchesFilter = filterStatus === 'all' || app.status === filterStatus;
    const matchesType = filterType === 'all' || filterType === 'applications';

    return matchesSearch && matchesFilter && matchesType;
  });

  const filteredOrders = userOrders.filter(order => {
    const items = getOrderItems(order);
    const matchesSearch =
      (order.id || '').toLowerCase().includes(search.toLowerCase()) ||
      ((order.deliveryAddress?.name || '')).toLowerCase().includes(search.toLowerCase()) ||
      items.some(item => (item?.productName || '').toLowerCase().includes(search.toLowerCase()));

    const matchesFilter = filterStatus === 'all' || order.orderStatus === filterStatus || order.paymentStatus === filterStatus;
    const matchesType = filterType === 'all' || filterType === 'orders';

    return matchesSearch && matchesFilter && matchesType;
  });

  const exportToExcel = () => {
    const data = [
      ...filteredApps.map(app => ({
        RecordType: 'Application',
        ID: app.id,
        Name: app.serviceName + (app.subserviceName ? ` (${app.subserviceName})` : ''),
        Amount: app.charge || 0,
        Status: app.status,
        PaymentStatus: app.paymentStatus || 'N/A',
        Date: new Date(app.date).toLocaleString()
      })),
      ...filteredOrders.map(ord => {
        const items = getOrderItems(ord);
        return {
          RecordType: 'Product Order',
          ID: ord.id,
          Name: items[0]?.productName || 'Store Order',
          Amount: ord.total,
          Status: ord.orderStatus,
          PaymentStatus: ord.paymentStatus,
          Date: new Date(ord.createdAt).toLocaleString()
        };
      })
    ];
    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'MyApplicationsAndOrders');
    writeFile(wb, `IndiaCyberCafe_Records_${Date.now()}.xlsx`);
    showToast('Export successful!');
  };

  const handlePay = async (app: Application) => {
    const scriptLoaded = await loadRazorpayScript();
    if (!scriptLoaded || !window.Razorpay) {
      showToast('Payment system not available. Please try again.', 'error');
      return;
    }

    const amountPaise = Math.round((app.charge || 0) * 100);
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      showToast('Invalid payable amount for this application.', 'error');
      return;
    }

    try {
      const orderResp = await fetch('/api/create-razorpay-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: app.id,
          notes: {
            applicationId: app.id,
            serviceId: app.serviceId,
            serviceName: app.serviceName,
          },
        }),
      });
      const orderData = await orderResp.json().catch(() => ({}));
      const razorpayOrderId = orderData.order_id || orderData.orderId;
      if (!orderResp.ok || !razorpayOrderId) {
        throw new Error(orderData.error || 'Could not initialize payment order.');
      }

      const razorpayGateway = gateways.find(g => g.type === 'razorpay' && g.active);
      const key = orderData.keyId || razorpayGateway?.credentials?.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_live_Rploo35wP3GfXd';

      const options = {
        key,
        amount: amountPaise,
        currency: 'INR',
        order_id: razorpayOrderId,
        name: 'India Cyber Cafe',
        description: `Payment for ${app.serviceName}`,
        handler: async (response: any) => {
          try {
            const idToken = await auth.currentUser?.getIdToken();
            if (!idToken) {
              throw new Error('Authentication required to verify payment.');
            }
            const verifyResp = await fetch(`/api/applications/${encodeURIComponent(app.id)}/verify-payment`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id || razorpayOrderId,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyData = await verifyResp.json().catch(() => ({}));
            if (!verifyResp.ok || !verifyData.success) {
              throw new Error(verifyData.error || 'Payment verification failed.');
            }
            showToast('Payment Successful!');
          } catch (handlerErr) {
            console.error('Track payment verify error:', handlerErr);
            showToast(handlerErr, 'error', 'Payment could not be verified.');
          }
        },
        prefill: {
          name: app.name,
          email: app.email,
          contact: user?.phone || ''
        },
        theme: { color: '#FF9933' }
      };
      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err) {
      console.error('Payment start error:', err);
      showToast(err, 'error', 'Unable to start payment. Please try again.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processing': return 'bg-orange-500';
      case 'clarification': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'rejected': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  const guestTrackerCard = (
    <div className="bg-white rounded-3xl shadow-md border border-slate-200 p-5 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xl sm:text-2xl font-bold text-navy flex items-center gap-2">
            <IconRenderer name="truck" className="w-6 h-6 text-primary" />
            Track Order by Order ID
          </h3>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">
            Placed an order as a guest or looking up a specific Store Order? Verify with your email, 10-digit mobile number, or tracking token.
          </p>
        </div>
        {!user && (
          <Link
            to="/login?redirect=/track"
            className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-navy text-white text-xs sm:text-sm font-bold hover:bg-navy-light transition-colors"
          >
            Sign In for Full History
          </Link>
        )}
      </div>

      {/* Quick chips for recent guest orders in browser */}
      {storedGuestOrders.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent Guest Orders on This Device</p>
          <div className="flex flex-wrap gap-2">
            {storedGuestOrders.slice(0, 5).map(item => (
              <button
                key={item.orderId}
                type="button"
                onClick={() => {
                  const verifier = item.token || item.email || item.phone || '';
                  setGuestOrderId(item.orderId);
                  setGuestVerifier(verifier);
                  performGuestLookup(item.orderId, verifier);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-primary/10 text-navy text-xs font-mono font-semibold border border-slate-200 transition-colors"
              >
                {item.orderId}
              </button>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          performGuestLookup(guestOrderId, guestVerifier);
        }}
        className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4"
      >
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1.5">Order ID</label>
          <input
            type="text"
            placeholder="e.g. ICC/STORE-13112026-..."
            value={guestOrderId}
            onChange={(e) => setGuestOrderId(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1.5">Email, Mobile, or Token</label>
          <input
            type="text"
            placeholder="Email, 10-digit Phone, or Token"
            value={guestVerifier}
            onChange={(e) => setGuestVerifier(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={guestLookupLoading}
            className="w-full btn-primary py-2.5 px-5 font-bold text-sm disabled:opacity-60"
          >
            {guestLookupLoading ? 'Checking...' : 'Check Order Status'}
          </button>
        </div>
      </form>

      {guestLookupError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm rounded-xl p-3.5 font-medium">
          {guestLookupError}
        </div>
      )}

      {guestTrackedOrder && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs font-mono font-bold text-green-700">{guestTrackedOrder.id}</p>
              <h4 className="text-lg font-bold text-navy">
                {getOrderItems(guestTrackedOrder)[0]?.productName || 'Store Order'}
              </h4>
              <p className="text-xs text-slate-500">
                Placed on {new Date(guestTrackedOrder.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${
                guestTrackedOrder.orderStatus === 'delivered' ? 'bg-green-500' :
                guestTrackedOrder.orderStatus === 'shipped' ? 'bg-blue-500' :
                guestTrackedOrder.orderStatus === 'processing' ? 'bg-orange-500' :
                guestTrackedOrder.orderStatus === 'cancelled' ? 'bg-red-500' :
                'bg-slate-500'
              }`}>
                Order: {guestTrackedOrder.orderStatus}
              </span>
              <span className={`badge ${
                guestTrackedOrder.paymentStatus === 'completed' ? 'bg-green-500' :
                guestTrackedOrder.paymentStatus === 'pending' ? 'bg-yellow-500' :
                'bg-red-500'
              }`}>
                Payment: {guestTrackedOrder.paymentStatus}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs sm:text-sm text-slate-600 space-y-0.5">
              <p><span className="font-semibold text-navy">Total:</span> ₹{guestTrackedOrder.total}</p>
              <p><span className="font-semibold text-navy">Payment Method:</span> {guestTrackedOrder.paymentMethod === 'cash' ? 'Cash on Delivery (COD)' : 'Online (Razorpay)'}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedOrder(guestTrackedOrder);
                setIsOrderDetailModalOpen(true);
              }}
              className="btn-primary py-2 px-5 text-xs sm:text-sm"
            >
              View Full Details & Updates
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Guest-only route (/track-order) or unauthenticated visitor on /track
  if (guestOnly || !user) {
    return (
      <div className="space-y-6 sm:space-y-8">
        <SEO
          title="Track Guest Order - India Cyber Cafe"
          description="Track your India Cyber Cafe store product order using your Order ID and email, phone number, or tracking token."
          url="https://b.indiacybercafe.com/track-order"
          keywords="Track Order, Guest Order Status, Store Order Tracking, India Cyber Cafe"
          ogType="website"
        />

        <div className="text-center sm:text-left space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold text-navy">Track Your Order</h1>
          <p className="text-slate-500 text-sm sm:text-base">
            Enter your Order ID and registered email or mobile number to view live order & payment status.
          </p>
        </div>

        {guestTrackerCard}

        {isOrderDetailModalOpen && selectedOrder && (
          <OrderDetailModal
            order={selectedOrder}
            onClose={() => { setIsOrderDetailModalOpen(false); setSelectedOrder(null); }}
            currentUser={user}
          />
        )}
      </div>
    );
  }

  const isLoadingAny = ordersLoading || applicationsLoading;
  const hasLoadError = Boolean(ordersError || applicationsError);
  const totalUserRecords = applications.length + userOrders.length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <SEO
        title="Track Applications & Orders - India Cyber Cafe"
        description="Track the status of your government service applications and product orders in real-time. Monitor your submissions with instant updates."
        url="https://b.indiacybercafe.com/track"
        keywords="Track Application, Order Status, Application Number, Order Tracking, Digital Services"
        ogType="website"
      />

      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="text-center sm:text-left space-y-1">
          <h2 className="text-3xl sm:text-4xl font-bold text-navy">My Applications & Orders</h2>
          <p className="text-slate-500 text-sm sm:text-base">Track the status of your submissions and product orders</p>
        </div>
        <div className="flex w-full sm:w-auto gap-2 sm:gap-3">
          {onRetryOrders && (
            <button
              type="button"
              onClick={onRetryOrders}
              disabled={ordersLoading}
              className="flex-1 sm:flex-none bg-white border border-slate-200 text-navy px-4 py-2.5 sm:py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-all shadow-sm text-sm"
            >
              <IconRenderer name="rotate-right" className={`w-4 h-4 ${ordersLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
          <button
            onClick={exportToExcel}
            className="flex-1 sm:flex-none bg-green-600 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-lg text-sm sm:text-base"
          >
            <IconRenderer name="excel" className="w-4 h-4 sm:w-5 sm:h-5" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 bg-white p-3 sm:p-4 rounded-2xl shadow-md border border-slate-100">
        <div className="relative flex-1">
          <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search ID, Service, or Product..."
            className="w-full pl-11 pr-4 py-2.5 sm:py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm sm:text-base"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 sm:gap-4">
          <div className="relative flex-1 sm:w-48">
            <SelectDropdown
              className="w-full px-4 py-2.5 sm:py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none bg-white text-sm sm:text-base"
              leadingIcon="filter"
              value={filterType}
              onChange={value => setFilterType(value as 'all' | 'applications' | 'orders')}
              options={[
                { value: 'all', label: 'All Items' },
                { value: 'applications', label: 'Applications' },
                { value: 'orders', label: 'Orders' },
              ]}
            />
          </div>
          <div className="relative flex-1 sm:w-48">
            <SelectDropdown
              className="w-full px-4 py-2.5 sm:py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none bg-white text-sm sm:text-base"
              leadingIcon="filter"
              value={filterStatus}
              onChange={setFilterStatus}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'processing', label: 'Processing' },
                { value: 'clarification', label: 'Clarification' },
                { value: 'completed', label: 'Completed' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'pending', label: 'Pending' },
                { value: 'shipped', label: 'Shipped' },
                { value: 'delivered', label: 'Delivered' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Loading Indicator */}
      {isLoadingAny && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center justify-center gap-3 text-slate-600 text-sm font-semibold shadow-sm">
          <IconRenderer name="spinner" className="w-5 h-5 animate-spin text-primary" />
          Loading your latest applications and store orders...
        </div>
      )}

      {/* Error State with Retry */}
      {hasLoadError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-sm text-red-800">
            <p className="font-bold">Some records could not be loaded completely.</p>
            <p className="text-xs mt-0.5">{ordersError?.message || applicationsError?.message || 'Please check your connection and try again.'}</p>
          </div>
          {onRetryOrders && (
            <button
              type="button"
              onClick={onRetryOrders}
              className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs sm:text-sm font-bold hover:bg-red-700 transition-colors shrink-0"
            >
              Retry Loading
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
        {/* Show Applications Table */}
        {(filterType === 'all' || filterType === 'applications') && (
          <>
            {filteredApps.length > 0 && (
              <div className="overflow-x-auto hidden sm:block">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-linear-to-r from-navy to-navy-light text-white">
                      <th className="p-6 font-bold">Applications</th>
                      <th className="p-6 font-bold">Service</th>
                      <th className="p-6 font-bold">Status</th>
                      <th className="p-6 font-bold">Date</th>
                      <th className="p-6 font-bold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredApps.map(app => (
                      <tr key={app.id} className="hover:bg-slate-50 transition-colors cursor-pointer">
                        <td className="p-6 font-medium text-slate-600">{app.id}</td>
                        <td className="p-6">
                          <div className="font-bold text-navy">{app.serviceName}</div>
                          {app.subserviceName && <div className="text-xs text-slate-400">{app.subserviceName}</div>}
                        </td>
                        <td className="p-6">
                          <span className={`badge ${getStatusBadge(app.status)}`}>
                            {app.status}
                          </span>
                        </td>
                        <td className="p-6 text-slate-500 text-sm">
                          {new Date(app.date).toLocaleDateString()}
                        </td>
                        <td className="p-6">
                          <div className="flex gap-2">
                            {app.status === 'completed' && app.paymentStatus === 'pending' && (
                              <button
                                onClick={() => handlePay(app)}
                                className="bg-green-600 text-white py-2 px-4 text-sm rounded-lg font-bold hover:bg-green-700 transition-all flex items-center gap-2"
                              >
                                <IconRenderer name="credit-card" className="w-4 h-4" />
                                Pay ₹{app.charge}
                              </button>
                            )}
                            <button
                              onClick={() => navigate(`/track/${app.id}`)}
                              className="btn-primary py-2 px-4 text-sm"
                            >
                              Details
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mobile View for Applications */}
            {filteredApps.length > 0 && (
              <div className="sm:hidden divide-y divide-slate-100">
                {filteredApps.map(app => (
                  <div key={app.id} className="p-6 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{app.id}</div>
                        <div className="font-bold text-navy text-lg">{app.serviceName}</div>
                        {app.subserviceName && <div className="text-xs text-slate-500">{app.subserviceName}</div>}
                      </div>
                      <span className={`badge ${getStatusBadge(app.status)}`}>
                        {app.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <div className="text-xs text-slate-400">
                        {new Date(app.date).toLocaleDateString()}
                      </div>
                      <div className="flex gap-2">
                        {app.status === 'completed' && app.paymentStatus === 'pending' && (
                          <button
                            onClick={() => handlePay(app)}
                            className="bg-green-600 text-white py-2 px-4 text-xs rounded-lg font-bold hover:bg-green-700 transition-all"
                          >
                            Pay ₹{app.charge}
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/track/${app.id}`)}
                          className="btn-primary py-2 px-6 text-xs"
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Show Orders Table */}
        {(filterType === 'all' || filterType === 'orders') && filteredOrders.length > 0 && (
          <>
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-linear-to-r from-green-600 to-green-700 text-white">
                    <th className="p-6 font-bold">Order ID</th>
                    <th className="p-6 font-bold">Product</th>
                    <th className="p-6 font-bold">Total</th>
                    <th className="p-6 font-bold">Order Status</th>
                    <th className="p-6 font-bold">Payment</th>
                    <th className="p-6 font-bold">Date</th>
                    <th className="p-6 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map(order => {
                    const items = getOrderItems(order);
                    return (
                      <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-6 font-medium font-mono text-sm text-green-700">{order.id}</td>
                        <td className="p-6">
                          <div className="font-bold text-navy">{items[0]?.productName || 'Store Product'}</div>
                          <div className="text-xs text-slate-400">{items.length} item{items.length !== 1 ? 's' : ''}</div>
                        </td>
                        <td className="p-6 font-bold text-navy">₹{order.total}</td>
                        <td className="p-6">
                          <span className={`badge ${
                            order.orderStatus === 'delivered' ? 'bg-green-500' :
                            order.orderStatus === 'shipped' ? 'bg-blue-500' :
                            order.orderStatus === 'processing' ? 'bg-orange-500' :
                            order.orderStatus === 'cancelled' ? 'bg-red-500' :
                            'bg-slate-500'
                          }`}>
                            {order.orderStatus}
                          </span>
                        </td>
                        <td className="p-6">
                          <span className={`badge ${
                            order.paymentStatus === 'completed' ? 'bg-green-500' :
                            order.paymentStatus === 'pending' ? 'bg-yellow-500' :
                            'bg-red-500'
                          }`}>
                            {order.paymentStatus}
                          </span>
                        </td>
                        <td className="p-6 text-slate-500 text-sm">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-6">
                          <button
                            onClick={() => {
                              setSelectedOrder(order);
                              setIsOrderDetailModalOpen(true);
                            }}
                            className="btn-primary py-2 px-6 text-sm"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile View for Orders */}
            <div className="sm:hidden divide-y divide-slate-100">
              {filteredOrders.map(order => {
                const items = getOrderItems(order);
                return (
                  <div key={order.id} className="p-6 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-xs text-green-600 font-mono font-bold uppercase tracking-wider mb-1">{order.id}</div>
                        <div className="font-bold text-navy text-lg">{items[0]?.productName || 'Store Product'}</div>
                        <div className="text-xs text-slate-500">{items.length} item{items.length !== 1 ? 's' : ''}</div>
                      </div>
                      <span className={`badge ${
                        order.orderStatus === 'delivered' ? 'bg-green-500' :
                        order.orderStatus === 'shipped' ? 'bg-blue-500' :
                        order.orderStatus === 'processing' ? 'bg-orange-500' :
                        order.orderStatus === 'cancelled' ? 'bg-red-500' :
                        'bg-slate-500'
                      }`}>
                        {order.orderStatus}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                      <div className="space-y-1">
                        <div className="font-bold text-navy">₹{order.total}</div>
                        <div className="text-xs text-slate-400">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedOrder(order);
                          setIsOrderDetailModalOpen(true);
                        }}
                        className="btn-primary py-2 px-6 text-xs"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Empty State */}
        {!isLoadingAny && filteredApps.length === 0 && filteredOrders.length === 0 && (
          <div className="p-10 text-center space-y-4">
            <div className="text-slate-400 font-medium">
              {totalUserRecords === 0
                ? 'You have not placed any applications or store orders yet.'
                : 'No applications or orders found matching your current search or filter.'}
            </div>
            {totalUserRecords === 0 ? (
              <div className="flex justify-center gap-3">
                <Link to="/services" className="btn-outline text-sm py-2 px-4">Browse Services</Link>
                <Link to="/store" className="btn-primary text-sm py-2 px-4">Visit Store</Link>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setSearch(''); setFilterType('all'); setFilterStatus('all'); }}
                className="btn-outline text-sm py-2 px-4"
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Also allow authenticated user to track any guest order by ID */}
      {guestTrackerCard}

      {/* Order Detail Modal */}
      {isOrderDetailModalOpen && selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => { setIsOrderDetailModalOpen(false); setSelectedOrder(null); }}
          currentUser={user}
        />
      )}
    </div>
  );
}
