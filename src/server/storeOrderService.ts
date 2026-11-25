import 'dotenv/config';
import dotenv from 'dotenv';
import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getDatabase, Database } from 'firebase-admin/database';
import { getAuth, Auth } from 'firebase-admin/auth';
import {
  enqueueOutboxNotification,
  buildQueuedEmailDeliverySummary,
} from './emailNotificationService.js';
import { requireAdminCaller, verifyCallerWithRole } from './operatorService.js';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';

// Resolve application root
const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const ORDERS_STORE_PATH = path.join(APP_ROOT, 'data/orders_store.json');
const PRODUCTS_DATA_PATH = path.join(APP_ROOT, 'public/data/products.json');
const DIST_PRODUCTS_PATH = path.join(APP_ROOT, 'dist/data/products.json');
const CUSTOM_UPLOADS_DIR = path.join(APP_ROOT, 'data/uploads/custom-images');
const DEFAULT_PROJECT_ID = 'india-cyber-cafe';
const DEFAULT_RTDB_URL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';

const normalizeEnvSecret = (raw?: string) =>
  String(raw || '').trim().replace(/^['"]|['"]$/g, '').trim();
const getRtdbDatabaseUrl = () => {
  const cleaned = normalizeEnvSecret(process.env.FIREBASE_DATABASE_URL).replace(/\/+$/, '');
  if (!cleaned) return DEFAULT_RTDB_URL;
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
};
const getConfiguredProjectId = () => (process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim() || DEFAULT_PROJECT_ID;

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

function parseServiceAccountRaw(raw: string): (ServiceAccount & { type?: string; project_id?: string; client_email?: string; private_key?: string }) | null {
  try {
    let trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner.startsWith('{') || /^[A-Za-z0-9+/=]+$/.test(inner)) {
        trimmed = inner;
      }
    }

    let parsed: any = null;
    if (trimmed.startsWith('{')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = JSON.parse(trimmed.replace(/\r?\n/g, '\\n'));
      }
    } else {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
      if (decoded.trim().startsWith('{')) {
        parsed = JSON.parse(decoded);
      }
    }

    if (parsed && typeof parsed === 'object') {
      const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : typeof parsed.clientEmail === 'string' ? parsed.clientEmail.trim() : '';
      const rawKey = typeof parsed.private_key === 'string' ? parsed.private_key : typeof parsed.privateKey === 'string' ? parsed.privateKey : '';
      const privateKey = rawKey.replace(/\\n/g, '\n');

      // Strictly reject client Firebase configs or incomplete credentials
      if (parsed.type !== 'service_account' || !clientEmail || !privateKey.includes('PRIVATE KEY')) {
        console.warn('⚠️ Ignoring non-service-account Firebase credential payload (requires type="service_account", client_email, private_key).');
        return null;
      }

      return {
        ...parsed,
        client_email: clientEmail,
        private_key: privateKey,
      };
    }
  } catch (err: any) {
    console.warn('⚠️ Invalid service account JSON/base64:', err?.message || err);
  }
  return null;
}

function loadAppRootEnvIfPresent() {
  try {
    const envPath = path.join(APP_ROOT, '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true } as any);
    }
  } catch {}
}

function resolveFirebaseCredential(): { credential: any | null; source: string; method: string; projectId?: string } {
  const inlineEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineEnv) {
    const methodName = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'FIREBASE_SERVICE_ACCOUNT_JSON' : 'FIREBASE_SERVICE_ACCOUNT';
    const parsed = parseServiceAccountRaw(inlineEnv);
    if (parsed) {
      return {
        credential: cert(parsed),
        source: 'environment',
        method: methodName,
        projectId: parsed.project_id
      };
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const parsed = parseServiceAccountRaw(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);
    if (parsed) {
      return {
        credential: cert(parsed),
        source: 'environment',
        method: 'FIREBASE_SERVICE_ACCOUNT_BASE64',
        projectId: parsed.project_id
      };
    }
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    const normalizedEmail = process.env.FIREBASE_CLIENT_EMAIL.trim();
    const normalizedKey = process.env.FIREBASE_PRIVATE_KEY.trim().replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
    if (normalizedEmail && normalizedKey.includes('PRIVATE KEY')) {
      return {
        credential: cert({
          projectId: getConfiguredProjectId(),
          clientEmail: normalizedEmail,
          privateKey: normalizedKey,
        }),
        source: 'environment',
        method: 'FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY',
        projectId: getConfiguredProjectId()
      };
    }
    console.warn('⚠️ Ignoring incomplete FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY environment variables.');
  }

  const envGacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      ? process.env.GOOGLE_APPLICATION_CREDENTIALS
      : path.join(APP_ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : null;

  const candidatePaths = [
    envGacPath,
    path.join(APP_ROOT, 'firebase-service-account.json'),
    path.join(APP_ROOT, 'service-account.json'),
    path.join(APP_ROOT, 'data/firebase-service-account.json'),
  ].filter(Boolean) as string[];

  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const parsed = parseServiceAccountRaw(fs.readFileSync(filePath, 'utf-8'));
        if (parsed) {
          return {
            credential: cert(parsed),
            source: 'file',
            method: envGacPath && filePath === envGacPath ? 'GOOGLE_APPLICATION_CREDENTIALS' : path.basename(filePath),
            projectId: parsed.project_id
          };
        }
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
    return { credential: undefined, source: 'gcp_adc', method: 'GCP_ADC' };
  }

  return { credential: null, source: 'none', method: 'none' };
}

// Initialize Firebase Admin SDK safely (singleton & re-entrant if .env loads after import)
let rtdbAdmin: Database | null = null;
let authAdmin: Auth | null = null;
let hasAdminCredential = false;
let credentialSource = 'none';
let credentialMethod = 'none';
let activeProjectId = DEFAULT_PROJECT_ID;
let loggedMissingWarning = false;

function ensureFirebaseAdminInitialized(): boolean {
  if (hasAdminCredential && rtdbAdmin && authAdmin) {
    return true;
  }

  loadAppRootEnvIfPresent();

  try {
    const { credential, source, method, projectId } = resolveFirebaseCredential();
    credentialSource = source;
    credentialMethod = method;
    activeProjectId = projectId || getConfiguredProjectId();

    if (source !== 'none') {
      const dbUrl = getRtdbDatabaseUrl();
      const appConfig: any = {
        projectId: activeProjectId,
        databaseURL: dbUrl
      };
      if (credential) {
        appConfig.credential = credential;
      }
      const apps = getApps();
      const defaultApp = apps.find(a => a.name === '[DEFAULT]') || apps[0];
      const authApp = defaultApp || initializeApp(appConfig);
      let dbApp = authApp;
      if ((authApp.options as any)?.databaseURL !== dbUrl) {
        dbApp = apps.find(a => a.name === 'icc-rtdb') || initializeApp(appConfig, 'icc-rtdb');
      }
      rtdbAdmin = getDatabase(dbApp);
      authAdmin = getAuth(authApp);
      hasAdminCredential = true;
      console.log(`✅ Firebase Admin SDK initialized (source=${source}, method=${method}, projectId=${activeProjectId})`);
      return true;
    } else if (!isTestMode() && !loggedMissingWarning) {
      loggedMissingWarning = true;
      console.warn('⚠️ Firebase Admin credentials not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or firebase-service-account.json). Protected /orders writes will fail fast instead of hanging.');
    }
  } catch (err: any) {
    console.warn('⚠️ Firebase Admin SDK init warning:', err?.message || err);
  }

  return false;
}

ensureFirebaseAdminInitialized();

let connectivityCache: {
  expiresAt: number;
  result: { rtdbConnected: boolean; rtdbChecked: boolean; rtdbLatencyMs: number | null; rtdbError?: string };
} = {
  expiresAt: 0,
  result: { rtdbConnected: false, rtdbChecked: false, rtdbLatencyMs: null }
};
let connectivityProbeInFlight: Promise<{ rtdbConnected: boolean; rtdbChecked: boolean; rtdbLatencyMs: number | null; rtdbError?: string }> | null = null;

export async function checkFirebaseAdminConnectivity(options: { force?: boolean; timeoutMs?: number } = {}) {
  const { force = false, timeoutMs = 4000 } = options;
  const now = Date.now();
  if (!force && connectivityCache.expiresAt > now) {
    return connectivityCache.result;
  }

  const ready = ensureFirebaseAdminInitialized();
  if (!ready || !rtdbAdmin) {
    const res = {
      rtdbConnected: false,
      rtdbChecked: false,
      rtdbLatencyMs: null,
      rtdbError: 'Firebase Admin credentials not configured'
    };
    connectivityCache = { expiresAt: now + 15000, result: res };
    return res;
  }

  if (isTestMode()) {
    return {
      rtdbConnected: false,
      rtdbChecked: false,
      rtdbLatencyMs: 0
    };
  }

  if (!force && connectivityProbeInFlight) {
    return connectivityProbeInFlight;
  }

  let probe: Promise<{ rtdbConnected: boolean; rtdbChecked: boolean; rtdbLatencyMs: number | null; rtdbError?: string }> | null = null;
  probe = (async () => {
    const startedAt = Date.now();
    try {
      // Locked /orders read proves real Admin-privileged RTDB connectivity (anonymous clients are denied by rules)
      await withTimeout(rtdbAdmin!.ref('orders').limitToFirst(1).once('value'), timeoutMs, 'Firebase Admin RTDB connectivity check');
      const res = {
        rtdbConnected: true,
        rtdbChecked: true,
        rtdbLatencyMs: Date.now() - startedAt
      };
      connectivityCache = { expiresAt: Date.now() + 30000, result: res };
      return res;
    } catch (err: any) {
      const rawMsg = String(err?.message || 'RTDB connectivity check failed');
      const safeMsg = rawMsg.replace(/https?:\/\/[^\s]+/g, '[redacted-url]').slice(0, 180);
      const res = {
        rtdbConnected: false,
        rtdbChecked: true,
        rtdbLatencyMs: Date.now() - startedAt,
        rtdbError: safeMsg
      };
      connectivityCache = { expiresAt: Date.now() + 15000, result: res };
      return res;
    } finally {
      if (probe && connectivityProbeInFlight === probe) {
        connectivityProbeInFlight = null;
      }
    }
  })();
  connectivityProbeInFlight = probe;
  return probe;
}

