import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getDatabase, Database } from 'firebase-admin/database';
import { getAuth, Auth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';

// Resolve application root
const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const ORDERS_STORE_PATH = path.join(APP_ROOT, 'data/orders_store.json');
const PRODUCTS_DATA_PATH = path.join(APP_ROOT, 'public/data/products.json');
const DIST_PRODUCTS_PATH = path.join(APP_ROOT, 'dist/data/products.json');
const CUSTOM_UPLOADS_DIR = path.join(APP_ROOT, 'data/uploads/custom-images');
const RTDB_PUBLIC_URL = (process.env.FIREBASE_DATABASE_URL || 'https://india-cyber-cafe-default-rtdb.firebaseio.com').replace(/\/+$/, '');

const isTestMode = () => process.env.STORE_ORDER_TEST_MODE === '1';

class DatabaseConfigError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 503) {
    super(message);
    this.name = 'DatabaseConfigError';
    this.statusCode = statusCode;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    promise.then(
      val => {
        clearTimeout(timer);
        resolve(val);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function parseServiceAccountRaw(raw: string): ServiceAccount | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed) as ServiceAccount;
    }
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
    if (decoded.trim().startsWith('{')) {
      return JSON.parse(decoded) as ServiceAccount;
    }
  } catch (err: any) {
    console.warn('⚠️ Invalid service account JSON/base64:', err?.message || err);
  }
  return null;
}

function resolveFirebaseCredential(): { credential: any | null; source: string } {
  const inlineEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineEnv) {
    const parsed = parseServiceAccountRaw(inlineEnv);
    if (parsed) return { credential: cert(parsed), source: 'FIREBASE_SERVICE_ACCOUNT_JSON' };
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const parsed = parseServiceAccountRaw(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);
    if (parsed) return { credential: cert(parsed), source: 'FIREBASE_SERVICE_ACCOUNT_BASE64' };
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID || 'india-cyber-cafe',
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      source: 'FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY'
    };
  }

  const candidatePaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(APP_ROOT, 'firebase-service-account.json'),
    path.join(APP_ROOT, 'service-account.json'),
    path.join(APP_ROOT, 'data/firebase-service-account.json'),
  ].filter(Boolean) as string[];

  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const parsed = parseServiceAccountRaw(fs.readFileSync(filePath, 'utf-8'));
        if (parsed) return { credential: cert(parsed), source: path.basename(filePath) };
      }
    } catch {}
  }

  // Only allow default GCP ADC inside genuine GCP runtimes to avoid hanging 169.254.169.254 metadata probes elsewhere
  const isGcpRuntime = Boolean(
    process.env.K_SERVICE ||
    process.env.FUNCTION_TARGET ||
    process.env.GAE_APPLICATION ||
    process.env.GCE_METADATA_HOST
  );
  if (isGcpRuntime) {
    return { credential: undefined, source: 'GCP_ADC' };
  }

  return { credential: null, source: 'none' };
}

// Initialize Firebase Admin SDK safely (singleton) ONLY when valid credentials are present
let rtdbAdmin: Database | null = null;
let authAdmin: Auth | null = null;
let hasAdminCredential = false;
let credentialSource = 'none';

try {
  const { credential, source } = resolveFirebaseCredential();
  credentialSource = source;
  if (source !== 'none') {
    const appConfig: any = {
      projectId: process.env.FIREBASE_PROJECT_ID || 'india-cyber-cafe',
      databaseURL: RTDB_PUBLIC_URL
    };
    if (credential) {
      appConfig.credential = credential;
    }
    const app = getApps().length ? getApps()[0] : initializeApp(appConfig);
    rtdbAdmin = getDatabase(app);
    authAdmin = getAuth(app);
    hasAdminCredential = true;
    console.log(`✅ Firebase Admin SDK initialized (${source})`);
  } else if (!isTestMode()) {
    console.warn('⚠️ Firebase Admin credentials not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or firebase-service-account.json). Protected /orders writes will fail fast instead of hanging.');
  }
} catch (err: any) {
  console.warn('⚠️ Firebase Admin SDK init warning:', err?.message || err);
}

export function getStoreServiceStatus() {
  return {
    firebaseAdminConfigured: hasAdminCredential,
    credentialSource,
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    testMode: isTestMode()
  };
}

// Mail transporter configuration for order receipts (strict short timeouts, async fire-and-forget)
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 8000,
  auth: {
    user: process.env.SMTP_USER || 'icc@indiacybercafe.com',
    pass: process.env.SMTP_PASS || '',
  },
  tls: { rejectUnauthorized: false }
});

// In-memory sliding window rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function checkRateLimit(bucket: string, ip: string, maxRequests = 20, windowMs = 60000): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

// Idempotency cache to prevent double-clicks on submit
const idempotencyCache = new Map<string, { timestamp: number; result: any }>();
function checkIdempotency(key?: string): any | null {
  if (!key || typeof key !== 'string') return null;
  const now = Date.now();
  const cached = idempotencyCache.get(key);
  if (cached && now - cached.timestamp < 5 * 60 * 1000) {
    return cached.result;
  }
  return null;
}
function recordIdempotency(key: string | undefined, result: any) {
  if (!key || typeof key !== 'string') return;
  idempotencyCache.set(key, { timestamp: Date.now(), result });
}

// Processed webhook events cache (prevents duplicate webhook execution)
const processedWebhookEvents = new Set<string>();

// Product catalog short-TTL cache
let catalogCache: { expiresAt: number; products: any[] } = { expiresAt: 0, products: [] };

// Canonical RTDB key converter: keeps `ICC/STORE-...` as display order.id while avoiding RTDB `/` nesting
export function toRtdbOrderKey(orderId: string): string {
  return String(orderId || '').trim().replace(/[/.#$[\]]/g, '-');
}

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function cleanText(val: unknown, maxLen = 250): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, maxLen);
}

function normalizePhone10(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return digits;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidSafeUrl(urlStr: string): boolean {
  if (!urlStr) return false;
  if (urlStr.startsWith('/uploads/custom-images/')) return true;
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        result[k] = stripUndefinedDeep(v);
      }
    }
    return result as T;
  }
  return value;
}

function sanitizeOrderForClient(order: any, options: { includeOwnerUid?: boolean } = {}) {
  if (!order || typeof order !== 'object') return order;
  const copy = { ...order };
  delete copy.guestTokenHash;
  delete copy.razorpaySignature;
  if (!options.includeOwnerUid) {
    delete copy.uid;
    delete copy.userId;
  }
  return copy;
}

// Local orders backup / test store helpers
function readLocalOrders(): Record<string, any> {
  try {
    if (fs.existsSync(ORDERS_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(ORDERS_STORE_PATH, 'utf-8'));
    }
  } catch (err) {
    console.warn('Could not read local orders store:', err);
  }
  return {};
}

