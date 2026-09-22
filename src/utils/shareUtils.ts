import { Service, SubService, Product } from '../types';

export const DEFAULT_ICC_IMAGE = 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png';
export const BASE_PRODUCTION_URL = 'https://b.indiacybercafe.com';

export interface ShareData {
  id?: string;
  title: string;
  text: string;
  url: string;
  image: string;
  category: 'Service' | 'Sub-Service' | 'Product';
  price?: number;
  originalPrice?: number;
  description?: string;
}

export function getBaseOrigin(customOrigin?: string): string {
  if (customOrigin) return customOrigin.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  return BASE_PRODUCTION_URL;
}

export function slugify(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Clean markdown symbols and extra whitespace for social cards and previews
 */
export function cleanPlainText(text?: string, maxLength = 160): string {
  if (!text) return '';
  const cleaned = text
    .replace(/<[^>]*>/g, '') // strip html
    .replace(/[#*_`~>[\]]/g, '') // strip markdown
    .replace(/\s+/g, ' ') // collapse whitespaces
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 3).trim() + '...';
}

/**
 * Builds ShareData for a Service
 */
export function getServiceShareData(service: Service, customOrigin?: string): ShareData {
  const origin = getBaseOrigin(customOrigin);
  const url = `${origin}/services/${service.id}`;
  
  const hasValidIcon = service.iconType === 'url' && service.icon && !service.icon.toLowerCase().endsWith('.mp4');
  const image = hasValidIcon ? service.icon! : DEFAULT_ICC_IMAGE;

  return {
    id: service.id,
    title: service.name,
    text: `Apply online for *${service.name}* on India Cyber Cafe. Quick and secure digital services.`,
    url,
    image,
    category: 'Service',
    description: cleanPlainText(service.description, 160),
  };
}

/**
 * Builds ShareData for a Sub-Service
 */
export function getSubServiceShareData(service: Service, subservice: SubService, customOrigin?: string): ShareData {
  const origin = getBaseOrigin(customOrigin);
  const subSlug = slugify(subservice.name);
  const url = `${origin}/services/${service.id}/${subSlug}`;

  const hasSubImage = subservice.imageType === 'url' && subservice.image && !subservice.image.toLowerCase().endsWith('.mp4');
  const hasServiceIcon = service.iconType === 'url' && service.icon && !service.icon.toLowerCase().endsWith('.mp4');
  const image = hasSubImage ? subservice.image! : (hasServiceIcon ? service.icon! : DEFAULT_ICC_IMAGE);

  const priceText = subservice.charge ? ` Charge: ₹${subservice.charge}.` : '';

  return {
    id: `${service.id}-${subSlug}`,
    title: `${subservice.name} (${service.name})`,
    text: `Apply for *${subservice.name}* under *${service.name}* online at India Cyber Cafe.${priceText} Fast and reliable assistance!`,
    url,
    image,
    category: 'Sub-Service',
    price: subservice.charge,
    originalPrice: subservice.originalCharge,
    description: `Apply online for ${subservice.name} under ${service.name}. Fast processing, secure submission & expert support.`,
  };
}

/**
 * Builds ShareData for a Product
 */
export function getProductShareData(product: Product, customOrigin?: string): ShareData {
  const origin = getBaseOrigin(customOrigin);
  const url = `${origin}/store/${product.category || 'all'}/${product.id}`;

  const hasImage = product.images && product.images.length > 0 && !product.images[0].toLowerCase().endsWith('.mp4');
  const image = hasImage ? product.images[0] : DEFAULT_ICC_IMAGE;

  const price = product.discountedPrice || product.price;

  return {
    id: product.id,
    title: product.name,
    text: `Check out *${product.name}* at India Cyber Cafe Store! Price: ₹${price}. Order online with fast delivery!`,
    url,
    image,
    category: 'Product',
    price,
    originalPrice: product.discountedPrice ? product.price : undefined,
    description: cleanPlainText(product.shortDescription || product.seoDescription, 160),
  };
}

/**
 * Social Sharing URL Helpers
 */
export function getWhatsAppShareUrl(url: string, text: string): string {
  const message = `${text}\n\n👉 View details: ${url}`;
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
}

export function getTelegramShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

export function getFacebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

export function getTwitterShareUrl(url: string, text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function getLinkedInShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

export function getEmailShareUrl(title: string, text: string, url: string): string {
  const subject = `${title} | India Cyber Cafe`;
  const body = `${text}\n\nLink: ${url}\n\nIndia Cyber Cafe - Digital Services, CSC & Online Form Portal`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
