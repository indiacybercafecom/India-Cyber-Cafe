import fs from 'fs';
import path from 'path';

export interface ServiceItem {
  id: string;
  name: string;
  icon?: string;
  iconType?: string;
  description?: string;
  fields?: any[];
  subservices?: Array<{
    name: string;
    charge?: number;
    originalCharge?: number;
    image?: string;
    imageType?: string;
    fields?: any[];
    turnaroundTime?: string;
    requirements?: string[];
  }>;
}

export interface ProductItem {
  id: string;
  name: string;
  permalink?: string;
  category: string;
  price: number;
  discountedPrice?: number;
  shortDescription?: string;
  longDescription?: string;
  images?: string[];
  inStock?: boolean;
  ratings?: { average: number; count: number };
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  turnaroundTime?: string;
  deliveryCharges?: number;
}

export interface ProductCategoryItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  order?: number;
}

export interface DocumentItem {
  id: string;
  name: string;
  category?: string;
  description?: string;
  downloadUrl?: string;
  previewUrl?: string;
  fileType?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DocumentCategoryItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  order?: number;
}

export interface PublicDataPayload {
  services: ServiceItem[];
  products: ProductItem[];
  productCategories: ProductCategoryItem[];
  documents: DocumentItem[];
  documentCategories: DocumentCategoryItem[];
}

export function slugify(text: string): string {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Server-side cache
let cachedData: PublicDataPayload | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in memory

export function invalidatePublicDataCache(): void {
  cachedData = null;
  lastCacheTime = 0;
  console.log('[PUBLIC DATA SERVICE] Cache invalidated');
}

function resolveAppRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json'))) return cwd;
  const parent = path.resolve(cwd, '..');
  if (fs.existsSync(path.join(parent, 'package.json'))) return parent;
  return cwd;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    }
  } catch (err: any) {
    console.warn(`[PUBLIC DATA SERVICE] Warning reading ${filePath}:`, err.message);
  }
  return null;
}

export function getPublicData(appRoot: string = resolveAppRoot()): PublicDataPayload {
  const now = Date.now();
  if (cachedData && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedData;
  }

  const dataDir = path.join(appRoot, 'public/data');
  const distDataDir = path.join(appRoot, 'dist/data');

  // 1. Services
  const servicesJson =
    readJsonFile<{ services?: ServiceItem[] }>(path.join(dataDir, 'services.json')) ||
    readJsonFile<{ services?: ServiceItem[] }>(path.join(distDataDir, 'services.json'));
  const services = Array.isArray(servicesJson?.services) ? servicesJson!.services : [];

  // 2. Products
  const productsJson =
    readJsonFile<{ products?: ProductItem[] }>(path.join(dataDir, 'products.json')) ||
    readJsonFile<{ products?: ProductItem[] }>(path.join(distDataDir, 'products.json'));
  const products = Array.isArray(productsJson?.products) ? productsJson!.products : [];

  // 3. Product Categories
  const prodCatJson =
    readJsonFile<{ categories?: ProductCategoryItem[] }>(path.join(dataDir, 'product-categories.json')) ||
    readJsonFile<{ categories?: ProductCategoryItem[] }>(path.join(distDataDir, 'product-categories.json'));
  const productCategories = Array.isArray(prodCatJson?.categories) ? prodCatJson!.categories : [];

  // 4. Documents
  const docsJson =
    readJsonFile<{ documents?: DocumentItem[] }>(path.join(dataDir, 'documents.json')) ||
    readJsonFile<{ documents?: DocumentItem[] }>(path.join(appRoot, 'data/documents.json')) ||
    readJsonFile<{ documents?: DocumentItem[] }>(path.join(distDataDir, 'documents.json'));
  const rawDocs = Array.isArray(docsJson) ? (docsJson as any) : Array.isArray(docsJson?.documents) ? docsJson!.documents : [];
  const documents = rawDocs.filter((d: any) => Boolean(d && (d.name || d.id)));

  // 5. Document Categories
  const docCatJson =
    readJsonFile<{ categories?: DocumentCategoryItem[] }>(path.join(dataDir, 'document-categories.json')) ||
    readJsonFile<{ categories?: DocumentCategoryItem[] }>(path.join(appRoot, 'data/document-categories.json')) ||
    readJsonFile<{ categories?: DocumentCategoryItem[] }>(path.join(distDataDir, 'document-categories.json'));
  const rawDocCats = Array.isArray(docCatJson) ? (docCatJson as any) : Array.isArray(docCatJson?.categories) ? docCatJson!.categories : [];
  const documentCategories = rawDocCats.filter((c: any) => Boolean(c && c.name));

  cachedData = {
    services,
    products,
    productCategories,
    documents,
    documentCategories,
  };
  lastCacheTime = now;

  return cachedData;
}