function saveLocalOrder(order: any) {
  try {
    const orders = readLocalOrders();
    orders[order.id] = order;
    fs.mkdirSync(path.dirname(ORDERS_STORE_PATH), { recursive: true });
    fs.writeFileSync(ORDERS_STORE_PATH, JSON.stringify(orders, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save to local orders store:', err);
  }
}

// Trusted product catalog loader (Admin RTDB if credentialed -> public RTDB REST -> local JSON fallback)
async function loadProductCatalog(): Promise<any[]> {
  const now = Date.now();
  if (catalogCache.expiresAt > now && catalogCache.products.length > 0) {
    return catalogCache.products;
  }

  if (hasAdminCredential && rtdbAdmin && !isTestMode()) {
    try {
      const snap = await withTimeout(rtdbAdmin.ref('products').once('value'), 5000, 'RTDB Admin catalog read');
      if (snap.exists()) {
        const val = snap.val();
        const products = Array.isArray(val)
          ? val.filter(Boolean)
          : Object.entries(val || {}).map(([id, item]: [string, any]) => ({ id, ...(item || {}) }));
        if (products.length > 0) {
          catalogCache = { expiresAt: now + 15000, products };
          return products;
        }
      }
    } catch (err: any) {
      console.warn('RTDB Admin product catalog read notice:', err?.message || err);
    }
  }

  // Public RTDB REST read (/products is public read in database.rules.json) with strict timeout
  if (!isTestMode()) {
    try {
      const resp = await fetch(`${RTDB_PUBLIC_URL}/products.json`, {
        signal: AbortSignal.timeout(4500),
        headers: { Accept: 'application/json' }
      });
      if (resp.ok) {
        const val = await resp.json();
        const products = Array.isArray(val)
          ? val.filter(Boolean)
          : Object.entries(val || {}).map(([id, item]: [string, any]) => ({ id, ...(item || {}) }));
        if (products.length > 0) {
          catalogCache = { expiresAt: now + 15000, products };
          return products;
        }
      }
    } catch (err: any) {
      console.warn('Public RTDB REST catalog read notice:', err?.message || err);
    }
  }

  try {
    if (fs.existsSync(PRODUCTS_DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(PRODUCTS_DATA_PATH, 'utf-8'));
      if (Array.isArray(data.products)) {
        catalogCache = { expiresAt: now + 15000, products: data.products };
        return data.products;
      }
    }
    if (fs.existsSync(DIST_PRODUCTS_PATH)) {
      const data = JSON.parse(fs.readFileSync(DIST_PRODUCTS_PATH, 'utf-8'));
      if (Array.isArray(data.products)) {
        catalogCache = { expiresAt: now + 15000, products: data.products };
        return data.products;
      }
    }
  } catch (err) {
    console.warn('Error reading product catalog file:', err);
  }

  return [];
}

// Generates canonical order ID format: ICC/STORE-DDMMYYYY-HHMMSS-XXXXX
export function generateServerOrderId(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const randomNum = String(crypto.randomInt(10000, 99999));
  return `ICC/STORE-${day}${month}${year}-${hours}${minutes}${seconds}-${randomNum}`;
}

// Extracts and strictly verifies Firebase ID token from Request (NEVER trusts unverified JWT payloads)
async function getVerifiedAuthUser(req: Request): Promise<{ uid: string; email: string; emailVerified: boolean } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7).trim();
  if (!token) return null;

  // Test mode verified token stub for isolated automated integration tests ONLY
  if (isTestMode() && token.startsWith('test-token:')) {
    const [, uid, email] = token.split(':');
    if (uid) {
      return { uid, email: (email || '').toLowerCase().trim(), emailVerified: true };
    }
    return null;
  }

  if (hasAdminCredential && authAdmin) {
    try {
      const decoded = await withTimeout(authAdmin.verifyIdToken(token), 5000, 'Auth ID token verification');
      if (decoded && decoded.uid) {
        return {
          uid: decoded.uid,
          email: (decoded.email || '').toLowerCase().trim(),
          emailVerified: Boolean(decoded.email_verified)
        };
      }
    } catch (adminErr: any) {
      console.warn('Firebase Admin token verification notice:', adminErr?.message || adminErr);
    }
  }

  // Fallback verified token inspection via Google Identity Toolkit (signature & revocation checked by Google)
  try {
    const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAMTND9rIAw-76Oey3c7c43-TW2t6mxEfw';
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: 'POST',
      signal: AbortSignal.timeout(6000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    });
    if (resp.ok) {
      const data = await resp.json();
      const user = data.users?.[0];
      if (user?.localId) {
        return {
          uid: user.localId,
          email: (user.email || '').toLowerCase().trim(),
          emailVerified: Boolean(user.emailVerified)
        };
      }
    }
  } catch (lookupErr) {
    console.warn('Identity toolkit lookup notice:', lookupErr);
  }

  return null;
}

function requireAdminDatabase(): Database {
  if (!hasAdminCredential || !rtdbAdmin) {
    throw new DatabaseConfigError('Order database service is unavailable: Firebase Admin credentials are not configured on the server.');
  }
  return rtdbAdmin;
}

// Persist order strictly to Firebase RTDB via Admin SDK (uses flat RTDB key to preserve queryability)
async function saveOrderToDatabase(order: any): Promise<void> {
  const cleanOrder = stripUndefinedDeep(order);
  const flatKey = toRtdbOrderKey(cleanOrder.id);

  if (isTestMode()) {
    saveLocalOrder(cleanOrder);
    return;
  }

  const db = requireAdminDatabase();
  await withTimeout(db.ref(`orders/${flatKey}`).set(cleanOrder), 10000, 'Saving order to Firebase RTDB');
  saveLocalOrder(cleanOrder);
}

// Find order across canonical flat key, legacy nested `orders/ICC/...` path, or local test store
async function findOrderRecord(orderId: string): Promise<{ order: any; rtdbPath: string } | null> {
  const flatKey = toRtdbOrderKey(orderId);

  if (isTestMode()) {
    const local = readLocalOrders();
    const matched = local[orderId] || local[flatKey] || Object.values(local).find((o: any) => o.id === orderId);
    return matched ? { order: matched, rtdbPath: `orders/${flatKey}` } : null;
  }

  const db = requireAdminDatabase();
  const flatSnap = await withTimeout(db.ref(`orders/${flatKey}`).once('value'), 9000, 'Reading order from Firebase RTDB');
  if (flatSnap.exists()) {
    const val = flatSnap.val();
    return { order: { id: orderId, ...val }, rtdbPath: `orders/${flatKey}` };
  }

  if (orderId !== flatKey) {
    const legacySnap = await withTimeout(db.ref(`orders/${orderId}`).once('value'), 9000, 'Reading legacy order path');
    if (legacySnap.exists()) {
      const val = legacySnap.val();
      return { order: { id: orderId, ...val }, rtdbPath: `orders/${orderId}` };
    }
  }

  return null;
}

async function findOrderByRazorpayOrderId(rzpOrderId: string): Promise<{ order: any; rtdbPath: string } | null> {
  if (!rzpOrderId) return null;

  if (isTestMode()) {
    const local = readLocalOrders();
    for (const ord of Object.values(local) as any[]) {
      if (ord.razorpayOrderId === rzpOrderId) {
        return { order: ord, rtdbPath: `orders/${toRtdbOrderKey(ord.id)}` };
      }
    }
    return null;
  }

  const db = requireAdminDatabase();
  const snap = await withTimeout(
    db.ref('orders').orderByChild('razorpayOrderId').equalTo(rzpOrderId).once('value'),
    9000,
    'Querying order by Razorpay ID'
  );
  if (snap.exists()) {
    const entries = Object.entries(snap.val() || {});
    if (entries.length > 0) {
      const [key, val] = entries[0] as [string, any];
      return { order: { id: val.id || key, ...val }, rtdbPath: `orders/${key}` };
    }
  }

  return null;
}

