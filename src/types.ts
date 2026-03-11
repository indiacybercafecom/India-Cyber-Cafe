export type UserRole = 'user' | 'operator' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  password?: string;
  role: UserRole;
  avatar?: string;
  address?: OrderAddress;
  createdAt: number;
}

export interface ServiceField {
  label: string;
  type: 'text' | 'email' | 'phone' | 'date' | 'checkbox' | 'select' | 'file' | 'textarea';
  options?: string[];
}

export interface SubService {
  name: string;
  charge: number;
  originalCharge?: number;
  paymentMethods: string[]; // e.g., ['cash', 'razorpay', 'pay_after_work', 'free']
  gatewayIds?: string[]; // IDs of specific PaymentGateway objects
  fields?: ServiceField[];
}

export interface Service {
  id: string;
  name: string;
  icon: string;
  iconType?: 'class' | 'url'; // 'class' for icon class names, 'url' for image/gif/mp4 links
  description: string;
  fields: ServiceField[];
  subservices: SubService[];
  css?: string;
}

export interface ApplicationNote {
  type: 'note' | 'status';
  by: string;
  email: string;
  text: string;
  time: string;
  status?: string;
  attachment?: string;
  attachmentName?: string;
}

export interface Application {
  id: string;
  uid: string;
  email: string;
  name: string;
  serviceName: string;
  serviceId: string;
  subserviceName?: string;
  charge?: number;
  details: Record<string, any>;
  fileUrl?: string;
  status: 'processing' | 'clarification' | 'completed' | 'rejected';
  assignedTo?: string; // operator email
  date: string;
  paymentMethod?: string;
  paymentStatus?: 'pending' | 'completed';
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  notes: ApplicationNote[];
}

export interface PaymentGateway {
  id: string;
  type: 'razorpay' | 'paypal' | 'stripe' | 'cashfree' | 'custom';
  name: string;
  active: boolean;
  description: string;
  credentials: Record<string, string>;
}

// Store & Products Section
export interface ProductCategory {
  id: string;
  name: string;
  description: string;
  icon?: string;
  order?: number;
}

export interface ProductReview {
  id: string;
  productId: string;
  uid: string;
  userName: string;
  userEmail?: string; // Email of the reviewer
  rating: number; // 1-5
  text: string;
  images?: string[]; // review photo URLs
  date: string;
  helpful?: number; // count of helpful votes
  helpfulBy?: string[]; // array of user IDs who marked as helpful
}

export interface Product {
  id: string;
  name: string;
  permalink: string; // URL-friendly slug based on product name
  category: string;
  price: number;
  discountedPrice: number;
  shortDescription: string;
  longDescription: string;
  images: string[]; // array of image URLs
  requiresCustomImage: boolean; // whether user needs to upload custom image
  customImageInstructions?: string;
  turnaroundTime?: string; // e.g., "5-7 business days"
  deliveryCharges?: number;
  inStock: boolean;
  ratings: {
    average: number;
    count: number;
    breakdown?: { [key: number]: number };
  };
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  paymentMethods?: ('online' | 'cod' | 'both')[]; // Payment methods: online (Razorpay), cash on delivery, or both
}

export interface OrderItem {
  productId: string;
  productName: string;
  price: number;
  discountedPrice?: number;
  quantity: number;
  customImageUrl?: string; // URL of custom image user uploaded
  specialInstructions?: string;
}

export interface OrderAddress {
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface Order {
  id: string;
  uid?: string; // optional if guest checkout
  email: string;
  items: OrderItem[];
  deliveryAddress: OrderAddress;
  subtotal: number;
  deliveryCharges: number;
  discount?: number;
  total: number;
  paymentMethod: 'razorpay' | 'cash' | 'bank_transfer';
  paymentStatus: 'pending' | 'completed' | 'failed';
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  orderStatus: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  notes: ApplicationNote[];
  createdAt: string;
  updatedAt: string;
}