export function findService(identifier: string, appRoot?: string): ServiceItem | undefined {
  const data = getPublicData(appRoot);
  const target = decodeURIComponent(identifier).toLowerCase().trim();
  const targetSlug = slugify(identifier);

  return data.services.find(
    s => s.id === identifier || s.id.toLowerCase() === target || slugify(s.name) === targetSlug
  );
}

export function findSubservice(
  service: ServiceItem,
  subserviceParam: string
): { name: string; charge?: number; originalCharge?: number; image?: string; [key: string]: any } | undefined {
  if (!service.subservices || !Array.isArray(service.subservices)) return undefined;

  const target = decodeURIComponent(subserviceParam).toLowerCase().trim();
  const targetSlug = slugify(subserviceParam);

  return service.subservices.find(
    ss =>
      slugify(ss.name) === targetSlug ||
      ss.name.toLowerCase().trim() === target ||
      (ss as any).id === subserviceParam
  );
}

export function findProduct(productId: string, appRoot?: string): ProductItem | undefined {
  const data = getPublicData(appRoot);
  const target = decodeURIComponent(productId).toLowerCase().trim();
  const targetSlug = slugify(productId);

  return data.products.find(
    p =>
      p.id === productId ||
      p.id.toLowerCase() === target ||
      (p.permalink && p.permalink.toLowerCase() === target) ||
      slugify(p.name) === targetSlug
  );
}

export function findProductCategory(categoryId: string, appRoot?: string): ProductCategoryItem | undefined {
  const data = getPublicData(appRoot);
  const target = decodeURIComponent(categoryId).toLowerCase().trim();
  const targetSlug = slugify(categoryId);

  return data.productCategories.find(
    c => c.id === categoryId || c.id.toLowerCase() === target || slugify(c.name) === targetSlug
  );
}

export function findDocument(
  param1: string,
  param2?: string,
  appRoot?: string
): { doc?: DocumentItem; category?: DocumentCategoryItem } {
  const data = getPublicData(appRoot);
  const slug1 = slugify(param1);
  const slug2 = param2 ? slugify(param2) : undefined;

  // If two params: /forms-documents/:categorySlug/:pdfSlug
  if (slug2) {
    const matchedCategory = data.documentCategories.find(c => slugify(c.name) === slug1);
    const matchedDoc = data.documents.find(
      d =>
        slugify(d.name) === slug2 &&
        (!matchedCategory || !d.category || slugify(d.category) === slug1)
    );
    if (matchedDoc) {
      return { doc: matchedDoc, category: matchedCategory };
    }
  }

  // If single param: /forms-documents/:slug (could be category or document)
  const matchedDocSingle = data.documents.find(d => slugify(d.name) === slug1 || d.id === param1);
  if (matchedDocSingle) {
    const cat = data.documentCategories.find(c => c.name === matchedDocSingle.category);
    return { doc: matchedDocSingle, category: cat };
  }

  const matchedCatSingle = data.documentCategories.find(c => slugify(c.name) === slug1);
  return { category: matchedCatSingle };
}

