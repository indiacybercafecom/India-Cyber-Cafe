import 'dotenv/config';
import dotenv from 'dotenv';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getDatabase, Database } from 'firebase-admin/database';
import { getAuth, Auth } from 'firebase-admin/auth';
import {
  getNotificationEvents,
  retryNotificationEvent,
  enqueueOutboxNotification,
  buildQueuedEmailDeliverySummary,
  getNotificationOutboxStats,
  getOutboxDlqJobs,
  replayOutboxJob,
  registerOutboxOperatorProfileResolver,
  normalizeEmailAddress,
  isValidEmailAddress,
  NotificationDeliveryState,
} from './emailNotificationService.js';
import {
  getQueueStats,
  getDlqJobs,
  replayDlqJob,
  processPushWorkerJob,
} from './asyncQueueService.js';

const __filename_op = fileURLToPath(import.meta.url);
const __dirname_op = path.dirname(__filename_op);

function resolveAppRoot(): string {
  const startDirs = [__dirname_op, process.cwd()];
  for (const startDir of startDirs) {
    let dir = path.resolve(startDir);
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return fs.existsSync(path.join(process.cwd(), 'package.json'))
    ? process.cwd()
    : path.resolve(process.cwd(), '..');
}

const APP_ROOT = resolveAppRoot();

function getAttachmentsDir(): string {
  if (process.env.ATTACHMENTS_DIR && process.env.ATTACHMENTS_DIR.trim()) {
    return path.resolve(process.env.ATTACHMENTS_DIR.trim());
  }
  if (process.env.UPLOAD_DIR && process.env.UPLOAD_DIR.trim()) {
    return path.resolve(process.env.UPLOAD_DIR.trim(), 'attachments');
  }
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return path.resolve(process.env.DATA_DIR.trim(), 'uploads/attachments');
  }
  return path.join(APP_ROOT, 'data/uploads/attachments');
}

function getApplicationAttachmentsDir(): string {
  if (process.env.APPLICATION_ATTACHMENTS_DIR && process.env.APPLICATION_ATTACHMENTS_DIR.trim()) {
    return path.resolve(process.env.APPLICATION_ATTACHMENTS_DIR.trim());
  }
  if (process.env.UPLOAD_DIR && process.env.UPLOAD_DIR.trim()) {
    return path.resolve(process.env.UPLOAD_DIR.trim(), 'application-attachments');
  }
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return path.resolve(process.env.DATA_DIR.trim(), 'uploads/application-attachments');
  }
  return path.join(APP_ROOT, 'data/uploads/application-attachments');
}

function getCandidateAttachmentsDirs(): string[] {
  const candidates = [
    getAttachmentsDir(),
    path.join(APP_ROOT, 'data/uploads/attachments'),
    path.resolve(process.cwd(), 'data/uploads/attachments'),
  ];
  return Array.from(new Set(candidates.map(d => path.resolve(d))));
}

const SUPER_ADMIN_UID = 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2';
const SUPER_ADMIN_EMAIL = 'indiacybercafe.com@gmail.com';
const MAX_NOTE_LENGTH = 2000;
const MAX_REPLY_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_STATUSES = new Set(['processing', 'clarification', 'completed', 'rejected']);
const ALLOWED_UPDATE_BODY_FIELDS = new Set(['status', 'note', 'attachmentUrl', 'attachmentName', 'attachments', 'clientRequestId']);
const ALLOWED_REPLY_BODY_FIELDS = new Set(['note', 'attachments', 'clientReplyId']);
const PROTECTED_UPDATE_FIELDS = new Set([
  'paymentStatus', 'paymentMethod', 'charge', 'uid', 'userId', 'email',
  'name', 'serviceName', 'serviceId', 'assignedTo', 'assignedToUid',
  'details', 'razorpayPaymentId', 'razorpayOrderId', 'notes', 'fileUrl',
  'date', 'id', 'createdAt', 'updatedAt'
]);
const PROTECTED_REPLY_FIELDS = new Set([
  ...PROTECTED_UPDATE_FIELDS,
  'status', 'authorUid', 'authorRole', 'type', 'by', 'email'
]);
const TEST_STORE_PATH = path.join(APP_ROOT, 'data/operator_test_store.json');

const DEFAULT_PROJECT_ID = 'india-cyber-cafe';
const DEFAULT_RTDB_URL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';
const normalizeEnvSecret = (raw?: string): string =>
  String(raw || '').trim().replace(/^['"]|['"]$/g, '').trim();
const getRtdbUrl = () => {
  const cleaned = normalizeEnvSecret(process.env.FIREBASE_DATABASE_URL).replace(/\/+$/, '');
  if (!cleaned) return DEFAULT_RTDB_URL;
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
};

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

const isTestMode = () => process.env.STORE_ORDER_TEST_MODE === '1' || process.env.OPERATOR_TEST_MODE === '1';

function loadEnv() {
  try {
    const envPath = path.join(APP_ROOT, '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true } as any);
    }
  } catch {}
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
      if (parsed.type !== 'service_account' || !clientEmail || !privateKey.includes('PRIVATE KEY')) {
        return null;
      }
      return { ...parsed, client_email: clientEmail, private_key: privateKey };
    }
  } catch {}
  return null;
}

let rtdbAdmin: Database | null = null;
let authAdmin: Auth | null = null;
let hasAdminCredential = false;
let hasExplicitServiceAccountCred = false;

function ensureAdminInit(): boolean {
  if (hasAdminCredential && rtdbAdmin && authAdmin) return true;
  loadEnv();
  try {
    const inlineEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    let parsed = inlineEnv ? parseServiceAccountRaw(inlineEnv) : null;
    let cred: any = parsed ? cert(parsed) : null;

    if (!cred && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      const key = process.env.FIREBASE_PRIVATE_KEY.trim().replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
      if (key.includes('PRIVATE KEY')) {
        cred = cert({
          projectId: (process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
          privateKey: key,
        });
      }
    }

    if (!cred) {
      const envGac = process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
          ? process.env.GOOGLE_APPLICATION_CREDENTIALS
          : path.join(APP_ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS)
        : null;
      const candidates = [
        envGac,
        path.join(APP_ROOT, 'firebase-service-account.json'),
        path.join(APP_ROOT, 'service-account.json'),
        path.join(APP_ROOT, 'data/firebase-service-account.json'),
      ].filter(Boolean) as string[];
      for (const p of candidates) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          const fileParsed = parseServiceAccountRaw(fs.readFileSync(p, 'utf-8'));
          if (fileParsed) {
            cred = cert(fileParsed);
            parsed = fileParsed;
            break;
          }
        }
      }
    }

    const isGcp = Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.GAE_APPLICATION || process.env.GCE_METADATA_HOST);
    if (cred || isGcp) {
      const rtdbUrl = getRtdbUrl();
      const projectId = parsed?.project_id || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
      const apps = getApps();
      const defaultApp = apps.find(a => a.name === '[DEFAULT]') || apps[0];
      const appConfig = {
        ...(cred ? { credential: cred } : {}),
        projectId,
        databaseURL: rtdbUrl,
      };
      const authApp = defaultApp || initializeApp(appConfig);
      let dbApp = authApp;
      if ((authApp.options as any)?.databaseURL !== rtdbUrl) {
        dbApp = apps.find(a => a.name === 'icc-rtdb') || initializeApp(appConfig, 'icc-rtdb');
      }
      rtdbAdmin = getDatabase(dbApp);
      authAdmin = getAuth(authApp);
      hasAdminCredential = true;
      hasExplicitServiceAccountCred = Boolean(cred);
      return true;
    }
  } catch (err: any) {
    console.warn('[operatorService] Admin SDK init notice:', err?.message || err);
  }
  return false;
}

ensureAdminInit();

let rtdbUsableCache: { usable: boolean; expiresAt: number } = { usable: false, expiresAt: 0 };
let rtdbProbeInFlight: Promise<boolean> | null = null;

async function isRtdbAdminUsable(): Promise<boolean> {
  if (isTestMode()) return false;
  if (!ensureAdminInit() || !rtdbAdmin) return false;
  const now = Date.now();
  if (rtdbUsableCache.expiresAt > now) {
    return rtdbUsableCache.usable;
  }
  if (rtdbProbeInFlight) {
    return rtdbProbeInFlight;
  }
  rtdbProbeInFlight = (async () => {
    try {
      await withTimeout(rtdbAdmin!.ref('users').limitToFirst(1).once('value'), 4000, 'RTDB admin probe');
      rtdbUsableCache = { usable: true, expiresAt: Date.now() + 30000 };
      return true;
    } catch {
      rtdbUsableCache = { usable: false, expiresAt: Date.now() + 15000 };
      return false;
    } finally {
      rtdbProbeInFlight = null;
    }
  })();
  return rtdbProbeInFlight;
}

function redactSensitiveText(input: unknown): string {
  return String(input || '')
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[redacted-id]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[redacted-pan]')
    .replace(/\b[6-9]\d{9}\b/g, '[redacted-phone]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/([?&](?:auth|token|key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .replace(/rzp_(?:test|live)_[A-Za-z0-9]+/gi, 'rzp_[redacted]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]')
    .slice(0, 350);
}

function logStructuredAppError(opts: {
  req?: Request;
  stage: string;
  status: number;
  code?: string;
  uid?: string;
  serviceId?: string;
  appId?: string;
  httpStatus?: number;
  gatewayCode?: string;
  gatewayDescription?: string;
  gatewayMode?: string;
  errorName?: string;
  errorCode?: string;
  err?: unknown;
  message?: string;
}) {
  const reqId = (opts.req as any)?.requestId || `app_${Date.now().toString(36)}`;
  const rawErrMsg = opts.err instanceof Error ? opts.err.message : typeof opts.err === 'string' ? opts.err : opts.message || '';
  const payload = {
    ts: new Date().toISOString(),
    level: opts.status >= 500 ? 'error' : 'warn',
    component: 'operatorService',
    requestId: reqId,
    stage: opts.stage,
    status: opts.status,
    code: opts.code || 'APP_ERROR',
    ...(opts.uid ? { uid: opts.uid } : {}),
    ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
    ...(opts.appId ? { appId: opts.appId } : {}),
    ...(typeof opts.httpStatus === 'number' ? { httpStatus: opts.httpStatus } : {}),
    ...(opts.gatewayCode ? { gatewayCode: opts.gatewayCode } : {}),
    ...(opts.gatewayDescription ? { gatewayDescription: redactSensitiveText(opts.gatewayDescription) } : {}),
    ...(opts.gatewayMode ? { gatewayMode: opts.gatewayMode } : {}),
    ...(opts.errorName ? { errorName: opts.errorName } : {}),
    ...(opts.errorCode ? { errorCode: opts.errorCode } : {}),
    message: redactSensitiveText(rawErrMsg || opts.message || 'Request failed'),
  };
  if (opts.status >= 500) {
    console.error(JSON.stringify(payload));
  } else {
    console.warn(JSON.stringify(payload));
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

function cleanText(val: unknown, maxLen = 2000): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, '').trim().slice(0, maxLen);
}

function extractQueryString(val: unknown, maxLen = 120): string {
  if (typeof val === 'string') return cleanText(val, maxLen);
  if (Array.isArray(val)) {
    for (const item of val) {
      const cleaned = cleanText(item, maxLen);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

function safeDecodeURIComponent(value: string): string {
  let current = value;
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(current)) break;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function isValidAppId(appId: string): boolean {
  if (!appId || appId.length > 120) return false;
  if (/[/.#$[\]\\\u0000-\u001f\u007f]/.test(appId)) return false;
  if (appId.includes('..')) return false;
  return true;
}

function isSafeAttachmentId(attachmentId: string): boolean {
  if (!attachmentId || attachmentId.length > 255) return false;
  if (/[/\\\u0000-\u001f\u007f]/.test(attachmentId)) return false;
  if (attachmentId === '.' || attachmentId === '..' || attachmentId.includes('..')) return false;
  return path.basename(attachmentId) === attachmentId;
}

function sanitizeFilename(name: string): string {
  const base = path.basename(String(name || 'attachment')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 120) || 'attachment';
}

const MAX_OPERATOR_RL_ENTRIES = 10000;
const callbackRateLimitMap = new Map<string, { count: number; resetTime: number }>();
function checkPublicNotificationRateLimit(bucket: string, ip: string, maxRequests = 10, windowMs = 60000): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  if (callbackRateLimitMap.size >= MAX_OPERATOR_RL_ENTRIES) {
    let removed = 0;
    for (const [k, v] of callbackRateLimitMap.entries()) {
      if (now > v.resetTime || removed < 500) {
        callbackRateLimitMap.delete(k);
        removed++;
        if (callbackRateLimitMap.size < MAX_OPERATOR_RL_ENTRIES - 500) break;
      }
    }
  }
  const entry = callbackRateLimitMap.get(key);
  if (!entry || now > entry.resetTime) {
    callbackRateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count += 1;
  return true;
}

const MAX_APP_IDEMPOTENCY_ENTRIES = 5000;
const appIdempotencyCache = new Map<string, { timestamp: number; result: any }>();
function checkAppIdempotency(key?: string): any | null {
  if (!key) return null;
  const cached = appIdempotencyCache.get(key);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
    return cached.result;
  }
  return null;
}
function recordAppIdempotency(key: string | undefined, result: any) {
  if (!key) return;
  if (appIdempotencyCache.size >= MAX_APP_IDEMPOTENCY_ENTRIES) {
    const first = appIdempotencyCache.keys().next().value;
    if (first) appIdempotencyCache.delete(first);
  }
  appIdempotencyCache.set(key, { timestamp: Date.now(), result });
}

let serviceCatalogCache: { expiresAt: number; services: any[] } = { expiresAt: 0, services: [] };
async function loadServiceCatalog(): Promise<any[]> {
  if (Date.now() < serviceCatalogCache.expiresAt && serviceCatalogCache.services.length > 0) {
    return serviceCatalogCache.services;
  }
  let services: any[] = [];
  if (!isTestMode() && (await isRtdbAdminUsable()) && rtdbAdmin) {
    try {
      const snap = await withTimeout(rtdbAdmin.ref('services').once('value'), 4000, 'Load services catalog');
      if (snap.exists()) {
        const val = snap.val();
        services = Array.isArray(val)
          ? val.filter(Boolean)
          : Object.entries(val || {}).map(([id, s]: [string, any]) => ({ id, ...s }));
      }
    } catch {}
  }
  if (services.length === 0 && !isTestMode()) {
    try {
      const restResp = await fetch(`${getRtdbUrl()}/services.json`, {
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'application/json' },
      });
      if (restResp.ok) {
        const val: any = await restResp.json();
        if (val) {
          services = Array.isArray(val)
            ? val.filter(Boolean)
            : Object.entries(val || {}).map(([id, s]: [string, any]) => ({ id, ...s }));
        }
      }
    } catch {}
  }
  if (services.length === 0) {
    const candidates = [
      path.join(APP_ROOT, 'public/data/services.json'),
      path.join(APP_ROOT, 'dist/data/services.json'),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
          const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.services) ? parsed.services : [];
          if (list.length > 0) {
            services = list;
            break;
          }
        }
      } catch {}
    }
  }
  if (services.length > 0) {
    serviceCatalogCache = { expiresAt: Date.now() + 60000, services };
  }
  return services;
}

// Local test store helper (used ONLY when STORE_ORDER_TEST_MODE=1 or OPERATOR_TEST_MODE=1)
function readTestStore(): { users: Record<string, any>; applications: Record<string, any>; pendingApplications?: Record<string, any>; payments: Record<string, any>; callbacks?: Record<string, any> } {
  try {
    if (fs.existsSync(TEST_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(TEST_STORE_PATH, 'utf-8'));
    }
  } catch {}
  return { users: {}, applications: {}, pendingApplications: {}, payments: {}, callbacks: {} };
}

function writeTestStore(store: { users: Record<string, any>; applications: Record<string, any>; pendingApplications?: Record<string, any>; payments: Record<string, any>; callbacks?: Record<string, any> }) {
  fs.mkdirSync(path.dirname(TEST_STORE_PATH), { recursive: true });
  const tmpPath = `${TEST_STORE_PATH}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmpPath, TEST_STORE_PATH);
}

let testDbDelayMs = 0;
let testDbTimeoutMs = 8000;
let testPaymentInitBehavior: {
  razorpayMode?: 'ok' | 'http_error' | 'network_error' | 'timeout' | 'invalid_json' | 'missing_order_id' | 'unconfigured';
  razorpayStatus?: number;
  razorpayErrorCode?: string;
  razorpayErrorDescription?: string;
  firebaseWriteMode?: 'ok' | 'reject' | 'permission_denied' | 'timeout';
} = {};

export function setOperatorTestDbBehaviorForTesting(opts: { delayMs?: number; timeoutMs?: number }) {
  if (!isTestMode()) return;
  if (typeof opts.delayMs === 'number') testDbDelayMs = Math.max(0, opts.delayMs);
  if (typeof opts.timeoutMs === 'number') testDbTimeoutMs = Math.max(10, opts.timeoutMs);
}

export function setPaymentInitTestBehaviorForTesting(opts: {
  razorpayMode?: 'ok' | 'http_error' | 'network_error' | 'timeout' | 'invalid_json' | 'missing_order_id' | 'unconfigured';
  razorpayStatus?: number;
  razorpayErrorCode?: string;
  razorpayErrorDescription?: string;
  firebaseWriteMode?: 'ok' | 'reject' | 'permission_denied' | 'timeout';
} | null) {
  if (!isTestMode()) return;
  testPaymentInitBehavior = opts ? { ...opts } : {};
}

export function resetPaymentInitCachesForTesting() {
  if (!isTestMode()) return;
  appIdempotencyCache.clear();
  pendingDraftsMap = null;
  inFlightPaymentCreates.clear();
  createdGatewayOrdersByDedupKey.clear();
  callbackRateLimitMap.clear();
  testPaymentInitBehavior = {};
}

async function runWithTestDbTiming<T>(op: () => T, label: string): Promise<T> {
  if (testDbDelayMs <= 0) {
    return op();
  }
  return await withTimeout(
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        try {
          resolve(op());
        } catch (err) {
          reject(err);
        }
      }, testDbDelayMs);
      if (typeof t.unref === 'function') t.unref();
    }),
    testDbTimeoutMs,
    label
  );
}

export interface VerifiedCaller {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  role: 'user' | 'operator' | 'admin';
  disabled: boolean;
  idToken?: string;
}

const EXPLICIT_INVALID_TOKEN_CODES = new Set([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/argument-error',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

async function verifyTokenViaIdentityToolkit(token: string): Promise<{ uid: string; email: string; emailVerified: boolean; displayName: string } | null> {
  const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAMTND9rIAw-76Oey3c7c43-TW2t6mxEfw';
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const user = data.users?.[0];
  if (!user?.localId) return null;
  return {
    uid: user.localId,
    email: (user.email || '').toLowerCase().trim(),
    emailVerified: Boolean(user.emailVerified),
    displayName: String(user.displayName || ''),
  };
}

export async function verifyCallerWithRole(req: Request): Promise<VerifiedCaller | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  let uid = '';
  let email = '';
  let emailVerified = false;
  let displayName = '';

  if (isTestMode() && token.startsWith('test-token:')) {
    const [, testUid, testEmail, verifiedFlag] = token.split(':');
    if (!testUid) return null;
    uid = testUid;
    email = (testEmail || '').toLowerCase().trim();
    emailVerified = verifiedFlag !== 'unverified';
  } else {
    ensureAdminInit();
    let verifiedViaAdmin = false;
    if (hasAdminCredential && authAdmin) {
      try {
        const decoded = await withTimeout(authAdmin.verifyIdToken(token), 4000, 'Verify Firebase ID token');
        uid = decoded.uid;
        email = (decoded.email || '').toLowerCase().trim();
        emailVerified = Boolean(decoded.email_verified);
        displayName = String(decoded.name || '');
        verifiedViaAdmin = true;
      } catch (err: any) {
        if (err?.code && EXPLICIT_INVALID_TOKEN_CODES.has(String(err.code))) {
          return null;
        }
      }
    }
    if (!verifiedViaAdmin) {
      try {
        const lookedUp = await verifyTokenViaIdentityToolkit(token);
        if (!lookedUp) return null;
        uid = lookedUp.uid;
        email = lookedUp.email;
        emailVerified = lookedUp.emailVerified;
        displayName = lookedUp.displayName;
      } catch {
        return null;
      }
    }
  }

  // Resolve trusted profile & role from test store -> Admin RTDB (when healthy) -> caller-authenticated RTDB REST
  let profile: any = null;
  if (isTestMode()) {
    const store = readTestStore();
    profile = store.users?.[uid] || null;
  } else if (await isRtdbAdminUsable() && rtdbAdmin) {
    try {
      const snap = await withTimeout(rtdbAdmin.ref(`users/${uid}`).once('value'), 4000, 'Fetch caller user profile');
      if (snap.exists()) profile = snap.val();
    } catch {}
  }

  if (!isTestMode() && !profile) {
    try {
      const restResp = await fetch(`${getRtdbUrl()}/users/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'application/json' },
      });
      if (restResp.ok) {
        const val = await restResp.json();
        if (val && typeof val === 'object') {
          profile = val;
        }
      }
    } catch {}
  }

  const isSuper = uid === SUPER_ADMIN_UID || email === SUPER_ADMIN_EMAIL;
  const disabled = Boolean(profile?.disabled === true);
  const rawRole = profile?.role;
  const role: 'user' | 'operator' | 'admin' = isSuper
    ? 'admin'
    : rawRole === 'admin' || rawRole === 'operator' || rawRole === 'user'
      ? rawRole
      : 'user';

  const caller: VerifiedCaller = {
    uid,
    email: (profile?.email || email || '').toLowerCase().trim(),
    emailVerified,
    name: String(profile?.name || displayName || email.split('@')[0] || 'User').trim(),
    role,
    disabled,
  };
  Object.defineProperty(caller, 'idToken', {
    value: token,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return caller;
}

export async function requireAuthenticatedCaller(req: Request, res: Response): Promise<VerifiedCaller | null> {
  const caller = await verifyCallerWithRole(req);
  if (!caller) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return null;
  }
  if (caller.disabled) {
    res.status(403).json({ success: false, error: 'Account is disabled. Please contact administrator.' });
    return null;
  }
  return caller;
}

