import fs from 'fs';
import path from 'path';

export const DEFAULT_ICC_IMAGE = 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png';
export const DEFAULT_ICC_TITLE = 'India Cyber Cafe - Digital Services, CSC & Online Form Portal';
export const DEFAULT_ICC_DESC = 'Apply for Government Services, CSC Online Forms, PAN Card, Aadhaar UCL, Certificates & Digital Products online at India Cyber Cafe. Fast, secure, and reliable digital partner.';

export function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function cleanText(text, maxLength = 160) {
  if (!text) return '';
  const cleaned = String(text)
    .replace(/<[^>]*>/g, '') // remove HTML tags
    .replace(/[#*_`~>[\]]/g, '') // remove markdown symbols
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 3).trim() + '...';
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function ensureHttps(url) {
  if (!url) return DEFAULT_ICC_IMAGE;
  let str = String(url).trim();
  if (str.startsWith('http://')) {
    str = 'https://' + str.slice(7);
  }
  return str;
}

export function getImageMimeType(url) {
  if (!url) return 'image/png';
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

export function isSocialCrawler(ua = '') {
  if (!ua) return false;
  return /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|linkedinbot|pinterest|slackbot|discordbot|skypeuripreview|googlebot|bingbot|applebot|yandex|duckduckbot|baiduspider|vkshare|w3c_validator|redditbot|embedly|quora link preview|outbrain/i.test(ua);
}

// In-memory cache for fast metadata lookup
let cachedServices = null;
let cachedServicesTime = 0;
let cachedProducts = null;
let cachedProductsTime = 0;

export function getServicesData(appRoot) {
  const now = Date.now();
  if (cachedServices && now - cachedServicesTime < 30000) {
    return cachedServices;
  }

  const pathsToTry = [
    path.join(appRoot, 'public/data/services.json'),
    path.join(appRoot, 'dist/data/services.json'),
    path.join(process.cwd(), 'public/data/services.json'),
    path.join(process.cwd(), 'dist/data/services.json'),
  ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedServices = parsed.services || [];
        cachedServicesTime = now;
        return cachedServices;
      } catch (err) {
        console.warn(`[SHARE METADATA] Error reading services from ${p}:`, err.message);
      }
    }
  }
  return cachedServices || [];
}

export function getProductsData(appRoot) {
  const now = Date.now();
  if (cachedProducts && now - cachedProductsTime < 30000) {
    return cachedProducts;
  }

  const pathsToTry = [
    path.join(appRoot, 'public/data/products.json'),
    path.join(appRoot, 'dist/data/products.json'),
    path.join(process.cwd(), 'public/data/products.json'),
    path.join(process.cwd(), 'dist/data/products.json'),
  ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedProducts = parsed.products || [];
        cachedProductsTime = now;
        return cachedProducts;
      } catch (err) {
        console.warn(`[SHARE METADATA] Error reading products from ${p}:`, err.message);
      }
    }
  }
  return cachedProducts || [];
}

/**
 * Resolves metadata for any given URL path in the application.
 */
