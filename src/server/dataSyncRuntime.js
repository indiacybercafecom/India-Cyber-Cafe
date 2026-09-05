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

async function fetchFirebaseCollection(collection) {
  const response = await fetch(`${DATABASE_URL}/${collection}.json?auth=null`);
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

export async function syncDataType(type) {
  ensureDataDirectory();
  try {
    if (type === 'services') return await syncServices();
    if (type === 'products') return await syncProducts();
    if (type === 'categories') return await syncCategories();
    return { success: false, file: '', error: 'Unknown sync type', message: 'Unknown sync type' };
  } catch (error) {
    const file = type === 'categories' ? 'product-categories.json' : `${type}.json`;
    return { success: false, file, error: error.message, message: `Failed to sync ${file}` };
  }
}

export async function syncAllPublicJson() {
  ensureDataDirectory();
  const results = [];
  results.push(await syncDataType('services'));
  results.push(await syncDataType('products'));
  results.push(await syncDataType('categories'));
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
  if (requiredFiles.every(file => fs.existsSync(path.join(DATA_DIR, file)))) return;
  const result = await syncAllPublicJson();
  if (!result.success) throw new Error('Initial public data synchronization failed');
}
