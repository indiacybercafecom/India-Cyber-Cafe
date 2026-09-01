import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Application, UserProfile, Service, PaymentGateway, Product, ProductCategory, Order, ProductReview } from '../types';
import { IconRenderer } from '../components/Icons';
import { showToast } from '../components/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { GatewayModal } from '../components/GatewayModal';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { ProductModal } from '../components/ProductModal';
import { CategoryModal } from '../components/CategoryModal';
import { OrderManageModal } from '../components/OrderManageModal';
import { exportDataComprehensive } from '../services/exportService';

interface AdminProps {
  applications: Application[];
  users: UserProfile[];
  services: Service[];
  gateways: PaymentGateway[];
  products?: Product[];
  productCategories?: ProductCategory[];
  orders?: Order[];
  productReviews?: ProductReview[];
  onViewApp: (app: Application) => void;
  onDeleteApp: (id: string) => Promise<void>;
  onEditService: (service: Service) => void;
  onAddService: () => void;
  onDeleteService: (id: string) => Promise<void>;
  onManageUser: (user: UserProfile) => void;
  onAddGateway: (gateway: PaymentGateway) => void;
  onUpdateGateway: (id: string, gateway: Partial<PaymentGateway>) => void;
  onDeleteGateway: (id: string) => Promise<void>;
  onEditProduct?: (id: string, product: any) => void;
  onAddProduct?: () => void;
  onDeleteProduct?: (id: string) => void;
  onViewOrder?: (order: Order) => void;
  onUpdateOrder?: (id: string, data: Partial<Order>) => Promise<void>;
  onDeleteOrder?: (id: string) => Promise<void>;
  onAddCategory?: (category: ProductCategory) => Promise<void>;
  onUpdateCategory?: (id: string, category: Partial<ProductCategory>) => Promise<void>;
  onDeleteCategory?: (id: string) => Promise<void>;
  onDeleteProductReview?: (id: string) => Promise<void>;
  onUpdateProductReview?: (id: string, data: Partial<ProductReview>) => Promise<void>;
  currentUser?: UserProfile;
}