export async function requireAdminCaller(req: Request, res: Response): Promise<VerifiedCaller | null> {
  const caller = await requireAuthenticatedCaller(req, res);
  if (!caller) return null;
  if (caller.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin privileges required' });
    return null;
  }
  return caller;
}

export function requireAdminMiddleware(req: Request, res: Response, next: NextFunction) {
  requireAdminCaller(req, res)
    .then(caller => {
      if (caller) {
        (req as any).verifiedCaller = caller;
        next();
      }
    })
    .catch(() => res.status(401).json({ success: false, error: 'Authentication required' }));
}

function isCallerAssignedToApp(app: any, caller: VerifiedCaller): boolean {
  if (!app || !caller || caller.disabled || caller.role !== 'operator') return false;
  return Boolean(app.assignedToUid && app.assignedToUid === caller.uid);
}

const ATTACHMENT_ROUTE_PREFIX = '/api/operator/attachments/';

function parseInternalAttachmentUrl(rawUrl: string): {
  isInternal: boolean;
  rawAttachmentId: string;
  appId: string;
  normalizedUrl: string;
} {
  let trimmed = String(rawUrl || '').trim().replace(/&amp;/g, '&');
  if (trimmed.startsWith('api/operator/attachments/')) {
    trimmed = `/${trimmed}`;
  }
  const hasInternalPrefix = trimmed.startsWith(ATTACHMENT_ROUTE_PREFIX);
  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed, 'http://localhost');
  } catch {
    return { isInternal: hasInternalPrefix, rawAttachmentId: '', appId: '', normalizedUrl: trimmed };
  }
  const pathname = parsed.pathname || '';
  if (!pathname.startsWith(ATTACHMENT_ROUTE_PREFIX)) {
    return { isInternal: false, rawAttachmentId: '', appId: '', normalizedUrl: trimmed };
  }
  let attSegment = safeDecodeURIComponent(pathname.slice(ATTACHMENT_ROUTE_PREFIX.length));
  let embeddedQueryAppId = '';
  const qIdx = attSegment.indexOf('?');
  if (qIdx >= 0) {
    const embeddedQs = attSegment.slice(qIdx + 1);
    attSegment = attSegment.slice(0, qIdx);
    const embeddedParams = new URLSearchParams(embeddedQs.replace(/&amp;/g, '&'));
    embeddedQueryAppId = cleanText(embeddedParams.get('appId') || '', 120);
  }
  const queryAppId = extractQueryString(
    parsed.searchParams.get('appId') || parsed.searchParams.get('amp;appId') || embeddedQueryAppId,
    120
  );
  const canonicalUrl = `${ATTACHMENT_ROUTE_PREFIX}${encodeURIComponent(attSegment)}${queryAppId ? `?appId=${encodeURIComponent(queryAppId)}` : ''}`;
  return {
    isInternal: true,
    rawAttachmentId: attSegment,
    appId: queryAppId,
    normalizedUrl: canonicalUrl,
  };
}

function findStoredAttachment(appId: string, attachmentId: string): {
  filePath: string;
  metaPath: string;
  appDir: string;
  resolvedAttachmentId: string;
} | null {
  if (!isValidAppId(appId) || !isSafeAttachmentId(attachmentId)) return null;
  const sanitizedFallback = sanitizeFilename(attachmentId);
  const candidateNames = sanitizedFallback && sanitizedFallback !== attachmentId
    ? [attachmentId, sanitizedFallback]
    : [attachmentId];

  for (const rootDir of getCandidateAttachmentsDirs()) {
    const appDir = path.resolve(rootDir, appId);
    for (const candidateName of candidateNames) {
      if (!isSafeAttachmentId(candidateName)) continue;
      const filePath = path.resolve(appDir, candidateName);
      if (!filePath.startsWith(appDir + path.sep)) continue;
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const metaPath = `${filePath}.meta.json`;
          if (candidateName !== attachmentId && fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (meta.appId && meta.appId !== appId) continue;
          }
          return {
            filePath,
            metaPath,
            appDir,
            resolvedAttachmentId: candidateName,
          };
        }
      } catch {}
    }
  }
  return null;
}

function resolveAppIdForAttachment(attachmentId: string): string | null {
  if (!isSafeAttachmentId(attachmentId)) return null;
  const matchedAppIds = new Set<string>();
  const sanitizedFallback = sanitizeFilename(attachmentId);
  const candidateNames = sanitizedFallback && sanitizedFallback !== attachmentId
    ? [attachmentId, sanitizedFallback]
    : [attachmentId];

  for (const rootDir of getCandidateAttachmentsDirs()) {
    try {
      if (!fs.existsSync(rootDir)) continue;
      const entries = fs.readdirSync(rootDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirAppId = entry.name;
        if (!isValidAppId(dirAppId)) continue;
        const appDir = path.resolve(rootDir, dirAppId);
        for (const candidateName of candidateNames) {
          if (!isSafeAttachmentId(candidateName)) continue;
          const filePath = path.resolve(appDir, candidateName);
          if (!filePath.startsWith(appDir + path.sep)) continue;
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const metaPath = `${filePath}.meta.json`;
            let metaAppId = dirAppId;
            if (fs.existsSync(metaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                if (meta.appId) metaAppId = String(meta.appId);
              } catch {}
            }
            if (metaAppId === dirAppId) {
              matchedAppIds.add(dirAppId);
            }
          }
        }
      }
    } catch {}
  }

  if (matchedAppIds.size === 1) {
    return Array.from(matchedAppIds)[0];
  }
  return null;
}

function writeAttachmentAtomically(
  appDir: string,
  attachmentId: string,
  buf: Buffer,
  meta: Record<string, any>
): { filePath: string; metaPath: string } {
  fs.mkdirSync(appDir, { recursive: true });
  const filePath = path.join(appDir, attachmentId);
  const metaPath = path.join(appDir, `${attachmentId}.meta.json`);
  const nonce = crypto.randomBytes(4).toString('hex');
  const tmpFilePath = `${filePath}.tmp-${nonce}`;
  const tmpMetaPath = `${metaPath}.tmp-${nonce}`;
  try {
    fs.writeFileSync(tmpFilePath, buf);
    fs.renameSync(tmpFilePath, filePath);
    fs.writeFileSync(tmpMetaPath, JSON.stringify(meta), 'utf-8');
    fs.renameSync(tmpMetaPath, metaPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== buf.length || !fs.existsSync(metaPath)) {
      throw new Error('Failed to verify persisted attachment files on disk');
    }
    return { filePath, metaPath };
  } catch (err) {
    for (const p of [tmpFilePath, tmpMetaPath]) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
    throw err;
  }
}

function validateInternalAttachmentReference(
  attachmentUrl: string,
  expectedAppId: string,
  expectedUploaderUid?: string
): { ok: boolean; normalizedUrl?: string; error?: string } {
  const parsed = parseInternalAttachmentUrl(attachmentUrl);
  if (!parsed.isInternal) {
    return { ok: true, normalizedUrl: attachmentUrl };
  }
  try {
    const rawAttId = parsed.rawAttachmentId;
    if (!rawAttId || !isSafeAttachmentId(rawAttId)) {
      return { ok: false, error: 'Invalid attachment reference' };
    }
    if (!isValidAppId(expectedAppId) || !parsed.appId || parsed.appId !== expectedAppId) {
      return { ok: false, error: 'Attachment URL does not match target application' };
    }
    const found = findStoredAttachment(expectedAppId, rawAttId);
    if (!found || !fs.existsSync(found.metaPath)) {
      return { ok: false, error: 'Referenced attachment file was not found on server' };
    }
    const meta = JSON.parse(fs.readFileSync(found.metaPath, 'utf-8'));
    if (
      meta.appId !== expectedAppId ||
      (meta.attachmentId !== found.resolvedAttachmentId && meta.attachmentId !== rawAttId)
    ) {
      return { ok: false, error: 'Attachment metadata mismatch for target application' };
    }
    if (expectedUploaderUid && meta.uploadedByUid && meta.uploadedByUid !== expectedUploaderUid) {
      return { ok: false, error: 'Attachment was not uploaded by the authenticated reply author' };
    }
    return { ok: true, normalizedUrl: parsed.normalizedUrl };
  } catch {
    return { ok: false, error: 'Invalid attachment URL' };
  }
}

function detectAttachmentFileType(buf: Buffer): { ok: boolean; ext?: string; contentType?: string } {
  if (!buf || buf.length === 0) return { ok: false };
  const isPdf = buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === '%PDF';
  const isJpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  if (isPdf) return { ok: true, ext: 'pdf', contentType: 'application/pdf' };
  if (isJpeg) return { ok: true, ext: 'jpg', contentType: 'image/jpeg' };
  if (isPng) return { ok: true, ext: 'png', contentType: 'image/png' };
  if (isWebp) return { ok: true, ext: 'webp', contentType: 'image/webp' };
  return { ok: false };
}

function inferMimeTypeFromExtension(filename: string): string | null {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

function normalizeValidatedAttachmentsList(
  rawAttachments: unknown,
  appId: string,
  expectedUploaderUid?: string
): { ok: boolean; attachments: Array<{ url: string; name: string }>; error?: string } {
  if (rawAttachments === undefined || rawAttachments === null) {
    return { ok: true, attachments: [] };
  }
  if (!Array.isArray(rawAttachments)) {
    return { ok: false, attachments: [], error: 'Attachments must be an array.' };
  }
  if (rawAttachments.length > MAX_REPLY_ATTACHMENTS) {
    return { ok: false, attachments: [], error: `You can attach at most ${MAX_REPLY_ATTACHMENTS} files per message.` };
  }
  const result: Array<{ url: string; name: string }> = [];
  const seenUrls = new Set<string>();
  for (let i = 0; i < rawAttachments.length; i++) {
    const item = rawAttachments[i];
    let url = '';
    let name = '';
    if (typeof item === 'string') {
      url = item.trim();
      name = `Attachment ${i + 1}`;
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      url = typeof obj.url === 'string' ? obj.url.trim() : '';
      name = cleanText(obj.name, 150) || `Attachment ${i + 1}`;
    } else {
      return { ok: false, attachments: [], error: 'Each attachment must be a valid { url, name } object or URL string.' };
    }
    url = url.replace(/&amp;/g, '&');
    if (url.startsWith('api/operator/attachments/')) {
      url = `/${url}`;
    }
    if (!url || url.length > 2048) {
      return { ok: false, attachments: [], error: 'Attachment URL is missing or too long.' };
    }
    const parsedInternal = parseInternalAttachmentUrl(url);
    if (!parsedInternal.isInternal && !url.startsWith('https://')) {
      return { ok: false, attachments: [], error: 'Invalid attachment URL.' };
    }
    if (parsedInternal.isInternal) {
      const refCheck = validateInternalAttachmentReference(url, appId, expectedUploaderUid);
      if (!refCheck.ok) {
        return { ok: false, attachments: [], error: refCheck.error || 'Invalid attachment reference.' };
      }
      if (refCheck.normalizedUrl) {
        url = refCheck.normalizedUrl;
      }
    }
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      result.push({ url, name: name.slice(0, 150) });
    }
  }
  return { ok: true, attachments: result };
}

function isCallerOwnerOfApp(app: any, caller: VerifiedCaller): boolean {
  if (!app || !caller || caller.disabled) return false;
  return app.uid === caller.uid || app.userId === caller.uid;
}

