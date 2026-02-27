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
import { Service, Application, UserProfile, PaymentGateway } from '../types';

export function useData() {
  const [services, setServices] = useState<Service[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const servicesRef = ref(rtdb, 'services');
    const unsubServices = onValue(servicesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setServices(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val })));
      } else {
        setServices([]);
      }
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
    });

    const usersRef = ref(rtdb, 'users');
    const unsubUsers = onValue(usersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setUsers(Object.entries(data).map(([uid, val]: [string, any]) => ({ uid, ...val } as UserProfile)));
      } else {
        setUsers([]);
      }
    });

    const gatewaysRef = ref(rtdb, 'gateways');
    const unsubGateways = onValue(gatewaysRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setGateways(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as PaymentGateway)));
      } else {
        setGateways([]);
      }
    });

    setLoading(false);

    return () => {
      unsubServices();
      unsubApps();
      unsubUsers();
      unsubGateways();
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

  return { 
    services, 
    applications, 
    users, 
    gateways, 
    loading,
    addApplication,
    updateApplication,
    deleteApplication,
    addService,
    updateService,
    deleteService
  };
}