async function isRazorpayPaymentUsedElsewhere(paymentId: string, expectedOrderId: string): Promise<boolean> {
  if (!paymentId) return false;

  if (isTestMode()) {
    const local = readLocalOrders();
    return Object.values(local).some(
      (ord: any) => ord.razorpayPaymentId === paymentId && ord.id !== expectedOrderId
    );
  }

  const db = requireAdminDatabase();
  const snap = await withTimeout(
    db.ref('orders').orderByChild('razorpayPaymentId').equalTo(paymentId).once('value'),
    9000,
    'Checking payment uniqueness'
  );
  if (snap.exists()) {
    return Object.values(snap.val() || {}).some((ord: any) => ord && ord.id !== expectedOrderId);
  }

  return false;
}

async function updateOrderInDatabase(orderId: string, updates: Record<string, any>, knownPath?: string): Promise<void> {
  const cleanUpdates = stripUndefinedDeep(updates);
  const flatKey = toRtdbOrderKey(orderId);

  if (isTestMode()) {
    const local = readLocalOrders();
    if (local[orderId]) {
      local[orderId] = { ...local[orderId], ...cleanUpdates };
      fs.mkdirSync(path.dirname(ORDERS_STORE_PATH), { recursive: true });
      fs.writeFileSync(ORDERS_STORE_PATH, JSON.stringify(local, null, 2), 'utf-8');
    }
    return;
  }

  const db = requireAdminDatabase();
  const targetPath = knownPath || (await findOrderRecord(orderId))?.rtdbPath || `orders/${flatKey}`;
  await withTimeout(db.ref(targetPath).update(cleanUpdates), 10000, 'Updating order in Firebase RTDB');

  // If record was in legacy nested path orders/ICC/..., migrate safely to flat path
  if (targetPath !== `orders/${flatKey}`) {
    try {
      const updatedSnap = await withTimeout(db.ref(targetPath).once('value'), 6000, 'Reading legacy order for migration');
      if (updatedSnap.exists()) {
        await withTimeout(db.ref(`orders/${flatKey}`).set({ ...updatedSnap.val(), id: orderId }), 6000, 'Migrating legacy order');
        await withTimeout(db.ref(targetPath).remove(), 6000, 'Cleaning legacy order path');
      }
    } catch (migErr) {
      console.warn('Legacy order migration warning:', migErr);
    }
  }

  // Keep local backup updated silently if present
  try {
    const local = readLocalOrders();
    if (local[orderId]) {
      local[orderId] = { ...local[orderId], ...cleanUpdates };
      fs.writeFileSync(ORDERS_STORE_PATH, JSON.stringify(local, null, 2), 'utf-8');
    }
  } catch {}
}

// Validate delivery address and recalculate server-authoritative order amounts
async function validateAndComputeOrder(
  rawItems: any,
  rawAddress: any,
  intendedMethod: 'cod' | 'online'
): Promise<{
  valid: true;
  verifiedItems: any[];
  sanitizedAddress: any;
  subtotal: number;
  deliveryCharges: number;
  total: number;
} | { valid: false; status: number; error: string }> {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 10) {
    return { valid: false, status: 400, error: 'Order must contain between 1 and 10 items.' };
  }

  if (!rawAddress || typeof rawAddress !== 'object') {
    return { valid: false, status: 400, error: 'Complete delivery address is required.' };
  }

  const name = cleanText(rawAddress.name, 100);
  const email = cleanText(rawAddress.email, 160).toLowerCase();
  const phone = normalizePhone10(rawAddress.phone);
  const addressLine1 = cleanText(rawAddress.addressLine1, 250);
  const addressLine2 = cleanText(rawAddress.addressLine2, 200);
  const city = cleanText(rawAddress.city, 100);
  const state = cleanText(rawAddress.state, 100);
  const pincode = cleanText(rawAddress.pincode, 10).replace(/\D/g, '');
  const country = cleanText(rawAddress.country, 60) || 'India';

  if (!name || name.length < 2) return { valid: false, status: 400, error: 'Valid full name is required.' };
  if (!email || !isValidEmail(email)) return { valid: false, status: 400, error: 'Valid email address is required.' };
  if (!/^[6-9]\d{9}$/.test(phone) && !/^\d{10}$/.test(phone)) {
    return { valid: false, status: 400, error: 'Valid 10-digit mobile number is required.' };
  }
  if (!addressLine1 || addressLine1.length < 4) return { valid: false, status: 400, error: 'Complete street address is required.' };
  if (!city) return { valid: false, status: 400, error: 'City is required.' };
  if (!state) return { valid: false, status: 400, error: 'State is required.' };
  if (!/^\d{6}$/.test(pincode)) return { valid: false, status: 400, error: 'Valid 6-digit pincode is required.' };

  const catalog = await loadProductCatalog();
  if (catalog.length === 0) {
    return { valid: false, status: 503, error: 'Product catalog is temporarily unavailable. Please retry.' };
  }

  let calculatedSubtotal = 0;
  let calculatedDelivery = 0;
  const verifiedItems: any[] = [];

  for (const item of rawItems) {
    if (!item || typeof item.productId !== 'string') {
      return { valid: false, status: 400, error: 'Invalid item product identifier.' };
    }
    const product = catalog.find(p => p.id === item.productId);
    if (!product) {
      return { valid: false, status: 400, error: `Product not found: ${item.productId}` };
    }
    if (product.inStock === false) {
      return { valid: false, status: 400, error: `${product.name} is currently out of stock.` };
    }

    // Check product permitted payment methods
    const methods: string[] = Array.isArray(product.paymentMethods) ? product.paymentMethods : ['online', 'cod'];
    const allowsBoth = methods.includes('both') || (methods.includes('online') && methods.includes('cod'));
    if (!allowsBoth) {
      if (intendedMethod === 'cod' && !methods.includes('cod')) {
        return { valid: false, status: 400, error: `${product.name} does not support Cash on Delivery.` };
      }
      if (intendedMethod === 'online' && !methods.includes('online')) {
        return { valid: false, status: 400, error: `${product.name} only supports Cash on Delivery.` };
      }
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return { valid: false, status: 400, error: 'Quantity must be an integer between 1 and 20.' };
    }

    const customImageUrl = typeof item.customImageUrl === 'string' ? item.customImageUrl.trim() : '';
    if (product.requiresCustomImage) {
      if (!customImageUrl || !isValidSafeUrl(customImageUrl)) {
        return { valid: false, status: 400, error: `A valid uploaded image is required for ${product.name}.` };
      }
    } else if (customImageUrl && !isValidSafeUrl(customImageUrl)) {
      return { valid: false, status: 400, error: 'Invalid custom image URL.' };
    }

    const basePrice = Number(product.price) || 0;
    const discountedPrice = Number(product.discountedPrice);
    const unitPrice = !isNaN(discountedPrice) && discountedPrice > 0 ? discountedPrice : basePrice;
    if (unitPrice <= 0) {
      return { valid: false, status: 400, error: `Invalid pricing configuration for ${product.name}.` };
    }

    calculatedSubtotal += unitPrice * quantity;
    calculatedDelivery += Number(product.deliveryCharges) || 0;

    verifiedItems.push(stripUndefinedDeep({
      productId: product.id,
      productName: product.name,
      price: basePrice,
      discountedPrice: !isNaN(discountedPrice) && discountedPrice > 0 ? discountedPrice : undefined,
      quantity,
      customImageUrl: customImageUrl || undefined,
      specialInstructions: cleanText(item.specialInstructions, 500) || undefined
    }));
  }

  const calculatedTotal = calculatedSubtotal + calculatedDelivery;

  return {
    valid: true,
    verifiedItems,
    sanitizedAddress: {
      name,
      email,
      phone,
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      country
    },
    subtotal: calculatedSubtotal,
    deliveryCharges: calculatedDelivery,
    total: calculatedTotal
  };
}