export function getAllPublicUrls(baseUrl: string = 'https://b.indiacybercafe.com', appRoot?: string): Array<{ path: string; fullUrl: string; title: string; priority: string; changefreq: string }> {
  const root = (baseUrl || 'https://b.indiacybercafe.com').replace(/\/+$/, '');
  const data = getPublicData(appRoot);
  const list: Array<{ path: string; fullUrl: string; title: string; priority: string; changefreq: string }> = [];

  const add = (p: string, title: string, priority = '0.7', changefreq = 'weekly') => {
    const cleanP = p === '/' ? '' : p;
    list.push({
      path: p,
      fullUrl: `${root}${cleanP}`,
      title,
      priority,
      changefreq,
    });
  };

  // 1. Static Pages
  add('/', 'India Cyber Cafe - Digital Services, CSC & Online Form Portal', '1.0', 'daily');
  add('/services', 'All Digital Services & CSC Applications', '0.9', 'daily');
  add('/price-list', 'Official Price List & Service Charges', '0.9', 'daily');
  add('/store', 'Online Store - PVC Smart Cards & Print Products', '0.8', 'daily');
  add('/forms-documents', 'Government Forms & PDF Document Downloads', '0.8', 'daily');
  add('/about', 'About India Cyber Cafe - Trusted Digital Partner', '0.6', 'monthly');
  add('/contact', 'Contact Us & Grievance Redressal', '0.6', 'monthly');
  add('/legal/terms', 'Terms and Conditions of Service', '0.5', 'monthly');
  add('/legal/privacy', 'Privacy Policy & DPDP Act Compliance Notice', '0.5', 'monthly');
  add('/legal/refund', 'Refund and Cancellation Policy', '0.5', 'monthly');
  add('/legal/disclaimer', 'Disclaimer and Non-Affiliation Notice', '0.5', 'monthly');
  add('/privacy-request', 'Submit Privacy & Grievance Redressal Request', '0.5', 'monthly');
  add('/privacy-request/track', 'Track Privacy Request Status', '0.4', 'monthly');
  add('/pay', 'Online Payment Portal - Pay by Link', '0.6', 'weekly');
  add('/sitemap.html', 'HTML Sitemap & Directory - Complete Website Services', '0.7', 'weekly');

  // 2. Services
  for (const s of data.services) {
    if (!s.id) continue;
    add(`/services/${s.id}`, `${s.name} - Online Application & Guidelines`, '0.8', 'weekly');

    for (const ss of s.subservices || []) {
      if (!ss.name) continue;
      add(
        `/services/${s.id}/${slugify(ss.name)}`,
        `${ss.name} (${s.name}) - Apply Online`,
        '0.7',
        'weekly'
      );
    }
  }

  // 3. Product Categories & Products
  for (const cat of data.productCategories) {
    if (!cat.id) continue;
    add(`/store/${cat.id}`, `${cat.name} - Store Category`, '0.7', 'weekly');
  }

  for (const p of data.products) {
    if (!p.id || !p.category) continue;
    add(
      `/store/${p.category}/${p.id}`,
      `${p.seoTitle || p.name} - India Cyber Cafe Store`,
      '0.7',
      'weekly'
    );
  }

  // 4. Document Categories & Documents
  for (const docCat of data.documentCategories) {
    if (!docCat.name) continue;
    const catSlug = slugify(docCat.name);
    add(`/forms-documents/${catSlug}`, `${docCat.name} - Forms & Documents`, '0.7', 'weekly');
  }

  for (const doc of data.documents) {
    if (!doc.name) continue;
    const catSlug = slugify(doc.category || 'general');
    const docSlug = slugify(doc.name);
    add(
      `/forms-documents/${catSlug}/${docSlug}`,
      `${doc.name} - PDF Download & Guidelines`,
      '0.6',
      'weekly'
    );
  }

  return list;
}
