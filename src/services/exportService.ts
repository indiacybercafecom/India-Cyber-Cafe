import { utils, writeFile, WorkBook } from 'xlsx';
import { Application, UserProfile, Service, PaymentGateway, Product, ProductCategory, Order, ProductReview } from '../types';

/**
 * Comprehensive Export Service
 * Exports complete data with all fields (not just selected columns)
 */

// ============== HELPER FUNCTIONS ==============

/**
 * Convert complex objects to readable strings
 */
const stringifyComplexValue = (value: any): string => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // For arrays, show count and types
    return `[${value.length} item${value.length > 1 ? 's' : ''}]`;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Complex Object]';
    }
  }
  return String(value);
};

/**
 * Flatten nested objects for Excel display
 */
const flattenObject = (obj: any, prefix = ''): Record<string, any> => {
  const flattened: Record<string, any> = {};

  const flatten = (current: any, prop: string) => {
    if (current === null || current === undefined) {
      flattened[prop] = 'N/A';
    } else if (Array.isArray(current)) {
      flattened[prop] = `[${current.length} items]`;
      // Store JSON version in a separate column
      flattened[`${prop}_JSON`] = JSON.stringify(current);
    } else if (typeof current === 'object' && !(current instanceof Date)) {
      for (const key in current) {
        if (current.hasOwnProperty(key)) {
          flatten(current[key], `${prop}_${key}`);
        }
      }
    } else if (current instanceof Date) {
      flattened[prop] = current.toISOString();
    } else {
      flattened[prop] = stringifyComplexValue(current);
    }
  };

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      flatten(obj[key], key);
    }
  }

  return flattened;
};

// ============== APPLICATIONS EXPORT ==============

export const exportApplications = (applications: Application[]): any[] => {
  return applications.map(app => ({
    'ID': app.id,
    'User Name': app.name,
    'Email': app.email,
    'Service ID': app.serviceId,
    'Service Name': app.serviceName,
    'Sub-Service': app.subserviceName || 'N/A',
    'Charge': app.charge || 0,
    'Status': app.status,
    'Payment Method': app.paymentMethod || 'N/A',
    'Payment Status': app.paymentStatus || 'N/A',
    'Razorpay Payment ID': app.razorpayPaymentId || 'N/A',
    'Razorpay Order ID': app.razorpayOrderId || 'N/A',
    'Assigned To': app.assignedTo || 'Unassigned',
    'Date': app.date ? new Date(app.date).toLocaleString('en-IN') : 'N/A',
    'File URL': app.fileUrl || 'N/A',
    'Details JSON': JSON.stringify(app.details || {}),
    'Notes Count': (app.notes || []).length,
    'Notes JSON': JSON.stringify(app.notes || []),
  }));
};

// ============== USERS EXPORT ==============

export const exportUsers = (users: UserProfile[]): any[] => {
  return users.map(u => ({
    'UID': u.uid,
    'Name': u.name,
    'Email': u.email,
    'Phone': u.phone || 'N/A',
    'Role': u.role,
    'Avatar URL': u.avatar || 'N/A',
    'Created At': new Date(u.createdAt).toLocaleString('en-IN'),
    'Address': u.address ? JSON.stringify(u.address) : 'N/A',
    'Address Line 1': u.address?.addressLine1 || 'N/A',
    'Address Line 2': u.address?.addressLine2 || 'N/A',
    'City': u.address?.city || 'N/A',
    'State': u.address?.state || 'N/A',
    'Pincode': u.address?.pincode || 'N/A',
    'Country': u.address?.country || 'N/A',
  }));
};

// ============== SERVICES EXPORT ==============

export const exportServices = (services: Service[]): any[] => {
  return services.map(s => ({
    'Service ID': s.id,
    'Service Name': s.name,
    'Icon': s.icon || 'N/A',
    'Icon Type': s.iconType || 'class',
    'Description': s.description,
    'CSS': s.css || 'N/A',
    'Fields Count': (s.fields || []).length,
    'Fields JSON': JSON.stringify(s.fields || []),
    'Sub-Services Count': (s.subservices || []).length,
    'Sub-Services JSON': JSON.stringify(s.subservices || []),
    'Sub-Services Summary': (s.subservices || [])
      .map(ss => `${ss.name} (₹${ss.charge})`)
      .join(' | '),
  }));
};

// ============== GATEWAYS EXPORT ==============

export const exportGateways = (gateways: PaymentGateway[]): any[] => {
  return gateways.map(g => ({
    'Gateway ID': g.id,
    'Gateway Name': g.name,
    'Type': g.type,
    'Active': g.active ? 'Yes' : 'No',
    'Description': g.description,
    'Credentials JSON': JSON.stringify(g.credentials || {}),
    'Credentials Keys': Object.keys(g.credentials || {}).join(', '),
  }));
};

// ============== PRODUCTS EXPORT ==============