// Send order emails asynchronously (fail-safe)
function sendOrderEmails(order: any, type: 'cod' | 'online') {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || isTestMode()) return;

  const itemsSummary = (order.items || [])
    .map((i: any) => `${i.productName} (Qty: ${i.quantity}) - ₹${i.discountedPrice || i.price}`)
    .join('\n');

  const trackUrl = order.isGuest
    ? `https://b.indiacybercafe.com/track-order?orderId=${encodeURIComponent(order.id)}`
    : `https://b.indiacybercafe.com/track`;

  mailTransporter.sendMail({
    from: `"India Cyber Cafe" <${process.env.SMTP_USER}>`,
    to: order.deliveryAddress?.email || order.email,
    subject: `Order Confirmed: ${order.id} - India Cyber Cafe`,
    text: `Dear ${order.deliveryAddress?.name || 'Customer'},\n\nYour order ${order.id} has been placed successfully.\nPayment Method: ${type === 'cod' ? 'Cash on Delivery (COD)' : 'Online (Razorpay)'}\nPayment Status: ${order.paymentStatus}\nTotal Amount: ₹${order.total}\n\nItems Ordered:\n${itemsSummary}\n\nDelivery Address:\n${order.deliveryAddress?.addressLine1}, ${order.deliveryAddress?.city}, ${order.deliveryAddress?.state} - ${order.deliveryAddress?.pincode}\n\nTrack your order anytime at: ${trackUrl}\n\nThank you for choosing India Cyber Cafe!\nSingrauli, MP, India`
  }).catch(err => console.warn('Customer order email error:', err.message));

  mailTransporter.sendMail({
    from: `"India Cyber Cafe Orders" <${process.env.SMTP_USER}>`,
    to: 'indiacybercafe.com@gmail.com',
    subject: `🛒 New ${type.toUpperCase()} Order [${order.id}] - ₹${order.total}`,
    text: `New order received on India Cyber Cafe Store:\n\nOrder ID: ${order.id}\nCustomer: ${order.deliveryAddress?.name} (${order.deliveryAddress?.phone})\nEmail: ${order.deliveryAddress?.email}\nGuest Order: ${order.isGuest ? 'Yes' : 'No'}\nPayment Method: ${order.paymentMethod}\nPayment Status: ${order.paymentStatus}\nTotal: ₹${order.total}\n\nItems:\n${itemsSummary}\n\nAddress:\n${order.deliveryAddress?.addressLine1}, ${order.deliveryAddress?.city}, ${order.deliveryAddress?.state} - ${order.deliveryAddress?.pincode}\n\nManage in Admin Panel: https://b.indiacybercafe.com/admin/orders`
  }).catch(err => console.warn('Admin order alert email error:', err.message));
}

async function recordVerifiedPaymentTransaction(order: any, paymentId: string, razorpayOrderId: string, now: string) {
  if (isTestMode() || !hasAdminCredential || !rtdbAdmin) return;
  try {
    const paymentKey = `pay_${toRtdbOrderKey(paymentId)}`;
    await withTimeout(
      rtdbAdmin.ref(`payments/${paymentKey}`).set({
        id: order.id.slice(0, 40),
        amount: order.total,
        currency: 'INR',
        paymentId,
        orderId: razorpayOrderId,
        status: 'completed',
        type: 'store_order',
        createdAt: now
      }),
      8000,
      'Recording verified payment transaction'
    );
  } catch (err) {
    console.warn('Payment record save notice:', err);
  }
}

// Fetch payment details from Razorpay API for secondary server verification
async function fetchRazorpayPayment(paymentId: string): Promise<any | null> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret || isTestMode()) return null;

  try {
    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const resp = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(8000)
    });
    if (resp.ok) {
      return await resp.json();
    }
  } catch (err: any) {
    console.warn('Razorpay payment fetch notice:', err?.message || err);
  }
  return null;
}

// ==========================================
// STORE ORDER ENDPOINTS
// ==========================================

/**
 * 1. POST /api/store/orders/cod
 * Authoritative Server-Side Cash on Delivery Order Creation (Guest + Authenticated)
 */
export async function handleCodOrder(req: Request, res: Response) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit('cod', clientIp, 15, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many requests. Please try again shortly.' });
    }

    const { items, deliveryAddress, idempotencyKey } = req.body || {};

    const cached = checkIdempotency(idempotencyKey ? `cod:${idempotencyKey}` : undefined);
    if (cached) {
      return res.status(200).json(cached);
    }

    const validation = await validateAndComputeOrder(items, deliveryAddress, 'cod');
    if (validation.valid === false) {
      return res.status(validation.status).json({ success: false, error: validation.error });
    }

    const authUser = await getVerifiedAuthUser(req);
    const isGuest = !authUser;

    const orderId = generateServerOrderId();
    const now = new Date().toISOString();

    let guestTrackingToken: string | undefined;
    let guestTokenHash: string | undefined;
    if (isGuest) {
      guestTrackingToken = crypto.randomBytes(24).toString('hex');
      guestTokenHash = crypto.createHash('sha256').update(guestTrackingToken).digest('hex');
    }

    const newOrder = stripUndefinedDeep({
      id: orderId,
      uid: isGuest ? 'guest' : authUser.uid,
      userId: isGuest ? 'guest' : authUser.uid,
      isGuest,
      guestTokenHash,
      email: validation.sanitizedAddress.email,
      items: validation.verifiedItems,
      deliveryAddress: validation.sanitizedAddress,
      subtotal: validation.subtotal,
      deliveryCharges: validation.deliveryCharges,
      total: validation.total,
      paymentMethod: 'cash' as const,
      paymentStatus: 'pending' as const,
      orderStatus: 'pending' as const,
      notes: [
        {
          type: 'status' as const,
          by: 'system',
          email: 'system@indiacybercafe.com',
          text: 'Order placed with Cash on Delivery (COD)',
          time: now
        }
      ],
      createdAt: now,
      updatedAt: now
    });

    if (!isTestMode()) {
      requireAdminDatabase();
    }

    await saveOrderToDatabase(newOrder);
    sendOrderEmails(newOrder, 'cod');

    const result = {
      success: true,
      orderId,
      order: sanitizeOrderForClient(newOrder, { includeOwnerUid: !isGuest }),
      guestTrackingToken
    };

    recordIdempotency(idempotencyKey ? `cod:${idempotencyKey}` : undefined, result);
    return res.status(201).json(result);
  } catch (error: any) {
    console.error('COD order creation error:', error);
    const status = error instanceof DatabaseConfigError ? error.statusCode : error?.message?.includes('timed out') ? 504 : 500;
    return res.status(status).json({
      success: false,
      error: error instanceof DatabaseConfigError
        ? error.message
        : error?.message?.includes('timed out')
          ? 'Order server timed out while saving your order. Please retry.'
          : 'Failed to place COD order. Please try again.'
    });
  }
}