export function getStoreServiceStatus() {
  ensureFirebaseAdminInitialized();
  return {
    firebaseAdminConfigured: hasAdminCredential,
    credentialSource,
    credentialMethod,
    projectId: activeProjectId,
    databaseUrl: getRtdbDatabaseUrl(),
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    testMode: isTestMode()
  };
}

export async function getStoreServiceHealth(options: { checkConnectivity?: boolean; force?: boolean } = {}) {
  const status = getStoreServiceStatus();
  if (options.checkConnectivity === false) {
    return status;
  }
  const connectivity = await checkFirebaseAdminConnectivity({ force: Boolean(options.force) });
  return {
    ...status,
    ...connectivity
  };
}

// Email notifications are delegated to ./emailNotificationService.js

// Bounded LRU-evicting rate limiter (prevents unbounded memory growth at high load)
const MAX_RATE_LIMIT_ENTRIES = 10000;
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function checkRateLimit(bucket: string, ip: string, maxRequests = 20, windowMs = 60000): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) {
    let removed = 0;
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetTime || removed < 500) {
        rateLimitMap.delete(k);
        removed++;
        if (rateLimitMap.size < MAX_RATE_LIMIT_ENTRIES - 500) break;
      }
    }
  }
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

// Durable + bounded idempotency cache to prevent double-clicks and survive restarts
const MAX_IDEMPOTENCY_ENTRIES = 5000;
const STORE_IDEMPOTENCY_PATH = path.join(APP_ROOT, 'data/store_idempotency.json');
const idempotencyCache = new Map<string, { timestamp: number; result: any }>();
let idempotencyHydrated = false;

function hydrateIdempotencyDisk() {
  if (idempotencyHydrated) return;
  idempotencyHydrated = true;
  try {
    if (fs.existsSync(STORE_IDEMPOTENCY_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_IDEMPOTENCY_PATH, 'utf-8'));
      const now = Date.now();
      for (const [k, v] of Object.entries(parsed || {}) as [string, any][]) {
        if (v && typeof v === 'object' && now - Number(v.timestamp || 0) < 24 * 60 * 60 * 1000) {
          idempotencyCache.set(k, v);
        }
      }
    }
  } catch {}
}

function checkIdempotency(key?: string): any | null {
  if (!key || typeof key !== 'string') return null;
  hydrateIdempotencyDisk();
  const now = Date.now();
  const cached = idempotencyCache.get(key);
  if (cached && now - cached.timestamp < 30 * 60 * 1000) {
    return cached.result;
  }
  return null;
}

let storeIdemFlushTimer: NodeJS.Timeout | null = null;
let storeIdemWriting = false;
let storeIdemDirty = false;

async function flushStoreIdempotencyAsync() {
  if (storeIdemWriting) {
    storeIdemDirty = true;
    return;
  }
  storeIdemDirty = false;
  storeIdemWriting = true;
  try {
    await fs.promises.mkdir(path.dirname(STORE_IDEMPOTENCY_PATH), { recursive: true });
    const recent = Object.fromEntries(Array.from(idempotencyCache.entries()).slice(-500));
    const tmp = `${STORE_IDEMPOTENCY_PATH}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(recent), 'utf-8');
    await fs.promises.rename(tmp, STORE_IDEMPOTENCY_PATH);
  } catch {} finally {
    storeIdemWriting = false;
    if (storeIdemDirty) {
      scheduleStoreIdempotencyFlush();
    }
  }
}

function scheduleStoreIdempotencyFlush() {
  storeIdemDirty = true;
  if (storeIdemFlushTimer) return;
  storeIdemFlushTimer = setTimeout(() => {
    storeIdemFlushTimer = null;
    void flushStoreIdempotencyAsync();
  }, 150);
  if (typeof storeIdemFlushTimer.unref === 'function') storeIdemFlushTimer.unref();
}

function recordIdempotency(key: string | undefined, result: any) {
  if (!key || typeof key !== 'string') return;
  hydrateIdempotencyDisk();
  if (idempotencyCache.size >= MAX_IDEMPOTENCY_ENTRIES) {
    const firstKey = idempotencyCache.keys().next().value;
    if (firstKey) idempotencyCache.delete(firstKey);
  }
  idempotencyCache.set(key, { timestamp: Date.now(), result });
  if (isTestMode()) {
    try {
      fs.mkdirSync(path.dirname(STORE_IDEMPOTENCY_PATH), { recursive: true });
      const recent = Object.fromEntries(Array.from(idempotencyCache.entries()).slice(-500));
      const tmp = `${STORE_IDEMPOTENCY_PATH}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(recent), 'utf-8');
      fs.renameSync(tmp, STORE_IDEMPOTENCY_PATH);
    } catch {}
  } else {
    scheduleStoreIdempotencyFlush();
  }
}

// Bounded processed webhook events cache (prevents duplicate webhook execution)
const processedWebhookEvents = new Set<string>();
function rememberWebhookEvent(eventId: string) {
  if (processedWebhookEvents.size >= 5000) {
    const first = processedWebhookEvents.values().next().value;
    if (first) processedWebhookEvents.delete(first);
  }
  processedWebhookEvents.add(eventId);
}

// Optional hook registered by operatorService for Razorpay webhook application reconciliation
type ApplicationWebhookHandler = (params: {
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  amountPaise?: number;
  notes?: Record<string, any>;
}) => Promise<boolean>;
let applicationWebhookHandler: ApplicationWebhookHandler | null = null;
export function registerApplicationWebhookReconciler(handler: ApplicationWebhookHandler | null) {
  applicationWebhookHandler = handler;
}

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

const localDigitalProductResources = new Map<string, any[]>();
const localDigitalDownloadOrders = new Map<string, any>();
const localDigitalDownloadTokens = new Map<string, any>();

const publicStoreBaseUrl = () => (process.env.PUBLIC_BASE_URL || 'https://b.indiacybercafe.com').replace(/\/+$/, '');

function getDigitalTokenEncryptionKey() {
  const dedicated = String(process.env.DIGITAL_DOWNLOAD_TOKEN_SECRET || '').trim();
  if (dedicated) return crypto.createHash('sha256').update(dedicated).digest();
  if (isTestMode()) return crypto.createHash('sha256').update('test_digital_download_secret').digest();
  throw new DatabaseConfigError('DIGITAL_DOWNLOAD_TOKEN_SECRET is not configured.');
}

function getLegacyDigitalTokenEncryptionKey(): Buffer | null {
  const legacy = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  return legacy ? crypto.createHash('sha256').update(legacy).digest() : null;
}

