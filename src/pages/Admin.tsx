import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Application, UserProfile, Service, PaymentGateway, Product, ProductCategory, Order } from '../types';
import { IconRenderer } from '../components/Icons';
import { showToast } from '../components/Toast';
import { utils, writeFile } from 'xlsx';
import { GatewayModal } from '../components/GatewayModal';
import { ConfirmationModal } from '../components/ConfirmationModal';

interface AdminProps {
  applications: Application[];
  users: UserProfile[];
  services: Service[];
  gateways: PaymentGateway[];
  products?: Product[];
  productCategories?: ProductCategory[];
  orders?: Order[];
  onViewApp: (app: Application) => void;
  onDeleteApp: (id: string) => void;
  onEditService: (service: Service) => void;
  onAddService: () => void;
  onDeleteService: (id: string) => void;
  onManageUser: (user: UserProfile) => void;
  onAddGateway: (gateway: PaymentGateway) => void;
  onUpdateGateway: (id: string, gateway: Partial<PaymentGateway>) => void;
  onDeleteGateway: (id: string) => void;
  onEditProduct?: (product: Product) => void;
  onAddProduct?: () => void;
  onDeleteProduct?: (id: string) => void;
  onViewOrder?: (order: Order) => void;
}

export function Admin({ 
  applications, 
  users, 
  services, 
  gateways,
  products = [],
  productCategories = [],
  orders = [],
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
  onViewOrder
}: AdminProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'apps' | 'users' | 'services' | 'payments' | 'products' | 'orders'>('apps');
  const [selectedGateway, setSelectedGateway] = useState<PaymentGateway | null>(null);
  const [isGatewayModalOpen, setIsGatewayModalOpen] = useState(false);
  
  // Search States
  const [searchApps, setSearchApps] = useState('');
  const [searchUsers, setSearchUsers] = useState('');
  const [searchServices, setSearchServices] = useState('');
  const [searchPayments, setSearchPayments] = useState('');
  const [searchProducts, setSearchProducts] = useState('');
  const [searchOrders, setSearchOrders] = useState('');

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
      onConfirm: () => {
        onDeleteGateway(id);
        showToast('Gateway deleted');
      }
    });
  };

  const exportToExcel = (type: 'apps' | 'users' | 'services' | 'payments' | 'all' = 'apps') => {
    const wb = utils.book_new();

    if (type === 'apps' || type === 'all') {
      const data = applications.map(app => ({
        ID: app.id,
        User: app.name,
        Email: app.email,
        Service: app.serviceName,
        SubService: app.subserviceName || 'N/A',
        Charge: app.charge,
        Status: app.status,
        Date: new Date(app.date).toLocaleString(),
        AssignedTo: app.assignedTo || 'Unassigned'
      }));
      const ws = utils.json_to_sheet(data);
      utils.book_append_sheet(wb, ws, "Applications");
    }

    if (type === 'users' || type === 'all') {
      const data = users.map(u => ({
        UID: u.uid,
        Name: u.name,
        Email: u.email,
        Phone: u.phone || 'N/A',
        Role: u.role,
        Joined: new Date(u.createdAt).toLocaleString()
      }));
      const ws = utils.json_to_sheet(data);
      utils.book_append_sheet(wb, ws, "Users");
    }

    if (type === 'services' || type === 'all') {
      const data = services.map(s => ({
        ID: s.id,
        Name: s.name,
        Description: s.description,
        SubServices: s.subservices.map(ss => `${ss.name} (₹${ss.charge})`).join(', ')
      }));
      const ws = utils.json_to_sheet(data);
      utils.book_append_sheet(wb, ws, "Services");
    }

    if (type === 'payments' || type === 'all') {
      const data = gateways.map(g => ({
        ID: g.id,
        Name: g.name,
        Type: g.type,
        Active: g.active ? 'Yes' : 'No',
        Description: g.description
      }));
      const ws = utils.json_to_sheet(data);
      utils.book_append_sheet(wb, ws, "Gateways");
    }

    writeFile(wb, `ICC_Data_${type}_${Date.now()}.xlsx`);
    showToast(`Export ${type} successful!`);
  };

  const handleDeleteApp = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Application',
      message: 'Are you sure you want to delete this application? All associated data will be permanently removed.',
      type: 'danger',
      onConfirm: () => {
        onDeleteApp(id);
        showToast('Application deleted', 'success');
      }
    });
  };

  const handleDeleteService = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Service',
      message: 'Are you sure you want to delete this service? This will remove it from the public services list.',
      type: 'danger',
      onConfirm: () => {
        onDeleteService(id);
        showToast('Service deleted', 'success');
      }
    });
  };

  // Filtered Lists
  const filteredApps = applications.filter(app => 
    app.id.toLowerCase().includes(searchApps.toLowerCase()) ||
    app.name.toLowerCase().includes(searchApps.toLowerCase()) ||
    app.email.toLowerCase().includes(searchApps.toLowerCase()) ||
    app.serviceName.toLowerCase().includes(searchApps.toLowerCase())
  );

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchUsers.toLowerCase()) ||
    u.email.toLowerCase().includes(searchUsers.toLowerCase()) ||
    (u.phone && u.phone.includes(searchUsers))
  );

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchServices.toLowerCase()) ||
    s.description.toLowerCase().includes(searchServices.toLowerCase())
  );

  const filteredGateways = gateways.filter(g => 
    g.name.toLowerCase().includes(searchPayments.toLowerCase()) ||
    g.type.toLowerCase().includes(searchPayments.toLowerCase())
  );

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(searchProducts.toLowerCase()) ||
    p.shortDescription.toLowerCase().includes(searchProducts.toLowerCase())
  );

  const filteredOrders = orders.filter(o =>
    o.id.toLowerCase().includes(searchOrders.toLowerCase()) ||
    o.email.toLowerCase().includes(searchOrders.toLowerCase())
  );

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
        <div className="flex gap-2">
          <button onClick={() => exportToExcel('all')} className="bg-navy text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-navy-light transition-all shadow-lg">
            <IconRenderer name="file-export" className="w-5 h-5" />
            Export All Data
          </button>
          <button onClick={() => exportToExcel(tab)} className="bg-green-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-green-700 transition-all shadow-lg shadow-green-600/20">
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
          { id: 'payments', label: 'Payments', icon: 'credit-card' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${
              tab === t.id ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-navy'
            }`}
          >
            <IconRenderer name={t.icon} className="w-4 h-4" />
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
          <div className="relative max-w-md">
            <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search users (Name, Email, Phone)..." 
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={searchUsers}
              onChange={e => setSearchUsers(e.target.value)}
            />
          </div>
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="p-6 font-bold">Avatar</th>
                    <th className="p-6 font-bold">Details</th>
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
                      <td className="p-6">
                        <div className="font-bold text-navy">{u.name}</div>
                        <div className="text-xs text-slate-400">{u.email}</div>
                      </td>
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
                      <td colSpan={4} className="p-10 text-center text-slate-400 italic">No users found.</td>
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
                    <div>
                      <div className="font-bold text-navy">{u.name}</div>
                      <div className="text-xs text-slate-400">{u.email}</div>
                      <span className={`badge mt-1 inline-block ${
                        u.role === 'admin' ? 'bg-red-500' : 
                        u.role === 'operator' ? 'bg-blue-500' : 'bg-slate-500'
                      }`}>
                        {u.role}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => onManageUser(u)}
                    className="p-2 bg-slate-100 rounded-xl text-navy"
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
                <IconRenderer name={s.icon} className="w-12 h-12 text-primary mb-4" />
                <h3 className="text-lg font-bold text-navy">{s.name}</h3>
                <p className="text-slate-400 text-sm mt-2 line-clamp-2">{s.description}</p>
              </div>
            ))}
            {filteredServices.length === 0 && (
              <div className="col-span-full p-10 text-center text-slate-400 italic">No services found.</div>
            )}
          </div>
        </div>
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

      {isGatewayModalOpen && (
        <GatewayModal 
          gateway={selectedGateway}
          onClose={() => { setIsGatewayModalOpen(false); setSelectedGateway(null); }}
          onSave={handleSaveGateway}
        />
      )}

      <ConfirmationModal 
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
      />
    </div>
  );
}
