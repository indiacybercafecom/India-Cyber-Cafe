import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../public/data');
const DATABASE_URL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';

function ensureDataDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeJsonAtomically(filePath, data, validate) {
  if (validate && !validate(data)) throw new Error(`Validation failed for ${path.basename(filePath)}`);
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    const written = JSON.parse(fs.readFileSync(tempPath, 'utf8'));
    if (validate && !validate(written)) throw new Error('Validation failed after write');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }
}

function firebaseObjectToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.entries(value).map(([id, item]) => ({ id, ...item }));
}

async function fetchFirebaseCollection(collection, firebaseToken) {
  const authQuery = firebaseToken ? `auth=${encodeURIComponent(firebaseToken)}` : 'auth=null';
  const response = await fetch(`${DATABASE_URL}/${collection}.json?${authQuery}`);
  if (!response.ok) throw new Error(`Firebase request failed: ${response.status} ${response.statusText}`);
  return firebaseObjectToArray(await response.json());
}

async function syncServices() {
  const services = await fetchFirebaseCollection('services');
  const validated = services.map(service => ({
    id: service.id || '',
    name: service.name || '',
    icon: service.icon || '',
    iconType: service.iconType || 'class',
    description: service.description || '',
    fields: service.fields || [],
    subservices: firebaseObjectToArray(service.subservices),
    css: service.css,
  }));
  const output = { version: 1, generatedAt: new Date().toISOString(), services: validated };
  writeJsonAtomically(path.join(DATA_DIR, 'services.json'), output, data => data?.version === 1 && Array.isArray(data.services));
  return { success: true, file: 'services.json', message: `Generated ${validated.length} services` };
}

async function syncProducts() {
  const products = await fetchFirebaseCollection('products');
  const validated = products.map(product => ({
    id: product.id || '',
    name: product.name || '',
    permalink: product.permalink || '',
    category: product.category || '',
    price: product.price || 0,
    discountedPrice: product.discountedPrice || 0,
    shortDescription: product.shortDescription || '',
    longDescription: product.longDescription || '',
    images: product.images || [],
    requiresCustomImage: product.requiresCustomImage || false,
    customImageInstructions: product.customImageInstructions,
    turnaroundTime: product.turnaroundTime,
    deliveryCharges: product.deliveryCharges,
    inStock: product.inStock !== undefined ? product.inStock : true,
    ratings: product.ratings || { average: 0, count: 0 },
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    seoKeywords: product.seoKeywords,
    paymentMethods: product.paymentMethods || ['online', 'cod'],
  }));
  const output = { version: 1, generatedAt: new Date().toISOString(), products: validated };
  writeJsonAtomically(path.join(DATA_DIR, 'products.json'), output, data => data?.version === 1 && Array.isArray(data.products));
  return { success: true, file: 'products.json', message: `Generated ${validated.length} products` };
}

async function syncCategories() {
  const categories = await fetchFirebaseCollection('productCategories');
  const validated = categories.map(category => ({
    id: category.id || '',
    name: category.name || '',
    description: category.description || '',
    icon: category.icon,
    order: category.order,
  }));
  const output = { version: 1, generatedAt: new Date().toISOString(), categories: validated };
  writeJsonAtomically(path.join(DATA_DIR, 'product-categories.json'), output, data => data?.version === 1 && Array.isArray(data.categories));
  return { success: true, file: 'product-categories.json', message: `Generated ${validated.length} categories` };
}

async function syncDocumentCategories(firebaseToken) {
  let categories;
  try {
    categories = await fetchFirebaseCollection('documentCategories', firebaseToken);
  } catch (err) {
    console.error('[JSON SYNC] Firebase documentCategories fetch error:', err.message);
    return {
      success: false,
      file: 'document-categories.json',
      error: err.message,
      message: 'Failed to fetch document categories from Firebase',
    };
  }

  const validated = (categories || []).map(category => ({
    id: category.id || '',
    name: category.name || '',
    description: category.description || '',
    icon: category.icon || 'file-text',
    order: category.order ?? 0,
  }));

  const output = { version: 1, generatedAt: new Date().toISOString(), categories: validated };

  // Write atomically to public/data/document-categories.json
  writeJsonAtomically(
    path.join(DATA_DIR, 'document-categories.json'),
    output,
    data => data?.version === 1 && Array.isArray(data.categories)
  );

  // Also write to data/ in root
  const rootDataDir = path.join(__dirname, '../../data');
  if (fs.existsSync(rootDataDir)) {
    writeJsonAtomically(
      path.join(rootDataDir, 'document-categories.json'),
      output,
      data => data?.version === 1 && Array.isArray(data.categories)
    );
  }

  // Also write to dist/data/ if built
  const distDataDir = path.join(__dirname, '../../dist/data');
  if (fs.existsSync(distDataDir)) {
    writeJsonAtomically(
      path.join(distDataDir, 'document-categories.json'),
      output,
      data => data?.version === 1 && Array.isArray(data.categories)
    );
  }

  return { success: true, file: 'document-categories.json', message: `Generated ${validated.length} document categories` };
}