async function readApplication(appId: string, callerIdToken?: string): Promise<any | null> {
  if (isTestMode()) {
    const store = readTestStore();
    return store.applications?.[appId] ? { id: appId, ...store.applications[appId] } : null;
  }
  if ((await isRtdbAdminUsable()) && rtdbAdmin) {
    const snap = await withTimeout(rtdbAdmin.ref(`applications/${appId}`).once('value'), 6000, 'Read application');
    if (!snap.exists()) return null;
    return { id: appId, ...snap.val() };
  }
  if (callerIdToken) {
    const resp = await fetch(`${getRtdbUrl()}/applications/${encodeURIComponent(appId)}.json?auth=${encodeURIComponent(callerIdToken)}`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (resp.ok) {
      const val = await resp.json();
      if (!val || typeof val !== 'object') return null;
      return { id: appId, ...val };
    }
    if (resp.status === 401 || resp.status === 403) {
      throw Object.assign(new Error('You do not have permission to access this application.'), { code: 'PERMISSION_DENIED', statusCode: 403 });
    }
  }
  throw Object.assign(new Error('Firebase Admin credentials not configured on server'), { code: 'FIREBASE_ADMIN_UNCONFIGURED', statusCode: 503 });
}

async function readUserProfile(uid: string): Promise<{ uid: string; email: string; name: string; role: string; disabled: boolean; phone?: string; authProvider?: string; registrationNotified?: boolean } | null> {
  if (!uid) return null;
  if (isTestMode()) {
    const store = readTestStore();
    const u = store.users?.[uid];
    if (!u) return null;
    return {
      uid,
      email: normalizeEmailAddress(u.email),
      name: String(u.name || u.email?.split('@')[0] || 'User').trim(),
      role: String(u.role || 'user'),
      disabled: Boolean(u.disabled === true),
      phone: u.phone ? String(u.phone) : undefined,
      authProvider: u.authProvider ? String(u.authProvider) : undefined,
      registrationNotified: Boolean(u.registrationNotified === true),
    };
  }
  if (!ensureAdminInit() || !rtdbAdmin) return null;
  try {
    const snap = await withTimeout(rtdbAdmin.ref(`users/${uid}`).once('value'), 5000, 'Read user profile');
    if (!snap.exists()) return null;
    const u = snap.val();
    return {
      uid,
      email: normalizeEmailAddress(u.email),
      name: String(u.name || u.email?.split('@')[0] || 'User').trim(),
      role: String(u.role || 'user'),
      disabled: Boolean(u.disabled === true),
      phone: u.phone ? String(u.phone) : undefined,
      authProvider: u.authProvider ? String(u.authProvider) : undefined,
      registrationNotified: Boolean(u.registrationNotified === true),
    };
  } catch {
    return null;
  }
}

registerOutboxOperatorProfileResolver(readUserProfile);

async function findOperatorProfile(params: { operatorUid?: string; operatorEmail?: string }) {
  const targetUid = cleanText(params.operatorUid || '', 128);
  const targetEmail = normalizeEmailAddress(params.operatorEmail || '');

  if (targetUid) {
    const byUid = await readUserProfile(targetUid);
    if (byUid) return byUid;
  }

  if (targetEmail) {
    if (isTestMode()) {
      const store = readTestStore();
      for (const [uid, raw] of Object.entries(store.users || {})) {
        const u = raw as any;
        if (normalizeEmailAddress(u?.email) === targetEmail) {
          return {
            uid,
            email: targetEmail,
            name: String(u.name || targetEmail.split('@')[0] || 'Operator').trim(),
            role: String(u.role || 'user'),
            disabled: Boolean(u.disabled === true),
          };
        }
      }
      return null;
    }

    if (ensureAdminInit() && rtdbAdmin) {
      const snap = await withTimeout(
        rtdbAdmin.ref('users').orderByChild('email').equalTo(targetEmail).once('value'),
        6000,
        'Lookup operator by email'
      );
      if (snap.exists()) {
        const entries = Object.entries(snap.val() || {});
        if (entries.length > 0) {
          const [uid, raw] = entries[0] as [string, any];
          return {
            uid,
            email: normalizeEmailAddress(raw?.email || targetEmail),
            name: String(raw?.name || targetEmail.split('@')[0] || 'Operator').trim(),
            role: String(raw?.role || 'user'),
            disabled: Boolean(raw?.disabled === true),
          };
        }
      }
    }
  }

  return null;
}

/**
 * GET /api/operator/applications/:appId
 */
export async function handleGetOperatorApplication(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;
    if (caller.role !== 'admin' && caller.role !== 'operator') {
      return res.status(403).json({ success: false, error: 'Operator or Admin access required' });
    }

    const appId = cleanText(req.params.appId, 120);
    if (!appId || /[/.#$[\]]/.test(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID' });
    }

    const app = await readApplication(appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    if (caller.role !== 'admin' && !isCallerAssignedToApp(app, caller)) {
      return res.status(403).json({ success: false, error: 'You are not assigned to this application' });
    }

    return res.json({ success: true, application: app });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleGetOperatorApplication error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve application' });
  }
}

/**
 * POST /api/operator/applications/:appId/update
 * Server-authoritative status update + append-only child note creation
 */
export async function handleOperatorUpdateApplication(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;
    if (caller.role !== 'admin' && caller.role !== 'operator') {
      return res.status(403).json({ success: false, error: 'Operator or Admin access required' });
    }

    const appId = cleanText(req.params.appId, 120);
    if (!appId || /[/.#$[\]]/.test(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ success: false, error: 'Invalid JSON request payload' });
    }

    // Explicitly reject protected fields and any unknown/unsupported keys
    for (const field of Object.keys(body)) {
      if (PROTECTED_UPDATE_FIELDS.has(field)) {
        return res.status(403).json({ success: false, error: `Modification of protected field "${field}" is forbidden` });
      }
      if (!ALLOWED_UPDATE_BODY_FIELDS.has(field)) {
        return res.status(400).json({ success: false, error: `Unknown or unsupported field "${field}" is not allowed` });
      }
    }

    const rawStatus = typeof body.status === 'string' ? body.status.trim() : '';
    const noteText = cleanText(body.note, MAX_NOTE_LENGTH);
    let attachmentUrl = typeof body.attachmentUrl === 'string' ? body.attachmentUrl.trim().replace(/&amp;/g, '&') : '';
    if (attachmentUrl.startsWith('api/operator/attachments/')) {
      attachmentUrl = `/${attachmentUrl}`;
    }
    const attachmentName = cleanText(body.attachmentName, 150);
    const attachmentsCheck = normalizeValidatedAttachmentsList(body.attachments, appId);

    let clientRequestId = '';
    if (body.clientRequestId !== undefined && body.clientRequestId !== null) {
      if (typeof body.clientRequestId !== 'string') {
        return res.status(400).json({ success: false, error: 'clientRequestId must be a string.' });
      }
      const trimmedReqId = body.clientRequestId.trim();
      if (trimmedReqId && (trimmedReqId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(trimmedReqId))) {
        return res.status(400).json({ success: false, error: 'Invalid clientRequestId format.' });
      }
      clientRequestId = trimmedReqId;
    }

    if (!attachmentsCheck.ok) {
      return res.status(400).json({ success: false, error: attachmentsCheck.error || 'Invalid attachments payload' });
    }
    const normalizedAttachments = [...attachmentsCheck.attachments];

    if (rawStatus && !ALLOWED_STATUSES.has(rawStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid status value. Allowed: processing, clarification, completed, rejected.' });
    }
    const parsedSingleAtt = attachmentUrl ? parseInternalAttachmentUrl(attachmentUrl) : null;
    if (attachmentUrl && !parsedSingleAtt?.isInternal && !attachmentUrl.startsWith('https://')) {
      return res.status(400).json({ success: false, error: 'Invalid attachment URL' });
    }
    if (parsedSingleAtt?.isInternal) {
      const attCheck = validateInternalAttachmentReference(attachmentUrl, appId);
      if (!attCheck.ok) {
        return res.status(400).json({ success: false, error: attCheck.error || 'Invalid attachment reference' });
      }
      if (attCheck.normalizedUrl) {
        attachmentUrl = attCheck.normalizedUrl;
      }
    }
    if (attachmentUrl && !normalizedAttachments.some(a => a.url === attachmentUrl)) {
      normalizedAttachments.unshift({ url: attachmentUrl, name: attachmentName || 'Attachment' });
    }
    if (normalizedAttachments.length > MAX_REPLY_ATTACHMENTS) {
      return res.status(400).json({ success: false, error: `You can attach at most ${MAX_REPLY_ATTACHMENTS} files per update.` });
    }
    if (!rawStatus && !noteText && !attachmentUrl && normalizedAttachments.length === 0) {
      return res.status(400).json({ success: false, error: 'Please provide a status update, note, or attachment.' });
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const noteId = `note_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const newNote: Record<string, any> = {
      id: noteId,
      type: rawStatus ? 'status' : 'note',
      by: caller.name || caller.email,
      email: caller.email,
      authorUid: caller.uid,
      authorRole: caller.role,
      text: noteText || (rawStatus ? `Status updated to ${rawStatus}` : `Uploaded attachment: ${attachmentName || normalizedAttachments[0]?.name || 'Attachment'}`),
      time: new Date(nowMs).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      createdAt: nowMs,
    };
    if (clientRequestId) {
      newNote.clientRequestId = clientRequestId;
    }
    if (rawStatus) newNote.status = rawStatus;
    if (attachmentUrl) {
      newNote.attachment = attachmentUrl;
      if (attachmentName) newNote.attachmentName = attachmentName;
    }
    if (normalizedAttachments.length > 0) {
      newNote.attachments = normalizedAttachments;
      if (!newNote.attachment) {
        newNote.attachment = normalizedAttachments[0].url;
        newNote.attachmentName = normalizedAttachments[0].name;
      }
    }

    let appSnapshotAfter: any = null;
    let previousStatus = 'pending';

    if (isTestMode()) {
      const txOut = await runWithTestDbTiming(() => {
        const store = readTestStore();
        const target = store.applications?.[appId];
        if (!target) {
          return { status: 404 as const, body: { success: false, error: 'Application not found' } };
        }
        if (caller.role !== 'admin' && !isCallerAssignedToApp(target, caller)) {
          return { status: 403 as const, body: { success: false, error: 'Access denied: application is not assigned to your account.' } };
        }
        previousStatus = String(target.status || 'pending');
        if (!target.notes || Array.isArray(target.notes)) {
          const mapped: Record<string, any> = {};
          if (Array.isArray(target.notes)) {
            target.notes.forEach((n: any, idx: number) => {
              if (n && typeof n === 'object') mapped[n.id || `legacy_${idx}`] = n;
            });
          }
          target.notes = mapped;
        }
        if (clientRequestId) {
          const existingDup = Object.values(target.notes).find(
            (n: any) => n && typeof n === 'object' && n.clientRequestId === clientRequestId && n.authorUid === caller.uid
          );
          if (existingDup) {
            return {
              status: 200 as const,
              duplicate: true,
              body: {
                success: true,
                duplicate: true,
                note: existingDup,
                status: target.status || 'pending',
                updatedAt: target.updatedAt || nowIso,
              },
            };
          }
        }
        target.notes[noteId] = newNote;
        if (rawStatus) target.status = rawStatus;
        target.updatedAt = nowIso;
        writeTestStore(store);
        return {
          status: 200 as const,
          duplicate: false,
          snapshot: { id: appId, ...target },
        };
      }, 'Atomic application update');

      if (txOut.status !== 200) {
        return res.status(txOut.status).json(txOut.body);
      }
      if (txOut.duplicate) {
        return res.json(txOut.body);
      }
      appSnapshotAfter = txOut.snapshot;
    } else if (ensureAdminInit() && rtdbAdmin) {
      const initialApp = await readApplication(appId);
      if (!initialApp) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (caller.role !== 'admin' && !isCallerAssignedToApp(initialApp, caller)) {
        return res.status(403).json({ success: false, error: 'Access denied: application is not assigned to your account.' });
      }

      // Atomic RTDB transaction prevents TOCTOU race & ensures duplicate clientRequestId idempotency
      const txState: { abortReason: 'NONE' | 'FORBIDDEN' | 'DUPLICATE'; previousStatus: string; duplicateNote: any } = {
        abortReason: 'NONE',
        previousStatus: String(initialApp.status || 'pending'),
        duplicateNote: null,
      };
      const txResult = await withTimeout(
        rtdbAdmin.ref(`applications/${appId}`).transaction((currentApp: any) => {
          txState.abortReason = 'NONE';
          txState.duplicateNote = null;
          if (currentApp === null) {
            return null;
          }
          if (caller.role !== 'admin' && !isCallerAssignedToApp(currentApp, caller)) {
            txState.abortReason = 'FORBIDDEN';
            return undefined;
          }
          txState.previousStatus = String(currentApp.status || 'pending');
          const nextNotes: Record<string, any> = {};
          if (Array.isArray(currentApp.notes)) {
            currentApp.notes.forEach((n: any, idx: number) => {
              if (n && typeof n === 'object') nextNotes[n.id || `legacy_${idx}`] = n;
            });
          } else if (currentApp.notes && typeof currentApp.notes === 'object') {
            Object.assign(nextNotes, currentApp.notes);
          }
          if (clientRequestId) {
            const existingDup = Object.values(nextNotes).find(
              (n: any) => n && typeof n === 'object' && n.clientRequestId === clientRequestId && n.authorUid === caller.uid
            );
            if (existingDup) {
              txState.abortReason = 'DUPLICATE';
              txState.duplicateNote = existingDup;
              return undefined;
            }
          }
          nextNotes[noteId] = newNote;

          return {
            ...currentApp,
            ...(rawStatus ? { status: rawStatus } : {}),
            updatedAt: nowIso,
            notes: nextNotes,
          };
        }),
        8000,
        'Atomic application update'
      );

      if (txState.abortReason === 'FORBIDDEN') {
        return res.status(403).json({ success: false, error: 'Access denied: application assignment changed.' });
      }
      if (txState.abortReason === 'DUPLICATE' && txState.duplicateNote) {
        return res.json({
          success: true,
          duplicate: true,
          note: txState.duplicateNote,
          status: initialApp.status || 'pending',
          updatedAt: initialApp.updatedAt || nowIso,
        });
      }
      const valAfter = txResult.snapshot?.val();
      if (!valAfter) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (!txResult.committed) {
        return res.status(409).json({ success: false, error: 'Application update conflicted with another change. Please retry.' });
      }
      previousStatus = txState.previousStatus;
      appSnapshotAfter = { id: appId, ...valAfter };
    } else {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: 'Firebase Admin credentials not configured on server' });
    }

    const attachmentSummary = normalizedAttachments.length > 0
      ? normalizedAttachments.map(a => a.name).join(', ')
      : (attachmentName || (attachmentUrl ? 'Attachment' : undefined));

    const outboxKey = clientRequestId
      ? `app_update:${appId}:req:${clientRequestId}`
      : `app_update:${appId}:${noteId}`;

    enqueueOutboxNotification({
      idempotencyKey: outboxKey,
      kind: 'application_update',
      appId,
      payload: {
        appSnapshot: appSnapshotAfter,
        previousStatus,
        newStatus: rawStatus || undefined,
        noteText: noteText || undefined,
        attachmentName: attachmentSummary,
        performedBy: { uid: caller.uid, name: caller.name, email: caller.email, role: caller.role },
        timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      },
    });

    return res.json({
      success: true,
      note: newNote,
      status: rawStatus || appSnapshotAfter.status,
      updatedAt: nowIso,
      notificationQueued: true,
    });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    if (String(err?.message || '').toLowerCase().includes('timed out')) {
      return res.status(504).json({ success: false, code: 'DB_TIMEOUT', error: 'Database did not respond in time. Please try again.' });
    }
    console.error('[operatorService] handleOperatorUpdateApplication error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update application' });
  }
}

/**
 * POST /api/operator/applications/:appId/upload-attachment
 * Server-verified attachment upload with magic-byte validation & assignment authorization
 */
export async function handleOperatorUploadAttachment(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;
    if (caller.role !== 'admin' && caller.role !== 'operator') {
      return res.status(403).json({ success: false, error: 'Operator or Admin access required' });
    }

    const appId = cleanText(req.params.appId, 120);
    if (!appId || /[/.#$[\]]/.test(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID' });
    }

    const app = await readApplication(appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }
    if (caller.role !== 'admin' && !isCallerAssignedToApp(app, caller)) {
      return res.status(403).json({ success: false, error: 'Access denied: application is not assigned to your account.' });
    }

    const file = (req as any).file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, error: 'Attachment file is required.' });
    }
    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'File exceeds the 5 MB limit.' });
    }

    const buf: Buffer = file.buffer;
    const isPdf = buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === '%PDF';
    const isJpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp = buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isPdf && !isJpeg && !isPng && !isWebp) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported or unsafe file format. Only valid PDF, JPG, PNG, and WEBP files are allowed.',
      });
    }

    const ext = isPdf ? 'pdf' : isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
    const contentType = isPdf ? 'application/pdf' : isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp';
    const safeOriginal = sanitizeFilename(file.originalname || `attachment.${ext}`);
    const attachmentId = `att_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const appDir = path.join(getAttachmentsDir(), appId);
    writeAttachmentAtomically(appDir, attachmentId, buf, {
      attachmentId,
      appId,
      uploadedByUid: caller.uid,
      uploadedByRole: caller.role,
      originalName: safeOriginal,
      contentType,
      size: buf.length,
      createdAt: new Date().toISOString(),
    });

    const downloadUrl = `/api/operator/attachments/${encodeURIComponent(attachmentId)}?appId=${encodeURIComponent(appId)}`;
    return res.json({
      success: true,
      url: downloadUrl,
      attachmentUrl: downloadUrl,
      attachmentName: safeOriginal,
    });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleOperatorUploadAttachment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to upload attachment' });
  }
}

/**
 * POST /api/applications/:appId/reply-attachments
 * Authenticated owner-only multiple attachment upload for clarification replies
 */
export async function handleUserReplyAttachmentUpload(req: Request, res: Response) {
  const writtenPaths: string[] = [];
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const appId = cleanText(req.params.appId, 120);
    if (!isValidAppId(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID' });
    }

    const app = await readApplication(appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }
    if (!isCallerOwnerOfApp(app, caller)) {
      return res.status(403).json({ success: false, error: 'Access denied: only the application owner can upload reply attachments.' });
    }

    const reqFiles = (req as any).files;
    const rawFiles: Array<{ buffer: Buffer; size: number; originalname?: string }> = [];
    if (Array.isArray(reqFiles)) {
      rawFiles.push(...reqFiles);
    } else if (reqFiles && typeof reqFiles === 'object') {
      if (Array.isArray(reqFiles.files)) rawFiles.push(...reqFiles.files);
      if (Array.isArray(reqFiles['files[]'])) rawFiles.push(...reqFiles['files[]']);
      if (Array.isArray(reqFiles.file)) rawFiles.push(...reqFiles.file);
    } else if ((req as any).file) {
      rawFiles.push((req as any).file);
    }

    if (rawFiles.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one attachment file is required.' });
    }
    if (rawFiles.length > MAX_REPLY_ATTACHMENTS) {
      return res.status(400).json({ success: false, error: `You can upload at most ${MAX_REPLY_ATTACHMENTS} files per reply.` });
    }

    const validatedFiles: Array<{ buf: Buffer; ext: string; contentType: string; safeOriginal: string }> = [];
    for (const f of rawFiles) {
      if (!f || !f.buffer || f.size <= 0) {
        return res.status(400).json({ success: false, error: 'Attachment file is empty or unreadable.' });
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        return res.status(400).json({ success: false, error: `File "${sanitizeFilename(f.originalname || 'attachment')}" exceeds the 5 MB limit.` });
      }
      const detected = detectAttachmentFileType(f.buffer);
      if (!detected.ok || !detected.ext || !detected.contentType) {
        return res.status(400).json({
          success: false,
          error: 'Unsupported or unsafe file format. Only valid PDF, JPG, PNG, and WEBP files are allowed.',
        });
      }
      validatedFiles.push({
        buf: f.buffer,
        ext: detected.ext,
        contentType: detected.contentType,
        safeOriginal: sanitizeFilename(f.originalname || `attachment.${detected.ext}`),
      });
    }

    const appDir = path.join(getAttachmentsDir(), appId);
    fs.mkdirSync(appDir, { recursive: true });
    const uploadedAttachments: Array<{ url: string; name: string }> = [];

    for (let i = 0; i < validatedFiles.length; i++) {
      const item = validatedFiles[i];
      const attachmentId = `reply_att_${Date.now()}_${i}_${crypto.randomBytes(8).toString('hex')}.${item.ext}`;
      const { filePath, metaPath } = writeAttachmentAtomically(appDir, attachmentId, item.buf, {
        attachmentId,
        appId,
        uploadedByUid: caller.uid,
        uploadedByRole: 'user',
        originalName: item.safeOriginal,
        contentType: item.contentType,
        size: item.buf.length,
        createdAt: new Date().toISOString(),
      });
      writtenPaths.push(filePath, metaPath);
      uploadedAttachments.push({
        url: `/api/operator/attachments/${encodeURIComponent(attachmentId)}?appId=${encodeURIComponent(appId)}`,
        name: item.safeOriginal,
      });
    }

    return res.json({
      success: true,
      attachments: uploadedAttachments,
    });
  } catch (err: any) {
    for (const p of writtenPaths) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleUserReplyAttachmentUpload error:', err);
    return res.status(500).json({ success: false, error: 'Failed to upload reply attachments' });
  }
}

/**
 * POST /api/applications/:appId/reply
 * Server-authoritative append-only clarification reply for verified application owner
 */
export async function handleUserReplyApplication(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const appId = cleanText(req.params.appId, 120);
    if (!appId || /[/.#$[\]]/.test(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ success: false, error: 'Invalid JSON request payload' });
    }

    for (const field of Object.keys(body)) {
      if (PROTECTED_REPLY_FIELDS.has(field)) {
        return res.status(403).json({ success: false, error: `Modification of protected field "${field}" is forbidden` });
      }
      if (!ALLOWED_REPLY_BODY_FIELDS.has(field)) {
        return res.status(400).json({ success: false, error: `Unknown or unsupported field "${field}" is not allowed` });
      }
    }

    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
      return res.status(400).json({ success: false, error: 'Reply text must be a string.' });
    }
    const rawNote = typeof body.note === 'string' ? body.note.trim() : '';
    if (rawNote.length > MAX_NOTE_LENGTH) {
      return res.status(400).json({ success: false, error: `Reply text must be ${MAX_NOTE_LENGTH} characters or less.` });
    }
    const noteText = cleanText(rawNote, MAX_NOTE_LENGTH);

    let clientReplyId = '';
    if (body.clientReplyId !== undefined && body.clientReplyId !== null) {
      if (typeof body.clientReplyId !== 'string') {
        return res.status(400).json({ success: false, error: 'clientReplyId must be a string.' });
      }
      const trimmedId = body.clientReplyId.trim();
      if (trimmedId && (trimmedId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(trimmedId))) {
        return res.status(400).json({ success: false, error: 'Invalid clientReplyId format.' });
      }
      clientReplyId = trimmedId;
    }

    const attachmentsCheck = normalizeValidatedAttachmentsList(body.attachments, appId, caller.uid);
    if (!attachmentsCheck.ok) {
      return res.status(400).json({ success: false, error: attachmentsCheck.error || 'Invalid attachments payload' });
    }
    const normalizedAttachments = attachmentsCheck.attachments;

    if (!noteText && normalizedAttachments.length === 0) {
      return res.status(400).json({ success: false, error: 'Please enter a reply message or attach at least one file.' });
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const noteId = `reply_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const newNote: Record<string, any> = {
      id: noteId,
      type: 'reply',
      by: caller.name || caller.email || 'User',
      email: caller.email || '',
      authorUid: caller.uid,
      authorRole: 'user',
      text: noteText || `Uploaded ${normalizedAttachments.length} attachment${normalizedAttachments.length > 1 ? 's' : ''}`,
      time: new Date(nowMs).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      createdAt: nowMs,
    };
    if (clientReplyId) {
      newNote.clientReplyId = clientReplyId;
    }
    if (normalizedAttachments.length > 0) {
      newNote.attachments = normalizedAttachments;
      if (normalizedAttachments.length === 1) {
        newNote.attachment = normalizedAttachments[0].url;
        newNote.attachmentName = normalizedAttachments[0].name;
      }
    }

    let appSnapshotAfter: any = null;

    if (isTestMode()) {
      const txOut = await runWithTestDbTiming(() => {
        const store = readTestStore();
        const target = store.applications?.[appId];
        if (!target) {
          return { status: 404 as const, body: { success: false, error: 'Application not found' } };
        }
        if (!isCallerOwnerOfApp(target, caller)) {
          return { status: 403 as const, body: { success: false, error: 'Access denied: you can only reply to your own applications.' } };
        }
        if (!target.notes || Array.isArray(target.notes)) {
          const mapped: Record<string, any> = {};
          if (Array.isArray(target.notes)) {
            target.notes.forEach((n: any, idx: number) => {
              if (n && typeof n === 'object') mapped[n.id || `legacy_${idx}`] = n;
            });
          }
          target.notes = mapped;
        }
        if (clientReplyId) {
          const existingDup = Object.values(target.notes).find(
            (n: any) => n && typeof n === 'object' && n.clientReplyId === clientReplyId && n.authorUid === caller.uid
          );
          if (existingDup) {
            return {
              status: 200 as const,
              duplicate: true,
              body: {
                success: true,
                duplicate: true,
                note: existingDup,
                updatedAt: target.updatedAt || nowIso,
              },
            };
          }
        }
        target.notes[noteId] = newNote;
        target.updatedAt = nowIso;
        writeTestStore(store);
        return {
          status: 200 as const,
          duplicate: false,
          snapshot: { id: appId, ...target },
        };
      }, 'Atomic user application reply');

      if (txOut.status !== 200) {
        return res.status(txOut.status).json(txOut.body);
      }
      if (txOut.duplicate) {
        return res.json(txOut.body);
      }
      appSnapshotAfter = txOut.snapshot;
    } else if (ensureAdminInit() && rtdbAdmin) {
      const initialApp = await readApplication(appId);
      if (!initialApp) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (!isCallerOwnerOfApp(initialApp, caller)) {
        return res.status(403).json({ success: false, error: 'Access denied: you can only reply to your own applications.' });
      }

      const txState: { abortReason: 'NONE' | 'FORBIDDEN' | 'DUPLICATE'; duplicateNote: any } = {
        abortReason: 'NONE',
        duplicateNote: null,
      };
      const txResult = await withTimeout(
        rtdbAdmin.ref(`applications/${appId}`).transaction((currentApp: any) => {
          txState.abortReason = 'NONE';
          txState.duplicateNote = null;
          if (currentApp === null) {
            return null;
          }
          if (!isCallerOwnerOfApp(currentApp, caller)) {
            txState.abortReason = 'FORBIDDEN';
            return undefined;
          }
          const nextNotes: Record<string, any> = {};
          if (Array.isArray(currentApp.notes)) {
            currentApp.notes.forEach((n: any, idx: number) => {
              if (n && typeof n === 'object') nextNotes[n.id || `legacy_${idx}`] = n;
            });
          } else if (currentApp.notes && typeof currentApp.notes === 'object') {
            Object.assign(nextNotes, currentApp.notes);
          }
          if (clientReplyId) {
            const existingDup = Object.values(nextNotes).find(
              (n: any) => n && typeof n === 'object' && n.clientReplyId === clientReplyId && n.authorUid === caller.uid
            );
            if (existingDup) {
              txState.abortReason = 'DUPLICATE';
              txState.duplicateNote = existingDup;
              return undefined;
            }
          }
          nextNotes[noteId] = newNote;
          return {
            ...currentApp,
            updatedAt: nowIso,
            notes: nextNotes,
          };
        }),
        8000,
        'Atomic user application reply'
      );

      if (txState.abortReason === 'FORBIDDEN') {
        return res.status(403).json({ success: false, error: 'Access denied: application ownership could not be verified.' });
      }
      if (txState.abortReason === 'DUPLICATE' && txState.duplicateNote) {
        return res.json({
          success: true,
          duplicate: true,
          note: txState.duplicateNote,
          updatedAt: initialApp.updatedAt || nowIso,
        });
      }
      const valAfter = txResult.snapshot?.val();
      if (!valAfter) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (!txResult.committed) {
        return res.status(409).json({ success: false, error: 'Reply submission conflicted with another change. Please retry.' });
      }
      appSnapshotAfter = { id: appId, ...valAfter };
    } else {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: 'Firebase Admin credentials not configured on server' });
    }

    const outboxKey = clientReplyId
      ? `app_user_reply:${appId}:req:${clientReplyId}`
      : `app_user_reply:${appId}:${noteId}`;

    enqueueOutboxNotification({
      idempotencyKey: outboxKey,
      kind: 'user_reply',
      appId,
      payload: {
        appSnapshot: appSnapshotAfter,
        noteText: newNote.text,
        attachmentNames: normalizedAttachments.map(a => a.name),
        performedBy: { uid: caller.uid, name: caller.name, email: caller.email, role: 'user' },
        timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      },
    });

    return res.json({
      success: true,
      note: newNote,
      updatedAt: nowIso,
      notificationQueued: true,
    });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    if (String(err?.message || '').toLowerCase().includes('timed out')) {
      return res.status(504).json({ success: false, code: 'DB_TIMEOUT', error: 'Database did not respond in time. Please try again.' });
    }
    console.error('[operatorService] handleUserReplyApplication error:', err);
    return res.status(500).json({ success: false, error: 'Failed to submit reply' });
  }
}

/**
 * GET /api/operator/attachments/:attachmentId?appId=...
 * Authorized download endpoint — verifies caller is Admin, Application Owner, or Assigned Operator
 */
export async function handleGetOperatorAttachment(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const rawParamDecoded = safeDecodeURIComponent(String(req.params.attachmentId || ''));
    let attachmentId = rawParamDecoded;
    let embeddedAppId = '';
    const embeddedQIdx = rawParamDecoded.indexOf('?');
    if (embeddedQIdx >= 0) {
      const qs = rawParamDecoded.slice(embeddedQIdx + 1).replace(/&amp;/g, '&');
      attachmentId = rawParamDecoded.slice(0, embeddedQIdx);
      const params = new URLSearchParams(qs);
      embeddedAppId = extractQueryString(params.get('appId'), 120);
    }

    const explicitQueryAppId = extractQueryString(
      req.query.appId !== undefined ? req.query.appId : req.query['amp;appId'],
      120
    );
    const hasExplicitInvalidAppId =
      typeof req.query.appId === 'string' &&
      req.query.appId.trim().length > 0 &&
      !isValidAppId(req.query.appId.trim());

    if (hasExplicitInvalidAppId || !isSafeAttachmentId(attachmentId)) {
      return res.status(400).json({ success: false, error: 'Invalid attachment reference' });
    }

    let appId = explicitQueryAppId || embeddedAppId;
    if (!appId) {
      const inferredAppId = resolveAppIdForAttachment(attachmentId);
      if (inferredAppId) {
        appId = inferredAppId;
      }
    }

    if (!isValidAppId(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid attachment reference' });
    }

    const app = await readApplication(appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    const allowed =
      caller.role === 'admin' ||
      isCallerOwnerOfApp(app, caller) ||
      isCallerAssignedToApp(app, caller);

    if (!allowed) {
      return res.status(403).json({ success: false, error: 'Access denied to this attachment' });
    }

    const found = findStoredAttachment(appId, attachmentId);
    if (!found) {
      return res.status(404).json({ success: false, error: 'Attachment file not found' });
    }

    let contentType = '';
    let originalName = attachmentId;
    if (fs.existsSync(found.metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(found.metaPath, 'utf-8'));
        if (meta.appId && meta.appId !== appId) {
          return res.status(403).json({ success: false, error: 'Attachment application mismatch' });
        }
        if (meta.contentType && meta.contentType !== 'application/octet-stream') {
          contentType = String(meta.contentType);
        }
        if (meta.originalName) {
          originalName = String(meta.originalName);
        }
      } catch {}
    }

    const fileBuf = fs.readFileSync(found.filePath);
    if (!contentType) {
      const detected = detectAttachmentFileType(fileBuf);
      contentType =
        detected.contentType ||
        inferMimeTypeFromExtension(originalName) ||
        inferMimeTypeFromExtension(found.resolvedAttachmentId) ||
        'application/octet-stream';
    }

    const safeHeaderName = String(originalName || found.resolvedAttachmentId || 'attachment')
      .replace(/[\r\n"\\]/g, '_')
      .trim() || 'attachment';
    const asciiFallback = safeHeaderName.replace(/[^\x20-\x7e]/g, '_');

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeHeaderName)}`
    );
    return res.send(fileBuf);
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleGetOperatorAttachment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve attachment' });
  }
}

/**
 * POST /api/applications/:appId/verify-payment
 * Allows verified Application Owner (or Admin) to complete post-work Razorpay payment
 * without granting customers direct RTDB write access to paymentStatus.
 */
export async function handleVerifyApplicationPayment(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const appId = cleanText(req.params.appId, 120);
    if (!appId || /[/.#$[\]]/.test(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID' });
    }

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing Razorpay verification fields' });
    }

    const app = await readApplication(appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    // Operators are strictly forbidden from modifying payment records or marking payments complete
    if (caller.role !== 'admin' && !isCallerOwnerOfApp(app, caller)) {
      return res.status(403).json({ success: false, error: 'Only the application owner or Admin can complete payment' });
    }

    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!isTestMode()) {
      if (!keySecret) {
        return res.status(503).json({ success: false, error: 'Razorpay secret not configured on server' });
      }
      const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(String(razorpay_signature), 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(400).json({ success: false, error: 'Invalid Razorpay signature' });
      }
    } else if (String(razorpay_signature) !== 'test_valid_sig') {
      return res.status(400).json({ success: false, error: 'Invalid test Razorpay signature' });
    }

    const nowIso = new Date().toISOString();
    if (isTestMode()) {
      const store = readTestStore();
      store.applications[appId] = {
        ...store.applications[appId],
        paymentStatus: 'completed',
        paymentMethod: 'razorpay',
        razorpayPaymentId: String(razorpay_payment_id),
        razorpayOrderId: String(razorpay_order_id),
        updatedAt: nowIso,
      };
      writeTestStore(store);
    } else if (ensureAdminInit() && rtdbAdmin) {
      await withTimeout(
        rtdbAdmin.ref(`applications/${appId}`).update({
          paymentStatus: 'completed',
          paymentMethod: 'razorpay',
          razorpayPaymentId: String(razorpay_payment_id),
          razorpayOrderId: String(razorpay_order_id),
          updatedAt: nowIso,
        }),
        8000,
        'Update application payment status'
      );
    }

    const obx = enqueueOutboxNotification({
      idempotencyKey: `app_payment:${appId}:${String(razorpay_payment_id)}`,
      kind: 'application_payment',
      appId,
      payload: {
        app: { ...app, paymentStatus: 'completed', paymentMethod: 'razorpay' },
        transactionId: String(razorpay_payment_id),
        paymentMethod: 'razorpay',
        razorpayOrderId: String(razorpay_order_id),
        timestamp: nowIso,
      },
      maxAttempts: 5,
    });

    return res.json({
      success: true,
      paymentStatus: 'completed',
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleVerifyApplicationPayment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify application payment' });
  }
}

/**
 * POST /api/applications/:appId/assign
 * Admin-only operator assignment / reassignment with non-blocking async notifications
 */
export async function handleAssignApplicationOperator(req: Request, res: Response) {
  try {
    const caller = await requireAdminCaller(req, res);
    if (!caller) return;

    const appId = cleanText(req.params.appId, 120);
    if (!appId || /[/.#$[\]]/.test(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID' });
    }

    const body = req.body || {};
    const requestedUid = typeof body.operatorUid === 'string' ? body.operatorUid.trim() : '';
    const requestedEmail = typeof body.operatorEmail === 'string' ? normalizeEmailAddress(body.operatorEmail) : '';

    const app = await readApplication(appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    let newOperator: { uid: string; email: string; name: string } | null = null;
    if (requestedUid || requestedEmail) {
      const profile = await findOperatorProfile({ operatorUid: requestedUid, operatorEmail: requestedEmail });
      if (!profile) {
        return res.status(404).json({ success: false, error: 'Target operator user account not found' });
      }
      if (profile.disabled) {
        return res.status(400).json({ success: false, error: 'Cannot assign to a disabled user account' });
      }
      if (profile.role !== 'operator' && profile.role !== 'admin') {
        return res.status(400).json({ success: false, error: 'Target user does not have operator or admin role' });
      }
      newOperator = { uid: profile.uid, email: profile.email, name: profile.name };
    }

    let previousOperator: { uid?: string; email?: string; name?: string } | null = null;
    if (app.assignedToUid || app.assignedTo) {
      const prevProfile = app.assignedToUid ? await readUserProfile(String(app.assignedToUid)) : null;
      previousOperator = {
        uid: prevProfile?.uid || (app.assignedToUid ? String(app.assignedToUid) : undefined),
        email: prevProfile?.email || normalizeEmailAddress(app.assignedTo),
        name: prevProfile?.name || (app.assignedTo ? String(app.assignedTo).split('@')[0] : undefined),
      };
    }

    const nowIso = new Date().toISOString();
    const updates = {
      assignedTo: newOperator ? newOperator.email : '',
      assignedToUid: newOperator ? newOperator.uid : '',
      updatedAt: nowIso,
    };

    if (isTestMode()) {
      const store = readTestStore();
      store.applications[appId] = { ...store.applications[appId], ...updates };
      writeTestStore(store);
    } else if (ensureAdminInit() && rtdbAdmin) {
      await withTimeout(rtdbAdmin.ref(`applications/${appId}`).update(updates), 8000, 'Assign operator');
    } else {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: 'Firebase Admin credentials not configured on server' });
    }

    const obx = enqueueOutboxNotification({
      idempotencyKey: `app_assigned:${appId}:${newOperator?.uid || 'none'}:${nowIso}`,
      kind: 'application_assigned',
      appId,
      payload: {
        app: { ...app, ...updates },
        newOperator,
        previousOperator,
        assignedBy: { uid: caller.uid, name: caller.name, email: caller.email, role: caller.role },
        timestamp: nowIso,
      },
      maxAttempts: 5,
    });

    return res.json({
      success: true,
      assignedTo: updates.assignedTo,
      assignedToUid: updates.assignedToUid,
      updatedAt: nowIso,
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleAssignApplicationOperator error:', err);
    return res.status(500).json({ success: false, error: 'Failed to assign application operator' });
  }
}

/**
 * POST /api/applications/:appId/payment-status
 * Admin-only application payment status toggle with non-blocking async emails
 */
export async function handleAdminUpdateApplicationPaymentStatus(req: Request, res: Response) {
  try {
    const caller = await requireAdminCaller(req, res);
    if (!caller) return;

    const appId = cleanText(req.params.appId, 120);
    if (!appId || /[/.#$[\]]/.test(appId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID' });
    }

    const paymentStatus = typeof req.body?.paymentStatus === 'string' ? req.body.paymentStatus.trim() : '';
    if (paymentStatus !== 'pending' && paymentStatus !== 'completed') {
      return res.status(400).json({ success: false, error: 'paymentStatus must be "pending" or "completed"' });
    }

    const app = await readApplication(appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    const previousPaymentStatus = String(app.paymentStatus || 'pending');
    const nowIso = new Date().toISOString();

    if (isTestMode()) {
      const store = readTestStore();
      store.applications[appId] = { ...store.applications[appId], paymentStatus, updatedAt: nowIso };
      writeTestStore(store);
    } else if (ensureAdminInit() && rtdbAdmin) {
      await withTimeout(rtdbAdmin.ref(`applications/${appId}`).update({ paymentStatus, updatedAt: nowIso }), 8000, 'Update paymentStatus');
    } else {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: 'Firebase Admin credentials not configured on server' });
    }

    let obxJobId: string | undefined;
    if (paymentStatus === 'completed' && previousPaymentStatus !== 'completed') {
      const obx = enqueueOutboxNotification({
        idempotencyKey: `app_payment:${appId}:${String(app.razorpayPaymentId || nowIso)}`,
        kind: 'application_payment',
        appId,
        payload: {
          app: { ...app, paymentStatus },
          transactionId: String(app.razorpayPaymentId || `ADMIN-${Date.now()}`),
          paymentMethod: app.paymentMethod || 'manual_admin',
          timestamp: nowIso,
        },
        maxAttempts: 5,
      });
      obxJobId = obx.job.jobId;
    }

    return res.json({
      success: true,
      paymentStatus,
      updatedAt: nowIso,
      notificationQueued: Boolean(obxJobId),
      ...(obxJobId ? { outboxJobId: obxJobId } : {}),
      emailDelivery: obxJobId ? buildQueuedEmailDeliverySummary(obxJobId) : null,
    });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleAdminUpdateApplicationPaymentStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update application payment status' });
  }
}

/**
 * POST /api/applications/upload-attachment
 * Authenticated attachment upload for service application form documents (resilient fallback when Firebase Storage fails)
 */
export async function handleUploadApplicationAttachment(req: Request, res: Response) {
  const requestId = (req as any).requestId || `att_${Date.now().toString(36)}`;
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkPublicNotificationRateLimit('app-upload-att', `${caller.uid}:${clientIp}`, 30, 60000)) {
      return res.status(429).json({ success: false, code: 'RATE_LIMITED', stage: 'upload_rate_limit', requestId, error: 'Too many file uploads. Please wait a moment.' });
    }

    const file = (req as any).file;
    if (!file || !file.buffer || file.size <= 0) {
      return res.status(400).json({ success: false, code: 'MISSING_FILE', stage: 'upload_validate', requestId, error: 'Attachment file is required.' });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return res.status(400).json({ success: false, code: 'FILE_TOO_LARGE', stage: 'upload_validate', requestId, error: 'File exceeds the 5 MB limit.' });
    }

    const buf: Buffer = file.buffer;
    const detected = detectAttachmentFileType(buf);
    if (!detected.ok || !detected.ext || !detected.contentType) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_FILE_TYPE',
        stage: 'upload_validate',
        requestId,
        error: 'Unsupported file format. Only valid PDF, JPG, PNG, and WEBP files are allowed.',
      });
    }

    const safeOriginal = sanitizeFilename(file.originalname || `document.${detected.ext}`);
    const attachmentId = `appatt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${detected.ext}`;
    const userDir = path.join(getApplicationAttachmentsDir(), sanitizeFilename(caller.uid));
    writeAttachmentAtomically(userDir, attachmentId, buf, {
      attachmentId,
      uploadedByUid: caller.uid,
      originalName: safeOriginal,
      contentType: detected.contentType,
      size: buf.length,
      createdAt: new Date().toISOString(),
    });

    const downloadUrl = `/api/applications/attachments/${encodeURIComponent(attachmentId)}`;
    return res.json({
      success: true,
      url: downloadUrl,
      attachmentName: safeOriginal,
      requestId,
    });
  } catch (err: any) {
    logStructuredAppError({ req, stage: 'upload_attachment', status: 500, code: 'UPLOAD_FAILED', err });
    return res.status(500).json({ success: false, code: 'UPLOAD_FAILED', stage: 'upload_attachment', requestId, error: 'Failed to upload document. Please try again.' });
  }
}

function findStoredApplicationAttachment(attachmentId: string, preferredUid?: string): {
  filePath: string;
  metaPath: string;
  meta: Record<string, any> | null;
} | null {
  if (!isSafeAttachmentId(attachmentId)) return null;
  const rootDir = getApplicationAttachmentsDir();
  if (!fs.existsSync(rootDir)) return null;

  const tryUserDir = (dirName: string) => {
    const userDir = path.resolve(rootDir, dirName);
    if (!userDir.startsWith(rootDir + path.sep)) return null;
    const filePath = path.resolve(userDir, attachmentId);
    if (!filePath.startsWith(userDir + path.sep)) return null;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const metaPath = `${filePath}.meta.json`;
      let meta: Record<string, any> | null = null;
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
      }
      return { filePath, metaPath, meta };
    }
    return null;
  };

  if (preferredUid) {
    const direct = tryUserDir(sanitizeFilename(preferredUid));
    if (direct) return direct;
  }

  try {
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const hit = tryUserDir(entry.name);
      if (hit) return hit;
    }
  } catch {}
  return null;
}