function decryptWithKey(encrypted: string, key: Buffer) {
  const [ivHex, tagHex, ciphertextHex] = String(encrypted || '').split('.');
  if (!ivHex || !tagHex || !ciphertextHex) throw new Error('Invalid encrypted download token.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}

function decryptDigitalToken(encrypted: string) {
  try {
    return decryptWithKey(encrypted, getDigitalTokenEncryptionKey());
  } catch (dedicatedError) {
    const legacyKey = getLegacyDigitalTokenEncryptionKey();
    if (!legacyKey) throw dedicatedError;
    try {
      return decryptWithKey(encrypted, legacyKey);
    } catch {
      throw dedicatedError;
    }
  }
}

function encryptWithKey(plainText: string, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${ciphertext.toString('hex')}`;
}

function encryptDigitalToken(token: string) {
  return encryptWithKey(token, getDigitalTokenEncryptionKey());
}

async function getPrivateDigitalProductResources(productId: string): Promise<any[]> {
  if (isTestMode()) return localDigitalProductResources.get(productId) || [];
  if (!ensureFirebaseAdminInitialized() || !rtdbAdmin) throw new DatabaseConfigError('Private product storage is unavailable.');
  const snapshot = await withTimeout(rtdbAdmin.ref(`digitalProductResources/${productId}`).once('value'), 7000, 'Reading private product resources');
  return snapshot.val()?.resources || [];
}

function groupDownloadResources(resources: any[]) {
  return (resources || []).filter(resource => !resource.revoked).reduce((grouped: any[], resource: any) => {
    let product = grouped.find(entry => entry.productName === resource.productName);
    if (!product) {
      product = { productName: resource.productName, resources: [] };
      grouped.push(product);
    }
    const readableToken = getReadableLegacyToken(resource);
    if (!readableToken) return grouped;
    product.resources.push({
      fileName: resource.fileName,
      label: resource.label,
      downloadUrl: `${publicStoreBaseUrl()}/api/store/downloads/${encodeURIComponent(readableToken)}`,
      expiresAt: resource.expiresAt || null,
      downloadLimit: resource.downloadLimit,
      downloadsUsed: resource.downloadCount || 0,
    });
    return grouped;
  }, []);
}

async function getDigitalDownloadEntitlement(orderId: string): Promise<any | null> {
  if (isTestMode()) return localDigitalDownloadOrders.get(orderId) || null;
  if (!ensureFirebaseAdminInitialized() || !rtdbAdmin) return null;
  const snapshot = await rtdbAdmin.ref(`digitalDownloads/orders/${toRtdbOrderKey(orderId)}`).once('value');
  return snapshot.val();
}

async function saveDigitalDownloadEntitlement(orderId: string, entitlement: any) {
  if (isTestMode()) {
    localDigitalDownloadOrders.set(orderId, entitlement);
    for (const resource of entitlement.resources || []) localDigitalDownloadTokens.set(resource.tokenHash, resource);
    return;
  }
  if (!ensureFirebaseAdminInitialized() || !rtdbAdmin) throw new DatabaseConfigError('Private download storage is unavailable.');
  const updates: Record<string, any> = {
    [`digitalDownloads/orders/${toRtdbOrderKey(orderId)}`]: entitlement,
  };
  for (const resource of entitlement.resources || []) {
    updates[`digitalDownloads/tokens/${resource.tokenHash}`] = { ...resource, orderId };
  }
  await rtdbAdmin.ref().update(updates);
}

async function ensureDigitalDownloads(order: any, regenerate = false): Promise<any[]> {
  if (!order || order.paymentStatus !== 'completed' || order.paymentMethod === 'cash' || order.paymentStatus === 'refunded') return [];
  const orderItems = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
  const virtualItems = orderItems.filter((item: any) => item?.productType === 'virtual');
  if (!virtualItems.length) return [];

  const current = await getDigitalDownloadEntitlement(order.id);
  if (current && !regenerate) return current.revoked ? [] : groupDownloadResources(current.resources || []);

  if (current) {
    for (const resource of current.resources || []) {
      resource.revoked = true;
      if (isTestMode()) localDigitalDownloadTokens.set(resource.tokenHash, resource);
    }
    if (!isTestMode() && rtdbAdmin) {
      const revocations: Record<string, boolean> = {};
      for (const resource of current.resources || []) revocations[`digitalDownloads/tokens/${resource.tokenHash}/revoked`] = true;
      if (Object.keys(revocations).length) await rtdbAdmin.ref().update(revocations);
    }
  }

  const createdAt = new Date().toISOString();
  const resources: any[] = [];
  for (const item of virtualItems as any[]) {
    const productResources = await getPrivateDigitalProductResources(item.productId);
    if (!Array.isArray(productResources) || productResources.length === 0) {
      throw new Error(`Digital download configuration missing for ${item.productId}`);
    }
    for (const resource of productResources) {
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiryDays = Math.max(0, Number(item.downloadExpiryDays) || 0);
      resources.push({
        tokenHash,
        encryptedToken: encryptDigitalToken(token),
        orderId: order.id,
        productId: item.productId,
        productName: item.productName,
        fileName: resource.fileName,
        label: resource.label,
        sourceUrl: resource.url,
        createdAt,
        expiresAt: expiryDays ? new Date(Date.now() + expiryDays * 86400000).toISOString() : null,
        downloadLimit: Math.min(1000, Math.max(1, Math.floor(Number(item.downloadLimit) || 5))),
        downloadCount: 0,
        revoked: false,
      });
    }
  }
  const entitlement = { orderId: order.id, createdAt, revoked: false, resources };
  await saveDigitalDownloadEntitlement(order.id, entitlement);
  return groupDownloadResources(resources);
}

async function revokeDigitalDownloads(orderId: string) {
  const entitlement = await getDigitalDownloadEntitlement(orderId);
  if (!entitlement) return;
  entitlement.revoked = true;
  const updates: Record<string, any> = {
    [`digitalDownloads/orders/${toRtdbOrderKey(orderId)}`]: entitlement,
  };
  for (const resource of entitlement.resources || []) {
    resource.revoked = true;
    if (isTestMode()) localDigitalDownloadTokens.set(resource.tokenHash, resource);
    else updates[`digitalDownloads/tokens/${resource.tokenHash}/revoked`] = true;
  }
  if (isTestMode()) localDigitalDownloadOrders.set(orderId, entitlement);
  else if (rtdbAdmin) await rtdbAdmin.ref().update(updates);
}

async function prepareDigitalDelivery(order: any, rtdbPath?: string) {
  const downloads = await ensureDigitalDownloads(order);
  const hasVirtualItems = (Array.isArray(order.items) ? order.items : Object.values(order.items || {}))
    .some((item: any) => item?.productType === 'virtual');
  const updates = {
    digitalDeliveryStatus: hasVirtualItems ? (downloads.length ? 'available' : 'unavailable') : 'not_required',
    digitalEmailStatus: hasVirtualItems ? 'queued' : 'not_required',
    digitalResourceNames: downloads.flatMap((product: any) => (product.resources || []).map((resource: any) => ({
      productName: product.productName,
      fileName: resource.fileName,
    }))),
  };
  await updateOrderInDatabase(order.id, updates, rtdbPath);
  return { downloads, order: { ...order, ...updates, digitalDownloads: downloads } };
}

export async function handleDigitalDownload(req: Request, res: Response) {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(404).send('Download not found.');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    let record: any;
    if (isTestMode()) record = localDigitalDownloadTokens.get(tokenHash);
    else {
      if (!ensureFirebaseAdminInitialized() || !rtdbAdmin) return res.status(503).send('Download service unavailable.');
      const snapshot = await rtdbAdmin.ref(`digitalDownloads/tokens/${tokenHash}`).once('value');
      record = snapshot.val();
    }
    if (!record || record.revoked) return res.status(404).send('Download not found.');
    if (typeof record.token === 'string' && record.token === token) {
      record.tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    }
    if (record.tokenHash !== tokenHash) return res.status(404).send('Download not found.');
    const orderRecord = await findOrderRecord(record.orderId);
    if (!orderRecord || orderRecord.order.paymentStatus !== 'completed') return res.status(403).send('This order is not eligible for downloads.');
    if (record.expiresAt && Date.now() > new Date(record.expiresAt).getTime()) return res.status(410).send('This download link has expired.');

    let safeFetch: { response: globalThis.Response; finalUrl: URL };
    try {
      safeFetch = await fetchSafeDownloadResponse(String(record.sourceUrl || ''));
    } catch (error: any) {
      const message = String(error?.message || 'Invalid download source.');
      if (/private|local|localhost|reserved|credentials|alternate|invalid|resolve/i.test(message)) {
        return res.status(400).send(message);
      }
      return res.status(502).send('Download source is unavailable.');
    }
    const response = safeFetch.response as unknown as globalThis.Response;
    const maxBytes = 5 * 1024 * 1024;
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) return res.status(413).send('File exceeds the download size limit.');
    const latestOrder = await findOrderRecord(record.orderId);
    if (!latestOrder || latestOrder.order.paymentStatus !== 'completed') return res.status(403).send('This order is not eligible for downloads.');
    if (isTestMode()) {
      if (record.downloadCount >= record.downloadLimit) return res.status(429).send('Download limit reached.');
      record.downloadCount += 1;
    } else {
      const tokenRef = rtdbAdmin!.ref(`digitalDownloads/tokens/${tokenHash}`);
      const transaction = await tokenRef.transaction((current: any) => {
        if (!current || current.revoked || current.tokenHash !== tokenHash || current.downloadCount >= current.downloadLimit || (current.expiresAt && Date.now() > new Date(current.expiresAt).getTime())) return;
        current.downloadCount = (Number(current.downloadCount) || 0) + 1;
        current.lastDownloadedAt = new Date().toISOString();
        return current;
      });
      if (!transaction.committed) return res.status(429).send('Download limit reached or link revoked.');
      record = transaction.snapshot.val();
    }
    const safeFileName = String(record.fileName || 'download').replace(/[\r\n"\\]/g, '_');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName)}`);
    if (Number.isFinite(contentLength) && contentLength > 0) res.setHeader('Content-Length', String(contentLength));
    let bytesSent = 0;
    const sizeGuard = new Transform({
      transform(chunk, _encoding, callback) {
        bytesSent += chunk.length;
        callback(bytesSent > maxBytes ? new Error('File exceeds the download size limit.') : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as any), sizeGuard, res);
    return;
  } catch (error: any) {
    console.error('Digital download error:', error?.message || error);
    if (res.headersSent) return res.destroy();
    return res.status(500).send('Could not process this download.');
  }
}

export async function handleAdminRegenerateDigitalDownloads(req: Request, res: Response) {
  const admin = await requireAdminCaller(req, res);
  if (!admin) return;
  try {
    const record = await findOrderRecord(String(req.params.orderId || ''));
    if (!record || record.order.paymentStatus !== 'completed') return res.status(403).json({ success: false, error: 'Downloads are available only for paid orders.' });
    const downloads = await ensureDigitalDownloads(record.order, true);
    if (!downloads.length) return res.status(400).json({ success: false, error: 'No digital resources are configured for this order.' });
    await updateOrderInDatabase(record.order.id, {
      digitalDeliveryStatus: 'available',
      digitalResourceNames: downloads.flatMap((product: any) => (product.resources || []).map((resource: any) => ({ productName: product.productName, fileName: resource.fileName }))),
    }, record.rtdbPath);
    return res.json({ success: true, downloads });
  } catch (error: any) {
    console.error('Download access regeneration failed:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not regenerate download access.' });
  }
}

export async function handleAdminRevokeDigitalDownloads(req: Request, res: Response) {
  const admin = await requireAdminCaller(req, res);
  if (!admin) return;
  try {
    const record = await findOrderRecord(String(req.params.orderId || ''));
    if (!record) return res.status(404).json({ success: false, error: 'Order not found.' });
    await revokeDigitalDownloads(record.order.id);
    await updateOrderInDatabase(record.order.id, { digitalDeliveryStatus: 'revoked' }, record.rtdbPath);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Download access revocation failed:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not revoke download access.' });
  }
}

export async function handleAdminResendDigitalEmail(req: Request, res: Response) {
  const admin = await requireAdminCaller(req, res);
  if (!admin) return;
  try {
    const record = await findOrderRecord(String(req.params.orderId || ''));
    if (!record || record.order.paymentStatus !== 'completed') return res.status(403).json({ success: false, error: 'Download emails are available only for paid orders.' });
    const downloads = await ensureDigitalDownloads(record.order);
    if (!downloads.length) return res.status(400).json({ success: false, error: 'No active digital downloads are available.' });
    const clientRequestId = String(req.body?.idempotencyKey || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    const job = enqueueOutboxNotification({
      idempotencyKey: `digital_delivery:${record.order.id}:${clientRequestId}`,
      kind: 'digital_delivery',
      orderId: record.order.id,
      payload: { order: record.order, downloads },
      maxAttempts: 5,
    });
    await updateOrderInDatabase(record.order.id, { digitalEmailStatus: 'queued' }, record.rtdbPath);
    return res.json({ success: true, outboxJobId: job.job.jobId, emailDelivery: buildQueuedEmailDeliverySummary(job.job.jobId) });
  } catch (error: any) {
    console.error('Digital delivery email resend failed:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not queue the download email.' });
  }
}

const ALLOWED_DIGITAL_EXTENSIONS = new Set(['pdf', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);

function extractVerifiedFirebaseDigitalObject(url: URL): { bucket: string; objectName: string; objectExt: string } | null {
  if (url.hostname !== 'firebasestorage.googleapis.com') return null;
  if (url.searchParams.get('alt') !== 'media' || !url.searchParams.get('token')) return null;
  const storagePath = url.pathname.match(/^\/v0\/b\/(india-cyber-cafe-free(?:\.(?:appspot\.com|firebasestorage\.app))?)\/o\/(.+)$/);
  if (!storagePath) return null;
  let objectName: string;
  try {
    objectName = decodeURIComponent(storagePath[2]);
  } catch {
    return null;
  }
  if (!objectName.startsWith('digital-products/')) return null;
  const objectFileName = objectName.slice('digital-products/'.length);
  if (!objectFileName || objectFileName.includes('/') || objectFileName.includes('\\')) return null;
  const dotIdx = objectFileName.lastIndexOf('.');
  const objectExt = dotIdx > 0 ? objectFileName.slice(dotIdx + 1).toLowerCase().trim() : '';
  if (!ALLOWED_DIGITAL_EXTENSIONS.has(objectExt)) return null;
  return { bucket: storagePath[1], objectName, objectExt };
}

export async function normalizeDigitalResources(
  value: any
): Promise<{ ok: true; resources: any[] } | { ok: false; error: string }> {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'Download resources must be a list.' };
  }
  if (value.length > 50) {
    return { ok: false, error: 'A maximum of 50 digital download resources is allowed per product.' };
  }
  const resources: any[] = [];
  const resourceIds = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const resource = value[i];
    const idxLabel = `Resource #${i + 1}`;
    if (!resource || typeof resource !== 'object') {
      return { ok: false, error: `${idxLabel}: Invalid resource entry.` };
    }
    const id = String(resource.id || '').trim() || crypto.randomUUID();
    let fileName = String(resource.fileName || '').trim();
    const label = String(resource.label || '').trim();
    const rawUrl = String(resource.url || '').trim();
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, error: `${idxLabel}: Enter a valid HTTPS download URL.` };
    }
    if (id.length > 128 || resourceIds.has(id)) {
      return { ok: false, error: `${idxLabel}: Duplicate or invalid resource ID.` };
    }
    if (!fileName || fileName.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(fileName)) {
      return { ok: false, error: `${idxLabel}: File name is required and cannot contain slashes.` };
    }
    if (!label || label.length > 160) {
      return { ok: false, error: `${idxLabel}: Button label must be between 1 and 160 characters.` };
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
      return { ok: false, error: `${idxLabel}: Download URL must use HTTPS without credentials or custom ports.` };
    }

    const isFirebaseStorageHost = url.hostname === 'firebasestorage.googleapis.com';
    let verifiedFirebaseObject: { bucket: string; objectName: string; objectExt: string } | null = null;
    if (!isTestMode() && isFirebaseStorageHost) {
      verifiedFirebaseObject = extractVerifiedFirebaseDigitalObject(url);
      if (!verifiedFirebaseObject) {
        return {
          ok: false,
          error: `${idxLabel}: Firebase Storage files must be uploaded via "Upload file" into digital product storage.`,
        };
      }
    }

    const dotIdx = fileName.lastIndexOf('.');
    let cleanExt = dotIdx > 0 ? fileName.slice(dotIdx + 1).toLowerCase().trim() : '';
    if (!ALLOWED_DIGITAL_EXTENSIONS.has(cleanExt) && verifiedFirebaseObject) {
      // Automatically preserve the uploaded file's extension if the admin omitted it in the display filename
      fileName = `${fileName.replace(/\.+$/, '')}.${verifiedFirebaseObject.objectExt}`.slice(0, 180);
      cleanExt = verifiedFirebaseObject.objectExt;
    }
    if (!ALLOWED_DIGITAL_EXTENSIONS.has(cleanExt)) {
      return {
        ok: false,
        error: `${idxLabel}: File name must end with .pdf, .zip, .doc, .docx, .xls, .xlsx, .ppt, or .pptx.`,
      };
    }
    if (verifiedFirebaseObject && verifiedFirebaseObject.objectExt !== cleanExt) {
      return {
        ok: false,
        error: `${idxLabel}: File name extension (.${cleanExt}) must match the uploaded file (.${verifiedFirebaseObject.objectExt}).`,
      };
    }

    if (!isTestMode()) {
      try {
        await validateSafeDownloadUrl(url.toString());
      } catch (err: any) {
        // Shared hosting DNS resolvers occasionally fail/time out on getaddrinfo for firebasestorage.googleapis.com.
        // Only allow bypassing transient DNS resolution failures when the URL is already pinned to our Firebase Storage bucket.
        const isTransientDnsFailure = err?.message === 'Could not resolve download source host.';
        if (!(verifiedFirebaseObject && isTransientDnsFailure)) {
          return {
            ok: false,
            error: `${idxLabel}: ${err?.message || 'Download URL is not allowed.'}`,
          };
        }
      }
    }
    resourceIds.add(id);
    resources.push({ id, fileName, label, url: url.toString() });
  }
  return { ok: true, resources };
}

