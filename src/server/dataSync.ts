import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Server-side data synchronization module
 * Generates public JSON snapshots from Firebase Realtime Database
 * Ensures atomic file writes and preserves last valid snapshot on error
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory for generated JSON files
const DATA_DIR = path.join(__dirname, '../../public/data');

interface SyncResult {
  success: boolean;
  file: string;
  error?: string;
  message: string;
}

interface SyncStatus {
  version: number;
  generatedAt: string;
  servicesUpdatedAt?: string;
  productsUpdatedAt?: string;
  categoriesUpdatedAt?: string;
}

/**
 * Ensure data directory exists
 */
function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Write JSON file atomically (write to temp, then rename)
 * Prevents partial/corrupted writes
 */
function writeJsonAtomically(
  filePath: string,
  data: any,
  validateFn?: (data: any) => boolean
): void {
  // Validate data before writing
  if (validateFn && !validateFn(data)) {
    throw new Error(`Validation failed for ${path.basename(filePath)}`);
  }

  // Create temp file
  const tempPath = `${filePath}.tmp`;

  try {
    // Write to temp file
    const jsonContent = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempPath, jsonContent, 'utf8');

    // Validate written content
    const written = JSON.parse(fs.readFileSync(tempPath, 'utf8'));
    if (!validateFn || validateFn(written)) {
      // Atomic rename
      fs.renameSync(tempPath, filePath);
    } else {
      throw new Error('Validation failed after write');
    }
  } catch (error) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupError) {
        console.error(`[JSON SYNC] Failed to cleanup temp file: ${tempPath}`, cleanupError);
      }
    }
    throw error;
  }
}

/**
 * Read existing JSON file, preserving last valid snapshot
 */
function readJsonSafe(filePath: string): any | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`[JSON SYNC] Error reading ${path.basename(filePath)}:`, error);
  }
  return null;
}

/**
 * Convert Firebase object to array
 * Firebase returns objects like { id1: data1, id2: data2 }
 */
function firebaseObjectToArray(obj: any): any[] {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  return Object.entries(obj).map(([id, val]: [string, any]) => ({
    id,
    ...val,
  }));
}

/**
 * Generate services.json
 * Includes nested subservices
 */