/**
 * GET /api/applications/attachments/:attachmentId
 * Authorized retrieval for initial application uploads (uploader, admin, or assigned operator with appId)
 */
export async function handleGetApplicationAttachment(req: Request, res: Response) {
  const requestId = (req as any).requestId || `getatt_${Date.now().toString(36)}`;
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const attachmentId = safeDecodeURIComponent(String(req.params.attachmentId || '')).split('?')[0];
    if (!isSafeAttachmentId(attachmentId)) {
      return res.status(400).json({ success: false, code: 'INVALID_ATTACHMENT_ID', stage: 'get_attachment', requestId, error: 'Invalid attachment reference' });
    }

    const found = findStoredApplicationAttachment(attachmentId, caller.uid);
    if (!found) {
      return res.status(404).json({ success: false, code: 'ATTACHMENT_NOT_FOUND', stage: 'get_attachment', requestId, error: 'Attachment file not found' });
    }

    const ownerUid = String(found.meta?.uploadedByUid || '');
    let allowed = caller.role === 'admin' || (ownerUid && ownerUid === caller.uid);
    if (!allowed && caller.role === 'operator') {
      const appId = extractQueryString(req.query.appId, 120);
      if (appId && isValidAppId(appId)) {
        const app = await readApplication(appId, caller.idToken).catch(() => null);
        if (app && isCallerAssignedToApp(app, caller)) {
          allowed = true;
        }
      }
    }

    if (!allowed) {
      return res.status(403).json({ success: false, code: 'ACCESS_DENIED', stage: 'get_attachment', requestId, error: 'Access denied to this attachment' });
    }

    const fileBuf = fs.readFileSync(found.filePath);
    const detected = detectAttachmentFileType(fileBuf);
    const contentType =
      (found.meta?.contentType && found.meta.contentType !== 'application/octet-stream' ? String(found.meta.contentType) : '') ||
      detected.contentType ||
      inferMimeTypeFromExtension(attachmentId) ||
      'application/octet-stream';
    const originalName = String(found.meta?.originalName || attachmentId).replace(/[\r\n"\\]/g, '_').trim() || 'attachment';
    const asciiFallback = originalName.replace(/[^\x20-\x7e]/g, '_');

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`
    );
    return res.send(fileBuf);
  } catch (err: any) {
    logStructuredAppError({ req, stage: 'get_attachment', status: 500, code: 'ATTACHMENT_READ_FAILED', err });
    return res.status(500).json({ success: false, code: 'ATTACHMENT_READ_FAILED', stage: 'get_attachment', requestId, error: 'Failed to retrieve attachment' });
  }
}

function isAllowedApplicationAttachmentUrl(val: string): boolean {
  return (
    val.startsWith('https://') ||
    val.startsWith('/api/applications/attachments/') ||
    val.startsWith('/api/operator/attachments/')
  );
}

function normalizeServiceSlug(text: string): string {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeRtdbFieldKey(key: string): string {
  return cleanText(key, 120).replace(/[/.#$[\]]/g, '').trim();
}

const PENDING_DRAFTS_STORE_PATH = path.join(APP_ROOT, 'data/pending_applications_store.json');
let pendingDraftsMap: Map<string, any> | null = null;
let pendingDraftsFlushTimer: NodeJS.Timeout | null = null;
let pendingDraftsDirty = false;
let pendingDraftsWriting = false;

function getPendingDraftsMap(): Map<string, any> {
  if (pendingDraftsMap) return pendingDraftsMap;
  const map = new Map<string, any>();
  try {
    if (fs.existsSync(PENDING_DRAFTS_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(PENDING_DRAFTS_STORE_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        const now = Date.now();
        for (const [k, v] of Object.entries(parsed)) {
          if (v && typeof v === 'object') {
            const ageMs = now - new Date((v as any).date || 0).getTime();
            if (!Number.isFinite(ageMs) || ageMs <= 7 * 24 * 60 * 60 * 1000) {
              map.set(k, v);
            }
          }
        }
      }
    }
  } catch {}
  pendingDraftsMap = map;
  return map;
}

let pendingDraftsInFlightFlush: Promise<void> | null = null;

async function flushPendingDraftsToDisk(throwOnError = false): Promise<void> {
  if (pendingDraftsInFlightFlush) {
    await pendingDraftsInFlightFlush;
    if (!pendingDraftsDirty) return;
  }
  if (!pendingDraftsDirty || !pendingDraftsMap) return;
  pendingDraftsDirty = false;
  const run = (async () => {
    try {
      const obj: Record<string, any> = {};
      for (const [k, v] of pendingDraftsMap!.entries()) {
        obj[k] = v;
      }
      const snapshot = JSON.stringify(obj, null, 2);
      await fs.promises.mkdir(path.dirname(PENDING_DRAFTS_STORE_PATH), { recursive: true });
      const tmp = `${PENDING_DRAFTS_STORE_PATH}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
      await fs.promises.writeFile(tmp, snapshot, 'utf-8');
      await fs.promises.rename(tmp, PENDING_DRAFTS_STORE_PATH);
    } catch (err) {
      pendingDraftsDirty = true;
      if (throwOnError) throw err;
      console.warn('[operatorService] Pending drafts flush notice:', err);
    } finally {
      pendingDraftsWriting = false;
      pendingDraftsInFlightFlush = null;
      if (pendingDraftsDirty && !throwOnError) {
        schedulePendingDraftsFlush();
      }
    }
  })();
  pendingDraftsWriting = true;
  pendingDraftsInFlightFlush = run;
  await run;
}