export async function handleAdminGetDigitalProductResources(req: Request, res: Response) {
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;
  const productId = String(req.params.productId || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) return res.status(400).json({ success: false, error: 'Invalid product ID.' });
  try {
    if (isTestMode()) return res.json({ success: true, resources: localDigitalProductResources.get(productId) || [] });
    if (!ensureFirebaseAdminInitialized() || !rtdbAdmin) return res.status(503).json({ success: false, error: 'Private product storage is unavailable.' });
    const snapshot = await withTimeout(rtdbAdmin.ref(`digitalProductResources/${productId}`).once('value'), 7000, 'Reading private product resources');
    return res.json({ success: true, resources: snapshot.val()?.resources || [] });
  } catch (error: any) {
    console.error('Could not read private product downloads:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not load download resources.' });
  }
}

export async function handleAdminSaveDigitalProductResources(req: Request, res: Response) {
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;
  const productId = String(req.params.productId || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) {
    return res.status(400).json({ success: false, error: 'Invalid product ID.' });
  }
  const normalized = await normalizeDigitalResources(req.body?.resources);
  if (normalized.ok === false) {
    console.warn('[storeOrderService] Digital resource validation failed:', {
      productId,
      error: normalized.error,
    });
    return res.status(400).json({ success: false, error: normalized.error });
  }
  const resources = normalized.resources;
  try {
    if (isTestMode()) localDigitalProductResources.set(productId, resources);
    else {
      if (!ensureFirebaseAdminInitialized() || !rtdbAdmin) return res.status(503).json({ success: false, error: 'Private product storage is unavailable.' });
      await withTimeout(rtdbAdmin.ref(`digitalProductResources/${productId}`).set({ resources, updatedAt: new Date().toISOString(), updatedBy: caller.uid }), 7000, 'Saving private product resources');
    }
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Could not save private product downloads:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not save download resources.' });
  }
}

export async function handleAdminDeleteDigitalProductResources(req: Request, res: Response) {
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;
  const productId = String(req.params.productId || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) return res.status(400).json({ success: false, error: 'Invalid product ID.' });
  try {
    if (isTestMode()) localDigitalProductResources.delete(productId);
    else {
      if (!ensureFirebaseAdminInitialized() || !rtdbAdmin) return res.status(503).json({ success: false, error: 'Private product storage is unavailable.' });
      await withTimeout(rtdbAdmin.ref(`digitalProductResources/${productId}`).remove(), 7000, 'Deleting private product resources');
    }
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Could not remove private product downloads:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Could not remove download resources.' });
  }
}

let localOrdersCache: Record<string, any> | null = null;
let localOrdersFlushTimer: NodeJS.Timeout | null = null;
let localOrdersWriting = false;
let localOrdersDirty = false;