function extractCoreTokens(title) {
  if (!title) return [];
  const noise = new Set([
    'form',
    'certificate',
    'application',
    'official',
    'document',
    'pdf',
    'prapatra',
    'praman',
    'patra',
  ]);
  return String(title)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !noise.has(w))
    .sort();
}

function getDocumentSignature(title) {
  const tokens = extractCoreTokens(title);
  const slugify = (str) => (str || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
  return tokens.length > 0 ? tokens.join('-') : slugify(title);
}

function deduplicateDocsList(docs) {
  if (!Array.isArray(docs)) return [];
  const slugify = (str) => (str || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
  const idMap = new Map();
  const catSigMap = new Map();
  const urlMap = new Map();

  for (const doc of docs) {
    if (!doc || (!doc.name && !doc.id)) continue;
    const id = (doc.id || '').trim();
    const catSlug = slugify(doc.category || 'general');
    const signature = getDocumentSignature(doc.name || '');
    const catSigKey = `${catSlug}::${signature}`;
    const cleanUrl = (doc.downloadUrl || doc.previewUrl || '').trim().toLowerCase();
    const isGenericUrl = !cleanUrl || cleanUrl.includes('incomeaay-certificate-form.pdf');

    const existing = (id && idMap.get(id)) || catSigMap.get(catSigKey) || (!isGenericUrl ? urlMap.get(cleanUrl) : undefined);
    if (existing) {
      const urlA = cleanUrl;
      const urlB = (existing.downloadUrl || existing.previewUrl || '').toLowerCase();
      const isDummyA = urlA.includes('incomeaay-certificate-form.pdf') || (doc.id && (doc.id.startsWith('mp-') || doc.id.startsWith('pan-')));
      const isDummyB = urlB.includes('incomeaay-certificate-form.pdf') || (existing.id && (existing.id.startsWith('mp-') || existing.id.startsWith('pan-')));
      const timeA = new Date(doc.updatedAt || doc.createdAt || 0).getTime();
      const timeB = new Date(existing.updatedAt || existing.createdAt || 0).getTime();

      const docWins = (!isDummyA && isDummyB) || (isDummyA === isDummyB && timeA >= timeB);
      if (docWins) {
        if (existing.id) idMap.delete(existing.id);
        const oldCatSlug = slugify(existing.category || 'general');
        catSigMap.delete(`${oldCatSlug}::${getDocumentSignature(existing.name || '')}`);
        if (!isGenericUrl) urlMap.delete(urlB);

        if (id) idMap.set(id, doc);
        catSigMap.set(catSigKey, doc);
        if (!isGenericUrl) urlMap.set(cleanUrl, doc);
      }
      continue;
    }

    if (id) idMap.set(id, doc);
    catSigMap.set(catSigKey, doc);
    if (!isGenericUrl) urlMap.set(cleanUrl, doc);
  }

  return Array.from(catSigMap.values()).sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });
}