export function getMetadataForUrl(pathname, baseUrl, appRoot = process.cwd()) {
  const cleanPath = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const rootUrl = baseUrl.replace(/\/+$/, '');

  // 1. Sub-Service Route: /services/:serviceId/:subserviceName
  const subserviceMatch = cleanPath.match(/^\/services\/([^/]+)\/([^/]+)$/);
  if (subserviceMatch) {
    const [, serviceId, subserviceParam] = subserviceMatch;
    const services = getServicesData(appRoot);
    const service = services.find(
      s => s.id === serviceId || slugify(s.name) === serviceId
    );

    if (service) {
      const decodedParam = decodeURIComponent(subserviceParam).toLowerCase();
      const subSlug = slugify(subserviceParam);

      const sub = (service.subservices || []).find(
        ss =>
          slugify(ss.name) === subSlug ||
          ss.name.toLowerCase() === decodedParam ||
          slugify(ss.name) === subserviceParam.toLowerCase()
      );

      if (sub) {
        const hasSubImg =
          sub.imageType === 'url' &&
          sub.image &&
          sub.image.startsWith('http') &&
          !sub.image.toLowerCase().endsWith('.mp4');

        const hasServiceIcon =
          service.iconType === 'url' &&
          service.icon &&
          service.icon.startsWith('http') &&
          !service.icon.toLowerCase().endsWith('.mp4');

        const image = hasSubImg ? ensureHttps(sub.image) : hasServiceIcon ? ensureHttps(service.icon) : DEFAULT_ICC_IMAGE;
        
        let priceInfo = '';
        if (sub.charge !== undefined && sub.charge !== null && sub.charge !== '') {
          if (sub.originalCharge && Number(sub.originalCharge) > Number(sub.charge)) {
            priceInfo = ` Service Charge: ₹${sub.charge} (Regular: ₹${sub.originalCharge}).`;
          } else {
            priceInfo = ` Service Charge: ₹${sub.charge}.`;
          }
        }

        return {
          title: `${sub.name} - ${service.name} | India Cyber Cafe`,
          description: `Apply online for ${sub.name} under ${service.name} at India Cyber Cafe.${priceInfo} Fast processing, secure submission & expert support.`,
          image,
          url: `${rootUrl}/services/${service.id}/${slugify(sub.name)}`,
          ogType: 'article',
          price: sub.charge,
        };
      }

      // If subservice not matched, fall back to parent service
      const hasServiceIcon =
        service.iconType === 'url' &&
        service.icon &&
        service.icon.startsWith('http') &&
        !service.icon.toLowerCase().endsWith('.mp4');

      return {
        title: `${service.name} - Apply Online | India Cyber Cafe`,
        description: cleanText(service.description) || DEFAULT_ICC_DESC,
        image: hasServiceIcon ? ensureHttps(service.icon) : DEFAULT_ICC_IMAGE,
        url: `${rootUrl}/services/${service.id}`,
        ogType: 'article',
      };
    }
  }

  // 2. Service Detail Route: /services/:serviceId
  const serviceMatch = cleanPath.match(/^\/services\/([^/]+)$/);
  if (serviceMatch) {
    const [, serviceId] = serviceMatch;
    const services = getServicesData(appRoot);
    const service = services.find(
      s => s.id === serviceId || slugify(s.name) === serviceId
    );

    if (service) {
      const hasServiceIcon =
        service.iconType === 'url' &&
        service.icon &&
        service.icon.startsWith('http') &&
        !service.icon.toLowerCase().endsWith('.mp4');

      const image = hasServiceIcon ? ensureHttps(service.icon) : DEFAULT_ICC_IMAGE;
      const subCount = service.subservices ? service.subservices.length : 0;
      const subCountText = subCount > 0 ? ` ${subCount} sub-services available.` : '';

      return {
        title: `${service.name} - Apply Online | India Cyber Cafe`,
        description:
          cleanText(service.description) ||
          `Apply online for ${service.name} at India Cyber Cafe.${subCountText} Fast, secure, and reliable digital assistance.`,
        image,
        url: `${rootUrl}/services/${service.id}`,
        ogType: 'article',
      };
    }
  }

  // 3. Store Product Route: /store/:categoryId/:productId, /store-product/:productId, /store/product/:productId
  const productMatch =
    cleanPath.match(/^\/store\/([^/]+)\/([^/]+)$/) ||
    cleanPath.match(/^\/store-product\/([^/]+)$/) ||
    cleanPath.match(/^\/store\/product\/([^/]+)$/) ||
    cleanPath.match(/^\/product\/([^/]+)$/);

  if (productMatch) {
    const productId = productMatch[2] || productMatch[1];
    const categoryId = productMatch[2] ? productMatch[1] : 'all';
    const products = getProductsData(appRoot);

    const product = products.find(
      p =>
        p.id === productId ||
        p.permalink === productId ||
        slugify(p.name) === productId
    );

    if (product) {
      const hasImage =
        product.images &&
        product.images.length > 0 &&
        product.images[0].startsWith('http') &&
        !product.images[0].toLowerCase().endsWith('.mp4');

      const image = hasImage ? ensureHttps(product.images[0]) : DEFAULT_ICC_IMAGE;
      const price = product.discountedPrice || product.price;
      let priceText = '';
      if (price) {
        if (product.discountedPrice && product.price && product.price > product.discountedPrice) {
          priceText = ` | Price: ₹${product.discountedPrice} (MRP: ₹${product.price})`;
        } else {
          priceText = ` | Price: ₹${price}`;
        }
      }

      return {
        title: `${product.seoTitle || product.name} | India Cyber Cafe Store`,
        description:
          cleanText(product.shortDescription || product.seoDescription || product.longDescription || product.name) +
          priceText,
        image,
        url: `${rootUrl}/store/${product.category || categoryId}/${product.id}`,
        ogType: 'product',
        price,
      };
    }
  }

  // 4. Static Standard Pages
  if (cleanPath === '/services') {
    return {
      title: 'Digital Services & CSC Online Portal | India Cyber Cafe',
      description:
        'Browse and apply for all government and digital services online: PAN card, Aadhaar UCL, Voter ID, Certificates, and more at India Cyber Cafe.',
      image: DEFAULT_ICC_IMAGE,
      url: `${rootUrl}/services`,
      ogType: 'website',
    };
  }

  if (cleanPath === '/store') {
    return {
      title: 'Online Store - Printing & Digital Products | India Cyber Cafe',
      description:
        'Shop custom printed t-shirts, PVC smart cards, medical reference books, and digital guides at India Cyber Cafe.',
      image: DEFAULT_ICC_IMAGE,
      url: `${rootUrl}/store`,
      ogType: 'website',
    };
  }

  if (cleanPath === '/price-list') {
    return {
      title: 'Service Price List & Charges | India Cyber Cafe',
      description:
        'Transparent pricing and service charges for all government services, online applications, and digital products.',
      image: DEFAULT_ICC_IMAGE,
      url: `${rootUrl}/price-list`,
      ogType: 'website',
    };
  }

  if (cleanPath === '/forms-documents') {
    return {
      title: 'Government Forms & Document Downloads | India Cyber Cafe',
      description:
        'Free download official PDF application forms and guidelines for government and legal services.',
      image: DEFAULT_ICC_IMAGE,
      url: `${rootUrl}/forms-documents`,
      ogType: 'website',
    };
  }

  // Default Homepage fallback
  return {
    title: DEFAULT_ICC_TITLE,
    description: DEFAULT_ICC_DESC,
    image: DEFAULT_ICC_IMAGE,
    url: rootUrl,
    ogType: 'website',
  };
}

