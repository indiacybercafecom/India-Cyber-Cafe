import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

interface PageMetadata {
  title: string;
  description: string;
  keywords?: string;
  image?: string;
  url: string;
  type?: 'website' | 'article' | 'product';
  structuredData?: Record<string, any>;
  canonicalUrl?: string;
}

export const usePageMetadata = (metadata: PageMetadata) => {
  useEffect(() => {
    // Ensure URLs are HTTPS
    const secureUrl = metadata.url?.startsWith('http://') 
      ? metadata.url.replace('http://', 'https://') 
      : metadata.url;
    
    const secureImage = metadata.image?.startsWith('http://') 
      ? metadata.image.replace('http://', 'https://') 
      : metadata.image;

    // Update document title
    document.title = metadata.title;

    // Update meta description
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', metadata.description);
    }

    // Update og:url
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) {
      ogUrl.setAttribute('content', secureUrl);
    }

    // Update og:title
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.setAttribute('content', metadata.title);
    }

    // Update og:description
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) {
      ogDescription.setAttribute('content', metadata.description);
    }

    // Update og:image
    if (secureImage) {
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) {
        ogImage.setAttribute('content', secureImage);
      }
    }

    // Update canonical URL
    const canonicalUrl = metadata.canonicalUrl || secureUrl;
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', canonicalUrl);

  }, [metadata]);

  return null;
};

// Helper function to generate structured data
export const generateStructuredData = {
  product: (product: any) => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.image,
    url: product.url,
    ...(product.price && {
      offers: {
        '@type': 'Offer',
        price: product.price,
        priceCurrency: 'INR',
        availability: 'https://schema.org/InStock',
      },
    }),
    ...(product.rating && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: product.rating.value,
        ratingCount: product.rating.count,
      },
    }),
  }),

  service: (service: any) => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.description,
    image: service.image,
    url: service.url,
    provider: {
      '@type': 'Organization',
      name: 'India Cyber Cafe',
      url: 'https://b.indiacybercafe.com',
    },
    ...(service.price && {
      offers: {
        '@type': 'Offer',
        price: service.price,
        priceCurrency: 'INR',
      },
    }),
  }),

  article: (article: any) => ({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.headline,
    description: article.description,
    image: article.image,
    url: article.url,
    datePublished: article.datePublished,
    dateModified: article.dateModified,
    author: {
      '@type': 'Organization',
      name: 'India Cyber Cafe',
      url: 'https://b.indiacybercafe.com',
    },
  }),

  faq: (faqs: Array<{ question: string; answer: string }>) => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }),

  breadcrumb: (items: Array<{ name: string; url: string }>) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }),
};
