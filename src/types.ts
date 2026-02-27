export type UserRole = 'user' | 'operator' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  password?: string;
  role: UserRole;
  avatar?: string;
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
  paymentMethods: string[]; // e.g., ['cash', 'razorpay', 'pay_after_work', 'free']
  gatewayIds?: string[]; // IDs of specific PaymentGateway objects
  fields?: ServiceField[];
}

export interface Service {
  id: string;
  name: string;
  icon: string;
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
