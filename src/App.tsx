import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { useServices } from './hooks/useServices';
import { useProducts } from './hooks/useProducts';
import { useProductCategories } from './hooks/useProductCategories';
import { useApplications } from './hooks/useApplications';
import { useOrders } from './hooks/useOrders';
import { useUsers } from './hooks/useUsers';
import { useGateways } from './hooks/useGateways';
import { useProductReviews } from './hooks/useProductReviews';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { AuthModal } from './components/AuthModal';
import { ToastContainer } from './components/Toast';
import { Home } from './pages/Home';
import { PageSkeleton } from './components/Skeleton';
import { Footer } from './components/Footer';
import { ScrollToTop } from './components/ScrollToTop';
import { ApplicationDetailsModal } from './components/ApplicationDetailsModal';
import { ServiceBuilderModal } from './components/ServiceBuilderModal';
import { UserManageModal } from './components/UserManageModal';
import { ConfirmationModal, LogoutChoiceModal } from './components/ConfirmationModal';
import { auth } from './firebase';
import { signOut } from 'firebase/auth';
import { showToast } from './components/Toast';
import { Service, Application, UserProfile } from './types';

// Lazy load other pages
const Services = lazy(() => import('./pages/Services').then(m => ({ default: m.Services })));
const ServiceDetail = lazy(() => import('./pages/ServiceDetail').then(m => ({ default: m.ServiceDetail })));
const Apply = lazy(() => import('./pages/Apply').then(m => ({ default: m.Apply })));
const Track = lazy(() => import('./pages/Track').then(m => ({ default: m.Track })));
const Profile = lazy(() => import('./pages/Profile').then(m => ({ default: m.Profile })));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const Operator = lazy(() => import('./pages/Operator').then(m => ({ default: m.Operator })));
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Register').then(m => ({ default: m.Register })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then(m => ({ default: m.ForgotPassword })));
const Legal = lazy(() => import('./pages/Legal').then(m => ({ default: m.Legal })));
const Store = lazy(() => import('./pages/Store').then(m => ({ default: m.Store })));
const StoreProduct = lazy(() => import('./pages/StoreProduct').then(m => ({ default: m.StoreProduct })));
const StoreCheckout = lazy(() => import('./pages/StoreCheckout').then(m => ({ default: m.StoreCheckout })));
const OrderConfirmation = lazy(() => import('./pages/OrderConfirmation').then(m => ({ default: m.OrderConfirmation })));