async function syncServicesJson(): Promise<SyncResult> {
  const filePath = path.join(DATA_DIR, 'services.json');

  try {
    console.log('[JSON SYNC] Starting services.json generation...');
    const databaseURL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';

    const response = await fetch(`${databaseURL}/services.json?auth=null`);
    if (!response.ok) {
      throw new Error(`Firebase request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const services = firebaseObjectToArray(data);

    // Validate structure
    const validated = services.map((service: any) => ({
      id: service.id || '',
      name: service.name || '',
      icon: service.icon || '',
      iconType: service.iconType || 'class',
      description: service.description || '',
      fields: service.fields || [],
      subservices: firebaseObjectToArray(service.subservices),
      css: service.css,
    }));

    const output = {
      version: 1,
      generatedAt: new Date().toISOString(),
      services: validated,
    };

    writeJsonAtomically(
      filePath,
      output,
      (data: any) =>
        data &&
        data.services &&
        Array.isArray(data.services) &&
        data.version === 1
    );

    console.log(`[JSON SYNC] ✅ services.json generated (${validated.length} services)`);
    return {
      success: true,
      file: 'services.json',
      message: `Generated ${validated.length} services`,
    };
  } catch (error: any) {
    console.error('[JSON SYNC] ❌ Error syncing services:', error.message);
    return {
      success: false,
      file: 'services.json',
      error: error.message,
      message: 'Failed to sync services.json',
    };
  }
}

/**
 * Generate products.json
 */
async function syncProductsJson(): Promise<SyncResult> {
  const filePath = path.join(DATA_DIR, 'products.json');

  try {
    console.log('[JSON SYNC] Starting products.json generation...');
    const databaseURL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';

    const response = await fetch(`${databaseURL}/products.json?auth=null`);
    if (!response.ok) {
      throw new Error(`Firebase request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const products = firebaseObjectToArray(data);

    // Validate structure
    const validated = products.map((product: any) => ({
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

    const output = {
      version: 1,
      generatedAt: new Date().toISOString(),
      products: validated,
    };

    writeJsonAtomically(
      filePath,
      output,
      (data: any) =>
        data &&
        data.products &&
        Array.isArray(data.products) &&
        data.version === 1
    );

    console.log(`[JSON SYNC] ✅ products.json generated (${validated.length} products)`);
    return {
      success: true,
      file: 'products.json',
      message: `Generated ${validated.length} products`,
    };
  } catch (error: any) {
    console.error('[JSON SYNC] ❌ Error syncing products:', error.message);
    return {
      success: false,
      file: 'products.json',
      error: error.message,
      message: 'Failed to sync products.json',
    };
  }
}

/**
 * Generate product-categories.json
 */
async function syncProductCategoriesJson(): Promise<SyncResult> {
  const filePath = path.join(DATA_DIR, 'product-categories.json');

  try {
    console.log('[JSON SYNC] Starting product-categories.json generation...');
    const databaseURL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';

    const response = await fetch(`${databaseURL}/productCategories.json?auth=null`);
    if (!response.ok) {
      throw new Error(`Firebase request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const categories = firebaseObjectToArray(data);

    // Validate structure
    const validated = categories.map((category: any) => ({
      id: category.id || '',
      name: category.name || '',
      description: category.description || '',
      icon: category.icon,
      order: category.order,
    }));

    const output = {
      version: 1,
      generatedAt: new Date().toISOString(),
      categories: validated,
    };

    writeJsonAtomically(
      filePath,
      output,
      (data: any) =>
        data &&
        data.categories &&
        Array.isArray(data.categories) &&
        data.version === 1
    );

    console.log(
      `[JSON SYNC] ✅ product-categories.json generated (${validated.length} categories)`
    );
    return {
      success: true,
      file: 'product-categories.json',
      message: `Generated ${validated.length} categories`,
    };
  } catch (error: any) {
    console.error('[JSON SYNC] ❌ Error syncing categories:', error.message);
    return {
      success: false,
      file: 'product-categories.json',
      error: error.message,
      message: 'Failed to sync product-categories.json',
    };
  }
}

/**
 * Generate metadata.json
 * Tracks sync status and timestamps
 */
async function syncMetadataJson(): Promise<SyncResult> {
  const filePath = path.join(DATA_DIR, 'metadata.json');

  try {
    console.log('[JSON SYNC] Starting metadata.json generation...');

    const metadata: SyncStatus = {
      version: 1,
      generatedAt: new Date().toISOString(),
      servicesUpdatedAt: new Date().toISOString(),
      productsUpdatedAt: new Date().toISOString(),
      categoriesUpdatedAt: new Date().toISOString(),
    };

    writeJsonAtomically(
      filePath,
      metadata,
      (data: any) =>
        data &&
        data.version === 1 &&
        data.generatedAt &&
        typeof data.generatedAt === 'string'
    );

    console.log('[JSON SYNC] ✅ metadata.json generated');
    return {
      success: true,
      file: 'metadata.json',
      message: 'Generated metadata.json',
    };
  } catch (error: any) {
    console.error('[JSON SYNC] ❌ Error syncing metadata:', error.message);
    return {
      success: false,
      file: 'metadata.json',
      error: error.message,
      message: 'Failed to sync metadata.json',
    };
  }
}

/**
 * Sync all public JSON files
 * Runs all synchronization tasks
 */
export async function syncAllPublicJson(): Promise<{
  success: boolean;
  results: SyncResult[];
}> {
  console.log('[JSON SYNC] ========================================');
  console.log('[JSON SYNC] Starting complete data synchronization');
  console.log('[JSON SYNC] ========================================');

  ensureDataDirectory();

  const results: SyncResult[] = [];

  // Execute all sync tasks
  const servicesResult = await syncServicesJson();
  results.push(servicesResult);

  const productsResult = await syncProductsJson();
  results.push(productsResult);

  const categoriesResult = await syncProductCategoriesJson();
  results.push(categoriesResult);

  const metadataResult = await syncMetadataJson();
  results.push(metadataResult);

  const allSuccess = results.every((r) => r.success);

  console.log('[JSON SYNC] ========================================');
  console.log(
    `[JSON SYNC] Sync ${allSuccess ? '✅ COMPLETED' : '⚠️ PARTIAL FAILURE'}`
  );
  console.log('[JSON SYNC] ========================================');

  return {
    success: allSuccess,
    results,
  };
}

/**
 * Sync specific data type
 * Used by admin CRUD operations to update only affected JSON
 */
export async function syncDataType(
  type: 'services' | 'products' | 'categories'
): Promise<SyncResult> {
  ensureDataDirectory();

  switch (type) {
    case 'services':
      return await syncServicesJson();
    case 'products':
      return await syncProductsJson();
    case 'categories':
      return await syncProductCategoriesJson();
    default:
      return {
        success: false,
        file: '',
        error: 'Unknown sync type',
        message: 'Unknown sync type',
      };
  }
}

/**
 * Initialize all JSON files on server startup
 * This is non-blocking; if it fails, the app still works
 */
export async function initializePublicDataOnStartup(): Promise<void> {
  try {
    console.log('[JSON SYNC] Initializing public data on server startup...');
    ensureDataDirectory();

    // Check if any JSON already exists
    const servicesPath = path.join(DATA_DIR, 'services.json');
    const productsPath = path.join(DATA_DIR, 'products.json');
    const categoriesPath = path.join(DATA_DIR, 'product-categories.json');

    const hasExistingData =
      fs.existsSync(servicesPath) &&
      fs.existsSync(productsPath) &&
      fs.existsSync(categoriesPath);

    if (hasExistingData) {
      console.log('[JSON SYNC] Found existing public data files, skipping initial sync');
      return;
    }

    console.log('[JSON SYNC] No existing data found, generating initial snapshots...');
    const result = await syncAllPublicJson();

    if (!result.success) {
      console.warn(
        '[JSON SYNC] ⚠️ Initial sync had issues, but app will use Firebase fallback'
      );
    }
  } catch (error: any) {
    console.error(
      '[JSON SYNC] Error during startup initialization:',
      error.message
    );
    // Non-fatal: app continues with Firebase fallback
  }
}
