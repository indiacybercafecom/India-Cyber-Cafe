import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { AuthModal } from './components/AuthModal';
import { ToastContainer } from './components/Toast';
import { Home } from './pages/Home';
import { Services } from './pages/Services';
import { Apply } from './pages/Apply';
import { Track } from './pages/Track';
import { Profile } from './pages/Profile';
import { Admin } from './pages/Admin';
import { Operator } from './pages/Operator';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Legal } from './pages/Legal';
import { Footer } from './components/Footer';
import { ScrollToTop } from './components/ScrollToTop';
import { ApplicationDetailsModal } from './components/ApplicationDetailsModal';
import { ServiceBuilderModal } from './components/ServiceBuilderModal';
import { UserManageModal } from './components/UserManageModal';
import { auth } from './firebase';
import { signOut } from 'firebase/auth';
import { showToast } from './components/Toast';
import { Service, Application, UserProfile, PaymentGateway } from './types';

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
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [isServiceBuilderOpen, setIsServiceBuilderOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

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
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isSidebarOpen, selectedApp, isServiceBuilderOpen, selectedUser]);

  // Push state when modal opens
  useEffect(() => {
    const isAnyModalOpen = isSidebarOpen || !!selectedApp || isServiceBuilderOpen || !!selectedUser;
    if (isAnyModalOpen) {
      window.history.pushState({ modal: true }, '');
    }
  }, [isSidebarOpen, !!selectedApp, isServiceBuilderOpen, !!selectedUser]);

  const closeSidebar = () => {
    setIsSidebarOpen(false);
    if (window.history.state?.modal) {
      window.history.back();
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      showToast('Logged out successfully!');
      navigate('/');
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const handleServiceSelect = (service: Service) => {
    if (!user) {
      navigate('/login');
      return;
    }
    setSelectedService(service);
    navigate('/apply');
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

  if (authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <ScrollToTop />
      <ToastContainer />
      
      <Navbar 
        user={user} 
        onLoginClick={() => navigate('/login')}
        onMenuClick={() => setIsSidebarOpen(true)}
        onLogoClick={() => navigate('/')}
      />

      <Sidebar 
        isOpen={isSidebarOpen}
        onClose={closeSidebar}
        user={user}
        onNavigate={(page) => navigate(`/${page === 'home' ? '' : page}`)}
        onLogout={handleLogout}
      />

      <AuthModal 
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      <main className="pt-[100px] pb-20 px-[5%] max-w-7xl mx-auto">
        <Routes>
          <Route path="/" element={<Home onNavigate={(p) => navigate(`/${p === 'home' ? '' : p}`)} services={services} onSelectService={handleServiceSelect} />} />
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
          <Route path="/register" element={!user ? <Register /> : <Navigate to="/" />} />
          <Route path="/legal/:type" element={<Legal />} />
          <Route path="/services" element={<Services services={services} onSelectService={handleServiceSelect} />} />
          <Route path="/apply" element={
            selectedService && user ? (
              <Apply 
                service={selectedService} 
                user={user} 
                gateways={gateways}
                onBack={() => navigate('/services')} 
                onSuccess={() => navigate('/track')}
              />
            ) : <Navigate to="/services" />
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
            ) : <Navigate to="/" />
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
      </main>

      {selectedApp && user && (
        <ApplicationDetailsModal 
          app={selectedApp} 
          onClose={() => {
            setSelectedApp(null);
            if (window.history.state?.modal) window.history.back();
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
