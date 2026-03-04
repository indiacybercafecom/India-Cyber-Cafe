import { useState, useEffect } from 'react';
import { 
  ref, 
  onValue, 
  set, 
  update, 
  remove, 
  push, 
  query, 
  orderByChild 
} from 'firebase/database';
import { rtdb } from '../firebase';
import { Service, Application, UserProfile, PaymentGateway, GlobalIcon } from '../types';

export function useData() {
  const [services, setServices] = useState<Service[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [globalIcons, setGlobalIcons] = useState<GlobalIcon[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let servicesLoaded = false;
    let appsLoaded = false;
    let usersLoaded = false;
    let gatewaysLoaded = false;

    const checkLoading = () => {
      if (servicesLoaded && appsLoaded && usersLoaded && gatewaysLoaded) {
        setLoading(false);
      }
    };

    const servicesRef = ref(rtdb, 'services');
    const unsubServices = onValue(servicesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setServices(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val })));
      } else {
        setServices([]);
      }
      servicesLoaded = true;
      checkLoading();
    });

    const appsRef = query(ref(rtdb, 'applications'), orderByChild('date'));
    const unsubApps = onValue(appsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const apps = Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as Application));
        setApplications(apps.reverse()); // Reverse to get desc order
      } else {
        setApplications([]);
      }
      appsLoaded = true;
      checkLoading();
    });

    const usersRef = ref(rtdb, 'users');
    const unsubUsers = onValue(usersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setUsers(Object.entries(data).map(([uid, val]: [string, any]) => ({ uid, ...val } as UserProfile)));
      } else {
        setUsers([]);
      }
      usersLoaded = true;
      checkLoading();
    });

    const gatewaysRef = ref(rtdb, 'gateways');
    const unsubGateways = onValue(gatewaysRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setGateways(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as PaymentGateway)));
      } else {
        setGateways([]);
      }
      gatewaysLoaded = true;
      checkLoading();
    });

    const iconsRef = ref(rtdb, 'globalIcons');
    const unsubIcons = onValue(iconsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setGlobalIcons(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as GlobalIcon)));
      } else {
        setGlobalIcons([]);
      }
      // We don't strictly need to wait for icons to stop loading, but good for consistency
      // If you want to include it in checkLoading, add iconsLoaded flag
    });

    return () => {
      unsubServices();
      unsubApps();
      unsubUsers();
      unsubGateways();
      unsubIcons();
    };
  }, []);

  const addApplication = async (app: Omit<Application, 'id'>) => {
    const newAppRef = push(ref(rtdb, 'applications'));
    return await set(newAppRef, app);
  };

  const updateApplication = async (id: string, data: Partial<Application>) => {
    return await update(ref(rtdb, `applications/${id}`), data);
  };

  const deleteApplication = async (id: string) => {
    return await remove(ref(rtdb, `applications/${id}`));
  };

  const addService = async (service: Service) => {
    return await set(ref(rtdb, `services/${service.id}`), service);
  };

  const updateService = async (id: string, data: Partial<Service>) => {
    return await update(ref(rtdb, `services/${id}`), data);
  };

  const deleteService = async (id: string) => {
    return await remove(ref(rtdb, `services/${id}`));
  };

  const addGateway = async (gateway: PaymentGateway) => {
    const newRef = push(ref(rtdb, 'gateways'));
    return await set(newRef, { ...gateway, id: newRef.key });
  };

  const updateGateway = async (id: string, data: Partial<PaymentGateway>) => {
    return await update(ref(rtdb, `gateways/${id}`), data);
  };

  const deleteGateway = async (id: string) => {
    return await remove(ref(rtdb, `gateways/${id}`));
  };

  const updateGlobalIcon = async (id: string, icon: string) => {
    return await update(ref(rtdb, `globalIcons/${id}`), { icon });
  };

  const addGlobalIcon = async (icon: Omit<GlobalIcon, 'id'>) => {
    const newRef = push(ref(rtdb, 'globalIcons'));
    return await set(newRef, { ...icon, id: newRef.key });
  };

  return { 
    services, 
    applications, 
    users, 
    gateways, 
    globalIcons,
    loading,
    addApplication,
    updateApplication,
    deleteApplication,
    addService,
    updateService,
    deleteService,
    addGateway,
    updateGateway,
    deleteGateway,
    updateGlobalIcon,
    addGlobalIcon
  };
}