async function syncDocuments(firebaseToken) {
  let remoteDocs;
  try {
    remoteDocs = await fetchFirebaseCollection('documents', firebaseToken);
  } catch (err) {
    console.warn('[JSON SYNC] RTDB documents fetch notice, attempting upstream live sync:', err.message);
    try {
      const prodResp = await fetch('https://b.indiacybercafe.com/data/documents.json', {
        headers: { Accept: 'application/json' },
      });
      if (prodResp.ok) {
        const prodData = await prodResp.json();
        remoteDocs = Array.isArray(prodData?.documents) ? prodData.documents : [];
      }
    } catch (prodErr) {
      console.warn('[JSON SYNC] Upstream fetch notice:', prodErr.message);
    }
  }

  if (!remoteDocs || !Array.isArray(remoteDocs)) {
    return {
      success: false,
      file: 'documents.json',
      error: 'Upstream and Firebase documents unavailable',
      message: 'Failed to fetch documents from Firebase or upstream',
    };
  }

  // Firebase is the single authoritative source of truth.
  // Never merge old local JSON data with new Firebase data.
  // Empty Firebase collection correctly generates [].
  const validated = (remoteDocs || [])
    .filter(document => document && (document.name || document.id))
    .map(document => ({
      id: document.id || '',
      name: document.name || '',
      description: document.description || '',
      category: document.category || '',
      previewUrl: document.previewUrl || '',
      downloadUrl: document.downloadUrl || '',
      ...(document.thumbnailUrl ? { thumbnailUrl: document.thumbnailUrl } : {}),
      fileType: document.fileType || 'PDF',
      active: document.active !== undefined ? !!document.active : true,
      createdAt: document.createdAt || new Date().toISOString(),
      updatedAt: document.updatedAt || new Date().toISOString(),
    }));

  const deduplicated = deduplicateDocsList(validated);
  const output = { version: 1, generatedAt: new Date().toISOString(), documents: deduplicated };

  // Atomically write to public/data/documents.json
  writeJsonAtomically(
    path.join(DATA_DIR, 'documents.json'),
    output,
    data => data?.version === 1 && Array.isArray(data.documents)
  );

  // Also write to data/documents.json in root if data dir exists
  const rootDataDir = path.join(__dirname, '../../data');
  if (fs.existsSync(rootDataDir)) {
    writeJsonAtomically(
      path.join(rootDataDir, 'documents.json'),
      output,
      data => data?.version === 1 && Array.isArray(data.documents)
    );
  }

  // Also write to dist/data/documents.json if dist exists
  const distDataDir = path.join(__dirname, '../../dist/data');
  if (fs.existsSync(distDataDir)) {
    writeJsonAtomically(
      path.join(distDataDir, 'documents.json'),
      output,
      data => data?.version === 1 && Array.isArray(data.documents)
    );
  }

  return { success: true, file: 'documents.json', message: `Generated ${deduplicated.length} documents` };
}

async function syncMetadata() {
  const timestamp = new Date().toISOString();
  const output = {
    version: 1,
    generatedAt: timestamp,
    servicesUpdatedAt: timestamp,
    productsUpdatedAt: timestamp,
    categoriesUpdatedAt: timestamp,
  };
  writeJsonAtomically(path.join(DATA_DIR, 'metadata.json'), output, data => data?.version === 1 && typeof data.generatedAt === 'string');
  return { success: true, file: 'metadata.json', message: 'Generated metadata.json' };
}

export async function syncDataType(type, firebaseToken) {
  ensureDataDirectory();
  try {
    if (type === 'services') return await syncServices();
    if (type === 'products') return await syncProducts();
    if (type === 'categories') return await syncCategories();
    if (type === 'documents') return await syncDocuments(firebaseToken);
    if (type === 'documentCategories') return await syncDocumentCategories(firebaseToken);
    return { success: false, file: '', error: 'Unknown sync type', message: 'Unknown sync type' };
  } catch (error) {
    const file = type === 'categories' ? 'product-categories.json' : type === 'documentCategories' ? 'document-categories.json' : `${type}.json`;
    return { success: false, file, error: error.message, message: `Failed to sync ${file}` };
  }
}

export async function syncAllPublicJson() {
  ensureDataDirectory();
  const results = [];
  results.push(await syncDataType('services'));
  results.push(await syncDataType('products'));
  results.push(await syncDataType('categories'));
  results.push(await syncDataType('documents'));
  results.push(await syncDataType('documentCategories'));
  try {
    results.push(await syncMetadata());
  } catch (error) {
    results.push({ success: false, file: 'metadata.json', error: error.message, message: 'Failed to sync metadata.json' });
  }
  return { success: results.every(result => result.success), results };
}

export async function initializePublicDataOnStartup() {
  ensureDataDirectory();
  const requiredFiles = ['services.json', 'products.json', 'product-categories.json'];
  if (!requiredFiles.every(file => fs.existsSync(path.join(DATA_DIR, file)))) {
    const result = await syncAllPublicJson();
    if (!result.success) throw new Error('Initial public data synchronization failed');
    return;
  }

  // Keep document snapshots aligned with Firebase even when older snapshots exist.
  await syncDataType('documents');
  await syncDataType('documentCategories');
}