async function flushLocalOrdersAsync() {
  if (!localOrdersCache || localOrdersWriting) {
    if (localOrdersCache) localOrdersDirty = true;
    return;
  }
  localOrdersDirty = false;
  localOrdersWriting = true;
  try {
    const snapshot = JSON.stringify(localOrdersCache, null, 2);
    await fs.promises.mkdir(path.dirname(ORDERS_STORE_PATH), { recursive: true });
    const tmp = `${ORDERS_STORE_PATH}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.promises.writeFile(tmp, snapshot, 'utf-8');
    await fs.promises.rename(tmp, ORDERS_STORE_PATH);
  } catch (err) {
    console.error('Failed to flush local orders store:', err);
  } finally {
    localOrdersWriting = false;
    if (localOrdersDirty) {
      scheduleLocalOrdersFlush();
    }
  }
}

function scheduleLocalOrdersFlush() {
  localOrdersDirty = true;
  if (localOrdersFlushTimer) return;
  localOrdersFlushTimer = setTimeout(() => {
    localOrdersFlushTimer = null;
    void flushLocalOrdersAsync();
  }, 150);
  if (typeof localOrdersFlushTimer.unref === 'function') localOrdersFlushTimer.unref();
}

// Local orders backup / test store helpers
function readLocalOrders(): Record<string, any> {
  if (!isTestMode() && localOrdersCache) return localOrdersCache;
  try {
    if (fs.existsSync(ORDERS_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(ORDERS_STORE_PATH, 'utf-8'));
      if (!isTestMode()) localOrdersCache = parsed;
      return parsed;
    }
  } catch (err) {
    console.warn('Could not read local orders store:', err);
  }
  if (!isTestMode()) {
    localOrdersCache = {};
    return localOrdersCache;
  }
  return {};
}

function saveLocalOrder(order: any) {
  try {
    const orders = readLocalOrders();
    orders[order.id] = order;
    if (isTestMode()) {
      fs.mkdirSync(path.dirname(ORDERS_STORE_PATH), { recursive: true });
      fs.writeFileSync(ORDERS_STORE_PATH, JSON.stringify(orders, null, 2), 'utf-8');
    } else {
      scheduleLocalOrdersFlush();
    }
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

  ensureFirebaseAdminInitialized();
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
      const resp = await fetch(`${getRtdbDatabaseUrl()}/products.json`, {
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

  ensureFirebaseAdminInitialized();
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

async function mayReadOrderDownloads(req: Request, order: any): Promise<boolean> {
  const caller = await getVerifiedAuthUser(req);
  if (caller && (caller.uid === order?.uid || caller.uid === order?.userId)) return true;
  const token = typeof req.body?.guestTrackingToken === 'string' ? req.body.guestTrackingToken.trim() : '';
  if (!token || !order?.guestTokenHash) return false;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const actual = Buffer.from(hash, 'utf8');
  const expected = Buffer.from(String(order.guestTokenHash), 'utf8');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function requireAdminDatabase(): Database {
  ensureFirebaseAdminInitialized();
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

  // Keep local backup updated non-blockingly if present
  try {
    const local = readLocalOrders();
    if (local[orderId]) {
      local[orderId] = { ...local[orderId], ...cleanUpdates };
      scheduleLocalOrdersFlush();
    }
  } catch {}
}

// Validate delivery/contact details and recalculate server-authoritative order amounts
export async function validateAndComputeOrder(
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
    return { valid: false, status: 400, error: 'Customer contact details are required.' };
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

  const catalog = await loadProductCatalog();
  if (catalog.length === 0) {
    return { valid: false, status: 503, error: 'Product catalog is temporarily unavailable. Please retry.' };
  }

  let calculatedSubtotal = 0;
  let calculatedDelivery = 0;
  let hasPhysicalItem = false;
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

    const productType = product.productType === 'virtual' ? 'virtual' : 'physical';
    if (productType === 'physical') {
      hasPhysicalItem = true;
    }
    if (productType === 'virtual' && intendedMethod === 'cod') {
      return { valid: false, status: 400, error: `${product.name} requires online payment.` };
    }
    if (productType === 'virtual') {
      try {
        const resources = await getPrivateDigitalProductResources(product.id);
        if (!resources.length) return { valid: false, status: 400, error: `Digital downloads are not configured for ${product.name}.` };
      } catch {
        return { valid: false, status: 503, error: 'Digital download configuration is temporarily unavailable.' };
      }
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
    if (productType === 'physical' && product.requiresCustomImage) {
      if (!customImageUrl || !isValidSafeUrl(customImageUrl)) {
        return { valid: false, status: 400, error: `A valid uploaded image is required for ${product.name}.` };
      }
    } else if (productType === 'physical' && customImageUrl && !isValidSafeUrl(customImageUrl)) {
      return { valid: false, status: 400, error: 'Invalid custom image URL.' };
    }

    const basePrice = Number(product.price) || 0;
    const discountedPrice = Number(product.discountedPrice);
    const unitPrice = !isNaN(discountedPrice) && discountedPrice > 0 ? discountedPrice : basePrice;
    if (unitPrice <= 0) {
      return { valid: false, status: 400, error: `Invalid pricing configuration for ${product.name}.` };
    }

    calculatedSubtotal += unitPrice * quantity;
    if (productType === 'physical') calculatedDelivery += Number(product.deliveryCharges) || 0;

    verifiedItems.push(stripUndefinedDeep({
      productId: product.id,
      productName: product.name,
      price: basePrice,
      discountedPrice: !isNaN(discountedPrice) && discountedPrice > 0 ? discountedPrice : undefined,
      quantity,
      productType,
      downloadExpiryDays: productType === 'virtual' ? Math.min(3650, Math.max(0, Number(product.downloadExpiryDays) || 0)) || undefined : undefined,
      downloadLimit: productType === 'virtual' ? Math.min(1000, Math.max(1, Number(product.downloadLimit) || 5)) : undefined,
      customImageUrl: productType === 'physical' ? customImageUrl || undefined : undefined,
      specialInstructions: cleanText(item.specialInstructions, 500) || undefined
    }));
  }

  if (hasPhysicalItem) {
    if (!addressLine1 || addressLine1.length < 4) return { valid: false, status: 400, error: 'Complete street address is required.' };
    if (!city) return { valid: false, status: 400, error: 'City is required.' };
    if (!state) return { valid: false, status: 400, error: 'State is required.' };
    if (!/^\d{6}$/.test(pincode)) return { valid: false, status: 400, error: 'Valid 6-digit pincode is required.' };
  }

  const calculatedTotal = calculatedSubtotal + calculatedDelivery;

  return {
    valid: true,
    verifiedItems,
    sanitizedAddress: {
      name,
      email,
      phone,
      addressLine1: hasPhysicalItem ? addressLine1 : '',
      addressLine2: hasPhysicalItem ? addressLine2 : '',
      city: hasPhysicalItem ? city : '',
      state: hasPhysicalItem ? state : '',
      pincode: hasPhysicalItem ? pincode : '',
      country
    },
    subtotal: calculatedSubtotal,
    deliveryCharges: calculatedDelivery,
    total: calculatedTotal
  };
}

// Order confirmation emails are dispatched cleanly via notifyOrderConfirmed in emailNotificationService.js

async function recordVerifiedPaymentTransaction(order: any, paymentId: string, razorpayOrderId: string, now: string) {
  ensureFirebaseAdminInitialized();
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
    if (cached) return res.status(200).json(cached);

    const authUser = await getVerifiedAuthUser(req);
    const isGuest = !authUser;
       const orderId = generateServerOrderId();
    const now = new Date().toISOString();

    const validation = await validateAndComputeOrder(items, deliveryAddress, 'cod');
    if (validation.valid === false) return res.status(validation.status).json({ success: false, error: validation.error });

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
    const obx = enqueueOutboxNotification({
      idempotencyKey: `order_confirmed:cod:${orderId}`,
      kind: 'order_confirmed',
      orderId,
      payload: { order: { ...newOrder, paymentMethod: 'cash' } },
      maxAttempts: 5,
    });

    const result = {
      success: true,
      orderId,
      order: sanitizeOrderForClient(newOrder, { includeOwnerUid: !isGuest }),
      guestTrackingToken,
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
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
    if (cached) return res.status(200).json(cached);

    const authUser = await getVerifiedAuthUser(req);
    const isGuest = !authUser;
    const orderId = generateServerOrderId();
    const now = new Date().toISOString();

    const validation = await validateAndComputeOrder(items, deliveryAddress, 'online');
    if (validation.valid === false) return res.status(validation.status).json({ success: false, error: validation.error });

    const amountInPaise = Math.round(validation.total * 100);
    if (!Number.isInteger(amountInPaise) || amountInPaise < 100 || amountInPaise > 10000000) {
      return res.status(400).json({ success: false, error: 'Order amount is outside allowed online payment bounds.' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID || (isTestMode() ? 'rzp_test_key' : '');
    const keySecret = process.env.RAZORPAY_KEY_SECRET || (isTestMode() ? 'test_rzp_secret' : '');
    let razorpayOrderId = `order_test_${crypto.randomBytes(6).toString('hex')}`;

    if (!isTestMode()) {
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const rzpResp = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        signal: AbortSignal.timeout(12000),
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amountInPaise, currency: 'INR', receipt: toRtdbOrderKey(orderId).slice(0, 40), notes: { orderId, email: validation.sanitizedAddress.email } })
      });
      if (!rzpResp.ok) {
        const errData = await rzpResp.json().catch(() => ({}));
        return res.status(502).json({ success: false, error: errData?.error?.description || 'Could not initiate payment with Razorpay. Please try again.' });
      }
      const rzpData = await rzpResp.json();
      if (!rzpData?.id) return res.status(502).json({ success: false, error: 'Invalid response from payment gateway.' });
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
      const delivery = await prepareDigitalDelivery(existingOrder, rtdbPath);
      const obx = enqueueOutboxNotification({
        idempotencyKey: `order_confirmed:online:${orderId}:${razorpay_payment_id}`,
        kind: 'order_confirmed',
        orderId,
        payload: { order: delivery.order },
        maxAttempts: 5,
      });
      return res.json({
        verified: true,
        orderId,
        order: sanitizeOrderForClient(delivery.order, { includeOwnerUid: !existingOrder.isGuest }),
        message: 'Order was already verified and confirmed.',
        notificationQueued: true,
        outboxJobId: obx.job.jobId,
        emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
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
    const delivery = await prepareDigitalDelivery(completedOrder, rtdbPath);
    const obx = enqueueOutboxNotification({
      idempotencyKey: `order_confirmed:online:${orderId}:${razorpay_payment_id}`,
      kind: 'order_confirmed',
      orderId,
      payload: { order: delivery.order },
      maxAttempts: 5,
    });

    return res.json({
      verified: true,
      orderId,
      order: sanitizeOrderForClient(delivery.order, { includeOwnerUid: !completedOrder.isGuest }),
      message: 'Payment verified and order confirmed successfully.',
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
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
    const mayReadDownloads = await mayReadOrderDownloads(req, order);
    if (order.paymentStatus === 'completed') {
      const delivery = await prepareDigitalDelivery(order, rtdbPath);
      return res.json({
        success: true,
        verified: true,
        order: sanitizeOrderForClient(mayReadDownloads ? delivery.order : { ...delivery.order, digitalDownloads: [] }, { includeOwnerUid: !order.isGuest })
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
    const delivery = await prepareDigitalDelivery(updatedOrder, rtdbPath);
    const obx = enqueueOutboxNotification({
      idempotencyKey: `order_confirmed:recovered:${order.id}:${capturedPayment.id}`,
      kind: 'order_confirmed',
      orderId: order.id,
      payload: { order: delivery.order },
      maxAttempts: 5,
    });

    return res.json({
      success: true,
      verified: true,
      order: sanitizeOrderForClient(mayReadDownloads ? delivery.order : { ...delivery.order, digitalDownloads: [] }, { includeOwnerUid: !updatedOrder.isGuest }),
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
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
          const delivery = await prepareDigitalDelivery(updatedOrder, rtdbPath);
          enqueueOutboxNotification({
            idempotencyKey: `order_confirmed:webhook:${order.id}:${paymentId || rzpOrderId}`,
            kind: 'order_confirmed',
            orderId: order.id,
            payload: { order: delivery.order },
            maxAttempts: 5,
          });
        }
      } else if (applicationWebhookHandler) {
        await applicationWebhookHandler({
          razorpayOrderId: rzpOrderId,
          razorpayPaymentId: paymentId,
          amountPaise: typeof payment?.amount === 'number' ? payment.amount : undefined,
          notes: payment?.notes || req.body?.payload?.order?.entity?.notes,
        }).catch((err: any) => {
          console.warn('Application webhook reconciliation notice:', err?.message || err);
        });
      }
    }

    if (event === 'payment.refunded' && rzpOrderId) {
      const matched = await findOrderByRazorpayOrderId(rzpOrderId);
      if (matched && matched.order.paymentStatus !== 'refunded') {
        const { order, rtdbPath } = matched;
        const now = new Date().toISOString();
        const updates = {
          paymentStatus: 'refunded',
          refundAmount: typeof payment?.amount === 'number' ? payment.amount / 100 : Number(order.total) || 0,
          refundedAt: now,
          updatedAt: now,
        };
        await updateOrderInDatabase(order.id, updates, rtdbPath);
        const hasDigitalItems = (Array.isArray(order.items) ? order.items : Object.values(order.items || {}))
          .some((item: any) => item?.productType === 'virtual');
        if (hasDigitalItems) {
          await revokeDigitalDownloads(order.id);
          await updateOrderInDatabase(order.id, { digitalDeliveryStatus: 'revoked' }, rtdbPath);
        }
      }
    }

    if (eventId) {
      rememberWebhookEvent(eventId);
    }

    return res.status(200).json({ status: 'ok' });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/**
 * 5. GET /api/store/orders/my
 * Loads orders owned by verified user using bounded parallel RTDB queries
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
    } else if (ensureFirebaseAdminInitialized() && rtdbAdmin) {
      // Run canonical uid, legacy userId, and email queries IN PARALLEL (bounded to last 150 each)
      const [uidSnap, legacySnap, emailSnap] = await Promise.all([
        withTimeout(rtdbAdmin.ref('orders').orderByChild('uid').equalTo(uid).limitToLast(150).once('value'), 9000, 'Querying user orders'),
        withTimeout(rtdbAdmin.ref('orders').orderByChild('userId').equalTo(uid).limitToLast(150).once('value'), 9000, 'Querying legacy orders'),
        email
          ? withTimeout(rtdbAdmin.ref('orders').orderByChild('email').equalTo(email).limitToLast(50).once('value'), 9000, 'Querying email orders')
          : Promise.resolve(null),
      ]);

      const deferredMigrations: Promise<any>[] = [];

      if (uidSnap?.exists()) {
        for (const [key, val] of Object.entries(uidSnap.val() || {}) as [string, any][]) {
          if (val && typeof val === 'object') {
            collectOrder({ id: val.id || key, ...val });
          }
        }
      }

      if (legacySnap?.exists()) {
        for (const [key, val] of Object.entries(legacySnap.val() || {}) as [string, any][]) {
          if (val && typeof val === 'object') {
            const ord = { id: val.id || key, ...val };
            if (ord.uid !== uid) {
              ord.uid = uid;
              deferredMigrations.push(updateOrderInDatabase(ord.id, { uid }, `orders/${key}`).catch(() => {}));
            }
            collectOrder(ord);
          }
        }
      }

      if (emailSnap?.exists()) {
        for (const [key, val] of Object.entries(emailSnap.val() || {}) as [string, any][]) {
          if (val && typeof val === 'object' && (val.isGuest || val.uid === 'guest' || !val.uid)) {
            const linkedAt = new Date().toISOString();
            const ord = { id: val.id || key, ...val, uid, userId: uid, isGuest: false, linkedAt };
            deferredMigrations.push(
              updateOrderInDatabase(ord.id, { uid, userId: uid, isGuest: false, linkedAt }, `orders/${key}`).catch(() => {})
            );
            collectOrder(ord);
          }
        }
      }

      if (deferredMigrations.length > 0) {
        void Promise.allSettled(deferredMigrations);
      }

      // Legacy nested `orders/ICC/...` path migration only when no canonical orders exist or quick check needed
      if (orderMap.size === 0) {
        const nestedIccSnap = await withTimeout(rtdbAdmin.ref('orders/ICC').limitToLast(100).once('value'), 6000, 'Checking legacy nested orders').catch(() => null);
        if (nestedIccSnap?.exists()) {
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
              await withTimeout(rtdbAdmin.ref(`orders/${flatKey}`).set(migrated), 6000, 'Migrating nested order');
              void withTimeout(rtdbAdmin.ref(`orders/ICC/${subKey}`).remove(), 5000, 'Removing nested order').catch(() => {});
              collectOrder(migrated);
            }
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
    const ordersWithDownloads = await Promise.all(userOrders.map(async (order: any) => ({
      ...order,
      digitalDownloads: order.paymentStatus === 'completed' ? await ensureDigitalDownloads(order) : [],
    })));

    return res.json({
      success: true,
      orders: ordersWithDownloads
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
    let isAuthorizedByGuestToken = false;

    if (cleanToken && order.guestTokenHash) {
      const computedHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
      const a = Buffer.from(computedHash, 'utf8');
      const b = Buffer.from(String(order.guestTokenHash), 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        isAuthorized = true;
        isAuthorizedByGuestToken = true;
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
      order: sanitizeOrderForClient({
        ...order,
        digitalDownloads: order.paymentStatus === 'completed' && isAuthorizedByGuestToken ? await ensureDigitalDownloads(order) : [],
      }, { includeOwnerUid: false })
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

    // 1. Link explicitly authorized guest tokens from browser session in parallel
    if (Array.isArray(guestOrderTokens) && guestOrderTokens.length > 0) {
      const candidates = guestOrderTokens.slice(0, 20).filter(
        (entry): entry is { orderId: string; token: string } =>
          Boolean(entry && typeof entry.orderId === 'string' && typeof entry.token === 'string')
      );
      const tokenResults = await Promise.allSettled(
        candidates.map(async (entry) => {
          const record = await findOrderRecord(entry.orderId);
          if (!record) return false;
          const { order, rtdbPath } = record;
          if (!order.isGuest && order.uid && order.uid !== 'guest') return false;
          if (!order.guestTokenHash) return false;

          const computedHash = crypto.createHash('sha256').update(entry.token).digest('hex');
          const a = Buffer.from(computedHash, 'utf8');
          const b = Buffer.from(String(order.guestTokenHash), 'utf8');
          if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
            await updateOrderInDatabase(order.id, { uid, userId: uid, isGuest: false, linkedAt: now }, rtdbPath);
            return true;
          }
          return false;
        })
      );
      for (const r of tokenResults) {
        if (r.status === 'fulfilled' && r.value) linkedCount++;
      }
    }

    // 2. Link guest orders matching verified account email in parallel chunks
    if (email) {
      if (isTestMode()) {
        const local = readLocalOrders();
        const matches = (Object.entries(local) as [string, any][]).filter(([, ord]) => {
          const ordEmail = (ord.email || ord.deliveryAddress?.email || '').toLowerCase().trim();
          return Boolean((ord.isGuest || ord.uid === 'guest') && ordEmail === email);
        });
        for (const [id] of matches) {
          await updateOrderInDatabase(id, { uid, userId: uid, isGuest: false, linkedAt: now });
          linkedCount++;
        }
      } else if (ensureFirebaseAdminInitialized() && rtdbAdmin) {
        const snap = await withTimeout(rtdbAdmin.ref('orders').orderByChild('email').equalTo(email).once('value'), 9000, 'Linking orders by email');
        if (snap.exists()) {
          const toLink = (Object.entries(snap.val() || {}) as [string, any][]).filter(
            ([, ord]) => Boolean(ord && (ord.isGuest || ord.uid === 'guest' || !ord.uid))
          );
          const CHUNK = 6;
          for (let i = 0; i < toLink.length; i += CHUNK) {
            const results = await Promise.allSettled(
              toLink.slice(i, i + CHUNK).map(async ([key, ord]) => {
                await updateOrderInDatabase(ord.id || key, { uid, userId: uid, isGuest: false, linkedAt: now }, `orders/${key}`);
                return true;
              })
            );
            for (const r of results) {
              if (r.status === 'fulfilled' && r.value) linkedCount++;
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

    ensureFirebaseAdminInitialized();
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

const VALID_ADMIN_ORDER_STATUSES = new Set(['pending', 'processing', 'shipped', 'delivered', 'cancelled']);
const VALID_ADMIN_PAYMENT_STATUSES = new Set(['pending', 'completed', 'failed', 'refunded']);

/**
 * 10. POST /api/admin/orders/:orderId/status
 * Admin-authoritative order status & payment status update + customer/admin email notifications
 */
export async function handleAdminUpdateOrderStatus(req: Request, res: Response) {
  try {
    const admin = await requireAdminCaller(req, res);
    if (!admin) return;

    const orderId = decodeURIComponent(String(req.params.orderId || '')).trim();
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID is required.' });
    }

    const record = await findOrderRecord(orderId);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const { order: existingOrder, rtdbPath } = record;
    const { orderStatus, paymentStatus, reason, estimatedDelivery } = req.body || {};

    const nextOrderStatus = typeof orderStatus === 'string' && orderStatus.trim() ? orderStatus.trim().toLowerCase() : undefined;
    const nextPaymentStatus = typeof paymentStatus === 'string' && paymentStatus.trim() ? paymentStatus.trim().toLowerCase() : undefined;

    if (nextOrderStatus && !VALID_ADMIN_ORDER_STATUSES.has(nextOrderStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid orderStatus value.' });
    }
    if (nextPaymentStatus && !VALID_ADMIN_PAYMENT_STATUSES.has(nextPaymentStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid paymentStatus value.' });
    }

    const statusChanged = Boolean(nextOrderStatus && nextOrderStatus !== existingOrder.orderStatus);
    const paymentChanged = Boolean(nextPaymentStatus && nextPaymentStatus !== existingOrder.paymentStatus);

    if (!statusChanged && !paymentChanged) {
      return res.status(400).json({ success: false, error: 'No order or payment status changes supplied.' });
    }

    const now = new Date().toISOString();
    const existingNotes = Array.isArray(existingOrder.notes) ? existingOrder.notes : [];
    const cleanReason = cleanText(reason, 300);
    const cleanEstimatedDelivery = cleanText(estimatedDelivery, 80);

    const updates: Record<string, any> = {
      updatedAt: now,
    };

    if (statusChanged && nextOrderStatus) {
      updates.orderStatus = nextOrderStatus;
      if (nextOrderStatus === 'cancelled' && cleanReason) {
        updates.cancellationReason = cleanReason;
      }
      updates.notes = [
        ...existingNotes,
        {
          type: 'status',
          by: 'system',
          email: 'system@indiacybercafe.com',
          text: cleanReason
            ? `Order status changed to ${nextOrderStatus}: ${cleanReason}`
            : `Order status changed to ${nextOrderStatus}`,
          time: now,
        },
      ];
    }

    if (paymentChanged && nextPaymentStatus) {
      updates.paymentStatus = nextPaymentStatus;
    }

    await updateOrderInDatabase(existingOrder.id, updates, rtdbPath);
    let updatedOrder = { ...existingOrder, ...updates };
    const hasDigitalItems = (Array.isArray(existingOrder.items) ? existingOrder.items : Object.values(existingOrder.items || {}))
      .some((item: any) => item?.productType === 'virtual');
    if (hasDigitalItems && paymentChanged && nextPaymentStatus && nextPaymentStatus !== 'completed') {
      await revokeDigitalDownloads(existingOrder.id);
      await updateOrderInDatabase(existingOrder.id, { digitalDeliveryStatus: 'revoked' }, rtdbPath);
      updatedOrder = { ...updatedOrder, digitalDeliveryStatus: 'revoked' };
    }

    let obxJobId: string | undefined;
    if (statusChanged && nextOrderStatus) {
      const obx = enqueueOutboxNotification({
        idempotencyKey: `order_status:${existingOrder.id}:${nextOrderStatus}:${now}`,
        kind: 'order_status',
        orderId: existingOrder.id,
        payload: {
          order: updatedOrder,
          newStatus: nextOrderStatus,
          reason: cleanReason || undefined,
          estimatedDelivery: cleanEstimatedDelivery || undefined,
          performedBy: {
            uid: admin.uid,
            name: admin.name || admin.email,
            email: admin.email,
          },
        },
        maxAttempts: 5,
      });
      obxJobId = obx.job.jobId;
    }

    return res.json({
      success: true,
      orderId: existingOrder.id,
      order: sanitizeOrderForClient(updatedOrder, { includeOwnerUid: !updatedOrder.isGuest }),
      notificationQueued: Boolean(statusChanged && nextOrderStatus),
      ...(obxJobId ? { outboxJobId: obxJobId, emailDelivery: buildQueuedEmailDeliverySummary(obxJobId) } : {}),
    });
  } catch (error: any) {
    console.error('Admin update order status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update order status.' });
  }
}

/**
 * 11. POST /api/admin/orders/:orderId/refund
 * Admin-authoritative order refund status recording + async email enqueue
 */
export async function handleAdminOrderRefund(req: Request, res: Response) {
  try {
    const admin = await requireAdminCaller(req, res);
    if (!admin) return;

    const orderId = decodeURIComponent(String(req.params.orderId || '')).trim();
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID is required.' });
    }

    const record = await findOrderRecord(orderId);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const { order: existingOrder, rtdbPath } = record;
    const orderTotal = Number(existingOrder.total) || 0;
    const requestedAmount = req.body?.refundAmount !== undefined ? Number(req.body.refundAmount) : orderTotal;
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || (orderTotal > 0 && requestedAmount > orderTotal)) {
      return res.status(400).json({ success: false, error: 'Invalid refund amount.' });
    }

    const rawDays = Number(req.body?.expectedDays);
    const expectedDays = Number.isInteger(rawDays) && rawDays >= 1 && rawDays <= 30 ? rawDays : 5;
    const reason = cleanText(req.body?.reason, 300);
    const now = new Date().toISOString();
    const existingNotes = Array.isArray(existingOrder.notes) ? existingOrder.notes : [];

    const updates = {
      paymentStatus: 'refunded',
      refundAmount: requestedAmount,
      refundReason: reason || 'Refund initiated by administrator',
      refundedAt: now,
      updatedAt: now,
      notes: [
        ...existingNotes,
        {
          type: 'status',
          by: admin.name || admin.email,
          email: admin.email,
          text: `Refund of ₹${requestedAmount.toFixed(2)} initiated${reason ? `: ${reason}` : ''}`,
          time: now,
        },
      ],
    };

    await updateOrderInDatabase(existingOrder.id, updates, rtdbPath);
    let updatedOrder = { ...existingOrder, ...updates };
    const hasDigitalItems = (Array.isArray(existingOrder.items) ? existingOrder.items : Object.values(existingOrder.items || {}))
      .some((item: any) => item?.productType === 'virtual');
    if (hasDigitalItems) {
      await revokeDigitalDownloads(existingOrder.id);
      await updateOrderInDatabase(existingOrder.id, { digitalDeliveryStatus: 'revoked' }, rtdbPath);
      updatedOrder = { ...updatedOrder, digitalDeliveryStatus: 'revoked' };
    }

    const obx = enqueueOutboxNotification({
      idempotencyKey: `order_refund:${existingOrder.id}:${requestedAmount}:${now}`,
      kind: 'order_refund',
      orderId: existingOrder.id,
      payload: {
        order: updatedOrder,
        refundAmount: requestedAmount,
        expectedDays,
        reason: reason || undefined,
        performedBy: {
          uid: admin.uid,
          name: admin.name || admin.email,
          email: admin.email,
        },
      },
      maxAttempts: 5,
    });

    return res.json({
      success: true,
      orderId: existingOrder.id,
      order: sanitizeOrderForClient(updatedOrder, { includeOwnerUid: !updatedOrder.isGuest }),
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (error: any) {
    console.error('Admin order refund error:', error);
    return res.status(500).json({ success: false, error: 'Failed to initiate order refund.' });
  }
}

/**
 * 12. POST /api/admin/orders/:orderId/notes
 * Atomic server-authoritative note append on store orders (Admin or assigned Operator)
 */
export async function handleAdminAddOrderNote(req: Request, res: Response) {
  try {
    const caller = await verifyCallerWithRole(req);
    if (!caller) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (caller.role !== 'admin' && caller.role !== 'operator') {
      return res.status(403).json({ success: false, error: 'Admin or operator role required.' });
    }

    const orderId = decodeURIComponent(String(req.params.orderId || '')).trim();
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID is required.' });
    }

    const record = await findOrderRecord(orderId);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const { order: existingOrder, rtdbPath } = record;
    if (caller.role === 'operator') {
      const assignedUid = String(existingOrder.assignedToUid || '').trim();
      if (!assignedUid || assignedUid !== caller.uid) {
        return res.status(403).json({ success: false, error: 'You are not assigned to this order.' });
      }
    }

    const text = cleanText(req.body?.text, 2000);
    const attachmentUrl = typeof req.body?.attachmentUrl === 'string' ? req.body.attachmentUrl.trim() : '';
    const attachmentName = cleanText(req.body?.attachmentName, 150);
    const clientRequestId = cleanText(req.body?.clientRequestId, 120);

    if (!text && !attachmentUrl) {
      return res.status(400).json({ success: false, error: 'Please enter a note or attach a file.' });
    }
    if (attachmentUrl && !isValidSafeUrl(attachmentUrl) && !attachmentUrl.startsWith('/api/')) {
      return res.status(400).json({ success: false, error: 'Invalid attachment URL.' });
    }

    const idempKey = clientRequestId ? `order_note:${orderId}:${clientRequestId}` : undefined;
    const cached = checkIdempotency(idempKey);
    if (cached) {
      return res.json({ ...cached, duplicate: true });
    }

    const now = new Date().toISOString();
    const noteEntry: Record<string, any> = {
      type: 'note',
      by: caller.name || caller.email || caller.role,
      email: caller.email,
      authorUid: caller.uid,
      authorRole: caller.role,
      text: text || (attachmentName ? `Attached file: ${attachmentName}` : 'Attachment uploaded'),
      time: now,
      createdAt: Date.now(),
      ...(clientRequestId ? { clientRequestId } : {}),
      ...(attachmentUrl ? { attachment: attachmentUrl, attachmentName: attachmentName || 'Attachment' } : {}),
    };

    const existingNotes = Array.isArray(existingOrder.notes) ? existingOrder.notes : [];
    if (clientRequestId && existingNotes.some((n: any) => n?.clientRequestId === clientRequestId)) {
      const result = {
        success: true,
        duplicate: true,
        orderId: existingOrder.id,
        notes: existingNotes,
      };
      recordIdempotency(idempKey, result);
      return res.json(result);
    }

    const updatedNotes = [...existingNotes, noteEntry];
    await updateOrderInDatabase(existingOrder.id, { notes: updatedNotes, updatedAt: now }, rtdbPath);

    const result = {
      success: true,
      orderId: existingOrder.id,
      note: noteEntry,
      notes: updatedNotes,
    };
    recordIdempotency(idempKey, result);
    return res.json(result);
  } catch (error: any) {
    console.error('Admin add order note error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save order note.' });
  }
}

/**
 * 13. POST /api/store/reviews
 * Server-authoritative product review submission + async notification enqueue
 */
export async function handleSubmitStoreReview(req: Request, res: Response) {
  try {
    const authUser = await getVerifiedAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Please sign in to submit a review.' });
    }

    if (!checkRateLimit('store-review', authUser.uid, 10, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many review submissions. Please wait a minute.' });
    }

    const { productId, rating, comment, images, idempotencyKey, userName, userAvatar } = req.body || {};
    const cleanProductId = cleanText(productId, 140);
    const numRating = Number(rating);
    const cleanComment = cleanText(comment, 2000);
    const cleanUserName = cleanText(userName, 120) || authUser.email.split('@')[0] || 'Customer';

    if (!cleanProductId) {
      return res.status(400).json({ success: false, error: 'Product ID is required.' });
    }
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5 stars.' });
    }
    if (!cleanComment) {
      return res.status(400).json({ success: false, error: 'Please write a review comment.' });
    }

    const safeImages: string[] = [];
    if (Array.isArray(images)) {
      for (const img of images.slice(0, 5)) {
        if (typeof img === 'string' && isValidSafeUrl(img.trim())) {
          safeImages.push(img.trim().slice(0, 1024));
        }
      }
    }

    const dedupKey = idempotencyKey ? `review:${authUser.uid}:${cleanProductId}:${cleanText(idempotencyKey, 120)}` : undefined;
    const cached = checkIdempotency(dedupKey);
    if (cached) {
      return res.status(200).json({ ...cached, duplicate: true });
    }

    const catalog = await loadProductCatalog();
    const product = catalog.find(p => p.id === cleanProductId);
    const productName = cleanText(product?.name || req.body?.productName || cleanProductId, 200);

    const nowIso = new Date().toISOString();
    const reviewId = `rev_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const reviewPayload: Record<string, any> = {
      id: reviewId,
      productId: cleanProductId,
      uid: authUser.uid,
      userName: cleanUserName,
      rating: numRating,
      comment: cleanComment,
      text: cleanComment,
      verified: true,
      helpful: 0,
      helpfulBy: [],
      createdAt: nowIso,
      date: nowIso,
      ...(typeof userAvatar === 'string' && isValidSafeUrl(userAvatar.trim()) ? { userAvatar: userAvatar.trim().slice(0, 1024) } : {}),
      ...(safeImages.length > 0 ? { images: safeImages } : {}),
    };

    if (isTestMode()) {
      const storePath = path.join(APP_ROOT, 'data/reviews_test_store.json');
      let existing: Record<string, any> = {};
      try {
        if (fs.existsSync(storePath)) existing = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
      } catch {}
      existing[reviewId] = reviewPayload;
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(existing, null, 2), 'utf-8');
    } else {
      const db = requireAdminDatabase();
      await withTimeout(db.ref(`productReviews/${reviewId}`).set(reviewPayload), 8000, 'Saving product review');

      // Recompute product rating aggregate atomically best-effort
      try {
        const revSnap = await withTimeout(
          db.ref('productReviews').orderByChild('productId').equalTo(cleanProductId).limitToLast(200).once('value'),
          5000,
          'Aggregating product ratings'
        );
        if (revSnap.exists()) {
          const allRevs = Object.values(revSnap.val() || {}) as any[];
          const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
          let totalScore = 0;
          let count = 0;
          for (const r of allRevs) {
            const rv = Math.max(1, Math.min(5, Math.round(Number(r?.rating) || 5)));
            breakdown[rv] = (breakdown[rv] || 0) + 1;
            totalScore += rv;
            count += 1;
          }
          if (count > 0) {
            const average = Math.round((totalScore / count) * 10) / 10;
            void db.ref(`products/${cleanProductId}/ratings`).set({ average, count, breakdown }).catch(() => {});
          }
        }
      } catch {}
    }

    const obx = enqueueOutboxNotification({
      idempotencyKey: `review_submitted:${reviewId}`,
      kind: 'review_submitted',
      payload: {
        productId: cleanProductId,
        productName,
        customerName: cleanUserName,
        customerEmail: authUser.email,
        rating: numRating,
        reviewText: cleanComment,
      },
      maxAttempts: 4,
    });

    const result = {
      success: true,
      reviewId,
      review: reviewPayload,
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
    };
    recordIdempotency(dedupKey, result);
    return res.status(201).json(result);
  } catch (error: any) {
    console.error('Submit review error:', error);
    const status = error instanceof DatabaseConfigError ? error.statusCode : error?.message?.includes('timed out') ? 504 : 500;
    return res.status(status).json({ success: false, error: 'Failed to submit review. Please try again.' });
  }
}