export function Admin({ 
  applications, 
  users, 
  services, 
  gateways,
  products = [],
  productCategories = [],
  orders = [],
  productReviews = [],
  onViewApp, 
  onDeleteApp,
  onEditService, 
  onAddService,
  onDeleteService,
  onManageUser,
  onAddGateway,
  onUpdateGateway,
  onDeleteGateway,
  onEditProduct,
  onAddProduct,
  onDeleteProduct,
  onViewOrder,
  onUpdateOrder,
  onDeleteOrder,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onDeleteProductReview,
  currentUser,
  onUpdateProductReview
}: AdminProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'apps' | 'users' | 'services' | 'payments' | 'products' | 'orders' | 'reviews'>('apps');
  const [selectedGateway, setSelectedGateway] = useState<PaymentGateway | null>(null);
  const [isGatewayModalOpen, setIsGatewayModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isOrderDetailModalOpen, setIsOrderDetailModalOpen] = useState(false);
  const [selectedReview, setSelectedReview] = useState<ProductReview | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'excel' | 'json'>('excel');
  
  // Search States
  const [searchApps, setSearchApps] = useState('');
  const [searchUsers, setSearchUsers] = useState('');
  const [searchServices, setSearchServices] = useState('');
  const [searchPayments, setSearchPayments] = useState('');
  const [searchProducts, setSearchProducts] = useState('');
  const [searchOrders, setSearchOrders] = useState('');
  const [searchReviews, setSearchReviews] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'user' | 'operator' | 'admin'>('all');

  // Confirmation Modal State
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'warning'
  });

  const handleSaveGateway = async (gateway: PaymentGateway) => {
    try {
      if (selectedGateway) {
        await onUpdateGateway(selectedGateway.id, gateway);
        showToast('Gateway updated successfully!');
      } else {
        await onAddGateway(gateway);
        showToast('Gateway added successfully!');
      }
      setIsGatewayModalOpen(false);
      setSelectedGateway(null);
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const handleDeleteGateway = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Gateway',
      message: 'Are you sure you want to delete this payment gateway? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          await onDeleteGateway(id);
          showToast('Gateway deleted successfully', 'success');
        } catch (error: any) {
          showToast(error.message || 'Failed to delete gateway', 'error');
        }
      }
    });
  };

  const handleDeleteProduct = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Product',
      message: 'Are you sure you want to delete this product? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          if (onDeleteProduct) {
            onDeleteProduct(id);
            showToast('Product deleted successfully');
          }
        } catch (error: any) {
          showToast(error.message || 'Failed to delete product', 'error');
        }
      }
    });
  };

  const handleDeleteCategory = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Category',
      message: 'Are you sure you want to delete this category? Products in this category will not be affected.',
      type: 'danger',
      onConfirm: async () => {
        try {
          if (onDeleteCategory) {
            await onDeleteCategory(id);
            showToast('Category deleted successfully');
          }
        } catch (error: any) {
          showToast(error.message || 'Failed to delete category', 'error');
        }
      }
    });
  };

  const handleDeleteOrder = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Order',
      message: 'Are you sure you want to delete this order? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          if (onDeleteOrder) {
            await onDeleteOrder(id);
            showToast('Order deleted successfully');
          }
        } catch (error: any) {
          showToast(error.message || 'Failed to delete order', 'error');
        }
      }
    });
  };

  const handleDeleteReview = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Review',
      message: 'Are you sure you want to delete this review? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          if (onDeleteProductReview) {
            await onDeleteProductReview(id);
            showToast('Review deleted successfully');
          }
        } catch (error: any) {
          showToast(error.message || 'Failed to delete review', 'error');
        }
      }
    });
  };

  const exportToExcel = (type: 'apps' | 'users' | 'services' | 'payments' | 'products' | 'orders' | 'reviews' | 'all' = 'apps') => {
    try {
      exportDataComprehensive(type, {
        applications,
        users,
        services,
        gateways,
        products,
        productCategories,
        orders,
        productReviews
      }, {
        format: exportFormat
      });
      
      const formatName = exportFormat === 'json' ? 'JSON' : 'Excel';
      showToast(`Export ${type} as ${formatName} successful!`, 'success');
    } catch (error: any) {
      showToast(error.message || 'Export failed', 'error');
    }
  };

  const handleDeleteApp = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Application',
      message: 'Are you sure you want to delete this application? All associated data will be permanently removed.',
      type: 'danger',
      onConfirm: async () => {
        try {
          await onDeleteApp(id);
          showToast('Application deleted successfully', 'success');
        } catch (error: any) {
          showToast(error.message || 'Failed to delete application', 'error');
        }
      }
    });
  };

  const handleDeleteService = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Service',
      message: 'Are you sure you want to delete this service? This will remove it from the public services list.',
      type: 'danger',
      onConfirm: async () => {
        try {
          await onDeleteService(id);
          showToast('Service deleted successfully', 'success');
        } catch (error: any) {
          showToast(error.message || 'Failed to delete service', 'error');
        }
      }
    });
  };

  // Filtered Lists
  const filteredApps = applications.filter(app => 
    (app.id || '').toLowerCase().includes(searchApps.toLowerCase()) ||
    (app.name || '').toLowerCase().includes(searchApps.toLowerCase()) ||
    (app.email || '').toLowerCase().includes(searchApps.toLowerCase()) ||
    (app.serviceName || '').toLowerCase().includes(searchApps.toLowerCase())
  );

  const filteredUsers = users
    .filter(u => 
      ((u.name || '').toLowerCase().includes(searchUsers.toLowerCase()) ||
       (u.email || '').toLowerCase().includes(searchUsers.toLowerCase()) ||
       ((u.phone || '').includes(searchUsers))) &&
      (userRoleFilter === 'all' || u.role === userRoleFilter)
    )
    .sort((a, b) => {
      // Sort by creation date - most recent first
      return b.createdAt - a.createdAt;
    });

  const filteredServices = services.filter(s => 
    (s.name || '').toLowerCase().includes(searchServices.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(searchServices.toLowerCase())
  );

  const filteredGateways = gateways.filter(g => 
    (g.name || '').toLowerCase().includes(searchPayments.toLowerCase()) ||
    (g.type || '').toLowerCase().includes(searchPayments.toLowerCase())
  );

  const filteredProducts = products.filter(p =>
    (p.name || '').toLowerCase().includes(searchProducts.toLowerCase()) ||
    (p.shortDescription || '').toLowerCase().includes(searchProducts.toLowerCase())
  );

  const filteredOrders = (orders && Array.isArray(orders) ? orders : [])
    .filter(o => {
      if (!o) return false;
      const orderIdMatch = o.id && typeof o.id === 'string' && o.id.toLowerCase().includes(searchOrders.toLowerCase());
      const emailMatch = o.email && typeof o.email === 'string' && o.email.toLowerCase().includes(searchOrders.toLowerCase());
      return orderIdMatch || emailMatch;
    })
    .sort((a, b) => {
      // Sort by creation date - most recent first
      const dateA = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

  return (
    <div className="space-y-8">
      {/* Security Notice */}
      <div className="bg-navy/5 border-l-4 border-navy p-4 rounded-r-xl flex items-center gap-4">
        <IconRenderer name="shield-check" className="w-6 h-6 text-navy" />
        <div>
          <p className="text-sm font-bold text-navy">Super Admin Protection Active</p>
          <p className="text-xs text-slate-500">The account <span className="font-bold">indiacybercafe.com@gmail.com</span> has permanent administrative privileges.</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-4xl font-bold text-navy">Admin Panel</h2>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <select 
            value={exportFormat}
            onChange={e => setExportFormat(e.target.value as 'excel' | 'json')}
            className="px-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all bg-white font-medium text-navy text-sm"
          >
            <option value="excel">📊 Export as Excel (.xlsx)</option>
            <option value="json">📋 Export as JSON (.json)</option>
          </select>
          <button onClick={() => exportToExcel('all')} className="bg-navy text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-navy-light transition-all shadow-lg whitespace-nowrap">
            <IconRenderer name="file-export" className="w-5 h-5" />
            Export All Data
          </button>
          <button onClick={() => exportToExcel(tab)} className="bg-green-600 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-lg shadow-green-600/20 whitespace-nowrap">
            <IconRenderer name="excel" className="w-5 h-5" />
            Export {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
        {[
          { id: 'apps', label: 'Applications', icon: 'clipboard-list' },
          { id: 'users', label: 'Users', icon: 'users' },
          { id: 'services', label: 'Services', icon: 'layers' },
          { id: 'products', label: 'Store', icon: 'shopping-bag' },
          { id: 'orders', label: 'Orders', icon: 'package' },
          { id: 'reviews', label: 'Reviews', icon: 'star' },
          { id: 'payments', label: 'Payments', icon: 'credit-card' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${
              tab === t.id ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-navy'
            }`}
          >
            <IconRenderer name={t.icon || 'layers'} className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'apps' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search applications (ID, Name, Email, Service)..." 
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={searchApps}
              onChange={e => setSearchApps(e.target.value)}
            />
          </div>
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="p-6 font-bold">ID</th>
                    <th className="p-6 font-bold">User</th>
                    <th className="p-6 font-bold">Service</th>
                    <th className="p-6 font-bold">Operator</th>
                    <th className="p-6 font-bold">Status</th>
                    <th className="p-6 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredApps.map(app => (
                    <tr key={app.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-6 font-medium text-slate-600">{app.id}</td>
                      <td className="p-6">
                        <div className="font-bold text-navy">{app.name}</div>
                        <div className="text-xs text-slate-400">{app.email}</div>
                      </td>
                      <td className="p-6 font-bold text-navy">{app.serviceName}</td>
                      <td className="p-6 text-slate-500 font-medium">{app.assignedTo || 'Unassigned'}</td>
                      <td className="p-6">
                        <span className={`badge ${
                          app.status === 'completed' ? 'bg-green-500' : 
                          app.status === 'processing' ? 'bg-orange-500' : 
                          app.status === 'rejected' ? 'bg-red-500' : 'bg-blue-500'
                        }`}>
                          {app.status}
                        </span>
                      </td>
                      <td className="p-6">
                        <div className="flex gap-2">
                          <button onClick={() => onViewApp(app)} className="btn-primary py-2 px-4 text-sm">View</button>
                          <button onClick={() => handleDeleteApp(app.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all">
                            <IconRenderer name="trash" className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredApps.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-slate-400 italic">No applications found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile View for Apps */}
            <div className="sm:hidden divide-y divide-slate-100">
              {filteredApps.map(app => (
                <div key={app.id} className="p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{app.id}</div>
                      <div className="font-bold text-navy">{app.name}</div>
                      <div className="text-xs text-slate-500">{app.serviceName}</div>
                    </div>
                    <span className={`badge ${
                      app.status === 'completed' ? 'bg-green-500' : 
                      app.status === 'processing' ? 'bg-orange-500' : 
                      app.status === 'rejected' ? 'bg-red-500' : 'bg-blue-500'
                    }`}>
                      {app.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <div className="text-xs text-slate-400 italic">
                      By: {app.assignedTo || 'Unassigned'}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => onViewApp(app)} className="btn-primary py-2 px-4 text-xs">View</button>
                      <button onClick={() => handleDeleteApp(app.id)} className="p-2 text-red-500 bg-red-50 rounded-lg">
                        <IconRenderer name="trash" className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredApps.length === 0 && (
                <div className="p-10 text-center text-slate-400 italic">No applications found.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-md">
              <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search users (Name, Email, Phone)..." 
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                value={searchUsers}
                onChange={e => setSearchUsers(e.target.value)}
              />
            </div>
            <select 
              value={userRoleFilter}
              onChange={e => setUserRoleFilter(e.target.value as any)}
              className="px-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all bg-white font-medium text-navy"
            >
              <option value="all">All Roles</option>
              <option value="user">Users</option>
              <option value="operator">Operators</option>
              <option value="admin">Admins</option>
            </select>
          </div>
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="p-6 font-bold">Avatar</th>
                    <th className="p-6 font-bold">Name</th>
                    <th className="p-6 font-bold">Email</th>
                    <th className="p-6 font-bold">Mobile</th>
                    <th className="p-6 font-bold">Role</th>
                    <th className="p-6 font-bold">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map(u => (
                    <tr key={u.uid} className="hover:bg-slate-50 transition-colors">
                      <td className="p-6">
                        <img src={u.avatar} className="w-10 h-10 rounded-full object-cover border-2 border-slate-100" />
                      </td>
                      <td className="p-6 font-bold text-navy">{u.name}</td>
                      <td className="p-6 text-sm text-slate-600">{u.email}</td>
                      <td className="p-6 text-sm text-slate-600">{u.phone || 'N/A'}</td>
                      <td className="p-6">
                        <span className={`badge ${
                          u.role === 'admin' ? 'bg-red-500' : 
                          u.role === 'operator' ? 'bg-blue-500' : 'bg-slate-500'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-6">
                        <button 
                          onClick={() => onManageUser(u)}
                          className="btn-outline py-2 px-4 text-sm"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-slate-400 italic">No users found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile View for Users */}
            <div className="sm:hidden divide-y divide-slate-100">
              {filteredUsers.map(u => (
                <div key={u.uid} className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <img src={u.avatar} className="w-12 h-12 rounded-full object-cover border-2 border-primary/20" />
                    <div className="min-w-0">
                      <div className="font-bold text-navy">{u.name}</div>
                      <div className="text-xs text-slate-400 truncate">{u.email}</div>
                      <div className="text-xs text-slate-400">{u.phone || 'No phone'}</div>
                      <span className={`badge mt-1 inline-block text-xs ${
                        u.role === 'admin' ? 'bg-red-500' : 
                        u.role === 'operator' ? 'bg-blue-500' : 'bg-slate-500'
                      }`}>
                        {u.role}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => onManageUser(u)}
                    className="p-2 bg-slate-100 rounded-xl text-navy flex-shrink-0"
                  >
                    <IconRenderer name="user-pen" className="w-5 h-5" />
                  </button>
                </div>
              ))}
              {filteredUsers.length === 0 && (
                <div className="p-10 text-center text-slate-400 italic">No users found.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'services' && (
        <ErrorBoundary>
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="relative w-full max-w-md">
                <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search services..." 
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  value={searchServices}
                  onChange={e => setSearchServices(e.target.value)}
                />
              </div>
              <button onClick={onAddService} className="w-full md:w-auto btn-primary flex items-center justify-center gap-2 px-8">
                <IconRenderer name="plus" className="w-5 h-5" />
                Create Service
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredServices.map(s => (
                <div key={s.id} className="bg-white p-6 rounded-2xl shadow-md border-2 border-transparent hover:border-primary transition-all group relative">
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button onClick={() => onEditService(s)} className="p-2 bg-primary text-white rounded-lg hover:scale-110 transition-all"><IconRenderer name="user-pen" className="w-4 h-4" /></button>
                    <button onClick={() => handleDeleteService(s.id)} className="p-2 bg-red-500 text-white rounded-lg hover:scale-110 transition-all"><IconRenderer name="trash" className="w-4 h-4" /></button>
                  </div>
                  <IconRenderer name={s.icon || 'layers'} className="w-12 h-12 text-primary mb-4" />
                  <h3 className="text-lg font-bold text-navy">{s.name}</h3>
                  <p className="text-slate-400 text-sm mt-2 line-clamp-2">{s.description}</p>
                </div>
              ))}
              {filteredServices.length === 0 && (
                <div className="col-span-full p-10 text-center text-slate-400 italic">No services found.</div>
              )}
            </div>
          </div>
        </ErrorBoundary>
      )}

      {tab === 'payments' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="relative w-full max-w-md">
              <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search gateways..." 
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                value={searchPayments}
                onChange={e => setSearchPayments(e.target.value)}
              />
            </div>
            <button 
              onClick={() => { setSelectedGateway(null); setIsGatewayModalOpen(true); }}
              className="w-full md:w-auto btn-primary py-3 px-8 text-sm flex items-center justify-center gap-2"
            >
              <IconRenderer name="plus" className="w-4 h-4" />
              Add Gateway
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredGateways.map(g => (
              <div key={g.id} className={`bg-white p-6 rounded-2xl shadow-md border-2 transition-all ${g.active ? 'border-green-500' : 'border-slate-100 opacity-60'}`}>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded">{g.type}</span>
                  <span className={`badge ${g.active ? 'bg-green-500' : 'bg-slate-400'}`}>{g.active ? 'Active' : 'Inactive'}</span>
                </div>
                <h3 className="text-xl font-bold text-navy mb-2">{g.name}</h3>
                <p className="text-slate-500 text-sm mb-6 line-clamp-2">{g.description}</p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => { setSelectedGateway(g); setIsGatewayModalOpen(true); }}
                    className="btn-outline flex-1 py-2 text-xs"
                  >
                    Configure
                  </button>
                  <button 
                    onClick={() => handleDeleteGateway(g.id)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <IconRenderer name="trash" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {filteredGateways.length === 0 && (
              <div className="col-span-full p-10 text-center text-slate-400 italic">No gateways found.</div>
            )}
          </div>
        </div>
      )}

      {tab === 'products' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="relative w-full max-w-md">
              <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search products..." 
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                value={searchProducts}
                onChange={e => setSearchProducts(e.target.value)}
              />
            </div>
            <div className="flex gap-3 flex-wrap">
              <button 
                onClick={() => { setSelectedCategory(null); setIsCategoryModalOpen(true); }}
                className="btn-outline py-3 px-6 text-sm flex items-center justify-center gap-2"
              >
                <IconRenderer name="layers" className="w-4 h-4" />
                Manage Categories
              </button>
              <button 
                onClick={() => { setSelectedProduct(null); setIsProductModalOpen(true); }}
                className="btn-primary py-3 px-8 text-sm flex items-center justify-center gap-2"
              >
                <IconRenderer name="plus" className="w-4 h-4" />
                Add Product
              </button>
            </div>
          </div>

          {/* Categories Section */}
          {productCategories && productCategories.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-700">Categories ({productCategories.length})</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {productCategories.map(cat => (
                  <div key={cat.id} className="bg-white p-4 rounded-xl border border-slate-200 hover:border-navy transition-all group">
                    <div className="flex items-start justify-between mb-3">
                      <IconRenderer name={cat.icon || 'layers'} className="w-6 h-6 text-navy" />
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          onClick={() => { setSelectedCategory(cat); setIsCategoryModalOpen(true); }}
                          className="p-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-all"
                          title="Edit"
                        >
                          <IconRenderer name="user-pen" className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(cat.id)}
                          className="p-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-all"
                          title="Delete"
                        >
                          <IconRenderer name="trash" className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs font-bold text-navy mb-1 line-clamp-2">{cat.name}</p>
                    <p className="text-[10px] text-slate-500 line-clamp-1">{cat.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {filteredProducts.length === 0 ? (
            <div className="bg-white rounded-3xl shadow-xl p-20 text-center">
              <div className="flex justify-center mb-4">
                <IconRenderer name="shopping-bag" className="w-16 h-16 text-slate-300" />
              </div>
              <h3 className="text-2xl font-bold text-slate-700 mb-2">No Products Yet</h3>
              <p className="text-slate-400 mb-6">Start adding products to your store to get started!</p>
              <button 
                onClick={() => { setSelectedProduct(null); setIsProductModalOpen(true); }}
                className="btn-primary py-3 px-8 flex items-center justify-center gap-2 mx-auto"
              >
                <IconRenderer name="plus" className="w-5 h-5" />
                Add First Product
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
              <div className="overflow-x-auto hidden sm:block">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className="p-6 font-bold">Product</th>
                      <th className="p-6 font-bold">Category</th>
                      <th className="p-6 font-bold">Price</th>
                      <th className="p-6 font-bold">Stock</th>
                      <th className="p-6 font-bold">Rating</th>
                      <th className="p-6 font-bold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducts.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-6">
                          <div className="flex items-center gap-4">
                            {p.images && p.images[0] && (
                              <img src={p.images[0]} alt={p.name} className="w-12 h-12 rounded-lg object-cover" />
                            )}
                            <div>
                              <div className="font-bold text-navy">{p.name}</div>
                              <div className="text-xs text-slate-400 line-clamp-1">{p.shortDescription}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-6 font-medium text-slate-600">{p.category}</td>
                        <td className="p-6">
                          <div className="font-bold text-navy">₹{p.discountedPrice || p.price}</div>
                          {p.discountedPrice > 0 && <div className="text-xs text-slate-400 line-through">₹{p.price}</div>}
                        </td>
                        <td className="p-6">
                          <span className={`badge ${p.inStock ? 'bg-green-500' : 'bg-red-500'}`}>
                            {p.inStock ? 'In Stock' : 'Out'}
                          </span>
                        </td>
                        <td className="p-6">
                          <div className="flex items-center gap-1">
                            <IconRenderer name="star" className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                            <span className="font-bold text-navy">{p.ratings.average.toFixed(1)}</span>
                            <span className="text-xs text-slate-400">({p.ratings.count})</span>
                          </div>
                        </td>
                        <td className="p-6">
                          <div className="flex gap-2">
                            <button 
                              onClick={() => { setSelectedProduct(p); setIsProductModalOpen(true); }}
                              className="btn-outline py-2 px-4 text-sm"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => handleDeleteProduct(p.id)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            >
                              <IconRenderer name="trash" className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile View for Products */}
              <div className="sm:hidden divide-y divide-slate-100">
                {filteredProducts.map(p => (
                  <div key={p.id} className="p-6 space-y-4">
                    <div className="flex items-start gap-4">
                      {p.images && p.images[0] && (
                        <img src={p.images[0]} alt={p.name} className="w-16 h-16 rounded-lg object-cover" />
                      )}
                      <div className="flex-1">
                        <div className="font-bold text-navy">{p.name}</div>
                        <div className="text-xs text-slate-400 line-clamp-1 mb-2">{p.category}</div>
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="font-bold text-navy">₹{p.discountedPrice || p.price}</div>
                            {p.discountedPrice > 0 && <div className="text-xs text-slate-400 line-through">₹{p.price}</div>}
                          </div>
                          <span className={`badge text-xs ${p.inStock ? 'bg-green-500' : 'bg-red-500'}`}>
                            {p.inStock ? 'In Stock' : 'Out'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <div className="flex items-center gap-1">
                        <IconRenderer name="star" className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                        <span className="font-bold text-navy">{p.ratings.average.toFixed(1)}</span>
                        <span className="text-xs text-slate-400">({p.ratings.count})</span>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => { setSelectedProduct(p); setIsProductModalOpen(true); }}
                          className="btn-outline py-2 px-3 text-xs"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteProduct(p.id)}
                          className="p-2 text-red-500 bg-red-50 rounded-lg"
                        >
                          <IconRenderer name="trash" className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search orders (ID, Email)..." 
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={searchOrders}
              onChange={e => setSearchOrders(e.target.value)}
            />
          </div>

          {filteredOrders.length === 0 ? (
            <div className="bg-white rounded-3xl shadow-xl p-20 text-center">
              <div className="flex justify-center mb-4">
                <IconRenderer name="package" className="w-16 h-16 text-slate-300" />
              </div>
              <h3 className="text-2xl font-bold text-slate-700 mb-2">No Orders Yet</h3>
              <p className="text-slate-400">Orders will appear here when customers place them in the store.</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
              <div className="overflow-x-auto hidden sm:block">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className="p-6 font-bold">Order ID</th>
                      <th className="p-6 font-bold">Customer</th>
                      <th className="p-6 font-bold">Items</th>
                      <th className="p-6 font-bold">Total</th>
                      <th className="p-6 font-bold">Status</th>
                      <th className="p-6 font-bold">Payment</th>
                      <th className="p-6 font-bold">Date</th>
                      <th className="p-6 font-bold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredOrders.map(o => {
                      if (!o || !o.id) return null;
                      const customerName = o.deliveryAddress?.name || 'Unknown';
                      const items = Array.isArray(o.items) ? o.items : [];
                      const total = o.total || 0;
                      const orderStatus = o.orderStatus || 'pending';
                      const paymentStatus = o.paymentStatus || 'pending';
                      const createdAt = o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN') : 'N/A';
                      
                      return (
                        <tr 
                          key={o.id} 
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="p-6 font-mono text-sm text-navy font-bold">{o.id}</td>
                          <td className="p-6">
                            <div className="font-bold text-navy">{customerName}</div>
                            <div className="text-xs text-slate-400">{o.email || 'N/A'}</div>
                          </td>
                          <td className="p-6 text-slate-600">{items.length} item{items.length !== 1 ? 's' : ''}</td>
                          <td className="p-6 font-bold text-navy">₹{total}</td>
                          <td className="p-6">
                            <span className={`badge ${
                              orderStatus === 'delivered' ? 'bg-green-500' :
                              orderStatus === 'shipped' ? 'bg-blue-500' :
                              orderStatus === 'processing' ? 'bg-orange-500' :
                              'bg-slate-500'
                            }`}>
                              {orderStatus}
                            </span>
                          </td>
                          <td className="p-6">
                            <span className={`badge ${
                              paymentStatus === 'completed' ? 'bg-green-500' :
                              paymentStatus === 'pending' ? 'bg-yellow-500' :
                              'bg-red-500'
                            }`}>
                              {paymentStatus}
                            </span>
                          </td>
                          <td className="p-6 text-slate-500 text-sm">{createdAt}</td>
                          <td className="p-6">
                            <div className="flex gap-2">
                              <button 
                                onClick={() => {
                                  setSelectedOrder(o);
                                  setIsOrderDetailModalOpen(true);
                                }}
                                className="btn-primary py-2 px-4 text-sm"
                              >
                                View
                              </button>
                              <button 
                                onClick={() => handleDeleteOrder(o.id)}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              >
                                <IconRenderer name="trash" className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile View for Orders */}
              <div className="sm:hidden divide-y divide-slate-100">
                {filteredOrders.map(o => {
                  if (!o || !o.id) return null;
                  const customerName = o.deliveryAddress?.name || 'Unknown';
                  const items = Array.isArray(o.items) ? o.items : [];
                  const total = o.total || 0;
                  const orderStatus = o.orderStatus || 'pending';
                  const paymentStatus = o.paymentStatus || 'pending';
                  const createdAt = o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN') : 'N/A';
                  
                  return (
                    <div 
                      key={o.id} 
                      className="p-6 space-y-4"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-mono text-xs text-navy font-bold mb-1">{o.id}</div>
                          <div className="font-bold text-navy">{customerName}</div>
                          <div className="text-xs text-slate-400">{o.email || 'N/A'}</div>
                        </div>
                        <span className={`badge ${
                          orderStatus === 'delivered' ? 'bg-green-500' :
                          orderStatus === 'shipped' ? 'bg-blue-500' :
                          orderStatus === 'processing' ? 'bg-orange-500' :
                          'bg-slate-500'
                        }`}>
                          {orderStatus}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                        <div>
                          <div className="text-xs text-slate-400 mb-1">{items.length} item{items.length !== 1 ? 's' : ''}</div>
                          <div className="font-bold text-navy">₹{total}</div>
                        </div>
                        <div className="flex gap-2 flex-col items-end">
                          <span className={`badge text-xs ${
                            paymentStatus === 'completed' ? 'bg-green-500' :
                            paymentStatus === 'pending' ? 'bg-yellow-500' :
                            'bg-red-500'
                          }`}>
                            {paymentStatus}
                          </span>
                          <span className="text-xs text-slate-400">{createdAt}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button 
                          onClick={() => {
                            setSelectedOrder(o);
                            setIsOrderDetailModalOpen(true);
                          }}
                          className="flex-1 btn-primary py-2 text-xs"
                        >
                          View & Manage
                        </button>
                        <button 
                          onClick={() => handleDeleteOrder(o.id)}
                          className="p-2 text-red-500 bg-red-50 rounded-lg"
                        >
                          <IconRenderer name="trash" className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {isProductModalOpen && productCategories && (
        <ProductModal 
          product={selectedProduct || undefined}
          categories={productCategories}
          onClose={() => { setIsProductModalOpen(false); setSelectedProduct(null); }}
          onSave={async (productData) => {
            // Check if product exists by checking if selectedProduct was provided
            const existingProductIndex = products.findIndex(p => p.id === productData.id);
            
            if (existingProductIndex !== -1 && selectedProduct) {
              // Update existing product
              if (onEditProduct) {
                // Remove id from update data and pass id separately
                const { id, ...dataToUpdate } = productData;
                await onEditProduct(id, dataToUpdate);
              }
            } else {
              // Add new product
              if (onEditProduct) {
                await onEditProduct(productData.id, productData);
              }
            }
          }}
        />
      )}

      {isCategoryModalOpen && (
        <CategoryModal 
          category={selectedCategory || undefined}
          onClose={() => { setIsCategoryModalOpen(false); setSelectedCategory(null); }}
          onSave={async (categoryData) => {
            try {
              const existingCategory = productCategories.find(c => c.id === categoryData.id);
              
              if (existingCategory && selectedCategory) {
                // Update existing category
                if (onUpdateCategory) {
                  const { id, ...dataToUpdate } = categoryData;
                  await onUpdateCategory(id, dataToUpdate);
                  showToast('Category updated successfully!', 'success');
                }
              } else {
                // Add new category
                if (onAddCategory) {
                  await onAddCategory(categoryData);
                  showToast('Category added successfully!', 'success');
                }
              }
            } catch (error: any) {
              showToast(error.message || 'Failed to save category', 'error');
            }
          }}
        />
      )}

      {isGatewayModalOpen && (
        <GatewayModal 
          gateway={selectedGateway}
          onClose={() => { setIsGatewayModalOpen(false); setSelectedGateway(null); }}
          onSave={handleSaveGateway}
        />
      )}

      {isOrderDetailModalOpen && selectedOrder && (
        <OrderManageModal 
          order={selectedOrder}
          onClose={() => { setIsOrderDetailModalOpen(false); setSelectedOrder(null); }}
          currentUser={currentUser}
          onUpdateOrder={onUpdateOrder}
          onDeleteOrder={onDeleteOrder}
        />
      )}

      {tab === 'reviews' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search reviews (Product, User)..." 
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={searchReviews}
              onChange={e => setSearchReviews(e.target.value)}
            />
          </div>

          {(productReviews || []).length === 0 ? (
            <div className="bg-white rounded-3xl shadow-xl p-20 text-center">
              <div className="flex justify-center mb-4">
                <IconRenderer name="star" className="w-16 h-16 text-slate-300" />
              </div>
              <h3 className="text-2xl font-bold text-slate-700 mb-2">No Reviews Yet</h3>
              <p className="text-slate-400">Customer reviews will appear here.</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className="p-4 sm:p-6 font-bold text-sm">Product</th>
                      <th className="p-4 sm:p-6 font-bold text-sm">User</th>
                      <th className="p-4 sm:p-6 font-bold text-sm">Rating</th>
                      <th className="p-4 sm:p-6 font-bold text-sm">Images</th>
                      <th className="p-4 sm:p-6 font-bold text-sm">Date</th>
                      <th className="p-4 sm:p-6 font-bold text-sm">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(productReviews || []).filter((r: ProductReview) => 
                      (r.productId?.toLowerCase().includes(searchReviews.toLowerCase()) ||
                       r.userName?.toLowerCase().includes(searchReviews.toLowerCase()) ||
                       r.text?.toLowerCase().includes(searchReviews.toLowerCase()))
                    ).map(review => (
                      <tr key={review.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 sm:p-6 font-medium text-slate-600 text-sm">{review.productId || 'N/A'}</td>
                        <td className="p-4 sm:p-6">
                          <div className="font-bold text-navy text-sm">{review.userName}</div>
                          <div className="text-xs text-slate-400">{review.uid}</div>
                        </td>
                        <td className="p-4 sm:p-6">
                          <div className="flex gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <span key={i} className="text-yellow-400 text-sm">
                                {i < review.rating ? '★' : '☆'}
                              </span>
                            ))}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">{review.rating}/5</div>
                        </td>
                        <td className="p-4 sm:p-6 text-sm">
                          {review.images && review.images.length > 0 ? (
                            <span className="badge bg-blue-500">{review.images.length} images</span>
                          ) : (
                            <span className="text-slate-400 text-xs">No images</span>
                          )}
                        </td>
                        <td className="p-4 sm:p-6 text-xs sm:text-sm text-slate-500">
                          {new Date(review.date).toLocaleDateString('en-IN')}
                        </td>
                        <td className="p-4 sm:p-6">
                          <div className="flex gap-2">
                            <button 
                              onClick={() => {
                                setSelectedReview(review);
                                setIsReviewModalOpen(true);
                              }}
                              className="btn-primary py-2 px-3 text-xs"
                            >
                              View
                            </button>
                            <button 
                              onClick={() => handleDeleteReview(review.id)}
                              className="btn-danger py-2 px-3 text-xs bg-red-500 hover:bg-red-600 text-white rounded-lg"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmationModal 
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
      />

      {/* Review Details Modal */}
      {isReviewModalOpen && selectedReview && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-yellow-400 to-amber-400 p-4 sm:p-6 flex items-start justify-between flex-shrink-0">
              <div className="flex-1">
                <h2 className="text-xl sm:text-2xl font-bold text-navy mb-2">Customer Review</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex gap-0.5 text-yellow-500">
                    {[...Array(5)].map((_, i) => (
                      <span key={i} className="text-lg sm:text-xl">
                        {i < selectedReview.rating ? '★' : '☆'}
                      </span>
                    ))}
                  </div>
                  <span className="font-bold text-navy bg-white/80 px-2.5 py-0.5 rounded-lg text-sm sm:text-base">{selectedReview.rating}/5</span>
                </div>
              </div>
              <button 
                onClick={() => { setIsReviewModalOpen(false); setSelectedReview(null); }}
                className="p-1.5 sm:p-2 hover:bg-white/20 rounded-full transition-all flex-shrink-0"
              >
                <IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6 text-navy" />
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">
              {/* User Info */}
              <div className="bg-slate-50 p-3 sm:p-4 rounded-lg sm:rounded-xl border border-slate-200">
                <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-2">Reviewed By</p>
                <h3 className="text-base sm:text-lg font-bold text-navy mb-1">{selectedReview.userName}</h3>
                <div className="space-y-0.5 text-xs sm:text-sm text-slate-600">
                  <p><span className="font-semibold">Email:</span> {selectedReview.userEmail || selectedReview.uid}</p>
                  <p><span className="font-semibold">Date:</span> {new Date(selectedReview.date).toLocaleDateString('en-IN')}</p>
                  <p><span className="font-semibold">Product:</span> {selectedReview.productId}</p>
                </div>
              </div>

              {/* Review Text */}
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 uppercase tracking-widest">Review</h4>
                <div className="bg-blue-50 border-l-4 border-blue-500 p-3 sm:p-4 rounded-lg">
                  <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {selectedReview.text}
                  </p>
                </div>
              </div>

              {/* Images */}
              {selectedReview.images && selectedReview.images.length > 0 && (
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 uppercase tracking-widest">
                    Images ({selectedReview.images.length})
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                    {selectedReview.images.map((img, idx) => (
                      <div key={idx} className="group cursor-pointer">
                        <img 
                          src={img} 
                          alt={`Review image ${idx + 1}`}
                          className="w-full h-24 sm:h-32 object-cover rounded-lg shadow-md group-hover:shadow-lg transition-all group-hover:scale-105"
                          onClick={() => window.open(img, '_blank')}
                          title="Click to view full size"
                        />
                        <p className="text-xs text-slate-500 mt-1 text-center">Img {idx + 1}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 sm:gap-3 bg-slate-50 p-3 sm:p-4 rounded-lg sm:rounded-xl border border-slate-200">
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold mb-1">Helpfulness</p>
                  <p className="text-lg sm:text-xl font-bold text-navy">👍 {selectedReview.helpful || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold mb-1">Posted</p>
                  <p className="text-sm text-slate-700">{new Date(selectedReview.date).toLocaleDateString('en-IN')}</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 border-t border-slate-200 p-3 sm:p-4 flex gap-2 flex-shrink-0">
              <button 
                onClick={async () => {
                  if (selectedReview) {
                    const currentHelpful = selectedReview.helpful || 0;
                    await onUpdateProductReview?.(selectedReview.id, { 
                      helpful: currentHelpful + 1,
                      helpfulBy: [...(selectedReview.helpfulBy || []), currentUser?.uid || 'admin']
                    });
                    setSelectedReview({ ...selectedReview, helpful: currentHelpful + 1 });
                    showToast('Marked as helpful!', 'success');
                  }
                }}
                className="flex-1 btn-outline py-2 sm:py-3 text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 hover:bg-blue-100"
              >
                <span>👍</span>
                <span className="hidden sm:inline">Mark Helpful</span>
                <span className="sm:hidden">Helpful</span>
              </button>
              <button 
                onClick={() => {
                  if (selectedReview.images && selectedReview.images.length > 0) {
                    window.open(selectedReview.images[0], '_blank');
                  }
                }}
                disabled={!selectedReview.images || selectedReview.images.length === 0}
                className="flex-1 btn-outline py-2 sm:py-3 text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconRenderer name="image" className="w-4 h-4" />
                <span className="hidden sm:inline">View Images</span>
                <span className="sm:hidden">Images</span>
              </button>
              <button 
                onClick={() => { setIsReviewModalOpen(false); setSelectedReview(null); }}
                className="flex-1 btn-primary py-2 sm:py-3 text-xs sm:text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