export const exportProducts = (products: Product[]): any[] => {
  return products.map(p => ({
    'Product ID': p.id,
    'Product Name': p.name,
    'Permalink': p.permalink,
    'Category': p.category,
    'Price': p.price,
    'Discounted Price': p.discountedPrice || 'N/A',
    'Short Description': p.shortDescription,
    'Long Description': p.longDescription,
    'Images Count': (p.images || []).length,
    'Images URLs': (p.images || []).join(' | '),
    'Requires Custom Image': p.requiresCustomImage ? 'Yes' : 'No',
    'Custom Image Instructions': p.customImageInstructions || 'N/A',
    'Turnaround Time': p.turnaroundTime || 'N/A',
    'Delivery Charges': p.deliveryCharges || 0,
    'In Stock': p.inStock ? 'Yes' : 'No',
    'Average Rating': p.ratings?.average || 0,
    'Rating Count': p.ratings?.count || 0,
    'Rating Breakdown': JSON.stringify(p.ratings?.breakdown || {}),
    'SEO Title': p.seoTitle || 'N/A',
    'SEO Description': p.seoDescription || 'N/A',
    'SEO Keywords': p.seoKeywords || 'N/A',
    'Payment Methods': (p.paymentMethods || []).join(', '),
  }));
};

// ============== CATEGORIES EXPORT ==============

export const exportCategories = (categories: ProductCategory[]): any[] => {
  return categories.map(c => ({
    'Category ID': c.id,
    'Category Name': c.name,
    'Description': c.description,
    'Icon': c.icon || 'N/A',
    'Order': c.order || 'N/A',
  }));
};

// ============== ORDERS EXPORT ==============

export const exportOrders = (orders: Order[]): any[] => {
  return orders.map(o => ({
    'Order ID': o.id,
    'User ID': o.uid || 'Guest',
    'Customer Email': o.email,
    'Customer Name': o.deliveryAddress?.name || 'N/A',
    'Customer Phone': o.deliveryAddress?.phone || 'N/A',
    'Items Count': (o.items || []).length,
    'Items JSON': JSON.stringify(o.items || []),
    'Subtotal': o.subtotal || 0,
    'Delivery Charges': o.deliveryCharges || 0,
    'Discount': o.discount || 0,
    'Total': o.total || 0,
    'Order Status': o.orderStatus || 'pending',
    'Payment Status': o.paymentStatus || 'pending',
    'Payment Method': o.paymentMethod || 'N/A',
    'Razorpay Payment ID': o.razorpayPaymentId || 'N/A',
    'Razorpay Order ID': o.razorpayOrderId || 'N/A',
    'Created At': o.createdAt ? new Date(o.createdAt).toLocaleString('en-IN') : 'N/A',
    'Updated At': o.updatedAt ? new Date(o.updatedAt).toLocaleString('en-IN') : 'N/A',
    'Delivery Address': JSON.stringify(o.deliveryAddress || {}),
    'Address Line 1': o.deliveryAddress?.addressLine1 || 'N/A',
    'Address Line 2': o.deliveryAddress?.addressLine2 || 'N/A',
    'City': o.deliveryAddress?.city || 'N/A',
    'State': o.deliveryAddress?.state || 'N/A',
    'Pincode': o.deliveryAddress?.pincode || 'N/A',
    'Country': o.deliveryAddress?.country || 'N/A',
    'Notes': (o.notes && o.notes.length > 0) ? JSON.stringify(o.notes) : 'N/A',
  }));
};

// ============== REVIEWS EXPORT ==============

export const exportReviews = (reviews: ProductReview[]): any[] => {
  return reviews.map(r => ({
    'Review ID': r.id,
    'Product ID': r.productId,
    'User ID': r.uid,
    'User Name': r.userName,
    'User Email': r.userEmail || 'N/A',
    'Rating': r.rating,
    'Review Text': r.text,
    'Images Count': (r.images || []).length,
    'Images URLs': (r.images || []).join(' | '),
    'Helpful Count': r.helpful || 0,
    'Helpful By Count': (r.helpfulBy || []).length,
    'Date': r.date ? new Date(r.date).toLocaleString('en-IN') : 'N/A',
  }));
};

// ============== MAIN EXPORT FUNCTION ==============

export interface ExportOptions {
  format: 'excel' | 'json';
  fileName?: string;
}