// Preload function
const preloadPages = () => {
  const pages = [
    () => import('./pages/Services'),
    () => import('./pages/Track'),
    () => import('./pages/Profile'),
    () => import('./pages/Login'),
    () => import('./pages/Store'),
  ];
  pages.forEach(p => p());
};

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminRoute = location.pathname === '/admin';
  const isOperatorRoute = location.pathname === '/operator';
  const isTrackRoute = location.pathname.startsWith('/track');
  const isApplyRoute = location.pathname.startsWith('/services/') && location.pathname.split('/').length >= 4;
  const isCheckoutRoute = location.pathname.startsWith('/store/') && location.pathname.endsWith('/checkout');
  const requiresProfile = isAdminRoute || isOperatorRoute || isTrackRoute || isApplyRoute || isCheckoutRoute || location.pathname === '/profile';
  const { user, authUser, loading: authLoading, profileLoading } = useAuth(requiresProfile);

  // Home/public data (loaded always, cache-first)
  const { services, addService, updateService, deleteService } = useServices();
  const { products, addProduct, updateProduct, deleteProduct } = useProducts();
  const { productCategories, addProductCategory, updateProductCategory, deleteProductCategory } = useProductCategories();

  // User-specific data (loaded only when user is authenticated)
  const userApplications = useApplications(
    isTrackRoute && user && user.role !== 'admin'
      ? { mode: 'user', uid: user.uid }
      : isOperatorRoute && user?.role === 'operator' && user.email
        ? { mode: 'operator', uid: user.uid, operatorEmail: user.email }
        : { mode: 'disabled' }
  );
  const userOrders = useOrders(
    isTrackRoute && user && user.role !== 'admin'
      ? { mode: 'user', uid: user.uid }
      : { mode: 'disabled' }
  );

  // Admin-only data (loaded only when user is admin)
  const adminApplications = useApplications(
    isAdminRoute && user?.role === 'admin' ? { mode: 'admin' } : { mode: 'disabled' }
  );
  const adminUsers = useUsers(isAdminRoute && user?.role === 'admin');
  const gateways = useGateways(
    (isAdminRoute && user?.role === 'admin') ||
    (isApplyRoute && !!user) ||
    (isTrackRoute && !!user)
  );
  const adminOrders = useOrders(
    isAdminRoute && user?.role === 'admin' ? { mode: 'admin' } : { mode: 'disabled' }
  );
  const adminReviews = useProductReviews(undefined, isAdminRoute && user?.role === 'admin');
  
  // Local state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [isServiceBuilderOpen, setIsServiceBuilderOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isLogoutChoiceOpen, setIsLogoutChoiceOpen] = useState(false);

  // Determine which data to use based on user role
  const applications = user?.role === 'admin' ? adminApplications.applications : userApplications.applications;
  const orders = user?.role === 'admin' ? adminOrders.orders : userOrders.orders;
  const users = user?.role === 'admin' ? adminUsers.users : [];
  const applicationsLoading = user?.role === 'admin' ? adminApplications.loading : userApplications.loading;
  const ordersLoading = user?.role === 'admin' ? adminOrders.loading : userOrders.loading;
  const usersLoading = adminUsers.loading;

  // Back button handling for modals and sidebar
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isSidebarOpen) {
        setIsSidebarOpen(false);
      } else if (isLogoutChoiceOpen) {
        setIsLogoutChoiceOpen(false);
      } else if (isLogoutConfirmOpen) {
        setIsLogoutConfirmOpen(false);
      } else if (selectedUser) {
        setSelectedUser(null);
      } else if (isServiceBuilderOpen) {
        setIsServiceBuilderOpen(false);
      } else if (selectedApp) {
        setSelectedApp(null);
      } else if (isAuthModalOpen) {
        setIsAuthModalOpen(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isSidebarOpen, selectedApp, isServiceBuilderOpen, selectedUser, isLogoutConfirmOpen, isLogoutChoiceOpen, isAuthModalOpen]);

  useEffect(() => {
    const isAnyModalOpen = isSidebarOpen || !!selectedApp || isServiceBuilderOpen || !!selectedUser || isLogoutConfirmOpen || isLogoutChoiceOpen || isAuthModalOpen;
    if (isAnyModalOpen) {
      if (!window.history.state?.modal) {
        window.history.pushState({ modal: true }, '');
      }
    }
  }, [isSidebarOpen, !!selectedApp, isServiceBuilderOpen, !!selectedUser, isLogoutConfirmOpen, isLogoutChoiceOpen, isAuthModalOpen]);

  const closeSidebar = () => {
    setIsSidebarOpen(false);
    if (window.history.state?.modal) {
      window.history.back();
    }
  };

  // Preload pages after home page is ready
  useEffect(() => {
    const timer = setTimeout(preloadPages, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleLogout = async () => {
    try {
      setIsSidebarOpen(false);
      await signOut(auth);
      setIsLogoutConfirmOpen(false);
      setIsLogoutChoiceOpen(true);
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const handleSaveService = async (service: Service) => {
    try {
      if (editingService) {
        await updateService(service.id, service);
      } else {
        await addService(service);
      }
      setIsServiceBuilderOpen(false);
      setEditingService(null);
      showToast('Service saved successfully!');
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <ScrollToTop />
      <ToastContainer />

      <Navbar
        user={user}
        loading={authLoading}
        onLoginClick={() => navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)}
        onMenuClick={() => setIsSidebarOpen(true)}
        onLogoClick={() => navigate('/')}
      />

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={closeSidebar}
        user={user}
        onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
        onLogout={() => setIsLogoutConfirmOpen(true)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      <main className="pt-[100px] pb-20 px-[3%] sm:px-[5%] w-full max-w-[1440px] mx-auto">
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            {/* Home - renders immediately with cached/public data */}
            <Route
              path="/"
              element={
                <Home
                  onNavigate={(p) => navigate(`/${p === 'home' ? '' : p}`)}
                  services={services}
                  products={products}
                  onSelectService={() => {}}
                  loading={false}
                />
              }
            />
            <Route path="/login" element={<Login user={user} />} />
            <Route path="/register" element={<Register user={user} />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/legal/:type" element={<Legal />} />
            <Route path="/about" element={<Legal />} />
            <Route path="/contact" element={<Legal />} />
            <Route path="/payment-policy" element={<Navigate to="/legal/terms" />} />
            <Route path="/refund-policy" element={<Navigate to="/legal/refund" />} />
            {/* Services - public data only */}
            <Route path="/services" element={<Services services={services} />} />
            <Route path="/services/:serviceId" element={<ServiceDetail services={services} />} />
            {/* Apply - services + gateways loaded on demand */}
            <Route
              path="/services/:serviceId/:subserviceName"
              element={
                user ? (
                  <Apply
                    services={services}
                    user={user}
                    gateways={gateways.gateways}
                    onSuccess={() => navigate('/track')}
                  />
                ) : (
                  <Navigate
                    to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
                  />
                )
              }
            />
            {/* Store Routes - products + categories */}
            <Route
              path="/store"
              element={
                <Store
                  products={products}
                  categories={productCategories}
                  isLoading={false}
                />
              }
            />
            <Route path="/store/order-confirmation" element={<OrderConfirmation />} />
            <Route
              path="/store/:categoryId/:productId/checkout"
              element={
                <StoreCheckout products={products} user={user} onAddOrder={userOrders.addOrder} />
              }
            />
            {/* StoreProduct - products + reviews for specific product */}
            <Route
              path="/store/:categoryId/:productId"
              element={
                <StoreProductRoute
                  products={products}
                  user={user}
                />
              }
            />
            {/* Track - user applications + orders */}
            <Route
              path="/track"
              element={
                user ? (
                  <Track
                    applications={applications}
                    orders={orders}
                    user={user}
                    gateways={gateways.gateways}
                    onViewDetails={setSelectedApp}
                    onUpdateApp={userApplications.updateApplication}
                  />
                ) : (
                  <Navigate
                    to={`/login?redirect=${encodeURIComponent('/track')}`}
                  />
                )
              }
            />
            <Route
              path="/track/:applicationId"
              element={
                user ? (
                  <Track
                    applications={applications}
                    orders={orders}
                    user={user}
                    gateways={gateways.gateways}
                    onViewDetails={setSelectedApp}
                    onUpdateApp={userApplications.updateApplication}
                  />
                ) : (
                  <Navigate
                    to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
                  />
                )
              }
            />
            <Route
              path="/profile"
              element={
                authLoading ? (
                  <PageSkeleton />
                ) : user ? (
                  <Profile user={user} />
                ) : (
                  <Navigate to="/" />
                )
              }
            />
            {/* Operator - all applications */}
            <Route
              path="/operator"
              element={
                authLoading ? (
                  <PageSkeleton />
                ) : user?.role === 'operator' ? (
                  <Operator
                    applications={userApplications.applications}
                    user={user}
                    onViewApp={setSelectedApp}
                  />
                ) : (
                  <Navigate to="/" />
                )
              }
            />
            {/* Admin - all data */}
            <Route
              path="/admin"
              element={
                authLoading ? (
                  <PageSkeleton />
                ) : user?.role === 'admin' ? (
                  <Admin
                    applications={adminApplications.applications}
                    users={users}
                    services={services}
                    gateways={gateways.gateways}
                    products={products}
                    productCategories={productCategories}
                    orders={orders}
                    productReviews={adminReviews.productReviews}
                    onViewApp={setSelectedApp}
                    onDeleteApp={adminApplications.deleteApplication}
                    onEditService={(s) => {
                      setEditingService(s);
                      setIsServiceBuilderOpen(true);
                    }}
                    onAddService={() => {
                      setEditingService(null);
                      setIsServiceBuilderOpen(true);
                    }}
                    onDeleteService={deleteService}
                    onManageUser={setSelectedUser}
                    onAddGateway={gateways.addGateway}
                    onUpdateGateway={gateways.updateGateway}
                    onDeleteGateway={gateways.deleteGateway}
                    onEditProduct={async (id: string, data: any) => {
                      const existingProduct = products.find((p) => p.id === id);
                      if (existingProduct) {
                        await updateProduct(id, data);
                      } else {
                        await addProduct(data);
                      }
                    }}
                    onAddProduct={() => {}}
                    onDeleteProduct={deleteProduct}
                    onViewOrder={setSelectedApp as any}
                    onUpdateOrder={adminOrders.updateOrder}
                    onDeleteOrder={adminOrders.deleteOrder}
                    onAddCategory={addProductCategory}
                    onUpdateCategory={updateProductCategory}
                    onDeleteCategory={deleteProductCategory}
                    onDeleteProductReview={async (id: string) => {
                      // Admin review delete
                    }}
                    onUpdateProductReview={adminReviews.updateProductReview}
                    currentUser={user}
                  />
                ) : (
                  <Navigate to="/" />
                )
              }
            />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </main>

      {selectedApp && user && (
        <ApplicationDetailsModal
          app={selectedApp}
          onClose={() => {
            setSelectedApp(null);
            if (location.pathname.includes('/track/')) {
              navigate('/track');
            } else if (window.history.state?.modal) {
              window.history.back();
            }
          }}
          currentUser={user}
          operators={users.filter((u) => u.role === 'operator')}
        />
      )}

      {isServiceBuilderOpen && (
        <ServiceBuilderModal
          service={editingService}
          onClose={() => {
            setIsServiceBuilderOpen(false);
            setEditingService(null);
            if (window.history.state?.modal) window.history.back();
          }}
          onSave={handleSaveService}
        />
      )}

      {selectedUser && (
        <UserManageModal
          user={selectedUser}
          onClose={() => {
            setSelectedUser(null);
            if (window.history.state?.modal) window.history.back();
          }}
        />
      )}

      <Footer />

      <ConfirmationModal
        isOpen={isLogoutConfirmOpen}
        onClose={() => setIsLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
        title="Logout Confirmation"
        message="Are you sure you want to logout from your account?"
        confirmText="Logout"
        type="warning"
      />

      <LogoutChoiceModal
        isOpen={isLogoutChoiceOpen}
        onClose={() => setIsLogoutChoiceOpen(false)}
        onChoice={(choice) => {
          setIsLogoutChoiceOpen(false);
          if (choice === 'relogin') {
            navigate('/login');
          } else {
            navigate('/');
          }
        }}
      />
    </div>
  );
}

// Component to handle StoreProduct route with proper review loading
function StoreProductRoute({ products, user }: { products: any[]; user: UserProfile | null }) {
  const { productId } = useParams<{ productId: string }>();
  const { productReviews, addProductReview } = useProductReviews(productId);

  return (
    <StoreProduct
      products={products}
      reviews={productReviews}
      user={user}
      isLoading={false}
      onAddReview={addProductReview}
    />
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

