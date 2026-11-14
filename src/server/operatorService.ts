import 'dotenv/config';
import dotenv from 'dotenv';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getDatabase, Database } from 'firebase-admin/database';
import { getAuth, Auth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';

const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const SUPER_ADMIN_UID = 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2';
const SUPER_ADMIN_EMAIL = 'indiacybercafe.com@gmail.com';
const ADMIN_EMAILS = ['icc@indiacybercafe.com', 'indiacybercafe.com@gmail.com'];
const ALLOWED_STATUSES = new Set(['processing', 'clarification', 'completed', 'rejected']);
const ALLOWED_UPDATE_BODY_FIELDS = new Set(['status', 'note', 'attachmentUrl', 'attachmentName']);
const PROTECTED_UPDATE_FIELDS = new Set([
  'paymentStatus', 'paymentMethod', 'charge', 'uid', 'userId', 'email',
  'name', 'serviceName', 'serviceId', 'assignedTo', 'assignedToUid',
  'details', 'razorpayPaymentId', 'razorpayOrderId', 'notes', 'fileUrl',
  'date', 'id', 'createdAt', 'updatedAt'
]);
const ATTACHMENTS_DIR = path.join(APP_ROOT, 'data/uploads/attachments');
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

function sanitizeFilename(name: string): string {
  const base = path.basename(String(name || 'attachment')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 120) || 'attachment';
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function validateInternalAttachmentReference(attachmentUrl: string, expectedAppId: string): { ok: boolean; error?: string } {
  if (!attachmentUrl.startsWith('/api/operator/attachments/')) {
    return { ok: true };
  }
  try {
    const parsed = new URL(attachmentUrl, 'http://localhost');
    const pathPrefix = '/api/operator/attachments/';
    if (!parsed.pathname.startsWith(pathPrefix)) {
      return { ok: false, error: 'Invalid attachment URL path' };
    }
    const rawAttId = decodeURIComponent(parsed.pathname.slice(pathPrefix.length));
    const safeAttId = sanitizeFilename(rawAttId);
    const queryAppId = cleanText(parsed.searchParams.get('appId') || '', 120);
    if (!safeAttId || safeAttId !== rawAttId || safeAttId.includes('..') || !queryAppId || queryAppId !== expectedAppId) {
      return { ok: false, error: 'Attachment URL does not match target application' };
    }
    const appDir = path.resolve(ATTACHMENTS_DIR, expectedAppId);
    const filePath = path.resolve(appDir, safeAttId);
    const metaPath = `${filePath}.meta.json`;
    if (!filePath.startsWith(appDir) || !fs.existsSync(filePath) || !fs.existsSync(metaPath)) {
      return { ok: false, error: 'Referenced attachment file was not found on server' };
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.appId !== expectedAppId || meta.attachmentId !== safeAttId) {
      return { ok: false, error: 'Attachment metadata mismatch for target application' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Invalid attachment URL' };
  }
}

function isCallerOwnerOfApp(app: any, caller: VerifiedCaller): boolean {
  if (!app || !caller || caller.disabled) return false;
  return app.uid === caller.uid || app.userId === caller.uid;
}

async function readApplication(appId: string): Promise<any | null> {
  if (isTestMode()) {
    const store = readTestStore();
    return store.applications?.[appId] || null;
  }
  if (!ensureAdminInit() || !rtdbAdmin) {
    throw Object.assign(new Error('Firebase Admin credentials not configured on server'), { code: 'FIREBASE_ADMIN_UNCONFIGURED', statusCode: 503 });
  }
  const snap = await withTimeout(rtdbAdmin.ref(`applications/${appId}`).once('value'), 6000, 'Read application');
  if (!snap.exists()) return null;
  return { id: appId, ...snap.val() };
}

async function sendNotificationEmails(emails: Array<{ to: string; subject: string; html: string }>) {
  if (isTestMode()) return;
  const smtpUser = process.env.SMTP_USER || '';
  const smtpPass = process.env.SMTP_PASS || '';
  if (!smtpUser || !smtpPass) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
    tls: { rejectUnauthorized: false },
  });

  await Promise.allSettled(
    emails
      .filter(e => e.to && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.to))
      .map(e =>
        transporter.sendMail({
          from: `"India Cyber Cafe" <${smtpUser}>`,
          to: e.to,
          subject: e.subject,
          html: e.html,
        })
      )
  );
}

function buildStatusEmailHtml(userName: string, serviceName: string, status: string, noteText?: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
      <div style="background: #FF9933; padding: 20px; text-align: center; color: #fff;">
        <h2 style="margin: 0;">India Cyber Cafe</h2>
        <p style="margin: 4px 0 0; font-size: 12px;">Application Status Updated</p>
      </div>
      <div style="padding: 20px; color: #333; line-height: 1.6;">
        <p>Hello <strong>${escapeHtml(userName)}</strong>,</p>
        <p>Your application for <strong>${escapeHtml(serviceName)}</strong> has been updated.</p>
        <div style="background: #f0f8ff; padding: 12px 15px; border-left: 4px solid #FF9933; border-radius: 6px; margin: 12px 0;">
          <p style="margin: 4px 0;"><strong>New Status:</strong> ${escapeHtml(status.toUpperCase())}</p>
          ${noteText ? `<p style="margin: 4px 0;"><strong>Note:</strong> ${escapeHtml(noteText)}</p>` : ''}
        </div>
        <p><a href="https://b.indiacybercafe.com/track" style="background: #FF9933; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; display: inline-block;">View Application</a></p>
      </div>
    </div>
  `;
}

function buildNoteEmailHtml(userName: string, serviceName: string, noteText: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
      <div style="background: #FF9933; padding: 20px; text-align: center; color: #fff;">
        <h2 style="margin: 0;">India Cyber Cafe</h2>
        <p style="margin: 4px 0 0; font-size: 12px;">New Update on Your Application</p>
      </div>
      <div style="padding: 20px; color: #333; line-height: 1.6;">
        <p>Hello <strong>${escapeHtml(userName)}</strong>,</p>
        <p>A new update has been posted on your application for <strong>${escapeHtml(serviceName)}</strong>:</p>
        <div style="background: #fff9e6; padding: 12px 15px; border-left: 4px solid #FF9933; border-radius: 6px; margin: 12px 0;">
          <p style="margin: 0;">${escapeHtml(noteText)}</p>
        </div>
        <p><a href="https://b.indiacybercafe.com/track" style="background: #FF9933; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; display: inline-block;">Check Dashboard</a></p>
      </div>
    </div>
  `;
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
    const noteText = cleanText(body.note, 2000);
    const attachmentUrl = typeof body.attachmentUrl === 'string' ? body.attachmentUrl.trim() : '';
    const attachmentName = cleanText(body.attachmentName, 150);

    if (rawStatus && !ALLOWED_STATUSES.has(rawStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid status value. Allowed: processing, clarification, completed, rejected.' });
    }
    if (attachmentUrl && !attachmentUrl.startsWith('https://') && !attachmentUrl.startsWith('/api/operator/attachments/')) {
      return res.status(400).json({ success: false, error: 'Invalid attachment URL' });
    }
    if (attachmentUrl.startsWith('/api/operator/attachments/')) {
      const attCheck = validateInternalAttachmentReference(attachmentUrl, appId);
      if (!attCheck.ok) {
        return res.status(400).json({ success: false, error: attCheck.error || 'Invalid attachment reference' });
      }
    }
    if (!rawStatus && !noteText && !attachmentUrl) {
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
      text: noteText || (rawStatus ? `Status updated to ${rawStatus}` : `Uploaded attachment: ${attachmentName || 'Attachment'}`),
      time: new Date(nowMs).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      createdAt: nowMs,
    };
    if (rawStatus) newNote.status = rawStatus;
    if (attachmentUrl) {
      newNote.attachment = attachmentUrl;
      if (attachmentName) newNote.attachmentName = attachmentName;
    }

    let appSnapshotAfter: any = null;

    if (isTestMode()) {
      const store = readTestStore();
      const target = store.applications?.[appId];
      if (!target) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (caller.role !== 'admin' && !isCallerAssignedToApp(target, caller)) {
        return res.status(403).json({ success: false, error: 'Access denied: application is not assigned to your account.' });
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
      target.notes[noteId] = newNote;
      if (rawStatus) target.status = rawStatus;
      target.updatedAt = nowIso;
      writeTestStore(store);
      appSnapshotAfter = target;
    } else if (ensureAdminInit() && rtdbAdmin) {
      const initialApp = await readApplication(appId);
      if (!initialApp) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (caller.role !== 'admin' && !isCallerAssignedToApp(initialApp, caller)) {
        return res.status(403).json({ success: false, error: 'Access denied: application is not assigned to your account.' });
      }

      // Atomic RTDB transaction prevents TOCTOU race if Admin reassigns or disables Operator mid-request
      const txState: { abortReason: 'NONE' | 'FORBIDDEN' } = { abortReason: 'NONE' };
      const txResult = await withTimeout(
        rtdbAdmin.ref(`applications/${appId}`).transaction((currentApp: any) => {
          txState.abortReason = 'NONE';
          if (currentApp === null) {
            return null;
          }
          if (caller.role !== 'admin' && !isCallerAssignedToApp(currentApp, caller)) {
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
      const valAfter = txResult.snapshot?.val();
      if (!valAfter) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (!txResult.committed) {
        return res.status(409).json({ success: false, error: 'Application update conflicted with another change. Please retry.' });
      }
      appSnapshotAfter = { id: appId, ...valAfter };
    } else {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: 'Firebase Admin credentials not configured on server' });
    }

    // Dispatch notification emails strictly AFTER DB write succeeds (deduplicated)
    const emailQueue: Array<{ to: string; subject: string; html: string }> = [];
    if (rawStatus) {
      const html = buildStatusEmailHtml(appSnapshotAfter.name || 'Customer', appSnapshotAfter.serviceName || 'Service', rawStatus, noteText || undefined);
      if (appSnapshotAfter.email) {
        emailQueue.push({ to: appSnapshotAfter.email, subject: `Status Update: ${appSnapshotAfter.serviceName}`, html });
      }
      for (const adminEmail of ADMIN_EMAILS) {
        emailQueue.push({ to: adminEmail, subject: `[Admin Alert] Status Updated: ${appSnapshotAfter.serviceName}`, html });
      }
      if (appSnapshotAfter.assignedTo && appSnapshotAfter.assignedTo.toLowerCase().trim() !== caller.email) {
        emailQueue.push({ to: appSnapshotAfter.assignedTo, subject: `[Update] Status Changed: ${appSnapshotAfter.serviceName}`, html });
      }
    } else if (noteText) {
      if (appSnapshotAfter.email) {
        emailQueue.push({
          to: appSnapshotAfter.email,
          subject: `New Update: ${appSnapshotAfter.serviceName}`,
          html: buildNoteEmailHtml(appSnapshotAfter.name || 'Customer', appSnapshotAfter.serviceName || 'Service', noteText),
        });
      }
      for (const adminEmail of ADMIN_EMAILS) {
        emailQueue.push({
          to: adminEmail,
          subject: `[Admin Alert] New Note Added: ${appSnapshotAfter.serviceName}`,
          html: buildNoteEmailHtml(appSnapshotAfter.name || 'Customer', appSnapshotAfter.serviceName || 'Service', `Note from ${caller.name} (${caller.role}): ${noteText}`),
        });
      }
    }

    sendNotificationEmails(emailQueue).catch(err => console.warn('[operatorService] Email notification notice:', err?.message || err));

    return res.json({
      success: true,
      note: newNote,
      status: rawStatus || appSnapshotAfter.status,
      updatedAt: nowIso,
    });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
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
    const appDir = path.join(ATTACHMENTS_DIR, appId);
    fs.mkdirSync(appDir, { recursive: true });
    const filePath = path.join(appDir, attachmentId);
    const metaPath = path.join(appDir, `${attachmentId}.meta.json`);
    fs.writeFileSync(filePath, buf);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        attachmentId,
        appId,
        uploadedByUid: caller.uid,
        uploadedByRole: caller.role,
        originalName: safeOriginal,
        contentType,
        size: buf.length,
        createdAt: new Date().toISOString(),
      }),
      'utf-8'
    );

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== buf.length || !fs.existsSync(metaPath)) {
      throw new Error('Failed to verify persisted attachment files on disk');
    }

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
 * GET /api/operator/attachments/:attachmentId?appId=...
 * Authorized download endpoint — verifies caller is Admin, Application Owner, or Assigned Operator
 */
export async function handleGetOperatorAttachment(req: Request, res: Response) {
  try {
    const caller = await requireAuthenticatedCaller(req, res);
    if (!caller) return;

    const appId = cleanText(req.query.appId, 120);
    const rawAttachmentParam = String(req.params.attachmentId || '');
    const attachmentId = sanitizeFilename(rawAttachmentParam);
    if (!appId || /[/.#$[\]]/.test(appId) || !attachmentId || attachmentId !== rawAttachmentParam || attachmentId.includes('..')) {
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

    const filePath = path.resolve(ATTACHMENTS_DIR, appId, attachmentId);
    if (!filePath.startsWith(path.resolve(ATTACHMENTS_DIR, appId)) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Attachment file not found' });
    }

    let contentType = 'application/octet-stream';
    let originalName = attachmentId;
    const metaPath = `${filePath}.meta.json`;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.appId && meta.appId !== appId) {
          return res.status(403).json({ success: false, error: 'Attachment application mismatch' });
        }
        contentType = meta.contentType || contentType;
        originalName = meta.originalName || originalName;
      } catch {}
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${originalName.replace(/"/g, '')}"`);
    return res.send(fs.readFileSync(filePath));
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

    return res.json({ success: true, paymentStatus: 'completed' });
  } catch (err: any) {
    if (err?.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
      return res.status(503).json({ success: false, code: 'FIREBASE_ADMIN_UNCONFIGURED', error: err.message });
    }
    console.error('[operatorService] handleVerifyApplicationPayment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify application payment' });
  }
}