/**
 * 2. POST /api/store/orders/create-payment
 * Prepares pending order and Razorpay order with strict server-side validation
 */
export async function handleCreatePaymentOrder(req: Request, res: Response) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit('create-payment', clientIp, 20, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many requests. Please try again shortly.' });
    }

    const { items, deliveryAddress, idempotencyKey } = req.body || {};

    const cached = checkIdempotency(idempotencyKey ? `pay:${idempotencyKey}` : undefined);
    if (cached) {
      return res.status(200).json(cached);
    }

    if (!isTestMode()) {
      requireAdminDatabase();
    }

    const validation = await validateAndComputeOrder(items, deliveryAddress, 'online');
    if (validation.valid === false) {
      return res.status(validation.status).json({ success: false, error: validation.error });
    }

    const amountInPaise = Math.round(validation.total * 100);
    if (!Number.isInteger(amountInPaise) || amountInPaise < 100 || amountInPaise > 10000000) {
      return res.status(400).json({ success: false, error: 'Order amount is outside allowed online payment bounds.' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID || (isTestMode() ? 'rzp_test_key' : '');
    const keySecret = process.env.RAZORPAY_KEY_SECRET || (isTestMode() ? 'test_rzp_secret' : '');

    if (!keyId || !keySecret) {
      return res.status(503).json({ success: false, error: 'Online payment gateway is not configured.' });
    }

    const authUser = await getVerifiedAuthUser(req);
    const isGuest = !authUser;
    const orderId = generateServerOrderId();
    const now = new Date().toISOString();

    let razorpayOrderId = `order_test_${crypto.randomBytes(6).toString('hex')}`;

    if (!isTestMode()) {
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const rzpResp = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        signal: AbortSignal.timeout(12000),
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: 'INR',
          receipt: toRtdbOrderKey(orderId).slice(0, 40),
          notes: {
            orderId,
            email: validation.sanitizedAddress.email
          }
        })
      });

      if (!rzpResp.ok) {
        const errData = await rzpResp.json().catch(() => ({}));
        console.error('❌ Razorpay Create Order error:', errData);
        return res.status(502).json({
          success: false,
          error: errData?.error?.description || 'Could not initiate payment with Razorpay. Please try again.'
        });
      }

      const rzpData = await rzpResp.json();
      if (!rzpData?.id) {
        return res.status(502).json({ success: false, error: 'Invalid response from payment gateway.' });
      }
      razorpayOrderId = rzpData.id;
    }

    let guestTrackingToken: string | undefined;
    let guestTokenHash: string | undefined;
    if (isGuest) {
      guestTrackingToken = crypto.randomBytes(24).toString('hex');
      guestTokenHash = crypto.createHash('sha256').update(guestTrackingToken).digest('hex');
    }

    const pendingOrder = stripUndefinedDeep({
      id: orderId,
      uid: isGuest ? 'guest' : authUser.uid,
      userId: isGuest ? 'guest' : authUser.uid,
      isGuest,
      guestTokenHash,
      email: validation.sanitizedAddress.email,
      items: validation.verifiedItems,
      deliveryAddress: validation.sanitizedAddress,
      subtotal: validation.subtotal,
      deliveryCharges: validation.deliveryCharges,
      total: validation.total,
      paymentMethod: 'razorpay' as const,
      paymentStatus: 'pending' as const,
      razorpayOrderId,
      orderStatus: 'pending' as const,
      notes: [
        {
          type: 'status' as const,
          by: 'system',
          email: 'system@indiacybercafe.com',
          text: `Payment initiated via Razorpay (Ref: ${razorpayOrderId})`,
          time: now
        }
      ],
      createdAt: now,
      updatedAt: now
    });

    await saveOrderToDatabase(pendingOrder);

    const result = {
      success: true,
      orderId,
      razorpayOrderId,
      amount: amountInPaise,
      amountInRupees: validation.total,
      currency: 'INR',
      keyId,
      guestTrackingToken
    };

    recordIdempotency(idempotencyKey ? `pay:${idempotencyKey}` : undefined, result);
    return res.status(201).json(result);
  } catch (error: any) {
    console.error('Payment order creation error:', error);
    const status = error instanceof DatabaseConfigError ? error.statusCode : error?.name === 'TimeoutError' || error?.message?.includes('timed out') ? 504 : 500;
    return res.status(status).json({
      success: false,
      error: error instanceof DatabaseConfigError
        ? error.message
        : status === 504
          ? 'Payment gateway timed out. No charge was made — please try again.'
          : 'Failed to initiate payment.'
    });
  }
}

/**
 * 3. POST /api/store/orders/verify-payment
 * Strict Cryptographic Signature Verification + Razorpay Cross-Check + Idempotent Confirmation
 */