function schedulePendingDraftsFlush() {
  pendingDraftsDirty = true;
  if (pendingDraftsFlushTimer) return;
  pendingDraftsFlushTimer = setTimeout(() => {
    pendingDraftsFlushTimer = null;
    void flushPendingDraftsToDisk(false);
  }, 100);
  if (typeof pendingDraftsFlushTimer.unref === 'function') pendingDraftsFlushTimer.unref();
}

async function savePendingDraftDurably(appId: string, pendingDraft: Record<string, any>): Promise<void> {
  const sanitizedDraft = stripUndefinedDeep(pendingDraft);

  if (isTestMode()) {
    const fbMode = testPaymentInitBehavior.firebaseWriteMode || 'ok';
    if (fbMode === 'permission_denied') {
      throw Object.assign(new Error('PERMISSION_DENIED: Permission denied while saving pending application.'), {
        statusCode: 403,
        code: 'FIREBASE_PERMISSION_DENIED',
        stage: 'save_pending_application',
      });
    }
    if (fbMode === 'timeout') {
      throw Object.assign(new Error('Save pending application draft timed out after 8000ms'), {
        statusCode: 504,
        code: 'FIREBASE_WRITE_TIMEOUT',
        stage: 'save_pending_application',
      });
    }
    if (fbMode === 'reject') {
      throw Object.assign(new Error('Simulated RTDB write rejection on pendingApplications'), {
        statusCode: 503,
        code: 'FIREBASE_WRITE_FAILED',
        stage: 'save_pending_application',
      });
    }
    await runWithTestDbTiming(() => {
      const store = readTestStore();
      if (!store.pendingApplications) store.pendingApplications = {};
      store.pendingApplications[appId] = sanitizedDraft;
      writeTestStore(store);
    }, 'Save pending application draft');
    return;
  }

  if (ensureAdminInit() && rtdbAdmin) {
    try {
      await withTimeout(
        rtdbAdmin.ref(`pendingApplications/${appId}`).set(sanitizedDraft),
        8000,
        'Save pending application draft'
      );
      rtdbUsableCache = { usable: true, expiresAt: Date.now() + 30000 };
      return;
    } catch (err: any) {
      const msg = String(err?.message || 'Firebase RTDB write failed');
      const isTimeout = err?.name === 'TimeoutError' || msg.toLowerCase().includes('timed out');
      const isPermissionDenied = /permission[_\s-]?denied/i.test(msg) || /unauthorized/i.test(msg);
      throw Object.assign(err instanceof Error ? err : new Error(msg), {
        statusCode: isTimeout ? 504 : isPermissionDenied ? 403 : 503,
        code: isTimeout
          ? 'FIREBASE_WRITE_TIMEOUT'
          : isPermissionDenied
            ? 'FIREBASE_PERMISSION_DENIED'
            : 'FIREBASE_WRITE_FAILED',
        stage: 'save_pending_application',
      });
    }
  }

  // Fallback ONLY when Firebase Admin SDK is not initialized on host: await atomic local durable persistence
  try {
    const map = getPendingDraftsMap();
    if (map.size >= 5000) {
      const oldest = map.keys().next().value;
      if (oldest) map.delete(oldest);
    }
    map.set(appId, sanitizedDraft);
    pendingDraftsDirty = true;
    await flushPendingDraftsToDisk(true);
  } catch (err: any) {
    throw Object.assign(err instanceof Error ? err : new Error('Failed to durably persist pending application draft'), {
      statusCode: 503,
      code: 'PENDING_DRAFT_PERSISTENCE_FAILED',
      stage: 'save_pending_application',
    });
  }
}

async function loadPendingDraft(appId: string): Promise<any | null> {
  if (isTestMode()) {
    return readTestStore().pendingApplications?.[appId] || null;
  }
  if (ensureAdminInit() && rtdbAdmin) {
    try {
      const snap = await withTimeout(rtdbAdmin.ref(`pendingApplications/${appId}`).once('value'), 6000, 'Read pending application draft');
      if (snap.exists()) return snap.val();
    } catch {}
  }
  return getPendingDraftsMap().get(appId) || null;
}

function removeLocalPendingDraft(appId: string) {
  const map = getPendingDraftsMap();
  if (map.delete(appId)) {
    schedulePendingDraftsFlush();
  }
}

/**
 * Sanitize service application submission payload and calculate authoritative charge
 */
async function buildAndValidateApplicationDraft(params: {
  caller: { uid: string; email: string; name: string };
  body: any;
  paymentMethod: 'cash' | 'razorpay' | 'pay_after_work' | 'free';
}) {
  const { caller, body, paymentMethod } = params;
  const serviceId = cleanText(body?.serviceId, 120);
  const subserviceName = cleanText(body?.subserviceName, 160);
  const rawDetails =
    body?.details && typeof body.details === 'object' && !Array.isArray(body.details)
      ? body.details
      : body?.formData && typeof body.formData === 'object' && !Array.isArray(body.formData)
        ? body.formData
        : {};
  const profileName = cleanText(body?.name, 120) || caller.name || 'Customer';
  let profilePhone = cleanText(body?.phone, 24);

  if (!serviceId) {
    throw Object.assign(new Error('Service ID is required.'), { statusCode: 400, code: 'MISSING_SERVICE_ID', stage: 'validate_payload' });
  }

  const services = await loadServiceCatalog();
  const service = services.find(
    (s: any) => s?.id === serviceId || String(s?.name || '').toLowerCase() === String(body?.serviceName || '').toLowerCase()
  );

  let authoritativeName = cleanText(body?.serviceName, 160) || serviceId;
  let authoritativeCharge = Math.max(0, Number(body?.charge) || 0);
  let allowedMethods: string[] = ['razorpay', 'cash', 'pay_after_work', 'free'];
  let activeFields: any[] = [];

  if (service) {
    authoritativeName = cleanText(service.name, 160) || authoritativeName;
    if (Array.isArray(service.subservices) && service.subservices.length > 0) {
      if (!subserviceName) {
        throw Object.assign(new Error('Please select a sub-service.'), { statusCode: 400, code: 'MISSING_SUBSERVICE', stage: 'validate_service' });
      }
      const lowerSub = subserviceName.toLowerCase();
      const slugSub = normalizeServiceSlug(subserviceName);
      const sub =
        service.subservices.find((ss: any) => String(ss?.name || '').trim() === subserviceName) ||
        service.subservices.find((ss: any) => String(ss?.name || '').trim().toLowerCase() === lowerSub) ||
        service.subservices.find((ss: any) => normalizeServiceSlug(String(ss?.name || '')) === slugSub);
      if (!sub) {
        throw Object.assign(new Error('Selected service variant could not be found.'), { statusCode: 400, code: 'INVALID_SUBSERVICE', stage: 'validate_service' });
      }
      authoritativeCharge = Math.max(0, Number(sub.charge) || 0);
      if (Array.isArray(sub.paymentMethods) && sub.paymentMethods.length > 0) {
        allowedMethods = sub.paymentMethods;
      }
      activeFields = Array.isArray(sub.fields) && sub.fields.length > 0
        ? sub.fields
        : Array.isArray(service.fields)
          ? service.fields
          : [];
    } else {
      activeFields = Array.isArray(service.fields) ? service.fields : [];
      if (typeof service.charge === 'number') {
        authoritativeCharge = Math.max(0, Number(service.charge) || 0);
      }
      if (Array.isArray(service.paymentMethods) && service.paymentMethods.length > 0) {
        allowedMethods = service.paymentMethods;
      }
    }
  }

  if (authoritativeCharge > 0 && paymentMethod === 'free') {
    throw Object.assign(new Error('Free submission is only available for zero-charge services.'), {
      statusCode: 400,
      code: 'INVALID_PAYMENT_METHOD',
      stage: 'validate_payment_method',
    });
  }

  const normalizedAllowed = new Set(allowedMethods.map((m: string) => String(m || '').toLowerCase().trim()));
  if (normalizedAllowed.has('both')) {
    normalizedAllowed.add('cash');
    normalizedAllowed.add('razorpay');
  }
  if (normalizedAllowed.has('online')) {
    normalizedAllowed.add('razorpay');
  }

  if (authoritativeCharge > 0 && !normalizedAllowed.has(paymentMethod) && paymentMethod !== 'razorpay') {
    throw Object.assign(new Error(`Payment method "${paymentMethod}" is not enabled for this service.`), {
      statusCode: 400,
      code: 'INVALID_PAYMENT_METHOD',
      stage: 'validate_payment_method',
    });
  }

  // Sanitize details (limit field count and string size; strip RTDB-forbidden key characters; keep safe URLs)
  const sanitizedDetails: Record<string, any> = {};
  const normalizedKeyLookup = new Map<string, any>();
  const entries = Object.entries(rawDetails).slice(0, 60);
  let primaryFileUrl = '';
  for (const [k, v] of entries) {
    const cleanKey = sanitizeRtdbFieldKey(k);
    if (!cleanKey) continue;
    let storedVal: any;
    if (Array.isArray(v)) {
      const cleanedArr = v
        .slice(0, 10)
        .map(item => (typeof item === 'string' ? item.trim().slice(0, 1500) : ''))
        .filter(Boolean);
      storedVal = cleanedArr;
      if (!primaryFileUrl && cleanedArr.length > 0 && isAllowedApplicationAttachmentUrl(cleanedArr[0])) {
        primaryFileUrl = cleanedArr[0];
      }
    } else if (typeof v === 'string') {
      const cleanedVal = v.trim().slice(0, 2000);
      storedVal = cleanedVal;
      if (!primaryFileUrl && isAllowedApplicationAttachmentUrl(cleanedVal)) {
        primaryFileUrl = cleanedVal;
      }
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      storedVal = v;
    } else {
      continue;
    }
    sanitizedDetails[cleanKey] = storedVal;
    normalizedKeyLookup.set(cleanKey.replace(/\s+/g, '').toLowerCase(), storedVal);
  }

  if (!profilePhone) {
    const phoneCandidate =
      sanitizedDetails['Mobile Number'] ||
      sanitizedDetails['mobile'] ||
      sanitizedDetails['mobileNumber'] ||
      sanitizedDetails['Phone'] ||
      normalizedKeyLookup.get('mobilenumber') ||
      normalizedKeyLookup.get('mobile') ||
      '';
    if (typeof phoneCandidate === 'string') {
      profilePhone = cleanText(phoneCandidate, 24);
    }
  }

  if (!primaryFileUrl && typeof body?.fileUrl === 'string' && isAllowedApplicationAttachmentUrl(body.fileUrl.trim())) {
    primaryFileUrl = body.fileUrl.trim().slice(0, 1500);
  }

  // Validate required fields defined in matched service schema (supports label, RTDB-sanitized label, & name keys)
  for (const field of activeFields) {
    if (!field || field.required === false) continue;
    const labelKey = cleanText(field.label, 120);
    const sanitizedLabelKey = sanitizeRtdbFieldKey(labelKey);
    const nameKey = cleanText(field.name, 120);
    const sanitizedNameKey = sanitizeRtdbFieldKey(nameKey);
    const rawVal =
      (labelKey && sanitizedDetails[labelKey] !== undefined ? sanitizedDetails[labelKey] : undefined) ??
      (sanitizedLabelKey && sanitizedDetails[sanitizedLabelKey] !== undefined ? sanitizedDetails[sanitizedLabelKey] : undefined) ??
      (nameKey && sanitizedDetails[nameKey] !== undefined ? sanitizedDetails[nameKey] : undefined) ??
      (sanitizedNameKey && sanitizedDetails[sanitizedNameKey] !== undefined ? sanitizedDetails[sanitizedNameKey] : undefined) ??
      (labelKey ? normalizedKeyLookup.get(sanitizedLabelKey.replace(/\s+/g, '').toLowerCase()) : undefined);
    const isEmpty =
      rawVal === undefined ||
      rawVal === null ||
      (Array.isArray(rawVal) ? rawVal.length === 0 : String(rawVal).trim().length === 0);
    if (isEmpty) {
      throw Object.assign(new Error(`${labelKey || nameKey || 'Required field'} is required.`), {
        statusCode: 400,
        code: 'MISSING_REQUIRED_FIELD',
        stage: 'validate_fields',
      });
    }
  }

  return {
    serviceId: service?.id || serviceId,
    serviceName: authoritativeName,
    subserviceName: subserviceName || undefined,
    charge: authoritativeCharge,
    paymentMethod,
    name: profileName,
    phone: profilePhone,
    email: caller.email,
    uid: caller.uid,
    details: sanitizedDetails,
    fileUrl: primaryFileUrl || undefined,
  };
}

