import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Application, PaymentGateway, UserProfile, Order } from '../types';
import { IconRenderer } from '../components/Icons';
import { SEO } from '../components/SEO';
import { showToast } from '../components/Toast';
import { utils, writeFile } from 'xlsx';
import { OrderDetailModal } from '../components/OrderDetailModal';

interface TrackProps {
  applications: Application[];
  orders?: Order[];
  user: UserProfile;
  gateways: PaymentGateway[];
  onViewDetails: (app: Application) => void;
  onUpdateApp: (id: string, data: Partial<Application>) => Promise<void>;
}

export function Track({ applications, orders = [], user, gateways, onViewDetails, onUpdateApp }: TrackProps) {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<'all' | 'applications' | 'orders'>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isOrderDetailModalOpen, setIsOrderDetailModalOpen] = useState(false);

  // Filter to user's orders
  const userOrders = orders.filter(o => o.uid === user?.uid);

  useEffect(() => {
    console.log('Track page - user:', user?.uid);
    console.log('Track page - all orders:', orders);
    console.log('Track page - user orders:', userOrders);
    if (applicationId && applications.length > 0) {
      const app = applications.find(a => a.id === applicationId);
      if (app) {
        onViewDetails(app);
      }
    }
  }, [applicationId]);

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
    const matchesSearch = 
      (order.id || '').toLowerCase().includes(search.toLowerCase()) ||
      ((order.deliveryAddress?.name || '')).toLowerCase().includes(search.toLowerCase()) ||
      (order.items || []).some(item => (item.productName || '').toLowerCase().includes(search.toLowerCase()));
    
    const matchesFilter = filterStatus === 'all' || order.orderStatus === filterStatus || order.paymentStatus === filterStatus;
    const matchesType = filterType === 'all' || filterType === 'orders';
    
    return matchesSearch && matchesFilter && matchesType;
  });

  const exportToExcel = () => {
    const data = filteredApps.map(app => ({
      ID: app.id,
      Service: app.serviceName,
      SubService: app.subserviceName || 'N/A',
      Charge: app.charge,
      Status: app.status,
      Date: new Date(app.date).toLocaleString(),
      PaymentStatus: app.paymentStatus || 'N/A'
    }));
    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "MyApplications");
    writeFile(wb, `My_Applications_${Date.now()}.xlsx`);
    showToast('Export successful!');
  };

  const handlePay = async (app: Application) => {
    const razorpayGateway = gateways.find(g => g.type === 'razorpay' && g.active);
    const key = razorpayGateway?.credentials?.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_live_Rploo35wP3GfXd';

    const options = {
      key,
      amount: (app.charge || 0) * 100,
      currency: 'INR',
      name: 'India Cyber Cafe',
      description: `Payment for ${app.serviceName}`,
      handler: async (response: any) => {
        await onUpdateApp(app.id, {
          paymentStatus: 'completed',
          razorpayPaymentId: response.razorpay_payment_id
        });
        showToast('Payment Successful!');
      },
      prefill: {
        name: app.name,
        email: app.email,
        contact: user.phone || ''
      },
      theme: { color: '#FF9933' }
    };
    const rzp = new (window as any).Razorpay(options);
    rzp.open();
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
        <button 
          onClick={exportToExcel} 
          className="w-full sm:w-auto bg-green-600 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-lg text-sm sm:text-base"
        >
          <IconRenderer name="excel" className="w-4 h-4 sm:w-5 sm:h-5" />
          Export Excel
        </button>
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
            <IconRenderer name="filter" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select 
              className="w-full pl-11 pr-8 py-2.5 sm:py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none bg-white text-sm sm:text-base"
              value={filterType}
              onChange={e => setFilterType(e.target.value as 'all' | 'applications' | 'orders')}
            >
              <option value="all">All Items</option>
              <option value="applications">Applications</option>
              <option value="orders">Orders</option>
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <IconRenderer name="chevron-down" className="w-3 h-3" />
            </div>
          </div>
          <div className="relative flex-1 sm:w-48">
            <IconRenderer name="filter" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select 
              className="w-full pl-11 pr-8 py-2.5 sm:py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none bg-white text-sm sm:text-base"
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="processing">Processing</option>
              <option value="clarification">Clarification</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
              <option value="pending">Pending</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <IconRenderer name="chevron-down" className="w-3 h-3" />
            </div>
          </div>
        </div>
      </div>

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
                  {filteredOrders.map(order => (
                    <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-6 font-medium font-mono text-sm text-green-700">{order.id}</td>
                      <td className="p-6">
                        <div className="font-bold text-navy">{order.items[0]?.productName || 'N/A'}</div>
                        <div className="text-xs text-slate-400">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</div>
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
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View for Orders */}
            <div className="sm:hidden divide-y divide-slate-100">
              {filteredOrders.map(order => (
                <div 
                  key={order.id} 
                  className="p-6 space-y-4"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs text-green-600 font-mono font-bold uppercase tracking-wider mb-1">{order.id}</div>
                      <div className="font-bold text-navy text-lg">{order.items[0]?.productName || 'N/A'}</div>
                      <div className="text-xs text-slate-500">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</div>
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
              ))}
            </div>
          </>
        )}

        {/* No Results */}
        {filteredApps.length === 0 && filteredOrders.length === 0 && (
          <div className="p-10 text-center text-slate-400 font-medium">
            No applications or orders found matching your search.
          </div>
        )}
      </div>

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