export async function handleVerifyPayment(req: Request, res: Response) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit('verify-payment', clientIp, 30, 60000)) {
      return res.status(429).json({ verified: false, error: 'Too many requests. Please wait a moment and retry verification.' });
    }

    const { orderId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};

    if (!orderId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ verified: false, error: 'Missing required payment verification parameters.' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET || (isTestMode() ? 'test_rzp_secret' : '');
    if (!keySecret) {
      return res.status(503).json({ verified: false, error: 'Payment verification gateway is not configured.' });
    }

    // 1. Verify HMAC-SHA256 signature strictly with timingSafeEqual
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto.createHmac('sha256', keySecret).update(body).digest('hex');
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const receivedBuf = Buffer.from(String(razorpay_signature), 'utf8');
    const isSignatureValid = expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);

    if (!isSignatureValid) {
      console.warn(`❌ Invalid Razorpay signature: order=${orderId}, payment=${razorpay_payment_id}`);
      return res.status(400).json({ verified: false, error: 'Invalid payment signature. Verification failed.' });
    }

    // 2. Retrieve pending order from database
    const record = await findOrderRecord(orderId);
    if (!record) {
      return res.status(404).json({ verified: false, error: 'Order record not found.' });
    }

    const { order: existingOrder, rtdbPath } = record;

    // 3. Verify Razorpay order ID matches stored order
    if (existingOrder.razorpayOrderId && existingOrder.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ verified: false, error: 'Razorpay order mismatch.' });
    }

    // 4. Prevent reusing same Razorpay payment ID across different orders
    const reusedElsewhere = await isRazorpayPaymentUsedElsewhere(razorpay_payment_id, orderId);
    if (reusedElsewhere) {
      return res.status(409).json({ verified: false, error: 'This payment reference has already been used for another order.' });
    }

    // 5. Idempotent return if already completed with this payment ID
    if (existingOrder.paymentStatus === 'completed') {
      if (existingOrder.razorpayPaymentId && existingOrder.razorpayPaymentId !== razorpay_payment_id) {
        return res.status(409).json({ verified: false, error: 'Order already paid with another transaction.' });
      }
      return res.json({
        verified: true,
        orderId,
        order: sanitizeOrderForClient(existingOrder, { includeOwnerUid: !existingOrder.isGuest }),
        message: 'Order was already verified and confirmed.'
      });
    }

    // 6. Verify captured amount & currency directly with Razorpay API when live
    const rzpPayment = await fetchRazorpayPayment(razorpay_payment_id);
    if (rzpPayment) {
      const expectedPaise = Math.round((Number(existingOrder.total) || 0) * 100);
      if (rzpPayment.order_id && rzpPayment.order_id !== razorpay_order_id) {
        return res.status(400).json({ verified: false, error: 'Payment does not belong to this Razorpay order.' });
      }
      if (rzpPayment.currency && rzpPayment.currency !== 'INR') {
        return res.status(400).json({ verified: false, error: 'Invalid payment currency.' });
      }
      if (typeof rzpPayment.amount === 'number' && rzpPayment.amount !== expectedPaise) {
        return res.status(400).json({ verified: false, error: 'Paid amount does not match order total.' });
      }
      if (rzpPayment.status === 'failed' || rzpPayment.status === 'refunded') {
        return res.status(400).json({ verified: false, error: `Payment status is ${rzpPayment.status}.` });
      }
    }

    // 7. Mark order confirmed & processing
    const now = new Date().toISOString();
    const existingNotes = Array.isArray(existingOrder.notes) ? existingOrder.notes : [];
    const updates = {
      paymentStatus: 'completed',
      orderStatus: existingOrder.orderStatus === 'pending' ? 'processing' : existingOrder.orderStatus,
      razorpayPaymentId: razorpay_payment_id,
      updatedAt: now,
      notes: [
        ...existingNotes,
        {
          type: 'status',
          by: 'system',
          email: 'system@indiacybercafe.com',
          text: `Payment verified via Razorpay (${razorpay_payment_id})`,
          time: now
        }
      ]
    };

    await updateOrderInDatabase(orderId, updates, rtdbPath);

    const completedOrder = {
      ...existingOrder,
      ...updates
    };

    await recordVerifiedPaymentTransaction(completedOrder, razorpay_payment_id, razorpay_order_id, now);
    sendOrderEmails(completedOrder, 'online');

    return res.json({
      verified: true,
      orderId,
      order: sanitizeOrderForClient(completedOrder, { includeOwnerUid: !completedOrder.isGuest }),
      message: 'Payment verified and order confirmed successfully.'
    });
  } catch (error: any) {
    console.error('Payment verification error:', error);
    return res.status(500).json({ verified: false, error: 'Payment verification encountered a server error. Please click Retry Verification without paying again.' });
  }
}

/**
 * 3b. POST /api/store/orders/recover-payment
 * Allows reconciling a pending Razorpay order from Razorpay API if client dropped off mid-verification
 */
