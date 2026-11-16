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
  notifyApplicationUpdate,
  notifyUserApplicationReply,
  notifyApplicationAssignment,
  notifyApplicationSubmitted,
  notifyApplicationPaymentConfirmed,
  notifyUserRegistration,
  notifyProfileUpdated,
  notifyCallbackRequest,
  notifyReviewSubmitted,
  getNotificationEvents,
  retryNotificationEvent,
  enqueueOutboxNotification,
  registerOutboxOperatorProfileResolver,
  normalizeEmailAddress,
  isValidEmailAddress,
  NotificationDeliveryState,
} from './emailNotificationService.js';

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
      const app = getApps().length
        ? getApps()[0]
        : initializeApp({
            ...(cred ? { credential: cred } : {}),
            projectId: parsed?.project_id || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
            databaseURL: (process.env.FIREBASE_DATABASE_URL || DEFAULT_RTDB_URL).replace(/\/+$/, ''),
          });
      rtdbAdmin = getDatabase(app);
      authAdmin = getAuth(app);
      hasAdminCredential = true;
      return true;
    }
  } catch (err: any) {
    console.warn('[operatorService] Admin SDK init notice:', err?.message || err);
  }
  return false;
}

ensureAdminInit();

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

const callbackRateLimitMap = new Map<string, { count: number; resetTime: number }>();
function checkPublicNotificationRateLimit(bucket: string, ip: string, maxRequests = 10, windowMs = 60000): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = callbackRateLimitMap.get(key);
  if (!entry || now > entry.resetTime) {
    callbackRateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count += 1;
  return true;
}

// Local test store helper (used ONLY when STORE_ORDER_TEST_MODE=1 or OPERATOR_TEST_MODE=1)
function readTestStore(): { users: Record<string, any>; applications: Record<string, any>; payments: Record<string, any> } {
  try {
    if (fs.existsSync(TEST_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(TEST_STORE_PATH, 'utf-8'));
    }
  } catch {}
  return { users: {}, applications: {}, payments: {} };
}

