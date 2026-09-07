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
  const categories = await fetchFirebaseCollection('documentCategories', firebaseToken);
  const validated = categories.map(category => ({
    id: category.id || '',
    name: category.name || '',
    description: category.description || '',
    icon: category.icon || 'file-text',
    order: category.order ?? 0,
  }));
  const output = { version: 1, generatedAt: new Date().toISOString(), categories: validated };
  writeJsonAtomically(path.join(DATA_DIR, 'document-categories.json'), output, data => data?.version === 1 && Array.isArray(data.categories));
  return { success: true, file: 'document-categories.json', message: `Generated ${validated.length} document categories` };
}

async function syncDocuments(firebaseToken) {
  const documents = await fetchFirebaseCollection('documents', firebaseToken);
  const validated = documents
    .filter(document => document && document.active !== false)
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
  const output = { version: 1, generatedAt: new Date().toISOString(), documents: validated };
  writeJsonAtomically(path.join(DATA_DIR, 'documents.json'), output, data => data?.version === 1 && Array.isArray(data.documents));
  return { success: true, file: 'documents.json', message: `Generated ${validated.length} documents` };
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