export async function handleRecoverPayment(req: Request, res: Response) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit('recover-payment', clientIp, 15, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many requests.' });
    }

    const { orderId } = req.body || {};
    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({ success: false, error: 'Order ID is required.' });
    }

    const record = await findOrderRecord(orderId.trim());
    if (!record) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const { order, rtdbPath } = record;
    if (order.paymentStatus === 'completed') {
      return res.json({
        success: true,
        verified: true,
        order: sanitizeOrderForClient(order, { includeOwnerUid: !order.isGuest })
      });
    }

    if (!order.razorpayOrderId) {
      return res.status(400).json({ success: false, error: 'Order does not have an online payment reference.' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret || isTestMode()) {
      return res.json({
        success: false,
        verified: false,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        error: 'Payment is still pending.'
      });
    }

    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const resp = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(order.razorpayOrderId)}/payments`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(8000)
    });

    if (!resp.ok) {
      return res.status(502).json({ success: false, error: 'Could not query payment status from Razorpay.' });
    }

    const data = await resp.json();
    const expectedPaise = Math.round((Number(order.total) || 0) * 100);
    const capturedPayment = (data.items || []).find(
      (p: any) => (p.status === 'captured' || p.status === 'authorized') && p.currency === 'INR' && p.amount === expectedPaise
    );

    if (!capturedPayment) {
      return res.json({
        success: false,
        verified: false,
        paymentStatus: order.paymentStatus,
        error: 'No completed payment found for this order yet.'
      });
    }

    const now = new Date().toISOString();
    const existingNotes = Array.isArray(order.notes) ? order.notes : [];
    const updates = {
      paymentStatus: 'completed',
      orderStatus: order.orderStatus === 'pending' ? 'processing' : order.orderStatus,
      razorpayPaymentId: capturedPayment.id,
      updatedAt: now,
      notes: [
        ...existingNotes,
        {
          type: 'status',
          by: 'system',
          email: 'system@indiacybercafe.com',
          text: `Payment recovered & reconciled via Razorpay (${capturedPayment.id})`,
          time: now
        }
      ]
    };

    await updateOrderInDatabase(order.id, updates, rtdbPath);
    const updatedOrder = { ...order, ...updates };
    await recordVerifiedPaymentTransaction(updatedOrder, capturedPayment.id, order.razorpayOrderId, now);
    sendOrderEmails(updatedOrder, 'online');

    return res.json({
      success: true,
      verified: true,
      order: sanitizeOrderForClient(updatedOrder, { includeOwnerUid: !updatedOrder.isGuest })
    });
  } catch (error: any) {
    console.error('Recover payment error:', error);
    return res.status(500).json({ success: false, error: 'Failed to recover payment status.' });
  }
}

/**
 * 4. POST /api/store/orders/razorpay-webhook
 * Webhook handler with rawBody HMAC verification, duplicate prevention, and RTDB lookup
 */
export async function handleRazorpayWebhook(req: Request, res: Response) {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    const eventId = req.headers['x-razorpay-event-id'] as string | undefined;

    if (webhookSecret) {
      if (!signature) {
        return res.status(400).json({ error: 'Missing webhook signature' });
      }
      const rawPayload = (req as any).rawBody instanceof Buffer
        ? (req as any).rawBody
        : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
      const digest = crypto.createHmac('sha256', webhookSecret).update(rawPayload).digest('hex');
      const digestBuf = Buffer.from(digest, 'utf8');
      const sigBuf = Buffer.from(signature, 'utf8');
      if (digestBuf.length !== sigBuf.length || !crypto.timingSafeEqual(digestBuf, sigBuf)) {
        return res.status(400).json({ error: 'Invalid webhook signature' });
      }
    } else if (!isTestMode()) {
      return res.status(503).json({ error: 'Webhook secret is not configured' });
    }

    if (eventId && processedWebhookEvents.has(eventId)) {
      return res.status(200).json({ status: 'ok', duplicate: true });
    }

    const event = req.body?.event;
    const payment = req.body?.payload?.payment?.entity;
    const rzpOrderId = payment?.order_id || req.body?.payload?.order?.entity?.id;
    const paymentId = payment?.id;

    if ((event === 'order.paid' || event === 'payment.captured') && rzpOrderId) {
      const matched = await findOrderByRazorpayOrderId(rzpOrderId);
      if (matched) {
        const { order, rtdbPath } = matched;
        const expectedPaise = Math.round((Number(order.total) || 0) * 100);
        if (payment && typeof payment.amount === 'number' && payment.amount !== expectedPaise) {
          console.warn(`⚠️ Webhook amount mismatch on order ${order.id}: paid=${payment.amount}, expected=${expectedPaise}`);
          return res.status(400).json({ error: 'Amount mismatch' });
        }

        if (order.paymentStatus !== 'completed') {
          const now = new Date().toISOString();
          const existingNotes = Array.isArray(order.notes) ? order.notes : [];
          const updates = {
            paymentStatus: 'completed',
            orderStatus: order.orderStatus === 'pending' ? 'processing' : order.orderStatus,
            razorpayPaymentId: paymentId || order.razorpayPaymentId,
            updatedAt: now,
            notes: [
              ...existingNotes,
              {
                type: 'status',
                by: 'system',
                email: 'system@indiacybercafe.com',
                text: `Payment confirmed via Razorpay webhook (${paymentId || rzpOrderId})`,
                time: now
              }
            ]
          };
          await updateOrderInDatabase(order.id, updates, rtdbPath);
          const updatedOrder = { ...order, ...updates };
          if (paymentId) {
            await recordVerifiedPaymentTransaction(updatedOrder, paymentId, rzpOrderId, now);
          }
          sendOrderEmails(updatedOrder, 'online');
        }
      }
    }

    if (eventId) {
      processedWebhookEvents.add(eventId);
    }

    return res.status(200).json({ status: 'ok' });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/**
 * 5. GET /api/store/orders/my
 * Loads all orders owned by verified user (uid, legacy userId, migrated nested ICC/STORE-..., and guest orders matching verified email)
 */
export async function handleGetMyOrders(req: Request, res: Response) {
  try {
    const authUser = await getVerifiedAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { uid, email } = authUser;
    const orderMap = new Map<string, any>();

    const collectOrder = (ord: any) => {
      if (!ord || typeof ord !== 'object' || !ord.id) return;
      if (!orderMap.has(ord.id)) {
        orderMap.set(ord.id, sanitizeOrderForClient(ord, { includeOwnerUid: true }));
      }
    };

    if (isTestMode()) {
      const local = readLocalOrders();
      for (const ord of Object.values(local) as any[]) {
        const ordEmail = (ord.email || ord.deliveryAddress?.email || '').toLowerCase().trim();
        const matchesOwner = ord.uid === uid || ord.userId === uid;
        const matchesGuestEmail = Boolean(email && ord.isGuest && ordEmail === email);
        if (matchesOwner || matchesGuestEmail) {
          if (matchesGuestEmail) {
            ord.uid = uid;
            ord.userId = uid;
            ord.isGuest = false;
            ord.linkedAt = new Date().toISOString();
            await updateOrderInDatabase(ord.id, { uid, userId: uid, isGuest: false, linkedAt: ord.linkedAt });
          } else if (ord.userId === uid && ord.uid !== uid) {
            ord.uid = uid;
            await updateOrderInDatabase(ord.id, { uid });
          }
          collectOrder(ord);
        }
      }
    } else if (hasAdminCredential && rtdbAdmin) {
      // 1. Canonical uid query
      const uidSnap = await withTimeout(rtdbAdmin.ref('orders').orderByChild('uid').equalTo(uid).once('value'), 9000, 'Querying user orders');
      if (uidSnap.exists()) {
        for (const [key, val] of Object.entries(uidSnap.val() || {}) as [string, any][]) {
          if (val && typeof val === 'object') {
            collectOrder({ id: val.id || key, ...val });
          }
        }
      }

      // 2. Legacy userId query
      const legacySnap = await withTimeout(rtdbAdmin.ref('orders').orderByChild('userId').equalTo(uid).once('value'), 9000, 'Querying legacy orders');
      if (legacySnap.exists()) {
        for (const [key, val] of Object.entries(legacySnap.val() || {}) as [string, any][]) {
          if (val && typeof val === 'object') {
            const ord = { id: val.id || key, ...val };
            if (ord.uid !== uid) {
              ord.uid = uid;
              await updateOrderInDatabase(ord.id, { uid }, `orders/${key}`);
            }
            collectOrder(ord);
          }
        }
      }

      // 3. Auto-link unlinked guest orders matching verified email
      if (email) {
        const emailSnap = await withTimeout(rtdbAdmin.ref('orders').orderByChild('email').equalTo(email).once('value'), 9000, 'Querying email orders');
        if (emailSnap.exists()) {
          for (const [key, val] of Object.entries(emailSnap.val() || {}) as [string, any][]) {
            if (val && typeof val === 'object' && (val.isGuest || val.uid === 'guest' || !val.uid)) {
              const ord = { id: val.id || key, ...val, uid, userId: uid, isGuest: false };
              await updateOrderInDatabase(ord.id, { uid, userId: uid, isGuest: false, linkedAt: new Date().toISOString() }, `orders/${key}`);
              collectOrder(ord);
            }
          }
        }
      }

      // 4. Legacy nested `orders/ICC/...` path migration (caused by slashes in ICC/STORE-... keys)
      const nestedIccSnap = await withTimeout(rtdbAdmin.ref('orders/ICC').once('value'), 8000, 'Checking legacy nested orders');
      if (nestedIccSnap.exists()) {
        for (const [subKey, val] of Object.entries(nestedIccSnap.val() || {}) as [string, any][]) {
          if (!val || typeof val !== 'object') continue;
          const ordId = val.id || `ICC/${subKey}`;
          const ordEmail = (val.email || val.deliveryAddress?.email || '').toLowerCase().trim();
          const belongsToUser =
            val.uid === uid ||
            val.userId === uid ||
            (Boolean(email) && (val.isGuest || val.uid === 'guest' || !val.uid) && ordEmail === email);

          if (belongsToUser) {
            const flatKey = toRtdbOrderKey(ordId);
            const migrated = stripUndefinedDeep({
              ...val,
              id: ordId,
              uid,
              userId: uid,
              isGuest: false
            });
            await withTimeout(rtdbAdmin.ref(`orders/${flatKey}`).set(migrated), 8000, 'Migrating nested order');
            await withTimeout(rtdbAdmin.ref(`orders/ICC/${subKey}`).remove(), 6000, 'Removing nested order').catch(() => {});
            collectOrder(migrated);
          }
        }
      }
    } else {
      return res.status(503).json({
        success: false,
        error: 'Order database service is unavailable: Firebase Admin credentials are not configured.'
      });
    }

    const userOrders = Array.from(orderMap.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    return res.json({
      success: true,
      orders: userOrders
    });
  } catch (error: any) {
    console.error('Get my orders error:', error);
    const status = error instanceof DatabaseConfigError ? error.statusCode : error?.message?.includes('timed out') ? 504 : 500;
    return res.status(status).json({ success: false, error: 'Failed to retrieve orders.' });
  }
}

/**
 * 6. POST /api/store/orders/guest-track
 * Secure Guest Order Status Tracking (Rate-limited, exact email/10-digit phone/token verification, zero full-database exposure)
 */
export async function handleGuestTrackOrder(req: Request, res: Response) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit('guest-track', clientIp, 12, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many tracking requests. Please try again shortly.' });
    }

    const { orderId, email, phone, token } = req.body || {};

    if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
      return res.status(400).json({ success: false, error: 'Order ID is required.' });
    }

    const cleanOrderId = orderId.trim();
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanPhone = normalizePhone10(phone);
    const cleanToken = typeof token === 'string' ? token.trim() : '';

    if (!cleanEmail && !cleanPhone && !cleanToken) {
      return res.status(400).json({ success: false, error: 'Email, 10-digit mobile number, or tracking token is required.' });
    }

    if (cleanPhone && cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number.' });
    }

    const record = await findOrderRecord(cleanOrderId);
    if (!record || !record.order || !record.order.id) {
      return res.status(404).json({ success: false, error: 'No order found matching this Order ID.' });
    }

    const order = record.order;
    let isAuthorized = false;

    if (cleanToken && order.guestTokenHash) {
      const computedHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
      const a = Buffer.from(computedHash, 'utf8');
      const b = Buffer.from(String(order.guestTokenHash), 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized && cleanEmail) {
      const orderEmail = (order.deliveryAddress?.email || order.email || '').toLowerCase().trim();
      if (orderEmail && orderEmail === cleanEmail) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized && cleanPhone && cleanPhone.length === 10) {
      const orderPhone = normalizePhone10(order.deliveryAddress?.phone || '');
      if (orderPhone.length === 10 && orderPhone === cleanPhone) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ success: false, error: 'Verification failed. Please check your Order ID and email/phone/token.' });
    }

    return res.json({
      success: true,
      order: sanitizeOrderForClient(order, { includeOwnerUid: false })
    });
  } catch (error: any) {
    console.error('Guest tracking error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve order status.' });
  }
}

/**
 * 7. POST /api/store/orders/link-guest-orders
 * Links guest orders matching verified account email OR verified guest tracking tokens
 */
export async function handleLinkGuestOrders(req: Request, res: Response) {
  try {
    const authUser = await getVerifiedAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { uid, email } = authUser;
    const { guestOrderTokens } = req.body || {};
    const now = new Date().toISOString();
    let linkedCount = 0;

    // 1. Link explicitly authorized guest tokens from browser session
    if (Array.isArray(guestOrderTokens)) {
      for (const entry of guestOrderTokens.slice(0, 20)) {
        if (!entry || typeof entry.orderId !== 'string' || typeof entry.token !== 'string') continue;
        const record = await findOrderRecord(entry.orderId);
        if (!record) continue;
        const { order, rtdbPath } = record;
        if (!order.isGuest && order.uid && order.uid !== 'guest') continue;
        if (!order.guestTokenHash) continue;

        const computedHash = crypto.createHash('sha256').update(entry.token).digest('hex');
        const a = Buffer.from(computedHash, 'utf8');
        const b = Buffer.from(String(order.guestTokenHash), 'utf8');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          await updateOrderInDatabase(order.id, { uid, userId: uid, isGuest: false, linkedAt: now }, rtdbPath);
          linkedCount++;
        }
      }
    }

    // 2. Link guest orders matching verified account email
    if (email) {
      if (isTestMode()) {
        const local = readLocalOrders();
        for (const [id, ord] of Object.entries(local) as [string, any][]) {
          const ordEmail = (ord.email || ord.deliveryAddress?.email || '').toLowerCase().trim();
          if ((ord.isGuest || ord.uid === 'guest') && ordEmail === email) {
            await updateOrderInDatabase(id, { uid, userId: uid, isGuest: false, linkedAt: now });
            linkedCount++;
          }
        }
      } else if (hasAdminCredential && rtdbAdmin) {
        const snap = await withTimeout(rtdbAdmin.ref('orders').orderByChild('email').equalTo(email).once('value'), 9000, 'Linking orders by email');
        if (snap.exists()) {
          for (const [key, ord] of Object.entries(snap.val() || {}) as [string, any][]) {
            if (ord && (ord.isGuest || ord.uid === 'guest' || !ord.uid)) {
              await updateOrderInDatabase(ord.id || key, { uid, userId: uid, isGuest: false, linkedAt: now }, `orders/${key}`);
              linkedCount++;
            }
          }
        }
      }
    }

    return res.json({
      success: true,
      linkedCount,
      message: linkedCount > 0 ? `Successfully linked ${linkedCount} guest order(s) to your account.` : 'No unlinked guest orders found.'
    });
  } catch (error: any) {
    console.error('Link guest orders error:', error);
    return res.status(500).json({ success: false, error: 'Failed to link guest orders.' });
  }
}

/**
 * 8. POST /api/auth/lookup-email
 * Safe non-PII existence lookup for checkout so guest checkout doesn't query restricted /users collection
 */
export async function handleLookupEmail(req: Request, res: Response) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit('lookup-email', clientIp, 20, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many requests.' });
    }

    const email = cleanText(req.body?.email, 160).toLowerCase();
    if (!email || !isValidEmail(email)) {
      return res.json({ success: true, found: false });
    }

    if (hasAdminCredential && authAdmin && !isTestMode()) {
      try {
        const userRecord = await withTimeout(authAdmin.getUserByEmail(email), 4000, 'Email lookup');
        const providers = (userRecord.providerData || []).map(p => p.providerId);
        const isGoogleOnly = providers.includes('google.com') && !providers.includes('password');
        return res.json({ success: true, found: true, isGoogleOnly });
      } catch (err: any) {
        if (err?.code === 'auth/user-not-found') {
          return res.json({ success: true, found: false });
        }
      }
    }

    return res.json({ success: true, found: false });
  } catch (error: any) {
    console.warn('Email lookup notice:', error?.message || error);
    return res.json({ success: true, found: false });
  }
}

/**
 * 9. POST /api/store/upload-custom-image
 * Fallback local upload for custom-image product checkout if Firebase Storage blocks unauthenticated guests
 */
export async function handleUploadCustomImage(req: Request, res: Response) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit('upload-custom-image', clientIp, 15, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many uploads. Please try again shortly.' });
    }

    const file = (req as any).file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, error: 'Image file is required.' });
    }

    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image must be 5MB or smaller.' });
    }

    const buf: Buffer = file.buffer;
    const isJpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp = buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

    if (!isJpeg && !isPng && !isWebp) {
      return res.status(400).json({ success: false, error: 'Invalid image format. Only JPG, PNG, and WEBP are allowed.' });
    }

    const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
    const filename = `custom_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.mkdirSync(CUSTOM_UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(CUSTOM_UPLOADS_DIR, filename), buf);

    return res.json({
      success: true,
      url: `/uploads/custom-images/${filename}`
    });
  } catch (error: any) {
    console.error('Custom image upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload custom image.' });
  }
}
