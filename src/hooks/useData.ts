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
import { Service, Application, UserProfile, PaymentGateway, Product, ProductCategory, Order, ProductReview } from '../types';

export function useData() {
  const [services, setServices] = useState<Service[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [productReviews, setProductReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let servicesLoaded = false;
    let appsLoaded = false;
    let usersLoaded = false;
    let gatewaysLoaded = false;
    let productsLoaded = false;
    let categoriesLoaded = false;
    let ordersLoaded = false;
    let reviewsLoaded = false;

    const checkLoading = () => {
      if (servicesLoaded && appsLoaded && usersLoaded && gatewaysLoaded && productsLoaded && categoriesLoaded && ordersLoaded && reviewsLoaded) {
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

    // Store - Products Listener
    const productsRef = ref(rtdb, 'products');
    const unsubProducts = onValue(productsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setProducts(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as Product)));
      } else {
        setProducts([]);
      }
      productsLoaded = true;
      checkLoading();
    });

    // Store - Product Categories Listener
    const categoriesRef = ref(rtdb, 'productCategories');
    const unsubCategories = onValue(categoriesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setProductCategories(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as ProductCategory)));
      } else {
        setProductCategories([]);
      }
      categoriesLoaded = true;
      checkLoading();
    });

    // Store - Orders Listener
    const ordersRef = ref(rtdb, 'orders');
    const unsubOrders = onValue(ordersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setOrders(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as Order)));
      } else {
        setOrders([]);
      }
      ordersLoaded = true;
      checkLoading();
    });

    // Store - Product Reviews Listener
    const reviewsRef = ref(rtdb, 'productReviews');
    const unsubReviews = onValue(reviewsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setProductReviews(Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as ProductReview)));
      } else {
        setProductReviews([]);
      }
      reviewsLoaded = true;
      checkLoading();
    });

    return () => {
      unsubServices();
      unsubApps();
      unsubUsers();
      unsubGateways();
      unsubProducts();
      unsubCategories();
      unsubOrders();
      unsubReviews();
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

  // ========== STORE PRODUCTS CRUD ==========
  const addProduct = async (product: Omit<Product, 'id'>) => {
    const newRef = push(ref(rtdb, 'products'));
    return await set(newRef, { ...product, id: newRef.key });
  };

  const updateProduct = async (id: string, data: Partial<Product>) => {
    return await update(ref(rtdb, `products/${id}`), data);
  };

  const deleteProduct = async (id: string) => {
    return await remove(ref(rtdb, `products/${id}`));
  };

  // ========== PRODUCT CATEGORIES CRUD ==========
  const addProductCategory = async (category: Omit<ProductCategory, 'id'>) => {
    const newRef = push(ref(rtdb, 'productCategories'));
    return await set(newRef, { ...category, id: newRef.key });
  };

  const updateProductCategory = async (id: string, data: Partial<ProductCategory>) => {
    return await update(ref(rtdb, `productCategories/${id}`), data);
  };

  const deleteProductCategory = async (id: string) => {
    return await remove(ref(rtdb, `productCategories/${id}`));
  };

  // ========== ORDERS CRUD ==========
  const addOrder = async (order: Omit<Order, 'id'>) => {
    const newRef = push(ref(rtdb, 'orders'));
    return await set(newRef, { ...order, id: newRef.key });
  };

  const updateOrder = async (id: string, data: Partial<Order>) => {
    return await update(ref(rtdb, `orders/${id}`), data);
  };

  const deleteOrder = async (id: string) => {
    return await remove(ref(rtdb, `orders/${id}`));
  };

  // ========== PRODUCT REVIEWS CRUD ==========
  const addProductReview = async (review: Omit<ProductReview, 'id'>) => {
    const newRef = push(ref(rtdb, 'productReviews'));
    return await set(newRef, { ...review, id: newRef.key });
  };

  const updateProductReview = async (id: string, data: Partial<ProductReview>) => {
    return await update(ref(rtdb, `productReviews/${id}`), data);
  };

  const deleteProductReview = async (id: string) => {
    return await remove(ref(rtdb, `productReviews/${id}`));
  };

  return { 
    services, 
    applications, 
    users, 
    gateways,
    products,
    productCategories,
    orders,
    productReviews,
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
    addProduct,
    updateProduct,
    deleteProduct,
    addProductCategory,
    updateProductCategory,
    deleteProductCategory,
    addOrder,
    updateOrder,
    deleteOrder,
    addProductReview,
    updateProductReview,
    deleteProductReview
  };
}
