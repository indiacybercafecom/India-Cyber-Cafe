import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
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
import { Service, Application, UserProfile, PaymentGateway } from './types';

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

// Preload function
const preloadPages = () => {
  const pages = [
    () => import('./pages/Services'),
    () => import('./pages/Track'),
    () => import('./pages/Profile'),
    () => import('./pages/Login'),
  ];
  pages.forEach(p => p());
};

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const { 
    services, 
    applications, 
    users, 
    gateways, 
    loading: dataLoading,
    addService,
    updateService,
    deleteService,
    deleteApplication,
    updateApplication,
    addGateway,
    updateGateway,
    deleteGateway
  } = useData();
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [isServiceBuilderOpen, setIsServiceBuilderOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isLogoutChoiceOpen, setIsLogoutChoiceOpen] = useState(false);

  // Back button handling for modals and sidebar
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isSidebarOpen) {
        setIsSidebarOpen(false);
      } else if (selectedApp) {
        setSelectedApp(null);
      } else if (isServiceBuilderOpen) {
        setIsServiceBuilderOpen(false);
      } else if (selectedUser) {
        setSelectedUser(null);
      } else if (isLogoutConfirmOpen) {
        setIsLogoutConfirmOpen(false);
      } else if (isLogoutChoiceOpen) {
        setIsLogoutChoiceOpen(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isSidebarOpen, selectedApp, isServiceBuilderOpen, selectedUser, isLogoutConfirmOpen, isLogoutChoiceOpen]);

  // Push state when modal opens
  useEffect(() => {
    const isAnyModalOpen = isSidebarOpen || !!selectedApp || isServiceBuilderOpen || !!selectedUser || isLogoutConfirmOpen || isLogoutChoiceOpen;
    if (isAnyModalOpen) {
      window.history.pushState({ modal: true }, '');
    }
  }, [isSidebarOpen, !!selectedApp, isServiceBuilderOpen, !!selectedUser, isLogoutConfirmOpen, isLogoutChoiceOpen]);

  const closeSidebar = () => {
    setIsSidebarOpen(false);
    if (window.history.state?.modal) {
      window.history.back();
    }
  };

  // Preload pages after home page is ready
  useEffect(() => {
    // Small delay to ensure home page is interactive first
    const timer = setTimeout(preloadPages, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleLogout = async () => {
    try {
      setIsSidebarOpen(false); // Close sidebar immediately
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
            <Route path="/" element={
              <Home 
                onNavigate={(p) => navigate(`/${p === 'home' ? '' : p}`)} 
                services={services} 
                onSelectService={() => {}} 
                loading={dataLoading}
              />
            } />
            <Route path="/login" element={<Login user={user} />} />
            <Route path="/register" element={<Register user={user} />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/legal/:type" element={<Legal />} />
            <Route path="/about" element={<Legal />} />
            <Route path="/contact" element={<Legal />} />
            <Route path="/payment-policy" element={<Navigate to="/legal/terms" />} />
            <Route path="/refund-policy" element={<Navigate to="/legal/refund" />} />
            <Route path="/services" element={<Services services={services} />} />
            <Route path="/services/:serviceId" element={<ServiceDetail services={services} />} />
            <Route path="/services/:serviceId/:subserviceName" element={
              user ? (
                <Apply 
                  services={services} 
                  user={user} 
                  gateways={gateways}
                  onSuccess={() => navigate('/track')}
                />
              ) : <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} />
            } />
            <Route path="/track" element={
              user ? (
                <Track 
                  applications={applications.filter(a => a.uid === user.uid || (user.role === 'operator' && a.assignedTo === user.email))} 
                  user={user}
                  gateways={gateways}
                  onViewDetails={setSelectedApp}
                  onUpdateApp={updateApplication}
                />
              ) : <Navigate to={`/login?redirect=${encodeURIComponent('/track')}`} />
            } />
            <Route path="/track/:applicationId" element={
              user ? (
                <Track 
                  applications={applications.filter(a => a.uid === user.uid || (user.role === 'operator' && a.assignedTo === user.email))} 
                  user={user}
                  gateways={gateways}
                  onViewDetails={setSelectedApp}
                  onUpdateApp={updateApplication}
                />
              ) : <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} />
            } />
            <Route path="/profile" element={user ? <Profile user={user} /> : <Navigate to="/" />} />
            <Route path="/operator" element={
              user?.role === 'operator' ? (
                <Operator 
                  applications={applications}
                  user={user}
                  onViewApp={setSelectedApp}
                />
              ) : <Navigate to="/" />
            } />
            <Route path="/admin" element={
              user?.role === 'admin' ? (
                <Admin 
                  applications={applications}
                  users={users}
                  services={services}
                  gateways={gateways}
                  onViewApp={setSelectedApp}
                  onDeleteApp={deleteApplication}
                  onEditService={(s) => { setEditingService(s); setIsServiceBuilderOpen(true); }}
                  onAddService={() => { setEditingService(null); setIsServiceBuilderOpen(true); }}
                  onDeleteService={deleteService}
                  onManageUser={setSelectedUser}
                  onAddGateway={addGateway}
                  onUpdateGateway={updateGateway}
                  onDeleteGateway={deleteGateway}
                />
              ) : <Navigate to="/" />
            } />
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
          operators={users.filter(u => u.role === 'operator')}
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

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
