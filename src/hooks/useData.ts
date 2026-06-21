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
import { cacheManager } from '../utils/cacheManager';
import { syncManager, mergeIncrementalData } from '../utils/syncManager';
import { generateSlug } from '../utils/slugGenerator';

// Pagination limits for large datasets
const PAGINATION_LIMITS = {
  applications: 50,
  orders: 100,
  users: 200,
  productReviews: 100
};

interface LoadingState {
  services: boolean;
  applications: boolean;
  users: boolean;
  gateways: boolean;
  products: boolean;
  productCategories: boolean;
  orders: boolean;
  productReviews: boolean;
}

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
  const [loadingState, setLoadingState] = useState<LoadingState>({
    services: false,
    applications: false,
    users: false,
    gateways: false,
    products: false,
    productCategories: false,
    orders: false,
    productReviews: false
  });

  useEffect(() => {
    // STEP 1: Load from cache immediately for instant display
    const cachedServices = cacheManager.get('services') || [];
    const cachedApplications = cacheManager.get('applications') || [];
    const cachedUsers = cacheManager.get('users') || [];
    const cachedGateways = cacheManager.get('gateways') || [];
    const cachedProducts = cacheManager.get('products') || [];
    const cachedCategories = cacheManager.get('productCategories') || [];
    const cachedOrders = cacheManager.get('orders') || [];
    const cachedReviews = cacheManager.get('productReviews') || [];

    // Set cached data immediately - shows something instantly
    if (cachedServices.length > 0) setServices(cachedServices);
    if (cachedApplications.length > 0) setApplications(cachedApplications);
    if (cachedUsers.length > 0) setUsers(cachedUsers);
    if (cachedGateways.length > 0) setGateways(cachedGateways);
    if (cachedProducts.length > 0) setProducts(cachedProducts);
    if (cachedCategories.length > 0) setProductCategories(cachedCategories);
    if (cachedOrders.length > 0) setOrders(cachedOrders);
    if (cachedReviews.length > 0) setProductReviews(cachedReviews);

    // If we have all cached data, mark loading as false immediately
    const hasCacheData = cachedServices.length > 0 || cachedApplications.length > 0;
    if (hasCacheData) {
      setLoading(false);
    }

    // STEP 2: Check sync status - only fetch if sync is needed
    // This prevents full database reloads on every page refresh
    const lastSyncServices = syncManager.getLastSync('services');
    const lastSyncApps = syncManager.getLastSync('applications');
    const lastSyncUsers = syncManager.getLastSync('users');
    const lastSyncGateways = syncManager.getLastSync('gateways');
    const lastSyncProducts = syncManager.getLastSync('products');
    const lastSyncCategories = syncManager.getLastSync('productCategories');
    const lastSyncOrders = syncManager.getLastSync('orders');
    const lastSyncReviews = syncManager.getLastSync('productReviews');

    const now = Date.now();
    const SYNC_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    // Only fetch collections that need sync (older than 5 minutes)
    const needsSyncServices = now - lastSyncServices > SYNC_THRESHOLD;
    const needsSyncApps = now - lastSyncApps > SYNC_THRESHOLD;
    const needsSyncUsers = now - lastSyncUsers > SYNC_THRESHOLD;
    const needsSyncGateways = now - lastSyncGateways > SYNC_THRESHOLD;
    const needsSyncProducts = now - lastSyncProducts > SYNC_THRESHOLD;
    const needsSyncCategories = now - lastSyncCategories > SYNC_THRESHOLD;
    const needsSyncOrders = now - lastSyncOrders > SYNC_THRESHOLD;
    const needsSyncReviews = now - lastSyncReviews > SYNC_THRESHOLD;

    let servicesLoaded = !needsSyncServices; // If no sync needed, mark as loaded
    let appsLoaded = !needsSyncApps;
    let usersLoaded = !needsSyncUsers;
    let gatewaysLoaded = !needsSyncGateways;
    let productsLoaded = !needsSyncProducts;
    let categoriesLoaded = !needsSyncCategories;
    let ordersLoaded = !needsSyncOrders;
    let reviewsLoaded = !needsSyncReviews;

    const checkLoading = () => {
      if (servicesLoaded && appsLoaded && usersLoaded && gatewaysLoaded && 
          productsLoaded && categoriesLoaded && ordersLoaded && reviewsLoaded) {
        setLoading(false);
      }
    };

    const unsubscribers: (() => void)[] = [];

    // STEP 3: Only fetch from Firebase if sync is needed
    // Services - only fetch if needed to sync
    if (needsSyncServices) {
      const servicesRef = ref(rtdb, 'services');
      const unsubServices = onValue(servicesRef, (snapshot) => {
        const data = snapshot.val();
        const servicesToSet = data ? Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val })) : [];
        
        // Merge with cached data instead of replacing
        const mergedServices = mergeIncrementalData.mergeItems(cachedServices, servicesToSet);
        setServices(mergedServices);
        cacheManager.set('services', mergedServices);
        syncManager.updateSync('services');
        servicesLoaded = true;
        checkLoading();
      }, (error) => {
        console.error('Error fetching services:', error);
        servicesLoaded = true;
        checkLoading();
      });
      unsubscribers.push(unsubServices);
    }

    // Applications - only fetch if needed to sync
    if (needsSyncApps) {
      const appsRef = query(ref(rtdb, 'applications'), orderByChild('date'));
      const unsubApps = onValue(appsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const apps = Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as Application));
          const sortedApps = apps.reverse();
          const paginatedApps = sortedApps.slice(0, PAGINATION_LIMITS.applications);
          
          // Merge with cached data
          const mergedApps = mergeIncrementalData.mergeItems(cachedApplications, paginatedApps);
          setApplications(mergedApps);
          cacheManager.set('applications', mergedApps);
        } else {
          setApplications(cachedApplications.length > 0 ? cachedApplications : []);
          cacheManager.set('applications', cachedApplications);
        }
        syncManager.updateSync('applications');
        appsLoaded = true;
        checkLoading();
      }, (error) => {
        console.error('Error fetching applications:', error);
        appsLoaded = true;
        checkLoading();
      });
      unsubscribers.push(unsubApps);
    }

    // Users - only fetch if needed to sync
    if (needsSyncUsers) {
      const usersRef = ref(rtdb, 'users');
      const unsubUsers = onValue(usersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const allUsers = Object.entries(data).map(([uid, val]: [string, any]) => ({ uid, ...val } as UserProfile));
          const paginatedUsers = allUsers.slice(0, PAGINATION_LIMITS.users);
          
          // Merge with cached data
          const mergedUsers = mergeIncrementalData.mergeItems(cachedUsers, paginatedUsers);
          setUsers(mergedUsers);
          cacheManager.set('users', mergedUsers);
        } else {
          setUsers(cachedUsers.length > 0 ? cachedUsers : []);
          cacheManager.set('users', cachedUsers);
        }
        syncManager.updateSync('users');
        usersLoaded = true;
        checkLoading();
      }, (error) => {
        console.error('Error fetching users:', error);
        usersLoaded = true;
        checkLoading();
      });
      unsubscribers.push(unsubUsers);
    }

    // Gateways - only fetch if needed to sync
    if (needsSyncGateways) {
      const gatewaysRef = ref(rtdb, 'gateways');
      const unsubGateways = onValue(gatewaysRef, (snapshot) => {
        const data = snapshot.val();
        const gatewaysToSet = data ? Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as PaymentGateway)) : [];
        
        // Merge with cached data
        const mergedGateways = mergeIncrementalData.mergeItems(cachedGateways, gatewaysToSet);
        setGateways(mergedGateways);
        cacheManager.set('gateways', mergedGateways);
        syncManager.updateSync('gateways');
        gatewaysLoaded = true;
        checkLoading();
      }, (error) => {
        console.error('Error fetching gateways:', error);
        gatewaysLoaded = true;
        checkLoading();
      });
      unsubscribers.push(unsubGateways);
    }

    // Products - only fetch if needed to sync
    if (needsSyncProducts) {
      setLoadingState(prev => ({ ...prev, products: true }));
      const productsRef = ref(rtdb, 'products');
      const unsubProducts = onValue(productsRef, (snapshot) => {
        const data = snapshot.val();
        const productsToSet = data ? Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as Product)) : [];
        
        // Merge with cached data
        const mergedProducts = mergeIncrementalData.mergeItems(cachedProducts, productsToSet);
        setProducts(mergedProducts);
        cacheManager.set('products', mergedProducts);
        syncManager.updateSync('products');
        setLoadingState(prev => ({ ...prev, products: false }));
        productsLoaded = true;
        checkLoading();
      }, (error) => {
        console.error('Error fetching products:', error);
        setLoadingState(prev => ({ ...prev, products: false }));
        productsLoaded = true;
        checkLoading();
      });
      unsubscribers.push(unsubProducts);
    } else {
      // If no sync needed, mark products as not loading
      setLoadingState(prev => ({ ...prev, products: false }));
    }

    // Product Categories - only fetch if needed to sync
    if (needsSyncCategories) {
      setLoadingState(prev => ({ ...prev, productCategories: true }));
      const categoriesRef = ref(rtdb, 'productCategories');
      const unsubCategories = onValue(categoriesRef, (snapshot) => {
        const data = snapshot.val();
        const categoriesToSet = data ? Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as ProductCategory)) : [];
        
        // Merge with cached data
        const mergedCategories = mergeIncrementalData.mergeItems(cachedCategories, categoriesToSet);
        setProductCategories(mergedCategories);
        cacheManager.set('productCategories', mergedCategories);
        syncManager.updateSync('productCategories');
        setLoadingState(prev => ({ ...prev, productCategories: false }));
        categoriesLoaded = true;
        checkLoading();
      }, (error) => {
        console.error('Error fetching product categories:', error);
        setLoadingState(prev => ({ ...prev, productCategories: false }));
        categoriesLoaded = true;
        checkLoading();
      });
      unsubscribers.push(unsubCategories);
    } else {
      // If no sync needed, mark categories as not loading
      setLoadingState(prev => ({ ...prev, productCategories: false }));
    }
    }

    // Orders - only fetch if needed to sync
    if (needsSyncOrders) {
      const ordersRef = ref(rtdb, 'orders');
      const unsubOrders = onValue(ordersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const extractOrders = (obj: any, prefix: string = ''): Order[] => {
            const orders: Order[] = [];
            if (!obj || typeof obj !== 'object') return orders;
            for (const [key, value] of Object.entries(obj)) {
              if (value && typeof value === 'object' && ('email' in value || 'items' in value || 'total' in value)) {
                const orderId = (value as any).id || (prefix ? `${prefix}/${key}` : key);
                orders.push({ id: orderId, ...(value as any) } as Order);
              } else if (value && typeof value === 'object') {
                const nestedPrefix = prefix ? `${prefix}/${key}` : key;
                orders.push(...extractOrders(value, nestedPrefix));
              }
            }
            return orders;
          };
          const fetchedOrders = extractOrders(data);
          const paginatedOrders = fetchedOrders.slice(0, PAGINATION_LIMITS.orders);
          
          // Merge with cached data
          const mergedOrders = mergeIncrementalData.mergeItems(cachedOrders, paginatedOrders);
          setOrders(mergedOrders);
          cacheManager.set('orders', mergedOrders);
        } else {
          setOrders(cachedOrders.length > 0 ? cachedOrders : []);
          cacheManager.set('orders', cachedOrders);
        }
        syncManager.updateSync('orders');
        ordersLoaded = true;
        checkLoading();
      }, (error) => {
        console.error('Error fetching orders:', error);
        ordersLoaded = true;
        checkLoading();
      });
      unsubscribers.push(unsubOrders);
    }

    // Product Reviews - only fetch if needed to sync
    if (needsSyncReviews) {
      setLoadingState(prev => ({ ...prev, productReviews: true }));
      const reviewsRef = ref(rtdb, 'productReviews');
      const unsubReviews = onValue(reviewsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const allReviews = Object.entries(data).map(([id, val]: [string, any]) => ({ id, ...val } as ProductReview));
          const paginatedReviews = allReviews.slice(0, PAGINATION_LIMITS.productReviews);
          
          // Merge with cached data
          const mergedReviews = mergeIncrementalData.mergeItems(cachedReviews, paginatedReviews);
          setProductReviews(mergedReviews);
          cacheManager.set('productReviews', mergedReviews);
        } else {
          setProductReviews(cachedReviews.length > 0 ? cachedReviews : []);
          cacheManager.set('productReviews', cachedReviews);
        }
        syncManager.updateSync('productReviews');
        setLoadingState(prev => ({ ...prev, productReviews: false }));
        reviewsLoaded = true;
        checkLoading();
      }, (error) => {
        console.error('Error fetching product reviews:', error);
        setLoadingState(prev => ({ ...prev, productReviews: false }));
        reviewsLoaded = true;
        checkLoading();
      });
      unsubscribers.push(unsubReviews);
    } else {
      // If no sync needed, mark reviews as not loading
      setLoadingState(prev => ({ ...prev, productReviews: false }));
    }

    return () => {
      unsubscribers.forEach(unsub => unsub());
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
    // Generate slug-based ID from product name for better SEO
    let productId = generateSlug(product.name);
    
    // Append timestamp if product with this slug already exists
    const existingProduct = products.find(p => p.id === productId);
    if (existingProduct) {
      const timestamp = Date.now().toString().slice(-6);
      productId = `${productId}-${timestamp}`;
    }
    
    await set(ref(rtdb, `products/${productId}`), { ...product, id: productId });
    
    // Update local state immediately so UI reflects changes
    const newProduct = { ...product, id: productId } as Product;
    const updatedProducts = [...products, newProduct];
    setProducts(updatedProducts);
    cacheManager.set('products', updatedProducts);
    syncManager.updateSync('products');
  };

  const updateProduct = async (id: string, data: Partial<Product>) => {
    await update(ref(rtdb, `products/${id}`), data);
    
    // Update local state immediately
    const updatedProducts = products.map(p => p.id === id ? { ...p, ...data } : p);
    setProducts(updatedProducts);
    cacheManager.set('products', updatedProducts);
    syncManager.updateSync('products');
  };

  const deleteProduct = async (id: string) => {
    await remove(ref(rtdb, `products/${id}`));
    
    // Update local state immediately
    const updatedProducts = products.filter(p => p.id !== id);
    setProducts(updatedProducts);
    cacheManager.set('products', updatedProducts);
    syncManager.updateSync('products');
  };

  // ========== PRODUCT CATEGORIES CRUD ==========
  const addProductCategory = async (category: Omit<ProductCategory, 'id'>) => {
    // Generate slug-based ID from category name for better SEO
    let categoryId = generateSlug(category.name);
    
    // Append timestamp if category with this slug already exists
    const existingCategory = productCategories.find(c => c.id === categoryId);
    if (existingCategory) {
      const timestamp = Date.now().toString().slice(-6);
      categoryId = `${categoryId}-${timestamp}`;
    }
    
    await set(ref(rtdb, `productCategories/${categoryId}`), { ...category, id: categoryId });
    
    // Update local state immediately
    const newCategory = { ...category, id: categoryId } as ProductCategory;
    const updatedCategories = [...productCategories, newCategory];
    setProductCategories(updatedCategories);
    cacheManager.set('productCategories', updatedCategories);
    syncManager.updateSync('productCategories');
  };

  const updateProductCategory = async (id: string, data: Partial<ProductCategory>) => {
    await update(ref(rtdb, `productCategories/${id}`), data);
    
    // Update local state immediately
    const updatedCategories = productCategories.map(c => c.id === id ? { ...c, ...data } : c);
    setProductCategories(updatedCategories);
    cacheManager.set('productCategories', updatedCategories);
    syncManager.updateSync('productCategories');
  };

  const deleteProductCategory = async (id: string) => {
    await remove(ref(rtdb, `productCategories/${id}`));
    
    // Update local state immediately
    const updatedCategories = productCategories.filter(c => c.id !== id);
    setProductCategories(updatedCategories);
    cacheManager.set('productCategories', updatedCategories);
    syncManager.updateSync('productCategories');
  };

  // ========== ORDERS CRUD ==========
  const addOrder = async (order: Omit<Order, 'id'> | Order) => {
    // Validate that uid is not undefined (Firebase doesn't allow undefined values)
    if (!order.uid) {
      throw new Error('User ID is required to place an order');
    }
    
    // Log order details for debugging
    console.log('Saving order to Firebase:', order);
    if (order.items && order.items.length > 0) {
      console.log('Order items with customImageUrl:', order.items.map(item => ({
        productName: item.productName,
        customImageUrl: item.customImageUrl
      })));
    }
    
    // Remove any undefined values from the order object
    const cleanOrder = Object.fromEntries(
      Object.entries(order).filter(([_, value]) => value !== undefined)
    );
    
    // If order has custom id (e.g., from generateOrderId), use it; otherwise generate from Firebase
    const orderId = 'id' in order && order.id ? order.id : undefined;
    
    if (orderId) {
      // Use custom order ID
      return await set(ref(rtdb, `orders/${orderId}`), { ...cleanOrder, id: orderId });
    } else {
      // Generate Firebase key for ID
      const newRef = push(ref(rtdb, 'orders'));
      return await set(newRef, { ...cleanOrder, id: newRef.key });
    }
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

  // Cache management utilities
  const clearAllCache = () => cacheManager.clearAll();
  const clearCache = (key: string) => cacheManager.clear(key);
  const refreshData = () => {
    clearAllCache();
    syncManager.clearAllTimestamps(); // Also clear sync timestamps to force full sync next time
    window.location.reload();
  };

  // Force sync for specific collection
  const forceSyncCollection = (collectionName: string) => {
    syncManager.clearTimestamp(collectionName);
  };

  // Get sync status for debugging/admin
  const getSyncStatus = () => {
    const collections = ['services', 'applications', 'users', 'gateways', 'products', 'productCategories', 'orders', 'productReviews'];
    return collections.reduce((acc, col) => {
      acc[col] = syncManager.getSyncInfo(col);
      return acc;
    }, {} as Record<string, any>);
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
    loadingState,
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
    deleteProductReview,
    clearAllCache,
    clearCache,
    refreshData,
    forceSyncCollection,
    getSyncStatus
  };
}