const inFlightApplicationCreates = new Map<string, Promise<{ status: number; body: any }>>();
const inFlightPaymentCreates = new Map<string, Promise<{ status: number; body: any }>>();
const createdGatewayOrdersByDedupKey = new Map<
  string,
  {
    appId: string;
    razorpayOrderId: string;
    amountPaise: number;
    charge: number;
    serviceId: string;
    subserviceName?: string;
    keyId: string;
    createdAt: number;
  }
>();

function rememberGatewayOrderForDedup(
  dedupKey: string | undefined,
  entry: {
    appId: string;
    razorpayOrderId: string;
    amountPaise: number;
    charge: number;
    serviceId: string;
    subserviceName?: string;
    keyId: string;
  }
) {
  if (!dedupKey) return;
  if (createdGatewayOrdersByDedupKey.size >= 2000) {
    const first = createdGatewayOrdersByDedupKey.keys().next().value;
    if (first) createdGatewayOrdersByDedupKey.delete(first);
  }
  createdGatewayOrdersByDedupKey.set(dedupKey, { ...entry, createdAt: Date.now() });
}

async function findExistingPendingDraftByClientRequestId(
  uid: string,
  clientRequestId: string
): Promise<any | null> {
  if (!uid || !clientRequestId) return null;
  if (isTestMode()) {
    const store = readTestStore();
    return (
      Object.values(store.pendingApplications || {}).find(
        (p: any) => p && p.uid === uid && p.clientRequestId === clientRequestId && p.razorpayOrderId
      ) || null
    );
  }
  if (ensureAdminInit() && rtdbAdmin) {
    try {
      const snap = await withTimeout(
        rtdbAdmin.ref('pendingApplications').orderByChild('uid').equalTo(uid).once('value'),
        5000,
        'Lookup existing pending payment draft'
      );
      if (snap.exists()) {
        const match = Object.values(snap.val() || {}).find(
          (p: any) => p && p.clientRequestId === clientRequestId && p.razorpayOrderId
        );
        if (match) return match;
      }
    } catch {}
  }
  for (const draft of getPendingDraftsMap().values()) {
    if (draft && draft.uid === uid && draft.clientRequestId === clientRequestId && draft.razorpayOrderId) {
      return draft;
    }
  }
  return null;
}

async function persistNewApplicationDurably(
  appId: string,
  appRecord: Record<string, any>,
  caller: VerifiedCaller
): Promise<void> {
  const cleanRecord = stripUndefinedDeep(appRecord);
  if (isTestMode()) {
    const store = readTestStore();
    store.applications[appId] = cleanRecord;
    writeTestStore(store);
    return;
  }
  if (ensureAdminInit() && rtdbAdmin) {
    await withTimeout(rtdbAdmin.ref(`applications/${appId}`).set(cleanRecord), 8000, 'Save service application');
    return;
  }
  if (caller.idToken) {
    const resp = await fetch(
      `${getRtdbUrl()}/applications/${encodeURIComponent(appId)}.json?auth=${encodeURIComponent(caller.idToken)}`,
      {
        method: 'PUT',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanRecord),
      }
    );
    if (resp.ok) {
      return;
    }
    const errText = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403) {
      throw Object.assign(new Error('You do not have permission to submit this application. Please sign in again.'), {
        statusCode: 403,
        code: 'RTDB_PERMISSION_DENIED',
        stage: 'db_commit_rest',
      });
    }
    throw Object.assign(new Error(`Database write failed (${resp.status})${errText ? ': ' + errText.slice(0, 120) : ''}`), {
      statusCode: 503,
      code: 'RTDB_WRITE_FAILED',
      stage: 'db_commit_rest',
    });
  }
  throw Object.assign(new Error('Database service is temporarily unavailable on server.'), {
    statusCode: 503,
    code: 'FIREBASE_ADMIN_UNCONFIGURED',
    stage: 'db_commit',
  });
}

/**
 * POST /api/applications
 * Server-authoritative application creation for Free / Cash / Pay After Work submissions
 */
export async function handleCreateApplication(req: Request, res: Response) {
  const requestId = (req as any).requestId || `app_${Date.now().toString(36)}`;
  let callerUid: string | undefined;
  const serviceIdForLog = cleanText(req.body?.serviceId, 120);
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;
    callerUid = caller.uid;

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkPublicNotificationRateLimit('create-app', `${caller.uid}:${clientIp}`, 20, 60000)) {
      return res.status(429).json({ success: false, code: 'RATE_LIMITED', stage: 'rate_limit', requestId, error: 'Too many submissions. Please wait a moment.' });
    }

    const body = req.body || {};
    const rawMethod = String(body.paymentMethod || 'cash').trim();
    const paymentMethod: 'cash' | 'pay_after_work' | 'free' =
      rawMethod === 'pay_after_work'
        ? 'pay_after_work'
        : rawMethod === 'free'
          ? 'free'
          : 'cash';
    const clientRequestId = cleanText(body.clientRequestId || body.idempotencyKey, 120);
    const dedupKey = clientRequestId ? `app_create:${caller.uid}:${clientRequestId}` : undefined;

    const cached = checkAppIdempotency(dedupKey);
    if (cached) {
      return res.status(200).json({ ...cached, duplicate: true, requestId });
    }

    if (dedupKey && inFlightApplicationCreates.has(dedupKey)) {
      const pendingOut = await inFlightApplicationCreates.get(dedupKey)!;
      return res.status(200).json({ ...pendingOut.body, duplicate: true, requestId });
    }

    const executeCreate = async (): Promise<{ status: number; body: any }> => {
      const draft = await buildAndValidateApplicationDraft({ caller, body, paymentMethod });
      if (rawMethod === 'razorpay' && draft.charge > 0) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'PAYMENT_FLOW_REQUIRED',
            stage: 'validate_payment_method',
            requestId,
            error: 'Paid Razorpay applications must go through /api/applications/create-payment and /confirm-payment.',
          },
        };
      }

      if (isTestMode() && clientRequestId) {
        const store = readTestStore();
        const existing = Object.values(store.applications || {}).find((a: any) => a?.uid === caller.uid && a?.clientRequestId === clientRequestId);
        if (existing) {
          const dupResult = { success: true, duplicate: true, appId: existing.id, application: existing, notificationQueued: true, requestId };
          recordAppIdempotency(dedupKey, dupResult);
          return { status: 200, body: dupResult };
        }
      }

      const nowIso = new Date().toISOString();
      const appId = `ICC-APP-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const paymentStatus: 'pending' | 'completed' = draft.charge === 0 ? 'completed' : 'pending';

      const appRecord: Record<string, any> = {
        id: appId,
        uid: caller.uid,
        userId: caller.uid,
        name: draft.name,
        email: draft.email,
        ...(draft.phone ? { phone: draft.phone } : {}),
        serviceId: draft.serviceId,
        serviceName: draft.serviceName,
        ...(draft.subserviceName ? { subserviceName: draft.subserviceName } : {}),
        charge: draft.charge,
        status: 'processing',
        paymentStatus,
        paymentMethod: draft.paymentMethod,
        details: draft.details,
        ...(draft.fileUrl ? { fileUrl: draft.fileUrl } : {}),
        date: nowIso,
        updatedAt: nowIso,
        ...(clientRequestId ? { clientRequestId } : {}),
        notes: {
          [`init_${Date.now()}`]: {
            type: 'status',
            by: 'System',
            email: 'system@indiacybercafe.com',
            text: draft.charge === 0
              ? 'Application submitted (no service fee).'
              : draft.paymentMethod === 'pay_after_work'
                ? 'Application submitted with Pay After Work.'
                : 'Application submitted with Cash / Pay at Center.',
            time: nowIso,
            createdAt: Date.now(),
          },
        },
      };

      await persistNewApplicationDurably(appId, appRecord, caller);

      const obx = enqueueOutboxNotification({
        idempotencyKey: `app_submitted:${appId}`,
        kind: 'application_submitted',
        appId,
        payload: { app: appRecord, timestamp: nowIso },
        maxAttempts: 5,
      });

      const result = {
        success: true,
        appId,
        application: appRecord,
        notificationQueued: true,
        outboxJobId: obx.job.jobId,
        emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
        requestId,
      };
      recordAppIdempotency(dedupKey, result);
      return { status: 201, body: result };
    };

    const runPromise = executeCreate();
    if (dedupKey) {
      inFlightApplicationCreates.set(dedupKey, runPromise);
    }
    try {
      const outcome = await runPromise;
      return res.status(outcome.status).json(outcome.body);
    } finally {
      if (dedupKey && inFlightApplicationCreates.get(dedupKey) === runPromise) {
        inFlightApplicationCreates.delete(dedupKey);
      }
    }
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || String(err?.message || '').toLowerCase().includes('timed out');
    const status = err?.statusCode || (isTimeout ? 504 : 500);
    const code = err?.code || (isTimeout ? 'DB_TIMEOUT' : status >= 500 ? 'APPLICATION_SUBMIT_FAILED' : 'VALIDATION_ERROR');
    const stage = err?.stage || (isTimeout ? 'db_timeout' : 'handle_create_application');
    logStructuredAppError({ req, stage, status, code, uid: callerUid, serviceId: serviceIdForLog, err });
    return res.status(status).json({
      success: false,
      code,
      stage,
      requestId,
      error: status >= 500 && !err?.statusCode ? 'Failed to submit application. Please try again.' : (err?.message || 'Failed to submit application.'),
    });
  }
}

/**
 * POST /api/applications/create-payment
 * Persists a durable pending application draft and creates a server-verified Razorpay order BEFORE opening checkout
 */
export async function handleCreateApplicationPayment(req: Request, res: Response) {
  const requestId = (req as any).requestId || `pay_${Date.now().toString(36)}`;
  let callerUid: string | undefined;
  let currentStage = 'verify_auth';
  let currentAppId: string | undefined;
  let gatewayModeForLog: string | undefined;
  const serviceIdForLog = cleanText(req.body?.serviceId, 120);

  const buildErrorPayload = (opts: {
    status: number;
    code: string;
    stage: string;
    error: string;
    err?: unknown;
    message?: string;
    httpStatus?: number;
    gatewayCode?: string;
    gatewayDescription?: string;
  }) => {
    const rawErr = opts.err as any;
    logStructuredAppError({
      req,
      stage: opts.stage,
      status: opts.status,
      code: opts.code,
      uid: callerUid,
      serviceId: serviceIdForLog,
      appId: currentAppId,
      httpStatus: opts.httpStatus,
      gatewayCode: opts.gatewayCode,
      gatewayDescription: opts.gatewayDescription,
      gatewayMode: gatewayModeForLog,
      errorName: rawErr?.name,
      errorCode: rawErr?.code || rawErr?.cause?.code,
      err: opts.err,
      message: opts.message || opts.error,
    });
    return {
      status: opts.status,
      body: {
        success: false,
        code: opts.code,
        stage: opts.stage,
        requestId,
        error: opts.error,
      },
    };
  };

  try {
    currentStage = 'verify_auth';
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;
    callerUid = caller.uid;

    currentStage = 'rate_limit';
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkPublicNotificationRateLimit('create-app-payment', `${caller.uid}:${clientIp}`, 15, 60000)) {
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        stage: 'rate_limit',
        requestId,
        error: 'Too many payment attempts. Please wait a minute.',
      });
    }

    const body = req.body || {};
    const clientRequestId = cleanText(body.clientRequestId || body.idempotencyKey, 120);
    const dedupKey = clientRequestId ? `app_create_pay:${caller.uid}:${clientRequestId}` : undefined;

    if (dedupKey && inFlightPaymentCreates.has(dedupKey)) {
      const pendingOut = await inFlightPaymentCreates.get(dedupKey)!;
      if (pendingOut.status >= 200 && pendingOut.status < 300) {
        return res.status(200).json({ ...pendingOut.body, duplicate: true, requestId });
      }
      return res.status(pendingOut.status).json({ ...pendingOut.body, requestId });
    }

    const executeCreatePayment = async (): Promise<{ status: number; body: any }> => {
      currentStage = 'validate_application';
      const draft = await buildAndValidateApplicationDraft({ caller, body, paymentMethod: 'razorpay' });

      currentStage = 'validate_charge';
      if (draft.charge <= 0) {
        return buildErrorPayload({
          status: 400,
          code: 'ZERO_CHARGE_SERVICE',
          stage: 'validate_charge',
          error: 'This service has ₹0 fee and does not require online payment.',
        });
      }

      const amountPaise = Math.round(draft.charge * 100);
      if (!Number.isInteger(amountPaise) || amountPaise < 100 || amountPaise > 10000000) {
        return buildErrorPayload({
          status: 400,
          code: 'INVALID_PAYMENT_AMOUNT',
          stage: 'validate_charge',
          error: 'Calculated service charge is outside valid online payment limits.',
          message: `Invalid amountPaise=${amountPaise}`,
        });
      }

      const cached = checkAppIdempotency(dedupKey);
      if (
        cached &&
        Number(cached.amount) === amountPaise &&
        (!cached.serviceId || cached.serviceId === draft.serviceId)
      ) {
        return { status: 200, body: { ...cached, duplicate: true, requestId } };
      }

      currentStage = 'preflight_payment';
      if (clientRequestId) {
        const existingPending = await findExistingPendingDraftByClientRequestId(caller.uid, clientRequestId);
        if (
          existingPending &&
          existingPending.serviceId === draft.serviceId &&
          Number(existingPending.amountPaise) === amountPaise &&
          typeof existingPending.razorpayOrderId === 'string' &&
          existingPending.razorpayOrderId
        ) {
          const fallbackKeyId = normalizeEnvSecret(process.env.RAZORPAY_KEY_ID) || 'rzp_test_key';
          const dupResult = {
            success: true,
            duplicate: true,
            appId: existingPending.id,
            serviceId: existingPending.serviceId,
            razorpayOrderId: existingPending.razorpayOrderId,
            order_id: existingPending.razorpayOrderId,
            amount: amountPaise,
            amountInRupees: draft.charge,
            currency: 'INR',
            keyId: fallbackKeyId,
            requestId,
          };
          recordAppIdempotency(dedupKey, dupResult);
          return { status: 200, body: dupResult };
        }
      }

      const keyId = normalizeEnvSecret(process.env.RAZORPAY_KEY_ID);
      const keySecret = normalizeEnvSecret(process.env.RAZORPAY_KEY_SECRET);
      gatewayModeForLog = keyId.startsWith('rzp_test_')
        ? 'test'
        : keyId.startsWith('rzp_live_')
          ? 'live'
          : keyId
            ? 'unknown'
            : 'unconfigured';

      const adminReady = isTestMode() ? true : ensureAdminInit();
      if (!isTestMode() && !adminReady && !caller.idToken) {
        return buildErrorPayload({
          status: 503,
          code: 'FIREBASE_ADMIN_UNCONFIGURED',
          stage: 'preflight_db',
          error: 'Online payment checkout is temporarily unavailable because server database access is not ready.',
          message: 'Neither Firebase Admin SDK nor caller ID token available before payment order creation',
        });
      }

      const recoveredOrder = dedupKey ? createdGatewayOrdersByDedupKey.get(dedupKey) : undefined;
      const canReuseRecoveredOrder = Boolean(
        recoveredOrder &&
          Date.now() - recoveredOrder.createdAt < 30 * 60 * 1000 &&
          recoveredOrder.serviceId === draft.serviceId &&
          (recoveredOrder.subserviceName || '') === (draft.subserviceName || '') &&
          recoveredOrder.amountPaise === amountPaise
      );

      let appId = canReuseRecoveredOrder
        ? recoveredOrder!.appId
        : `ICC-APP-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      currentAppId = appId;
      let razorpayOrderId = canReuseRecoveredOrder ? recoveredOrder!.razorpayOrderId : '';
      let responseKeyId = canReuseRecoveredOrder ? recoveredOrder!.keyId : keyId;

      if (!razorpayOrderId) {
        if (isTestMode()) {
          const rzpSim = testPaymentInitBehavior.razorpayMode || 'ok';
          if (rzpSim === 'unconfigured') {
            return buildErrorPayload({
              status: 503,
              code: 'RAZORPAY_UNCONFIGURED',
              stage: 'preflight_payment',
              error: 'Payment gateway is not configured on the server.',
              message: 'Simulated RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing',
            });
          }
          currentStage = 'razorpay_create_order';
          if (rzpSim === 'network_error') {
            return buildErrorPayload({
              status: 502,
              code: 'RAZORPAY_NETWORK_ERROR',
              stage: 'razorpay_create_order',
              error: 'Unable to reach the payment gateway right now. Please try again shortly.',
              err: Object.assign(new Error('fetch failed: ECONNRESET'), { code: 'ECONNRESET' }),
            });
          }
          if (rzpSim === 'timeout') {
            return buildErrorPayload({
              status: 504,
              code: 'RAZORPAY_TIMEOUT',
              stage: 'razorpay_create_order',
              error: 'Payment gateway timed out before starting checkout. Please try again.',
              err: Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }),
            });
          }
          if (rzpSim === 'http_error') {
            const simStatus = testPaymentInitBehavior.razorpayStatus || 401;
            const simCode = testPaymentInitBehavior.razorpayErrorCode || 'BAD_REQUEST_ERROR';
            const simDesc = testPaymentInitBehavior.razorpayErrorDescription || 'Authentication failed';
            return buildErrorPayload({
              status: 502,
              code: 'RAZORPAY_ORDER_FAILED',
              stage: 'razorpay_create_order',
              error: 'Unable to start online payment right now. Please try again shortly.',
              httpStatus: simStatus,
              gatewayCode: simCode,
              gatewayDescription: simDesc,
              message: `Razorpay HTTP ${simStatus}: ${simCode} - ${simDesc}`,
            });
          }
          currentStage = 'razorpay_parse_response';
          if (rzpSim === 'invalid_json') {
            return buildErrorPayload({
              status: 502,
              code: 'RAZORPAY_INVALID_RESPONSE',
              stage: 'razorpay_parse_response',
              error: 'Received an invalid response from the payment gateway. Please try again.',
              httpStatus: 200,
              err: new SyntaxError('Unexpected token < in JSON at position 0'),
            });
          }
          if (rzpSim === 'missing_order_id') {
            return buildErrorPayload({
              status: 502,
              code: 'RAZORPAY_INVALID_RESPONSE',
              stage: 'razorpay_parse_response',
              error: 'Payment gateway returned an incomplete order response. Please try again.',
              httpStatus: 200,
              message: 'Razorpay response JSON missing valid order id',
            });
          }
          razorpayOrderId = `order_test_app_${crypto.randomBytes(6).toString('hex')}`;
          responseKeyId = keyId || 'rzp_test_key';
        } else {
          if (!keyId || !keySecret || keyId.length < 12 || keySecret.length < 10) {
            return buildErrorPayload({
              status: 503,
              code: 'RAZORPAY_UNCONFIGURED',
              stage: 'preflight_payment',
              error: 'Payment gateway is not configured on the server.',
              message: !keyId || !keySecret
                ? 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing'
                : 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET has invalid length/format',
            });
          }
          if (!keyId.startsWith('rzp_test_') && !keyId.startsWith('rzp_live_')) {
            return buildErrorPayload({
              status: 503,
              code: 'RAZORPAY_UNCONFIGURED',
              stage: 'preflight_payment',
              error: 'Payment gateway credentials on the server have an unrecognized format.',
              message: 'RAZORPAY_KEY_ID must begin with rzp_test_ or rzp_live_',
            });
          }

          currentStage = 'razorpay_create_order';
          const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
          let rzpResp: globalThis.Response;
          try {
            rzpResp = await fetch('https://api.razorpay.com/v1/orders', {
              method: 'POST',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount: amountPaise,
                currency: 'INR',
                receipt: appId.slice(0, 40),
                notes: {
                  kind: 'service_application',
                  appId,
                  uid: caller.uid,
                  serviceId: draft.serviceId,
                },
              }),
              signal: AbortSignal.timeout(10000),
            });
          } catch (fetchErr: any) {
            const msg = String(fetchErr?.message || '');
            const isTimeout =
              fetchErr?.name === 'TimeoutError' ||
              fetchErr?.name === 'AbortError' ||
              msg.toLowerCase().includes('timed out');
            return buildErrorPayload({
              status: isTimeout ? 504 : 502,
              code: isTimeout ? 'RAZORPAY_TIMEOUT' : 'RAZORPAY_NETWORK_ERROR',
              stage: 'razorpay_create_order',
              error: isTimeout
                ? 'Payment gateway timed out before starting checkout. Please try again.'
                : 'Unable to reach the payment gateway right now. Please try again shortly.',
              err: fetchErr,
            });
          }

          if (!rzpResp.ok) {
            const rawErrText = await rzpResp.text().catch(() => '');
            let errData: any = {};
            try {
              errData = rawErrText ? JSON.parse(rawErrText) : {};
            } catch {}
            const gatewayCode = typeof errData?.error?.code === 'string' ? errData.error.code : undefined;
            const gatewayDesc =
              typeof errData?.error?.description === 'string'
                ? errData.error.description
                : rawErrText
                  ? rawErrText.slice(0, 200)
                  : `Razorpay HTTP ${rzpResp.status}`;
            return buildErrorPayload({
              status: 502,
              code: 'RAZORPAY_ORDER_FAILED',
              stage: 'razorpay_create_order',
              error: 'Unable to start online payment right now. Your filled form details remain saved.',
              httpStatus: rzpResp.status,
              gatewayCode,
              gatewayDescription: gatewayDesc,
              message: `Razorpay order failed (${rzpResp.status}${gatewayCode ? ` ${gatewayCode}` : ''}): ${gatewayDesc}`,
            });
          }

          currentStage = 'razorpay_parse_response';
          let rzpOrder: any;
          try {
            const rawBodyText = await rzpResp.text();
            rzpOrder = JSON.parse(rawBodyText);
          } catch (parseErr: any) {
            return buildErrorPayload({
              status: 502,
              code: 'RAZORPAY_INVALID_RESPONSE',
              stage: 'razorpay_parse_response',
              error: 'Received an invalid response from the payment gateway. Please try again.',
              httpStatus: rzpResp.status,
              err: parseErr,
            });
          }

          if (!rzpOrder || typeof rzpOrder.id !== 'string' || !rzpOrder.id.trim().startsWith('order_')) {
            return buildErrorPayload({
              status: 502,
              code: 'RAZORPAY_INVALID_RESPONSE',
              stage: 'razorpay_parse_response',
              error: 'Payment gateway returned an incomplete order response. Please try again.',
              httpStatus: rzpResp.status,
              message: `Razorpay response missing valid order id (keys=${rzpOrder && typeof rzpOrder === 'object' ? Object.keys(rzpOrder).join(',') : typeof rzpOrder})`,
            });
          }

          razorpayOrderId = rzpOrder.id.trim();
          responseKeyId = keyId;
        }

        rememberGatewayOrderForDedup(dedupKey, {
          appId,
          razorpayOrderId,
          amountPaise,
          charge: draft.charge,
          serviceId: draft.serviceId,
          subserviceName: draft.subserviceName,
          keyId: responseKeyId,
        });
      }

      currentStage = 'save_pending_application';
      const nowIso = new Date().toISOString();
      const pendingDraft = stripUndefinedDeep({
        ...draft,
        id: appId,
        razorpayOrderId,
        amountPaise,
        status: 'pending_payment',
        paymentStatus: 'pending',
        date: nowIso,
        updatedAt: nowIso,
        ...(clientRequestId ? { clientRequestId } : {}),
      });

      try {
        await savePendingDraftDurably(appId, pendingDraft);
      } catch (saveErr: any) {
        const msg = String(saveErr?.message || '');
        const isTimeout =
          saveErr?.name === 'TimeoutError' ||
          saveErr?.code === 'FIREBASE_WRITE_TIMEOUT' ||
          msg.toLowerCase().includes('timed out');
        const isPerm =
          saveErr?.code === 'FIREBASE_PERMISSION_DENIED' ||
          /permission[_\s-]?denied/i.test(msg);
        return buildErrorPayload({
          status: saveErr?.statusCode || (isTimeout ? 504 : isPerm ? 403 : 503),
          code:
            saveErr?.code ||
            (isTimeout
              ? 'FIREBASE_WRITE_TIMEOUT'
              : isPerm
                ? 'FIREBASE_PERMISSION_DENIED'
                : 'FIREBASE_WRITE_FAILED'),
          stage: 'save_pending_application',
          error: isTimeout
            ? 'Payment session confirmation timed out. Please keep this page open and try again.'
            : 'Unable to confirm your payment session right now. Please keep this page open and try again.',
          err: saveErr,
        });
      }

      currentStage = 'finalize_response';
      const result = {
        success: true,
        appId,
        serviceId: draft.serviceId,
        razorpayOrderId,
        order_id: razorpayOrderId,
        amount: amountPaise,
        amountInRupees: draft.charge,
        currency: 'INR',
        keyId: responseKeyId || 'rzp_test_key',
        requestId,
      };
      recordAppIdempotency(dedupKey, result);
      return { status: 201, body: result };
    };

    const runPromise = executeCreatePayment();
    if (dedupKey) {
      inFlightPaymentCreates.set(dedupKey, runPromise);
    }
    try {
      const outcome = await runPromise;
      return res.status(outcome.status).json(outcome.body);
    } finally {
      if (dedupKey && inFlightPaymentCreates.get(dedupKey) === runPromise) {
        inFlightPaymentCreates.delete(dedupKey);
      }
    }
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || String(err?.message || '').toLowerCase().includes('timed out');
    const status = err?.statusCode || (isTimeout ? 504 : 500);
    const code = err?.code || (isTimeout ? 'GATEWAY_TIMEOUT' : 'PAYMENT_INIT_FAILED');
    const stage = err?.stage || currentStage || 'handle_create_application_payment';
    logStructuredAppError({
      req,
      stage,
      status,
      code,
      uid: callerUid,
      serviceId: serviceIdForLog,
      appId: currentAppId,
      gatewayMode: gatewayModeForLog,
      errorName: err?.name,
      errorCode: err?.code,
      err,
    });
    return res.status(status).json({
      success: false,
      code,
      stage,
      requestId,
      error:
        status >= 500 && !err?.statusCode
          ? 'Unable to start online payment right now. Please keep this page open and try again.'
          : err?.message || 'Unable to start online payment right now.',
    });
  }
}