export const exportDataComprehensive = (
  type: 'apps' | 'users' | 'services' | 'payments' | 'products' | 'categories' | 'orders' | 'reviews' | 'all',
  data: {
    applications?: Application[];
    users?: UserProfile[];
    services?: Service[];
    gateways?: PaymentGateway[];
    products?: Product[];
    productCategories?: ProductCategory[];
    orders?: Order[];
    productReviews?: ProductReview[];
  },
  options: ExportOptions = { format: 'excel' }
) => {
  const fileName = options.fileName || `ICC_Export_${type}_${Date.now()}`;

  if (options.format === 'json') {
    // Export as JSON
    const exportData: any = {};

    if ((type === 'apps' || type === 'all') && data.applications) {
      exportData.applications = data.applications;
    }
    if ((type === 'users' || type === 'all') && data.users) {
      exportData.users = data.users;
    }
    if ((type === 'services' || type === 'all') && data.services) {
      exportData.services = data.services;
    }
    if ((type === 'payments' || type === 'all') && data.gateways) {
      exportData.gateways = data.gateways;
    }
    if ((type === 'products' || type === 'all') && data.products) {
      exportData.products = data.products;
    }
    if ((type === 'categories' || type === 'all') && data.productCategories) {
      exportData.categories = data.productCategories;
    }
    if ((type === 'orders' || type === 'all') && data.orders) {
      exportData.orders = data.orders;
    }
    if ((type === 'reviews' || type === 'all') && data.productReviews) {
      exportData.reviews = data.productReviews;
    }

    // Create and download JSON file
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } else {
    // Export as Excel
    const wb = utils.book_new();

    if (type === 'apps' || type === 'all') {
      if (data.applications && data.applications.length > 0) {
        const appData = exportApplications(data.applications);
        const ws = utils.json_to_sheet(appData);
        // Set column widths
        const colWidths = Object.keys(appData[0]).map(key => ({ wch: Math.min(30, key.length + 2) }));
        ws['!cols'] = colWidths;
        utils.book_append_sheet(wb, ws, 'Applications');
      }
    }

    if (type === 'users' || type === 'all') {
      if (data.users && data.users.length > 0) {
        const userData = exportUsers(data.users);
        const ws = utils.json_to_sheet(userData);
        const colWidths = Object.keys(userData[0]).map(key => ({ wch: Math.min(30, key.length + 2) }));
        ws['!cols'] = colWidths;
        utils.book_append_sheet(wb, ws, 'Users');
      }
    }

    if (type === 'services' || type === 'all') {
      if (data.services && data.services.length > 0) {
        const serviceData = exportServices(data.services);
        const ws = utils.json_to_sheet(serviceData);
        const colWidths = Object.keys(serviceData[0]).map(key => ({ wch: Math.min(40, key.length + 2) }));
        ws['!cols'] = colWidths;
        utils.book_append_sheet(wb, ws, 'Services');
      }
    }

    if (type === 'payments' || type === 'all') {
      if (data.gateways && data.gateways.length > 0) {
        const gatewayData = exportGateways(data.gateways);
        const ws = utils.json_to_sheet(gatewayData);
        const colWidths = Object.keys(gatewayData[0]).map(key => ({ wch: Math.min(35, key.length + 2) }));
        ws['!cols'] = colWidths;
        utils.book_append_sheet(wb, ws, 'Gateways');
      }
    }

    if (type === 'products' || type === 'all') {
      if (data.products && data.products.length > 0) {
        const productData = exportProducts(data.products);
        const ws = utils.json_to_sheet(productData);
        const colWidths = Object.keys(productData[0]).map(key => ({ wch: Math.min(30, key.length + 2) }));
        ws['!cols'] = colWidths;
        utils.book_append_sheet(wb, ws, 'Products');
      }
    }

    if (type === 'categories' || type === 'all') {
      if (data.productCategories && data.productCategories.length > 0) {
        const categoryData = exportCategories(data.productCategories);
        const ws = utils.json_to_sheet(categoryData);
        const colWidths = Object.keys(categoryData[0]).map(key => ({ wch: Math.min(20, key.length + 2) }));
        ws['!cols'] = colWidths;
        utils.book_append_sheet(wb, ws, 'Categories');
      }
    }

    if (type === 'orders' || type === 'all') {
      if (data.orders && data.orders.length > 0) {
        const orderData = exportOrders(data.orders);
        const ws = utils.json_to_sheet(orderData);
        const colWidths = Object.keys(orderData[0]).map(key => ({ wch: Math.min(35, key.length + 2) }));
        ws['!cols'] = colWidths;
        utils.book_append_sheet(wb, ws, 'Orders');
      }
    }

    if (type === 'reviews' || type === 'all') {
      if (data.productReviews && data.productReviews.length > 0) {
        const reviewData = exportReviews(data.productReviews);
        const ws = utils.json_to_sheet(reviewData);
        const colWidths = Object.keys(reviewData[0]).map(key => ({ wch: Math.min(25, key.length + 2) }));
        ws['!cols'] = colWidths;
        utils.book_append_sheet(wb, ws, 'Reviews');
      }
    }

    // If exporting all and nothing was added, show a message
    if (wb.SheetNames.length === 0) {
      console.warn('No data available to export');
      return;
    }

    writeFile(wb, `${fileName}.xlsx`);
  }
};
