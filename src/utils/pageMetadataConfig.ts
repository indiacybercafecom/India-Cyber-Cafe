/**
 * Page Metadata Configuration
 * Defines SEO metadata for all pages in the application
 */

export const pageMetadataConfig: Record<string, any> = {
  home: {
    title: 'India Cyber Cafe - Digital Services, CSC & Online Form Portal',
    description: 'Apply for Government Services, Jobs & Documents online with India\'s trusted digital partner. Fast, secure, and reliable digital services.',
    keywords: 'India Cyber Cafe, Digital Seva, Government Services, Online Application, CSC, Digital India',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/',
  },

  services: {
    title: 'Government Services & Digital Solutions - India Cyber Cafe',
    description: 'Browse and apply for various government services including Aadhar, PAN, Passport, and more through India Cyber Cafe.',
    keywords: 'Government Services, Aadhar, PAN Card, Passport, Digital India, Online Application',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/services',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/services',
  },

  serviceDetail: {
    title: 'Service Details - India Cyber Cafe',
    description: 'Get detailed information about government services and apply online.',
    keywords: 'Service Application, Government Services',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: (id: string) => `https://b.indiacybercafe.com/service-detail/${id}`,
    type: 'article' as const,
  },

  store: {
    title: 'Online Store - Buy Digital Services & Products - India Cyber Cafe',
    description: 'Shop for digital services, documents, and products from India Cyber Cafe. Secure checkout with Razorpay payment gateway.',
    keywords: 'Online Store, Digital Products, Government Documents, E-commerce',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/store',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/store',
  },

  storeProduct: {
    title: 'Product Details - India Cyber Cafe Store',
    description: 'View detailed information about products and services available in the India Cyber Cafe store.',
    keywords: 'Product, Digital Services, Online Shopping',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: (id: string) => `https://b.indiacybercafe.com/store-product/${id}`,
    type: 'product' as const,
  },

  apply: {
    title: 'Apply for Services - India Cyber Cafe',
    description: 'Fill out and submit your government service applications online through India Cyber Cafe.',
    keywords: 'Apply Online, Government Application, Service Application',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/apply',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/apply',
  },

  track: {
    title: 'Track Application Status - India Cyber Cafe',
    description: 'Track the status of your government service applications in real-time.',
    keywords: 'Track Application, Application Status, Order Tracking',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/track',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/track',
  },

  profile: {
    title: 'My Profile - India Cyber Cafe',
    description: 'Manage your India Cyber Cafe account, applications, and personal information.',
    keywords: 'Profile, Account Management, User Profile',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/profile',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/profile',
  },

  login: {
    title: 'Login - India Cyber Cafe',
    description: 'Sign in to your India Cyber Cafe account to access your applications and services.',
    keywords: 'Login, Sign In, User Authentication',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/login',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/login',
  },

  register: {
    title: 'Register - India Cyber Cafe',
    description: 'Create a new account on India Cyber Cafe to access government services and digital solutions.',
    keywords: 'Register, Sign Up, Create Account',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/register',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/register',
  },

  forgotPassword: {
    title: 'Forgot Password - India Cyber Cafe',
    description: 'Reset your India Cyber Cafe account password.',
    keywords: 'Forgot Password, Password Reset',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/forgot-password',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/forgot-password',
  },

  storeCheckout: {
    title: 'Checkout - India Cyber Cafe Store',
    description: 'Complete your purchase securely with our Razorpay payment gateway.',
    keywords: 'Checkout, Payment, Online Shopping',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/store-checkout',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/store-checkout',
  },

  orderConfirmation: {
    title: 'Order Confirmation - India Cyber Cafe',
    description: 'Your order has been successfully placed. Track your order status here.',
    keywords: 'Order Confirmation, Order Status',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/order-confirmation',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/order-confirmation',
  },

  legal: {
    title: 'Legal Information - India Cyber Cafe',
    description: 'Read our terms of service, privacy policy, and other legal information.',
    keywords: 'Legal, Terms of Service, Privacy Policy',
    image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
    url: 'https://b.indiacybercafe.com/legal',
    type: 'website' as const,
    canonicalUrl: 'https://b.indiacybercafe.com/legal',
  },
};

/**
 * Get metadata for a specific page
 */
export const getPageMetadata = (pageName: string, id?: string) => {
  const config = pageMetadataConfig[pageName];
  
  if (!config) {
    return pageMetadataConfig.home;
  }

  return {
    ...config,
    url: typeof config.url === 'function' && id ? config.url(id) : config.url,
  };
};