async function finalizePendingApplicationRecord(params: {
  appId: string;
  pendingDraft: any;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  callerIdToken?: string;
}): Promise<any> {
  const { appId, pendingDraft, razorpayOrderId, razorpayPaymentId, callerIdToken } = params;
  const nowIso = new Date().toISOString();

  const existingCommitted = await readApplication(appId, callerIdToken).catch(() => null);
  if (existingCommitted && existingCommitted.paymentStatus === 'completed') {
    removeLocalPendingDraft(appId);
    return existingCommitted;
  }

  const finalRecord: Record<string, any> = stripUndefinedDeep({
    ...(pendingDraft || {}),
    id: appId,
    uid: pendingDraft?.uid || '',
    userId: pendingDraft?.uid || '',
    status: 'processing',
    paymentStatus: 'completed',
    paymentMethod: 'razorpay',
    razorpayOrderId,
    razorpayPaymentId,
    date: pendingDraft?.date || nowIso,
    updatedAt: nowIso,
    notes: {
      [`pay_${Date.now()}`]: {
        type: 'status',
        by: 'System',
        email: 'system@indiacybercafe.com',
        text: `Application submitted and payment verified via Razorpay (${razorpayPaymentId}).`,
        time: nowIso,
        createdAt: Date.now(),
      },
    },
  });

  if (isTestMode()) {
    const store = readTestStore();
    store.applications[appId] = finalRecord;
    if (store.pendingApplications) delete store.pendingApplications[appId];
    store.payments[`pay_${razorpayPaymentId}`] = {
      id: `pay_${razorpayPaymentId}`,
      amount: Number(finalRecord.charge) || 0,
      currency: 'INR',
      paymentId: razorpayPaymentId,
      orderId: appId,
      razorpayOrderId,
      status: 'completed',
      type: 'service_application',
      createdAt: nowIso,
    };
    writeTestStore(store);
  } else if (ensureAdminInit() && rtdbAdmin) {
    const payKey = `app_${appId}_${razorpayPaymentId}`.replace(/[/.#$[\]]/g, '_');
    await withTimeout(
      rtdbAdmin.ref().update({
        [`applications/${appId}`]: finalRecord,
        [`pendingApplications/${appId}`]: null,
        [`payments/${payKey}`]: {
          id: payKey,
          amount: Number(finalRecord.charge) || 0,
          currency: 'INR',
          paymentId: razorpayPaymentId,
          orderId: appId,
          razorpayOrderId,
          status: 'completed',
          type: 'service_application',
          createdAt: nowIso,
        },
      }),
      8000,
      'Commit verified application'
    );
    removeLocalPendingDraft(appId);
  } else if (callerIdToken) {
    const resp = await fetch(
      `${getRtdbUrl()}/applications/${encodeURIComponent(appId)}.json?auth=${encodeURIComponent(callerIdToken)}`,
      {
        method: 'PUT',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalRecord),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw Object.assign(
        new Error(`Database commit failed (${resp.status})${errText ? ': ' + errText.slice(0, 120) : ''}`),
        {
          statusCode: resp.status === 401 || resp.status === 403 ? 403 : 503,
          code: resp.status === 401 || resp.status === 403 ? 'RTDB_PERMISSION_DENIED' : 'RTDB_WRITE_FAILED',
          stage: 'commit_payment_rest',
        }
      );
    }
    removeLocalPendingDraft(appId);
  } else {
    throw Object.assign(new Error('Database service is temporarily unavailable to commit paid application.'), {
      statusCode: 503,
      code: 'FIREBASE_ADMIN_UNCONFIGURED',
      stage: 'commit_payment',
    });
  }

  enqueueOutboxNotification({
    idempotencyKey: `app_submitted:${appId}`,
    kind: 'application_submitted',
    appId,
    payload: { app: finalRecord, timestamp: nowIso },
    maxAttempts: 5,
  });

  return finalRecord;
}

/**
 * POST /api/applications/:appId/confirm-payment
 * Atomically verifies Razorpay signature + amount and commits the application in RTDB
 */
export async function handleConfirmApplicationPayment(req: Request, res: Response) {
  const requestId = (req as any).requestId || `conf_${Date.now().toString(36)}`;
  let callerUid: string | undefined;
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;
    callerUid = caller.uid;

    const appId = cleanText(req.params.appId, 120);
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
    if (!appId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ success: false, verified: false, code: 'MISSING_PAYMENT_FIELDS', stage: 'confirm_validate', requestId, error: 'Missing payment verification details.' });
    }

    const existingApp = await readApplication(appId, caller.idToken).catch(() => null);
    if (existingApp) {
      if (caller.role !== 'admin' && !isCallerOwnerOfApp(existingApp, caller)) {
        return res.status(403).json({ success: false, verified: false, code: 'ACCESS_DENIED', stage: 'confirm_authz', requestId, error: 'Access denied' });
      }
      if (existingApp.paymentStatus === 'completed') {
        return res.json({ success: true, verified: true, appId, application: existingApp, notificationQueued: true, requestId });
      }
    }

    const pendingDraft = await loadPendingDraft(appId);

    if (!pendingDraft) {
      return res.status(404).json({ success: false, verified: false, code: 'PENDING_DRAFT_NOT_FOUND', stage: 'confirm_read_draft', requestId, error: 'Pending application draft not found or expired.' });
    }
    if (caller.role !== 'admin' && pendingDraft.uid !== caller.uid) {
      return res.status(403).json({ success: false, verified: false, code: 'ACCESS_DENIED', stage: 'confirm_authz', requestId, error: 'Access denied.' });
    }
    if (pendingDraft.razorpayOrderId && pendingDraft.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ success: false, verified: false, code: 'ORDER_ID_MISMATCH', stage: 'confirm_validate', requestId, error: 'Order ID mismatch.' });
    }

    const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!isTestMode()) {
      if (!keySecret) {
        return res.status(503).json({ success: false, verified: false, code: 'RAZORPAY_UNCONFIGURED', stage: 'confirm_secret', requestId, error: 'Payment secret is not configured.' });
      }
      const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(String(razorpay_signature), 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(400).json({ success: false, verified: false, code: 'INVALID_PAYMENT_SIGNATURE', stage: 'confirm_signature', requestId, error: 'Invalid payment signature.' });
      }
      if (keyId && pendingDraft.amountPaise) {
        try {
          const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
          const pResp = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(String(razorpay_payment_id))}`, {
            headers: { Authorization: authHeader },
            signal: AbortSignal.timeout(6000),
          });
          if (pResp.ok) {
            const pData: any = await pResp.json();
            if (pData.order_id && pData.order_id !== razorpay_order_id) {
              return res.status(400).json({ success: false, verified: false, code: 'ORDER_MISMATCH', stage: 'confirm_gateway', requestId, error: 'Payment does not belong to this order.' });
            }
            if (typeof pData.amount === 'number' && pData.amount !== Number(pendingDraft.amountPaise)) {
              return res.status(400).json({ success: false, verified: false, code: 'AMOUNT_MISMATCH', stage: 'confirm_gateway', requestId, error: 'Paid amount mismatch.' });
            }
          }
        } catch {}
      }
    } else {
      const testSecret = keySecret || 'test_rzp_secret';
      const expectedTestSig = crypto
        .createHmac('sha256', testSecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      const a = Buffer.from(expectedTestSig, 'utf8');
      const b = Buffer.from(String(razorpay_signature), 'utf8');
      const validTestHmac = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!validTestHmac && String(razorpay_signature) !== 'test_valid_sig') {
        return res.status(400).json({ success: false, verified: false, code: 'INVALID_PAYMENT_SIGNATURE', stage: 'confirm_signature', requestId, error: 'Invalid test payment signature.' });
      }
    }

    const finalApp = await finalizePendingApplicationRecord({
      appId,
      pendingDraft,
      razorpayOrderId: String(razorpay_order_id),
      razorpayPaymentId: String(razorpay_payment_id),
      callerIdToken: caller.idToken,
    });

    return res.status(200).json({
      success: true,
      verified: true,
      appId,
      application: finalApp,
      notificationQueued: true,
      emailDelivery: buildQueuedEmailDeliverySummary(),
      requestId,
    });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    const code = err?.code || 'CONFIRM_PAYMENT_FAILED';
    const stage = err?.stage || 'confirm_payment';
    logStructuredAppError({ req, stage, status, code, uid: callerUid, err });
    return res.status(status).json({ success: false, verified: false, code, stage, requestId, error: status >= 500 && !err?.statusCode ? 'Failed to confirm application payment.' : (err?.message || 'Failed to confirm application payment.') });
  }
}

/**
 * POST /api/applications/:appId/recover-payment
 * Recovers a paid service application if the browser tab closed before /confirm-payment finished
 */
export async function handleRecoverApplicationPayment(req: Request, res: Response) {
  const requestId = (req as any).requestId || `rec_${Date.now().toString(36)}`;
  let callerUid: string | undefined;
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;
    callerUid = caller.uid;

    const appId = cleanText(req.params.appId, 120);
    const existingApp = await readApplication(appId, caller.idToken).catch(() => null);
    if (existingApp) {
      if (caller.role !== 'admin' && !isCallerOwnerOfApp(existingApp, caller)) {
        return res.status(403).json({ success: false, code: 'ACCESS_DENIED', stage: 'recover_authz', requestId, error: 'Access denied' });
      }
      return res.json({ success: true, verified: existingApp.paymentStatus === 'completed', appId, application: existingApp, requestId });
    }

    const pendingDraft = await loadPendingDraft(appId);

    if (!pendingDraft || (caller.role !== 'admin' && pendingDraft.uid !== caller.uid)) {
      return res.status(404).json({ success: false, code: 'DRAFT_NOT_FOUND', stage: 'recover_read_draft', requestId, error: 'Application draft not found.' });
    }

    const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keyId || !keySecret || isTestMode() || !pendingDraft.razorpayOrderId) {
      return res.json({ success: false, verified: false, code: 'PAYMENT_PENDING', stage: 'recover_gateway', requestId, error: 'Payment is still pending.' });
    }

    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const resp = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(pendingDraft.razorpayOrderId)}/payments`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      return res.status(502).json({ success: false, code: 'RAZORPAY_LOOKUP_FAILED', stage: 'recover_gateway', requestId, error: 'Failed to check payment status.' });
    }
    const data: any = await resp.json();
    const expectedPaise = Number(pendingDraft.amountPaise) || Math.round((Number(pendingDraft.charge) || 0) * 100);
    const captured = (data.items || []).find(
      (p: any) => (p.status === 'captured' || p.status === 'authorized') && p.currency === 'INR' && p.amount === expectedPaise
    );
    if (!captured) {
      return res.json({ success: false, verified: false, code: 'PAYMENT_NOT_CAPTURED', stage: 'recover_gateway', requestId, error: 'No captured payment found yet.' });
    }

    const finalApp = await finalizePendingApplicationRecord({
      appId,
      pendingDraft,
      razorpayOrderId: pendingDraft.razorpayOrderId,
      razorpayPaymentId: captured.id,
      callerIdToken: caller.idToken,
    });
    return res.json({ success: true, verified: true, appId, application: finalApp, notificationQueued: true, requestId });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    const code = err?.code || 'RECOVER_PAYMENT_FAILED';
    const stage = err?.stage || 'recover_payment';
    logStructuredAppError({ req, stage, status, code, uid: callerUid, err });
    return res.status(status).json({ success: false, code, stage, requestId, error: 'Failed to recover application payment.' });
  }
}