/**
 * Injects dynamic Open Graph, Twitter, canonical, and title tags into index.html
 */
export function injectOpenGraphMetadata(html, metadata) {
  if (!html || !metadata) return html;

  const safeTitle = escapeHtml(metadata.title);
  const safeDesc = escapeHtml(metadata.description);
  const safeImage = escapeHtml(metadata.image || DEFAULT_ICC_IMAGE);
  const safeUrl = escapeHtml(metadata.url);
  const ogType = escapeHtml(metadata.ogType || 'website');
  const imageMime = getImageMimeType(metadata.image);

  let modified = html;

  // Replace <title>
  if (/<title>[^<]*<\/title>/i.test(modified)) {
    modified = modified.replace(/<title>[^<]*<\/title>/i, `<title>${safeTitle}</title>`);
  } else {
    modified = modified.replace('<head>', `<head>\n    <title>${safeTitle}</title>`);
  }

  // Replace standard description
  if (/<meta\s+name=["']description["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      `<meta name="description" content="${safeDesc}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta name="description" content="${safeDesc}" />\n  </head>`);
  }

  // Replace standard image
  if (/<meta\s+name=["']image["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+name=["']image["'][^>]*>/i,
      `<meta name="image" content="${safeImage}" />`
    );
  }

  // Replace og:title
  if (/<meta\s+property=["']og:title["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+property=["']og:title["'][^>]*>/i,
      `<meta property="og:title" content="${safeTitle}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta property="og:title" content="${safeTitle}" />\n  </head>`);
  }

  // Replace og:description
  if (/<meta\s+property=["']og:description["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+property=["']og:description["'][^>]*>/i,
      `<meta property="og:description" content="${safeDesc}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta property="og:description" content="${safeDesc}" />\n  </head>`);
  }

  // Replace og:image
  if (/<meta\s+property=["']og:image["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+property=["']og:image["'][^>]*>/i,
      `<meta property="og:image" content="${safeImage}" />\n    <meta property="og:image:secure_url" content="${safeImage}" />\n    <meta property="og:image:type" content="${imageMime}" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />\n    <meta property="og:image:alt" content="${safeTitle}" />`
    );
  } else {
    modified = modified.replace(
      '</head>',
      `    <meta property="og:image" content="${safeImage}" />\n    <meta property="og:image:secure_url" content="${safeImage}" />\n    <meta property="og:image:type" content="${imageMime}" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />\n    <meta property="og:image:alt" content="${safeTitle}" />\n  </head>`
    );
  }

  // Replace og:url
  if (/<meta\s+property=["']og:url["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+property=["']og:url["'][^>]*>/i,
      `<meta property="og:url" content="${safeUrl}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta property="og:url" content="${safeUrl}" />\n  </head>`);
  }

  // Replace og:type
  if (/<meta\s+property=["']og:type["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+property=["']og:type["'][^>]*>/i,
      `<meta property="og:type" content="${ogType}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta property="og:type" content="${ogType}" />\n  </head>`);
  }

  // Replace or inject og:site_name
  if (/<meta\s+property=["']og:site_name["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+property=["']og:site_name["'][^>]*>/i,
      `<meta property="og:site_name" content="India Cyber Cafe" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta property="og:site_name" content="India Cyber Cafe" />\n  </head>`);
  }

  // Replace twitter:card
  if (/<meta\s+(?:property|name)=["']twitter:card["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+(?:property|name)=["']twitter:card["'][^>]*>/i,
      `<meta name="twitter:card" content="summary_large_image" />\n    <meta property="twitter:card" content="summary_large_image" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta name="twitter:card" content="summary_large_image" />\n  </head>`);
  }

  // Replace twitter:title
  if (/<meta\s+(?:property|name)=["']twitter:title["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+(?:property|name)=["']twitter:title["'][^>]*>/i,
      `<meta name="twitter:title" content="${safeTitle}" />\n    <meta property="twitter:title" content="${safeTitle}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta name="twitter:title" content="${safeTitle}" />\n  </head>`);
  }

  // Replace twitter:description
  if (/<meta\s+(?:property|name)=["']twitter:description["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+(?:property|name)=["']twitter:description["'][^>]*>/i,
      `<meta name="twitter:description" content="${safeDesc}" />\n    <meta property="twitter:description" content="${safeDesc}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta name="twitter:description" content="${safeDesc}" />\n  </head>`);
  }

  // Replace twitter:image
  if (/<meta\s+(?:property|name)=["']twitter:image["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+(?:property|name)=["']twitter:image["'][^>]*>/i,
      `<meta name="twitter:image" content="${safeImage}" />\n    <meta property="twitter:image" content="${safeImage}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <meta name="twitter:image" content="${safeImage}" />\n  </head>`);
  }

  // Replace or inject canonical link
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<link\s+rel=["']canonical["'][^>]*>/i,
      `<link rel="canonical" href="${safeUrl}" />`
    );
  } else {
    modified = modified.replace('</head>', `    <link rel="canonical" href="${safeUrl}" />\n  </head>`);
  }

  return modified;
}