function writeTestStore(store: { users: Record<string, any>; applications: Record<string, any>; payments: Record<string, any> }) {
  fs.mkdirSync(path.dirname(TEST_STORE_PATH), { recursive: true });
  fs.writeFileSync(TEST_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

let testDbDelayMs = 0;
let testDbTimeoutMs = 8000;

export function setOperatorTestDbBehaviorForTesting(opts: { delayMs?: number; timeoutMs?: number }) {
  if (!isTestMode()) return;
  if (typeof opts.delayMs === 'number') testDbDelayMs = Math.max(0, opts.delayMs);
  if (typeof opts.timeoutMs === 'number') testDbTimeoutMs = Math.max(10, opts.timeoutMs);
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
    if (hasAdminCredential && authAdmin) {
      try {
        const decoded = await withTimeout(authAdmin.verifyIdToken(token), 5000, 'Verify Firebase ID token');
        uid = decoded.uid;
        email = (decoded.email || '').toLowerCase().trim();
        emailVerified = Boolean(decoded.email_verified);
        displayName = String(decoded.name || '');
      } catch {
        return null;
      }
    } else {
      try {
        const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAMTND9rIAw-76Oey3c7c43-TW2t6mxEfw';
        const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
          method: 'POST',
          signal: AbortSignal.timeout(6000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token }),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const user = data.users?.[0];
        if (!user?.localId) return null;
        uid = user.localId;
        email = (user.email || '').toLowerCase().trim();
        emailVerified = Boolean(user.emailVerified);
        displayName = String(user.displayName || '');
      } catch {
        return null;
      }
    }
  }

  // Resolve trusted profile & role from RTDB (or test store) — never trust client-supplied role
  let profile: any = null;
  if (isTestMode()) {
    const store = readTestStore();
    profile = store.users?.[uid] || null;
  } else if (ensureAdminInit() && rtdbAdmin) {
    try {
      const snap = await withTimeout(rtdbAdmin.ref(`users/${uid}`).once('value'), 5000, 'Fetch caller user profile');
      if (snap.exists()) profile = snap.val();
    } catch {
      // Fail closed if RTDB profile lookup errors for non-super-admin
      if (uid !== SUPER_ADMIN_UID && email !== SUPER_ADMIN_EMAIL) {
        return null;
      }
    }
  } else {
    // Without Admin SDK, fallback to RTDB REST only if SUPER_ADMIN or deny privileged operations
    if (uid === SUPER_ADMIN_UID || email === SUPER_ADMIN_EMAIL) {
      return {
        uid,
        email,
        emailVerified,
        name: displayName || 'Super Admin',
        role: 'admin',
        disabled: false,
      };
    }
    return {
      uid,
      email,
      emailVerified,
      name: displayName || email.split('@')[0] || 'User',
      role: 'user',
      disabled: false,
    };
  }

  const isSuper = uid === SUPER_ADMIN_UID || email === SUPER_ADMIN_EMAIL;
  const disabled = Boolean(profile?.disabled === true);
  const rawRole = profile?.role;
  const role: 'user' | 'operator' | 'admin' = isSuper
    ? 'admin'
    : rawRole === 'admin' || rawRole === 'operator' || rawRole === 'user'
      ? rawRole
      : 'user';

  return {
    uid,
    email: (profile?.email || email || '').toLowerCase().trim(),
    emailVerified,
    name: String(profile?.name || displayName || email.split('@')[0] || 'User').trim(),
    role,
    disabled,
  };
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

async function readApplication(appId: string): Promise<any | null> {
  if (isTestMode()) {
    const store = readTestStore();
    return store.applications?.[appId] ? { id: appId, ...store.applications[appId] } : null;
  }
  if (!ensureAdminInit() || !rtdbAdmin) {
    throw Object.assign(new Error('Firebase Admin credentials not configured on server'), { code: 'FIREBASE_ADMIN_UNCONFIGURED', statusCode: 503 });
  }
  const snap = await withTimeout(rtdbAdmin.ref(`applications/${appId}`).once('value'), 6000, 'Read application');
  if (!snap.exists()) return null;
  return { id: appId, ...snap.val() };
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

    const emailDelivery = await notifyApplicationPaymentConfirmed({
      appId,
      app: { ...app, paymentStatus: 'completed' },
      transactionId: String(razorpay_payment_id),
      paymentMethod: 'razorpay',
      razorpayOrderId: String(razorpay_order_id),
      timestamp: nowIso,
    });

    return res.json({ success: true, paymentStatus: 'completed', emailDelivery });
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
 * Admin-only operator assignment / reassignment with role-separated emails
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

    const emailDelivery = await notifyApplicationAssignment({
      appId,
      app: { ...app, ...updates },
      newOperator,
      previousOperator,
      assignedBy: { uid: caller.uid, name: caller.name, email: caller.email, role: caller.role },
      timestamp: nowIso,
    });

    return res.json({
      success: true,
      assignedTo: updates.assignedTo,
      assignedToUid: updates.assignedToUid,
      updatedAt: nowIso,
      emailDelivery,
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
 * Admin-only application payment status toggle with confirmed payment emails
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

    let emailDelivery = null;
    if (paymentStatus === 'completed' && previousPaymentStatus !== 'completed') {
      emailDelivery = await notifyApplicationPaymentConfirmed({
        appId,
        app: { ...app, paymentStatus },
        transactionId: String(app.razorpayPaymentId || `ADMIN-${Date.now()}`),
        paymentMethod: app.paymentMethod || 'manual_admin',
        timestamp: nowIso,
      });
    }

    return res.json({ success: true, paymentStatus, updatedAt: nowIso, emailDelivery });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleAdminUpdateApplicationPaymentStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update application payment status' });
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

    const emailDelivery = await notifyApplicationSubmitted({ appId, app });
    return res.json({ success: true, emailDelivery });
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
        emailDelivery: { success: true, hasFailures: false, totalCount: 0, sentCount: 0, failedCount: 0, skippedDuplicateCount: 1, events: [] },
      });
    }

    // Best-effort atomic flag on DB record so repeated logins never re-trigger welcome emails
    if (isTestMode()) {
      const store = readTestStore();
      if (store.users?.[caller.uid]) {
        store.users[caller.uid].registrationNotified = true;
        writeTestStore(store);
      }
    } else if (ensureAdminInit() && rtdbAdmin && profile) {
      await withTimeout(rtdbAdmin.ref(`users/${caller.uid}/registrationNotified`).set(true), 4000, 'Mark registration notified').catch(() => {});
    }

    const emailDelivery = await notifyUserRegistration({
      uid: caller.uid,
      userName: profile?.name || caller.name,
      userEmail: profile?.email || caller.email,
      phone: profile?.phone,
      authProvider: isGoogle ? 'google' : (profile?.authProvider || 'password'),
      isGuestCheckout,
    });

    return res.json({ success: true, emailDelivery });
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

    const emailDelivery = await notifyProfileUpdated({
      uid: caller.uid,
      userName: profile?.name || caller.name,
      userEmail: profile?.email || caller.email,
      updateType,
    });

    return res.json({ success: true, emailDelivery });
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
    const emailDelivery = await notifyReviewSubmitted({
      uid: caller.uid,
      productId,
      productName,
      customerName: profile?.name || caller.name,
      customerEmail: profile?.email || caller.email,
      rating,
      reviewText,
    });

    return res.json({ success: true, emailDelivery });
  } catch (err: any) {
    console.error('[operatorService] handleNotifyReviewSubmitted error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send review notification' });
  }
}

/**
 * POST /api/notifications/callback
 * Public rate-limited callback request notification (server sends fixed Admin template + optional Customer ack)
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

    const emailDelivery = await notifyCallbackRequest({
      mobileNumber: mobile,
      customerName,
      customerEmail,
    });

    return res.json({ success: true, emailDelivery });
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