export async function reconcilePendingApplicationFromWebhook(params: {
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  amountPaise?: number;
  notes?: Record<string, any>;
}): Promise<boolean> {
  const { razorpayOrderId, razorpayPaymentId, amountPaise, notes } = params;
  const candidateAppId = notes?.appId ? cleanText(String(notes.appId), 120) : '';

  if (isTestMode()) {
    const store = readTestStore();
    const match = candidateAppId
      ? store.pendingApplications?.[candidateAppId]
      : Object.values(store.pendingApplications || {}).find((p: any) => p?.razorpayOrderId === razorpayOrderId);
    if (!match) return false;
    if (typeof amountPaise === 'number' && match.amountPaise && amountPaise !== Number(match.amountPaise)) return false;
    await finalizePendingApplicationRecord({
      appId: match.id,
      pendingDraft: match,
      razorpayOrderId,
      razorpayPaymentId: razorpayPaymentId || razorpayOrderId,
    });
    return true;
  }

  if (!ensureAdminInit() || !rtdbAdmin) return false;
  let pendingDraft: any = null;
  if (candidateAppId) {
    const snap = await withTimeout(rtdbAdmin.ref(`pendingApplications/${candidateAppId}`).once('value'), 5000, 'Read webhook pending app');
    if (snap.exists()) pendingDraft = snap.val();
  }
  if (!pendingDraft) {
    const snap = await withTimeout(
      rtdbAdmin.ref('pendingApplications').orderByChild('razorpayOrderId').equalTo(razorpayOrderId).limitToFirst(1).once('value'),
      5000,
      'Query webhook pending app'
    ).catch(() => null);
    if (snap?.exists()) {
      const first = Object.values(snap.val() || {})[0];
      if (first) pendingDraft = first;
    }
  }
  if (!pendingDraft) return false;
  if (typeof amountPaise === 'number' && pendingDraft.amountPaise && amountPaise !== Number(pendingDraft.amountPaise)) {
    return false;
  }
  await finalizePendingApplicationRecord({
    appId: pendingDraft.id,
    pendingDraft,
    razorpayOrderId,
    razorpayPaymentId: razorpayPaymentId || razorpayOrderId,
  });
  return true;
}

/**
 * POST /api/profile/update
 * Server-authoritative user profile update with phone collision check, phone index sync, and async notification
 */
export async function handleProfileUpdate(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkPublicNotificationRateLimit('profile-update', `${caller.uid}:${clientIp}`, 20, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many profile updates. Please wait a minute.' });
    }

    const body = req.body || {};
    const avatarOnly = Boolean(body.avatarOnly);
    const avatar = typeof body.avatar === 'string' && /^https:\/\//i.test(body.avatar.trim()) ? body.avatar.trim().slice(0, 1024) : undefined;
    const existingProfile = await readUserProfile(caller.uid);

    if (avatarOnly) {
      if (!avatar) {
        return res.status(400).json({ success: false, error: 'A valid avatar URL is required.' });
      }
      const nowMs = Date.now();
      const avatarUpdates: Record<string, any> = {
        avatar,
        customAvatar: true,
        updatedAt: nowMs,
      };
      if (isTestMode()) {
        const store = readTestStore();
        store.users[caller.uid] = { ...(store.users[caller.uid] || { uid: caller.uid, email: caller.email, role: caller.role }), ...avatarUpdates };
        writeTestStore(store);
      } else if (ensureAdminInit() && rtdbAdmin) {
        await withTimeout(rtdbAdmin.ref(`users/${caller.uid}`).update(avatarUpdates), 8000, 'Save profile avatar');
      } else {
        return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: 'Firebase Admin credentials not configured on server' });
      }
      const obx = enqueueOutboxNotification({
        idempotencyKey: `profile_avatar:${caller.uid}:${nowMs}`,
        kind: 'profile_updated',
        payload: {
          uid: caller.uid,
          userName: existingProfile?.name || caller.name || 'Customer',
          userEmail: existingProfile?.email || caller.email,
          updateType: 'Profile Picture',
        },
        maxAttempts: 4,
      });
      return res.json({
        success: true,
        profile: { ...(existingProfile || {}), ...avatarUpdates },
        notificationQueued: true,
        outboxJobId: obx.job.jobId,
        emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
      });
    }

    const name = cleanText(body.name, 120);
    const rawPhone = String(body.phone || '').replace(/\D/g, '');
    const digitsPhone =
      rawPhone.startsWith('91') && rawPhone.length === 12
        ? rawPhone.slice(2)
        : rawPhone.startsWith('0') && rawPhone.length === 11
          ? rawPhone.slice(1)
          : rawPhone;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required.' });
    }
    if (!/^[6-9]\d{9}$/.test(digitsPhone)) {
      return res.status(400).json({ success: false, error: 'Valid 10-digit Indian mobile number starting with 6–9 is required.' });
    }

    const address = cleanText(body.address, 400);
    const updateType = cleanText(body.updateType, 100) || 'Profile Details';
    const prevPhone = String(existingProfile?.phone || '').replace(/\D/g, '').slice(-10);

    const nowMs = Date.now();
    const updates: Record<string, any> = {
      name,
      phone: digitsPhone,
      address,
      profileCompleted: true,
      updatedAt: nowMs,
      ...(avatar ? { avatar, customAvatar: true } : {}),
    };

    if (isTestMode()) {
      const store = readTestStore();
      const collision = Object.values(store.users || {}).find(
        (u: any) => u && u.uid !== caller.uid && String(u.phone || '').replace(/\D/g, '').slice(-10) === digitsPhone
      );
      if (collision) {
        return res.status(409).json({ success: false, error: 'This mobile number is already linked to another account.' });
      }
      store.users[caller.uid] = { ...(store.users[caller.uid] || { uid: caller.uid, email: caller.email, role: caller.role }), ...updates };
      writeTestStore(store);
    } else if (ensureAdminInit() && rtdbAdmin) {
      const idxSnap = await withTimeout(rtdbAdmin.ref(`phoneIndex/${digitsPhone}`).once('value'), 5000, 'Check phone uniqueness');
      if (idxSnap.exists() && idxSnap.val()?.uid && idxSnap.val()?.uid !== caller.uid) {
        return res.status(409).json({ success: false, error: 'This mobile number is already registered to another account.' });
      }
      const multiUpdates: Record<string, any> = {};
      for (const [k, v] of Object.entries(updates)) {
        multiUpdates[`users/${caller.uid}/${k}`] = v;
      }
      multiUpdates[`phoneIndex/${digitsPhone}`] = {
        uid: caller.uid,
        email: existingProfile?.email || caller.email,
        isGoogleOnly: (existingProfile?.authProvider || '') === 'google',
        updatedAt: nowMs,
      };
      if (prevPhone && prevPhone !== digitsPhone) {
        multiUpdates[`phoneIndex/${prevPhone}`] = null;
      }
      await withTimeout(rtdbAdmin.ref().update(multiUpdates), 8000, 'Save profile update');
    } else {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: 'Firebase Admin credentials not configured on server' });
    }

    const obx = enqueueOutboxNotification({
      idempotencyKey: `profile_update:${caller.uid}:${nowMs}`,
      kind: 'profile_updated',
      payload: {
        uid: caller.uid,
        userName: name,
        userEmail: existingProfile?.email || caller.email,
        updateType,
      },
      maxAttempts: 4,
    });

    return res.json({
      success: true,
      profile: { ...(existingProfile || {}), ...updates },
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (err: any) {
    console.error('[operatorService] handleProfileUpdate error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
}

/**
 * POST /api/notifications/application-submitted
 */
export async function handleNotifyApplicationSubmitted(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const appId = cleanText(req.body?.appId, 120);
    if (!appId || /[/.#$[\]]/.test(appId)) {
      return res.status(400).json({ success: false, error: 'Valid application ID is required' });
    }

    const app = await readApplication(appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    if (caller.role !== 'admin' && !isCallerOwnerOfApp(app, caller)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const obx = enqueueOutboxNotification({
      idempotencyKey: `app_submitted:${appId}`,
      kind: 'application_submitted',
      appId,
      payload: { app },
      maxAttempts: 5,
    });

    return res.json({
      success: true,
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleNotifyApplicationSubmitted error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send application notification' });
  }
}

/**
 * POST /api/notifications/registration
 */
export async function handleNotifyRegistration(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const isGoogle = Boolean(req.body?.isGoogle);
    const isGuestCheckout = Boolean(req.body?.isGuestCheckout);

    const profile = await readUserProfile(caller.uid);
    if (profile?.registrationNotified) {
      return res.json({
        success: true,
        alreadyNotified: true,
        notificationQueued: false,
        emailDelivery: { success: true, hasFailures: false, totalCount: 0, sentCount: 0, failedCount: 0, skippedDuplicateCount: 1, events: [] },
      });
    }

    if (isTestMode()) {
      const store = readTestStore();
      if (store.users?.[caller.uid]) {
        store.users[caller.uid].registrationNotified = true;
        writeTestStore(store);
      }
    } else if (ensureAdminInit() && rtdbAdmin && profile) {
      await withTimeout(rtdbAdmin.ref(`users/${caller.uid}/registrationNotified`).set(true), 4000, 'Mark registration notified').catch(() => {});
    }

    const obx = enqueueOutboxNotification({
      idempotencyKey: `registration:${caller.uid}`,
      kind: 'user_registration',
      payload: {
        uid: caller.uid,
        userName: profile?.name || caller.name,
        userEmail: profile?.email || caller.email,
        phone: profile?.phone,
        authProvider: isGoogle ? 'google' : (profile?.authProvider || 'password'),
        isGuestCheckout,
      },
      maxAttempts: 5,
    });

    return res.json({
      success: true,
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (err: any) {
    console.error('[operatorService] handleNotifyRegistration error:', err);
    return res.status(500).json({ success: false, error: 'Failed to process registration notification' });
  }
}

/**
 * POST /api/notifications/profile-updated
 */
export async function handleNotifyProfileUpdated(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const updateType = cleanText(req.body?.updateType, 100) || 'Profile Details';
    const profile = await readUserProfile(caller.uid);

    const obx = enqueueOutboxNotification({
      idempotencyKey: `profile_update:${caller.uid}:${updateType}:${Date.now()}`,
      kind: 'profile_updated',
      payload: {
        uid: caller.uid,
        userName: profile?.name || caller.name,
        userEmail: profile?.email || caller.email,
        updateType,
      },
      maxAttempts: 4,
    });

    return res.json({
      success: true,
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (err: any) {
    console.error('[operatorService] handleNotifyProfileUpdated error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send profile update notification' });
  }
}

/**
 * POST /api/notifications/review-submitted
 */
export async function handleNotifyReviewSubmitted(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const productId = cleanText(req.body?.productId, 120);
    const reviewText = cleanText(req.body?.reviewText, 2000);
    const rating = Number(req.body?.rating);

    if (!productId || !reviewText || reviewText.length < 3 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Valid productId, integer rating (1-5), and reviewText are required' });
    }

    let productName = cleanText(req.body?.productName, 160) || productId;
    if (!isTestMode() && ensureAdminInit() && rtdbAdmin) {
      try {
        const prodSnap = await withTimeout(rtdbAdmin.ref(`products/${productId}/name`).once('value'), 4000, 'Read product name');
        if (prodSnap.exists() && typeof prodSnap.val() === 'string') {
          productName = prodSnap.val();
        }
      } catch {}
    }

    const profile = await readUserProfile(caller.uid);
    const obx = enqueueOutboxNotification({
      idempotencyKey: `review_notify:${caller.uid}:${productId}:${Date.now()}`,
      kind: 'review_submitted',
      payload: {
        uid: caller.uid,
        productId,
        productName,
        customerName: profile?.name || caller.name,
        customerEmail: profile?.email || caller.email,
        rating,
        reviewText,
      },
      maxAttempts: 4,
    });

    return res.json({
      success: true,
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (err: any) {
    console.error('[operatorService] handleNotifyReviewSubmitted error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send review notification' });
  }
}

/**
 * POST /api/notifications/callback
 * Public rate-limited callback request persistence + non-blocking async email enqueue
 */
export async function handleNotifyCallback(req: Request, res: Response) {
  try {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkPublicNotificationRateLimit('callback', clientIp, 10, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many callback requests. Please wait a moment.' });
    }

    let mobile = cleanText(req.body?.mobileNumber, 20).replace(/\D/g, '');
    if (mobile.startsWith('91') && mobile.length === 12) mobile = mobile.slice(2);
    else if (mobile.startsWith('0') && mobile.length === 11) mobile = mobile.slice(1);

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ success: false, error: 'Valid 10-digit Indian mobile number is required' });
    }

    const caller = await verifyCallerWithRole(req);
    const customerName = cleanText(req.body?.name, 100) || (caller && !caller.disabled ? caller.name : undefined);
    const rawEmail = typeof req.body?.email === 'string' ? normalizeEmailAddress(req.body.email) : '';
    const customerEmail = isValidEmailAddress(rawEmail)
      ? rawEmail
      : caller && !caller.disabled && isValidEmailAddress(caller.email)
        ? caller.email
        : undefined;

    const cbId = `cb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const cbRecord = {
      id: cbId,
      mobileNumber: mobile,
      ...(customerName ? { customerName } : {}),
      ...(customerEmail ? { customerEmail } : {}),
      ...(caller?.uid ? { uid: caller.uid } : {}),
      createdAt: nowIso,
    };

    if (isTestMode()) {
      const store = readTestStore();
      if (!store.callbacks) store.callbacks = {};
      store.callbacks[cbId] = cbRecord;
      writeTestStore(store);
    } else if (ensureAdminInit() && rtdbAdmin) {
      await withTimeout(rtdbAdmin.ref(`callbackRequests/${cbId}`).set(cbRecord), 4000, 'Save callback request').catch(() => {});
    }

    const obx = enqueueOutboxNotification({
      idempotencyKey: `callback:${mobile}:${Math.floor(Date.now() / 60000)}`,
      kind: 'callback_request',
      payload: {
        mobileNumber: mobile,
        customerName,
        customerEmail,
      },
      maxAttempts: 4,
    });

    return res.json({
      success: true,
      callbackId: cbId,
      notificationQueued: true,
      outboxJobId: obx.job.jobId,
      emailDelivery: buildQueuedEmailDeliverySummary(obx.job.jobId),
    });
  } catch (err: any) {
    console.error('[operatorService] handleNotifyCallback error:', err);
    return res.status(500).json({ success: false, error: 'Failed to submit callback notification' });
  }
}

/**
 * GET /api/admin/notifications
 */
export async function handleListNotificationEvents(req: Request, res: Response) {
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;

  const stateParam = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  const validStates = new Set<NotificationDeliveryState>(['queued', 'sent_to_smtp', 'failed', 'retried']);
  const state = validStates.has(stateParam as NotificationDeliveryState) ? (stateParam as NotificationDeliveryState) : undefined;
  const appId = cleanText(req.query.appId, 120) || undefined;
  const orderId = cleanText(req.query.orderId, 120) || undefined;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);

  const events = getNotificationEvents({ state, appId, orderId, limit });
  return res.json({ success: true, events });
}

/**
 * POST /api/admin/notifications/:eventId/retry
 * Retries a previously failed email without mutating application or order database records
 */
export async function handleRetryNotificationEvent(req: Request, res: Response) {
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;

  const eventId = cleanText(req.params.eventId, 120);
  if (!eventId) {
    return res.status(400).json({ success: false, error: 'Valid eventId is required' });
  }

  const result = await retryNotificationEvent(eventId);
  if (!result.found) {
    return res.status(404).json({ success: false, error: 'Notification event not found' });
  }

  return res.json({ success: true, event: result.event });
}

/**
 * GET /api/admin/queue/stats
 */
export async function handleGetQueueStats(req: Request, res: Response) {
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;
  return res.json({
    success: true,
    queue: getQueueStats(),
    outbox: getNotificationOutboxStats(),
  });
}

/**
 * GET /api/admin/queue/dlq
 */
export async function handleListDlqJobs(req: Request, res: Response) {
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
  return res.json({
    success: true,
    queueDlq: getDlqJobs(limit),
    outboxDlq: getOutboxDlqJobs(limit),
  });
}

/**
 * POST /api/admin/queue/:jobId/replay
 */
export async function handleReplayDlqJob(req: Request, res: Response) {
  const caller = await requireAdminCaller(req, res);
  if (!caller) return;
  const jobId = cleanText(req.params.jobId, 120);
  if (!jobId) {
    return res.status(400).json({ success: false, error: 'Valid jobId is required' });
  }
  const outboxRes = await replayOutboxJob(jobId);
  if (outboxRes.found) {
    return res.json({ success: true, source: 'outbox', job: outboxRes.job });
  }
  const queueRes = await replayDlqJob(jobId);
  if (queueRes.found) {
    return res.json({ success: true, source: 'asyncQueue', job: queueRes.job });
  }
  return res.status(404).json({ success: false, error: 'Queue/DLQ job not found' });
}

/**
 * POST /api/internal/workers/process
 * Push worker receiver for Cloud Tasks / PubSub HTTP workers
 */
export async function handleInternalWorkerProcess(req: Request, res: Response) {
  const expectedSecret = (process.env.INTERNAL_WORKER_SECRET || '').trim();
  const providedSecret = String(req.headers['x-worker-secret'] || '').trim();
  if (expectedSecret) {
    const a = Buffer.from(expectedSecret, 'utf8');
    const b = Buffer.from(providedSecret, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ success: false, error: 'Unauthorized worker call' });
    }
  } else if (!isTestMode()) {
    // Allow fallback check via Admin token if shared secret isn't set
    const caller = await verifyCallerWithRole(req);
    if (!caller || caller.role !== 'admin') {
      return res.status(401).json({ success: false, error: 'Worker secret or Admin auth required' });
    }
  }

  let job = req.body?.job;
  if (!job && req.body?.message?.data) {
    try {
      const decoded = Buffer.from(String(req.body.message.data), 'base64').toString('utf-8');
      job = JSON.parse(decoded)?.job;
    } catch {}
  }
  if (!job || !job.jobId || !job.kind) {
    return res.status(400).json({ success: false, error: 'Invalid worker job payload' });
  }

  const outcome = await processPushWorkerJob(job);
  if (!outcome.ok) {
    return res.status(500).json({ success: false, error: outcome.error || 'Worker processing failed' });
  }
  return res.json({ success: true, jobId: job.jobId, state: outcome.job?.state });
}