// Exportable SSRF-safe URL validation and redirect-safe fetch helpers for digital downloads
export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = String(ip || '').trim().toLowerCase().replace(/%.+$/, '');
  const family = net.isIP(normalized);
  if (!family) return true;

  if (family === 4) {
    const parts = normalized.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b, c] = parts;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) return isPrivateOrReservedIp(mapped);
  }
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8');
}

export async function validateSafeDownloadUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid download source URL.');
  }
  if (isTestMode() && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')) return url;
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Download source must use HTTPS without credentials or alternate ports.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || ['localhost', 'localhost.localdomain', 'ip6-localhost'].includes(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Private or local download hosts are not allowed.');
  }
  if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) throw new Error('Private IP download hosts are not allowed.');

  if (!net.isIP(hostname)) {
    let addresses: Array<{ address: string }> = [];
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      // Fallback to direct DNS record resolution when system getaddrinfo fails on shared hosting
      const [v4, v6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
      if (v4.status === 'fulfilled') {
        addresses.push(...v4.value.map(address => ({ address })));
      }
      if (v6.status === 'fulfilled') {
        addresses.push(...v6.value.map(address => ({ address })));
      }
      if (!addresses.length) {
        throw new Error('Could not resolve download source host.');
      }
    }
    if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedIp(address))) {
      throw new Error('Download source resolved to a private or reserved address.');
    }
  }
  return url;
}

export async function fetchSafeDownloadResponse(sourceUrl: string): Promise<{ response: globalThis.Response; finalUrl: URL }> {
  let current = await validateSafeDownloadUrl(sourceUrl);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': 'ICC-Digital-Download/1.0', 'Accept': '*/*' },
      signal: AbortSignal.timeout(120000),
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirectCount === 3) throw new Error('Download source redirected too many times.');
      const location = response.headers.get('location');
      if (!location) throw new Error('Download source redirect has no location.');
      current = await validateSafeDownloadUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Download source returned HTTP ${response.status}.`);
    if (!response.body) throw new Error('Download source returned no file body.');
    return { response: response as unknown as globalThis.Response, finalUrl: current };
  }
  throw new Error('Could not follow download source safely.');
}

function getReadableLegacyToken(resource: any): string | null {
  if (typeof resource?.token === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(resource.token)) return resource.token;
  if (typeof resource?.encryptedToken === 'string') {
    try {
      const token = decryptDigitalToken(resource.encryptedToken);
      return /^[A-Za-z0-9_-]{40,60}$/.test(token) ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}

