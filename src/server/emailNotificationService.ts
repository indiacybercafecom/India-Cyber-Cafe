import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import {
  enqueueAsyncJob,
  getQueueDriver,
  registerQueueProcessor,
  resetAsyncQueueForTesting,
} from './asyncQueueService.js';

const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const NOTIFICATION_LEDGER_PATH = path.join(APP_ROOT, 'data/notification_events.json');
const NOTIFICATION_OUTBOX_PATH = path.join(APP_ROOT, 'data/notification_outbox.json');
const DEFAULT_ADMIN_EMAILS = ['icc@indiacybercafe.com', 'indiacybercafe.com@gmail.com'];
const SITE_URL = 'https://b.indiacybercafe.com';
const EMAIL_ASSET_BASE_URL = (process.env.EMAIL_ASSET_BASE_URL || SITE_URL).replace(/\/+$/, '');
const BRAND_LOGO_GIF_URL = `${EMAIL_ASSET_BASE_URL}/assets/email/icc-logo-animation.gif`;
const BRAND_LOGO_STATIC_URL = `${EMAIL_ASSET_BASE_URL}/assets/email/icc-logo-static.png`;

export const EMAIL_BRAND_ASSETS = {
  siteUrl: SITE_URL,
  logoGifUrl: BRAND_LOGO_GIF_URL,
  logoStaticUrl: BRAND_LOGO_STATIC_URL,
  logoWidth: 340,
  logoHeight: 133,
} as const;

export type EmailRecipientRole = 'customer' | 'admin' | 'operator' | 'previous_operator';
export type NotificationDeliveryState = 'queued' | 'sent_to_smtp' | 'failed' | 'retried';

export interface NotificationEventRecord {
  eventId: string;
  idempotencyKey: string;
  templateId: string;
  recipient: string;
  recipientRole: EmailRecipientRole;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  state: NotificationDeliveryState;
  stateHistory: NotificationDeliveryState[];
  attempts: number;
  maxAttempts: number;
  wasRetried: boolean;
  smtpAccepted: boolean;
  error?: string;
  context?: {
    appId?: string;
    orderId?: string;
    ticketId?: string;
    uid?: string;
    productId?: string;
    actorUid?: string;
    actorRole?: string;
  };
  createdAt: string;
  updatedAt: string;
  sentToSmtpAt?: string;
}

export interface NotificationDispatchItem {
  templateId: string;
  recipient: string;
  recipientRole: EmailRecipientRole;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  idempotencyKey: string;
  required?: boolean;
  context?: NotificationEventRecord['context'];
}

export interface NotificationDispatchReport {
  success: boolean;
  hasFailures: boolean;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedDuplicateCount: number;
  events: Array<{
    eventId: string;
    templateId: string;
    recipient: string;
    recipientRole: EmailRecipientRole;
    state: NotificationDeliveryState;
    wasRetried: boolean;
    attempts: number;
    smtpAccepted: boolean;
    skippedDuplicate?: boolean;
    error?: string;
  }>;
}

export interface MailTransportLike {
  sendMail: (mail: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) => Promise<any>;
}

const isTestMode = () => process.env.STORE_ORDER_TEST_MODE === '1' || process.env.OPERATOR_TEST_MODE === '1';

let testingTransport: MailTransportLike | null = null;
const memoryLedger = new Map<string, NotificationEventRecord>();
const dedupIndex = new Map<string, string>(); // `${idempotencyKey}|${recipientRole}|${recipient}` -> eventId

export function setEmailTransportForTesting(transport: MailTransportLike | null) {
  testingTransport = transport;
}

export function resetNotificationStateForTesting() {
  memoryLedger.clear();
  dedupIndex.clear();
  resetNotificationOutboxForTesting();
  if (isTestMode()) {
    try {
      if (fs.existsSync(NOTIFICATION_LEDGER_PATH)) {
        fs.unlinkSync(NOTIFICATION_LEDGER_PATH);
      }
    } catch {}
  }
}

export function isValidEmailAddress(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function normalizeEmailAddress(email: unknown): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safePortalUrl(pathOrUrl: string, fallback = SITE_URL): string {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return fallback;
  if (pathOrUrl.startsWith('/')) {
    return `${SITE_URL}${pathOrUrl}`;
  }
  try {
    const parsed = new URL(pathOrUrl);
    const allowedHosts = new Set(['b.indiacybercafe.com', 'indiacybercafe.com']);
    try {
      allowedHosts.add(new URL(SITE_URL).hostname);
    } catch {}
    if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname)) {
      return parsed.toString();
    }
  } catch {}
  return fallback;
}

export function getAdminEmails(): string[] {
  const configuredRaw = process.env.ADMIN_NOTIFICATION_EMAILS || process.env.ADMIN_EMAILS || '';
  const fromEnv = configuredRaw
    .split(',')
    .map(item => normalizeEmailAddress(item))
    .filter(isValidEmailAddress);

  const merged = new Set<string>(DEFAULT_ADMIN_EMAILS.map(normalizeEmailAddress));
  for (const addr of fromEnv) {
    merged.add(addr);
  }
  return Array.from(merged);
}

export const OFFICIAL_ADMIN_EMAILS = new Set<string>(getAdminEmails());

export function resolveOperatorRecipient(
  app: any,
  operatorProfile?: { uid?: string; email?: string; name?: string } | null
): { uid: string; email: string; name: string } | null {
  const uid = typeof (operatorProfile?.uid || app?.assignedToUid) === 'string'
    ? String(operatorProfile?.uid || app?.assignedToUid).trim()
    : '';
  const rawEmail = operatorProfile?.email || app?.assignedTo || '';
  const email = normalizeEmailAddress(rawEmail);
  const name = String(operatorProfile?.name || (email ? email.split('@')[0] : '') || 'Operator').trim();

  if (!uid && !email) return null;
  return { uid, email, name };
}

let cachedPooledTransport: { key: string; transporter: MailTransportLike } | null = null;

function getActiveTransport(): { transporter: MailTransportLike | null; fromEmail: string; missingReason?: string } {
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();

  if (testingTransport) {
    return {
      transporter: testingTransport,
      fromEmail: smtpUser || 'icc@indiacybercafe.com',
    };
  }

  if (!smtpUser || !smtpPass) {
    return {
      transporter: null,
      fromEmail: smtpUser || 'icc@indiacybercafe.com',
      missingReason: 'SMTP credentials (SMTP_USER / SMTP_PASS) are not configured',
    };
  }

  const host = process.env.SMTP_HOST || 'smtp.hostinger.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const transportKey = `${host}:${port}:${secure}:${smtpUser}:${smtpPass}`;

  if (!cachedPooledTransport || cachedPooledTransport.key !== transportKey) {
    const transporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      host,
      port,
      secure,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 8000,
      auth: { user: smtpUser, pass: smtpPass },
      tls: { rejectUnauthorized: false },
    });
    cachedPooledTransport = { key: transportKey, transporter };
  }

  return { transporter: cachedPooledTransport.transporter, fromEmail: smtpUser };
}

function readDiskLedger(): Record<string, NotificationEventRecord> {
  try {
    if (fs.existsSync(NOTIFICATION_LEDGER_PATH)) {
      return JSON.parse(fs.readFileSync(NOTIFICATION_LEDGER_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function writeJsonAtomicSync(filePath: string, data: any) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

async function writeJsonAtomicAsync(filePath: string, data: any) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}

let ledgerFlushTimer: NodeJS.Timeout | null = null;
let ledgerWriting = false;
let ledgerDirty = false;
let ledgerHydrated = false;

function buildBoundedLedgerSnapshot(): Record<string, NotificationEventRecord> {
  const entries = Array.from(memoryLedger.entries())
    .sort((a, b) => new Date(b[1].createdAt || 0).getTime() - new Date(a[1].createdAt || 0).getTime())
    .slice(0, 500);
  return Object.fromEntries(entries);
}

async function flushLedgerToDiskAsync(): Promise<void> {
  if (ledgerWriting) {
    ledgerDirty = true;
    return;
  }
  ledgerDirty = false;
  ledgerWriting = true;
  try {
    await writeJsonAtomicAsync(NOTIFICATION_LEDGER_PATH, buildBoundedLedgerSnapshot());
  } catch (err: any) {
    console.warn('[emailNotificationService] Could not persist ledger:', err?.message || err);
  } finally {
    ledgerWriting = false;
    if (ledgerDirty) {
      scheduleLedgerFlush();
    }
  }
}

function scheduleLedgerFlush() {
  ledgerDirty = true;
  if (ledgerFlushTimer) return;
  ledgerFlushTimer = setTimeout(() => {
    ledgerFlushTimer = null;
    void flushLedgerToDiskAsync();
  }, 150);
  if (typeof ledgerFlushTimer.unref === 'function') ledgerFlushTimer.unref();
}

function writeDiskLedgerSync() {
  try {
    writeJsonAtomicSync(NOTIFICATION_LEDGER_PATH, buildBoundedLedgerSnapshot());
  } catch (err: any) {
    console.warn('[emailNotificationService] Could not persist ledger:', err?.message || err);
  }
}

function hydrateLedgerCache() {
  if (ledgerHydrated) return;
  ledgerHydrated = true;
  const disk = readDiskLedger();
  for (const [id, rec] of Object.entries(disk)) {
    memoryLedger.set(id, rec);
    if (rec.idempotencyKey && rec.recipientRole && rec.recipient && rec.state === 'sent_to_smtp') {
      const dedupKey = `${rec.idempotencyKey}|${rec.recipientRole}|${normalizeEmailAddress(rec.recipient)}`;
      dedupIndex.set(dedupKey, id);
    }
  }
}

async function persistNotificationEvent(record: NotificationEventRecord) {
  hydrateLedgerCache();
  memoryLedger.set(record.eventId, record);
  if (record.state === 'sent_to_smtp' && record.idempotencyKey && record.recipient) {
    const dedupKey = `${record.idempotencyKey}|${record.recipientRole}|${normalizeEmailAddress(record.recipient)}`;
    dedupIndex.set(dedupKey, record.eventId);
  }

  if (isTestMode()) {
    writeDiskLedgerSync();
  } else {
    scheduleLedgerFlush();
  }

  // Best-effort mirror to Firebase RTDB when Admin SDK is active outside test mode
  if (!isTestMode() && getApps().length > 0) {
    try {
      const db = getDatabase(getApps()[0]);
      // Store metadata summary in RTDB (never store raw credentials or tokens)
      await Promise.race([
        db.ref(`notificationEvents/${record.eventId}`).set({
          eventId: record.eventId,
          idempotencyKey: record.idempotencyKey,
          templateId: record.templateId,
          recipient: record.recipient,
          recipientRole: record.recipientRole,
          subject: record.subject,
          state: record.state,
          attempts: record.attempts,
          wasRetried: record.wasRetried,
          smtpAccepted: record.smtpAccepted,
          error: record.error || null,
          context: record.context || null,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          sentToSmtpAt: record.sentToSmtpAt || null,
        }),
        new Promise(resolve => setTimeout(resolve, 2500)),
      ]);
    } catch {}
  }
}

export function getNotificationEvents(filters?: { state?: NotificationDeliveryState; appId?: string; orderId?: string; limit?: number }): NotificationEventRecord[] {
  hydrateLedgerCache();
  let items = Array.from(memoryLedger.values());
  if (filters?.state) {
    items = items.filter(i => i.state === filters.state);
  }
  if (filters?.appId) {
    items = items.filter(i => i.context?.appId === filters.appId);
  }
  if (filters?.orderId) {
    items = items.filter(i => i.context?.orderId === filters.orderId);
  }
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items.slice(0, filters?.limit || 100);
}

export function getNotificationEventById(eventId: string): NotificationEventRecord | null {
  hydrateLedgerCache();
  return memoryLedger.get(eventId) || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

async function deliverSingleEvent(record: NotificationEventRecord, options?: { maxAttempts?: number; retryDelayMs?: number }): Promise<NotificationEventRecord> {
  const maxAttempts = options?.maxAttempts ?? record.maxAttempts ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? (isTestMode() || testingTransport ? 5 : 300);

  if (!isValidEmailAddress(record.recipient)) {
    record.state = 'failed';
    record.stateHistory.push('failed');
    record.smtpAccepted = false;
    record.error = record.recipientRole === 'customer'
      ? 'MISSING_OR_INVALID_CUSTOMER_EMAIL'
      : 'MISSING_OR_INVALID_RECIPIENT_EMAIL';
    record.updatedAt = new Date().toISOString();
    await persistNotificationEvent(record);
    console.warn(`[EMAIL] Delivery failed (eventId=${record.eventId}, template=${record.templateId}, role=${record.recipientRole}): ${record.error}`);
    return record;
  }

  const { transporter, fromEmail, missingReason } = getActiveTransport();
  if (!transporter) {
    record.state = 'failed';
    record.stateHistory.push('failed');
    record.smtpAccepted = false;
    record.error = missingReason || 'SMTP transport unavailable';
    record.updatedAt = new Date().toISOString();
    await persistNotificationEvent(record);
    console.warn(`[EMAIL] Delivery failed (eventId=${record.eventId}, template=${record.templateId}, to=${record.recipient}): ${record.error}`);
    return record;
  }

  const senderLabel = (record.fromName || 'India Cyber Cafe').replace(/["\r\n]/g, '').trim() || 'India Cyber Cafe';
  let lastErr = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      record.wasRetried = true;
      record.state = 'retried';
      record.stateHistory.push('retried');
      await sleep(retryDelayMs * attempt);
    }

    record.attempts += 1;
    try {
      await transporter.sendMail({
        from: `"${senderLabel}" <${fromEmail}>`,
        to: record.recipient,
        subject: record.subject,
        html: record.html,
        ...(record.text ? { text: record.text } : {}),
      });

      const sentAt = new Date().toISOString();
      record.state = 'sent_to_smtp';
      record.stateHistory.push('sent_to_smtp');
      record.smtpAccepted = true;
      record.error = undefined;
      record.sentToSmtpAt = sentAt;
      record.updatedAt = sentAt;
      await persistNotificationEvent(record);
      return record;
    } catch (err: any) {
      lastErr = String(err?.message || err || 'SMTP delivery error').slice(0, 300);
      console.warn(`[EMAIL] Attempt ${attempt}/${maxAttempts} failed (eventId=${record.eventId}, template=${record.templateId}, to=${record.recipient}): ${lastErr}`);
    }
  }

  record.state = 'failed';
  record.stateHistory.push('failed');
  record.smtpAccepted = false;
  record.error = lastErr || 'SMTP delivery failed after retries';
  record.updatedAt = new Date().toISOString();
  await persistNotificationEvent(record);
  return record;
}

export async function dispatchNotificationBatch(
  items: NotificationDispatchItem[],
  options?: { maxAttempts?: number; retryDelayMs?: number }
): Promise<NotificationDispatchReport> {
  hydrateLedgerCache();

  const reportEvents: NotificationDispatchReport['events'] = new Array(items.length);
  let sentCount = 0;
  let failedCount = 0;
  let skippedDuplicateCount = 0;

  const toDeliver: Array<{ index: number; record: NotificationEventRecord }> = [];
  const batchSeenDedupKeys = new Set<string>();

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const normalizedRecipient = normalizeEmailAddress(item.recipient);
    const dedupKey = `${item.idempotencyKey}|${item.recipientRole}|${normalizedRecipient}`;

    if (item.idempotencyKey && normalizedRecipient && dedupIndex.has(dedupKey)) {
      const existingId = dedupIndex.get(dedupKey)!;
      const existing = memoryLedger.get(existingId);
      if (existing && existing.state === 'sent_to_smtp') {
        skippedDuplicateCount += 1;
        reportEvents[idx] = {
          eventId: existing.eventId,
          templateId: existing.templateId,
          recipient: existing.recipient,
          recipientRole: existing.recipientRole,
          state: existing.state,
          wasRetried: existing.wasRetried,
          attempts: existing.attempts,
          smtpAccepted: existing.smtpAccepted,
          skippedDuplicate: true,
        };
        continue;
      }
    }

    if (item.idempotencyKey && normalizedRecipient && batchSeenDedupKeys.has(dedupKey)) {
      skippedDuplicateCount += 1;
      reportEvents[idx] = {
        eventId: `dup_${idx}`,
        templateId: item.templateId,
        recipient: normalizedRecipient,
        recipientRole: item.recipientRole,
        state: 'sent_to_smtp',
        wasRetried: false,
        attempts: 0,
        smtpAccepted: true,
        skippedDuplicate: true,
      };
      continue;
    }
    if (item.idempotencyKey && normalizedRecipient) {
      batchSeenDedupKeys.add(dedupKey);
    }

    const now = new Date().toISOString();
    const eventId = `ntf_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    const record: NotificationEventRecord = {
      eventId,
      idempotencyKey: item.idempotencyKey || eventId,
      templateId: item.templateId,
      recipient: normalizedRecipient,
      recipientRole: item.recipientRole,
      subject: String(item.subject || '').slice(0, 200),
      html: item.html,
      ...(item.text ? { text: item.text } : {}),
      fromName: item.fromName || 'India Cyber Cafe',
      state: 'queued',
      stateHistory: ['queued'],
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      wasRetried: false,
      smtpAccepted: false,
      context: item.context,
      createdAt: now,
      updatedAt: now,
    };

    memoryLedger.set(record.eventId, record);
    toDeliver.push({ index: idx, record });
  }

  const BATCH_DELIVER_CONCURRENCY = 4;
  for (let i = 0; i < toDeliver.length; i += BATCH_DELIVER_CONCURRENCY) {
    const chunk = toDeliver.slice(i, i + BATCH_DELIVER_CONCURRENCY);
    await Promise.allSettled(
      chunk.map(async ({ index, record }) => {
        const finalRecord = await deliverSingleEvent(record, options);
        if (finalRecord.state === 'sent_to_smtp') {
          sentCount += 1;
        } else {
          failedCount += 1;
        }
        reportEvents[index] = {
          eventId: finalRecord.eventId,
          templateId: finalRecord.templateId,
          recipient: finalRecord.recipient,
          recipientRole: finalRecord.recipientRole,
          state: finalRecord.state,
          wasRetried: finalRecord.wasRetried,
          attempts: finalRecord.attempts,
          smtpAccepted: finalRecord.smtpAccepted,
          ...(finalRecord.error ? { error: finalRecord.error } : {}),
        };
      })
    );
  }

  return {
    success: failedCount === 0,
    hasFailures: failedCount > 0,
    totalCount: reportEvents.filter(Boolean).length,
    sentCount,
    failedCount,
    skippedDuplicateCount,
    events: reportEvents.filter(Boolean),
  };
}

export async function retryNotificationEvent(eventId: string): Promise<{ found: boolean; event?: NotificationEventRecord }> {
  hydrateLedgerCache();
  const existing = memoryLedger.get(eventId);
  if (!existing) {
    return { found: false };
  }
  if (existing.state === 'sent_to_smtp') {
    return { found: true, event: existing };
  }

  existing.state = 'retried';
  existing.stateHistory.push('retried');
  existing.wasRetried = true;
  existing.updatedAt = new Date().toISOString();
  await persistNotificationEvent(existing);

  const updated = await deliverSingleEvent(existing, { maxAttempts: 2 });
  return { found: true, event: updated };
}

// =============================================================================
// GMAIL-MOBILE-SAFE RESPONSIVE HTML LAYOUT & ROLE-SEPARATED TEMPLATES
// =============================================================================

export function wrapEmailHtml(title: string, contentHtml: string, badgeLabel = 'Customer Notification'): string {
  const safeTitle = escapeHtml(title);
  const safeBadge = escapeHtml(badgeLabel);
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<title>${safeTitle}</title>
<!--[if mso]>
<xml>
  <o:OfficeDocumentSettings>
    <o:AllowPNG/>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings>
</xml>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1e293b;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f4f6f9;margin:0;padding:16px 8px;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;margin:0 auto;background-color:#ffffff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;border-collapse:separate;">
          <tr>
            <td align="center" bgcolor="#FFFDF9" style="background-color:#FFFDF9;padding:24px 20px 18px 20px;text-align:center;border-bottom:1px solid #E2E8F0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td align="center" style="padding:0 0 12px 0;text-align:center;">
                    <a href="${SITE_URL}" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;border:0;">
                      <!--[if mso]>
                      <img src="${BRAND_LOGO_STATIC_URL}" alt="India Cyber Cafe" width="${EMAIL_BRAND_ASSETS.logoWidth}" height="${EMAIL_BRAND_ASSETS.logoHeight}" border="0" style="display:block;margin:0 auto;width:${EMAIL_BRAND_ASSETS.logoWidth}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                      <![endif]-->
                      <!--[if !mso]><!-->
                      <img src="${BRAND_LOGO_GIF_URL}" alt="India Cyber Cafe" width="${EMAIL_BRAND_ASSETS.logoWidth}" height="${EMAIL_BRAND_ASSETS.logoHeight}" border="0" style="display:block;margin:0 auto;width:${EMAIL_BRAND_ASSETS.logoWidth}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                      <!--<![endif]-->
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0;text-align:center;">
                    <div style="font-size:15px;line-height:1.3;font-weight:700;color:#0f172a;letter-spacing:0.2px;margin:0 0 6px 0;">India Cyber Cafe</div>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;border-collapse:separate;">
                      <tr>
                        <td align="center" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:999px;padding:4px 12px;font-size:11px;line-height:1.2;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#475569;">
                          ${safeBadge}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:18px 24px 14px 24px;border-bottom:1px solid #E2E8F0;text-align:left;">
              <h2 style="margin:0;font-size:18px;line-height:1.35;font-weight:700;color:#0f172a;">${safeTitle}</h2>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px;font-size:14px;line-height:1.65;color:#334155;word-break:break-word;">
              ${contentHtml}
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:20px;border-top:2px solid #FF9933;text-align:center;font-size:12px;color:#64748b;">
              <div style="font-weight:700;color:#1e293b;margin-bottom:10px;">India Cyber Cafe Support Center</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:420px;margin:0 auto 12px auto;">
                <tr>
                  <td width="50%" style="padding:4px;text-align:center;vertical-align:top;">
                    <div style="font-weight:700;color:#FF9933;">Email</div>
                    <a href="mailto:icc@indiacybercafe.com" style="color:#c2410c;text-decoration:none;word-break:break-all;">icc@indiacybercafe.com</a>
                  </td>
                  <td width="50%" style="padding:4px;text-align:center;vertical-align:top;">
                    <div style="font-weight:700;color:#FF9933;">Website</div>
                    <a href="${SITE_URL}" style="color:#c2410c;text-decoration:none;">b.indiacybercafe.com</a>
                  </td>
                </tr>
              </table>
              <div style="background-color:#fff7ed;padding:10px;border-radius:6px;margin-bottom:10px;font-size:11px;color:#475569;">
                Singrauli, Madhya Pradesh, India &bull; <a href="${SITE_URL}/legal/privacy" style="color:#c2410c;text-decoration:none;">Privacy Policy</a>
              </div>
              <div style="font-size:11px;color:#94a3b8;">&copy; 2024-2026 India Cyber Cafe. All rights reserved.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderButton(label: string, url: string, bgColor = '#FF9933'): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;">
    <tr>
      <td style="border-radius:6px;background-color:${bgColor};">
        <a href="${escapeHtml(safePortalUrl(url))}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function renderItemsTable(items: Array<{ name?: string; productName?: string; quantity: number; price?: number; discountedPrice?: number }>): string {
  const rows = (items || []).map(item => {
    const name = item.productName || item.name || 'Product';
    const qty = Number(item.quantity) || 1;
    const unitPrice = Number(item.discountedPrice) > 0 ? Number(item.discountedPrice) : Number(item.price) || 0;
    const lineTotal = qty * unitPrice;
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:left;">${escapeHtml(name)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;white-space:nowrap;word-break:normal;">${qty}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap;word-break:normal;">&#8377;${unitPrice.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap;word-break:normal;">&#8377;${lineTotal.toFixed(2)}</td>
    </tr>`;
  }).join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;">
    <thead>
      <tr style="background-color:#f1f5f9;border-bottom:2px solid #FF9933;">
        <th style="padding:8px;text-align:left;">Product</th>
        <th style="padding:8px;text-align:center;white-space:nowrap;word-break:normal;">Qty</th>
        <th style="padding:8px;text-align:right;white-space:nowrap;word-break:normal;">Price</th>
        <th style="padding:8px;text-align:right;white-space:nowrap;word-break:normal;">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export const serverEmailTemplates = {
  // 1. Application Status & Notes Templates (Strictly Role-Separated)
  customerStatusUpdated: (p: {
    customerName: string;
    serviceName: string;
    appId: string;
    newStatus: string;
    noteText?: string;
    attachmentName?: string;
  }) => wrapEmailHtml(
    'Application Status Updated',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Your application status has been updated.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>New Status:</strong> <span style="background-color:#FF9933;color:#ffffff;padding:2px 8px;border-radius:4px;font-weight:700;">${escapeHtml(p.newStatus.toUpperCase())}</span></p>
       ${p.noteText ? `<p style="margin:8px 0 4px 0;"><strong>Processing Note:</strong> ${escapeHtml(p.noteText)}</p>` : ''}
       ${p.attachmentName ? `<p style="margin:4px 0;"><strong>Attachment Added:</strong> ${escapeHtml(p.attachmentName)}</p>` : ''}
     </div>
     <p>You can view live progress and any requested actions from your tracking page.</p>
     ${renderButton('Track Your Application', `/track?id=${encodeURIComponent(p.appId)}`)}
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  customerApplicationCompleted: (p: {
    customerName: string;
    serviceName: string;
    appId: string;
    noteText?: string;
  }) => wrapEmailHtml(
    'Application Completed Successfully',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Your application has been marked as <strong>Completed</strong>.</p>
     <div style="background-color:#f0fdf4;padding:14px;border-left:4px solid #16a34a;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Status:</strong> <span style="background-color:#16a34a;color:#ffffff;padding:2px 8px;border-radius:4px;font-weight:700;">COMPLETED</span></p>
       ${p.noteText ? `<p style="margin:8px 0 4px 0;"><strong>Completion Note:</strong> ${escapeHtml(p.noteText)}</p>` : ''}
     </div>
     ${renderButton('View Application & Downloads', `/track?id=${encodeURIComponent(p.appId)}`, '#16a34a')}
     <p>Thank you for choosing India Cyber Cafe!</p>
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  customerApplicationRejected: (p: {
    customerName: string;
    serviceName: string;
    appId: string;
    noteText?: string;
  }) => wrapEmailHtml(
    'Application Update - Attention Required',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Your application status has been updated to <strong>Rejected / Needs Revision</strong>.</p>
     <div style="background-color:#fef2f2;padding:14px;border-left:4px solid #dc2626;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Status:</strong> <span style="background-color:#dc2626;color:#ffffff;padding:2px 8px;border-radius:4px;font-weight:700;">REJECTED</span></p>
       ${p.noteText ? `<p style="margin:8px 0 4px 0;"><strong>Reason / Note:</strong> ${escapeHtml(p.noteText)}</p>` : ''}
     </div>
     ${renderButton('Review Application Details', `/track?id=${encodeURIComponent(p.appId)}`, '#dc2626')}
     <p>Please contact our support team if you need assistance.</p>
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  adminStatusUpdated: (p: {
    customerName: string;
    customerEmail: string;
    appId: string;
    serviceName: string;
    previousStatus: string;
    newStatus: string;
    performedByName: string;
    performedByRole: string;
    noteText?: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: Application Status Updated',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>An application status has been updated on the portal.</p>
     <div style="background-color:#eff6ff;padding:14px;border-left:4px solid #1d4ed8;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Customer Name:</strong> ${escapeHtml(p.customerName || 'Customer')}</p>
       <p style="margin:4px 0;"><strong>Customer Email:</strong> ${escapeHtml(p.customerEmail || 'N/A')}</p>
       <p style="margin:4px 0;"><strong>Previous Status:</strong> ${escapeHtml((p.previousStatus || 'unknown').toUpperCase())}</p>
       <p style="margin:4px 0;"><strong>New Status:</strong> <span style="background-color:#1d4ed8;color:#ffffff;padding:2px 8px;border-radius:4px;font-weight:700;">${escapeHtml(p.newStatus.toUpperCase())}</span></p>
       <p style="margin:4px 0;"><strong>Updated By:</strong> ${escapeHtml(p.performedByName)} (${escapeHtml(p.performedByRole.toUpperCase())})</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
       ${p.noteText ? `<p style="margin:8px 0 4px 0;"><strong>Note:</strong> ${escapeHtml(p.noteText)}</p>` : ''}
     </div>
     ${renderButton('Open Admin Dashboard', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Notification'
  ),

  operatorStatusUpdated: (p: {
    operatorName: string;
    customerName: string;
    appId: string;
    serviceName: string;
    previousStatus: string;
    newStatus: string;
    performedByName: string;
    noteText?: string;
  }) => wrapEmailHtml(
    'Assigned Application Status Updated',
    `<p>Hello <strong>${escapeHtml(p.operatorName || 'Operator')}</strong>,</p>
     <p>An update has been recorded on an application assigned to you.</p>
     <div style="background-color:#f0f9ff;padding:14px;border-left:4px solid #0284c7;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Customer Name:</strong> ${escapeHtml(p.customerName || 'Customer')}</p>
       <p style="margin:4px 0;"><strong>Previous Status:</strong> ${escapeHtml((p.previousStatus || 'unknown').toUpperCase())}</p>
       <p style="margin:4px 0;"><strong>New Status:</strong> ${escapeHtml(p.newStatus.toUpperCase())}</p>
       <p style="margin:4px 0;"><strong>Updated By:</strong> ${escapeHtml(p.performedByName)}</p>
       ${p.noteText ? `<p style="margin:8px 0 4px 0;"><strong>Note:</strong> ${escapeHtml(p.noteText)}</p>` : ''}
     </div>
     ${renderButton('View in Operator Panel', '/operator', '#0284c7')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Operations</strong></p>`,
    'Operator Notification'
  ),

  customerNoteAdded: (p: {
    customerName: string;
    serviceName: string;
    appId: string;
    noteText: string;
    attachmentName?: string;
  }) => wrapEmailHtml(
    'New Update on Your Application',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>A new update has been posted on your application for <strong>${escapeHtml(p.serviceName)}</strong>.</p>
     <div style="background-color:#fffbeb;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       ${p.noteText ? `<p style="margin:6px 0;">${escapeHtml(p.noteText)}</p>` : ''}
       ${p.attachmentName ? `<p style="margin:4px 0;"><strong>Attachment Added:</strong> ${escapeHtml(p.attachmentName)}</p>` : ''}
     </div>
     ${renderButton('Check Your Application', `/track?id=${encodeURIComponent(p.appId)}`)}
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  adminNoteAdded: (p: {
    customerName: string;
    customerEmail: string;
    appId: string;
    serviceName: string;
    noteText: string;
    performedByName: string;
    performedByRole: string;
    attachmentName?: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: New Note Added to Application',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A new processing note has been added to an application.</p>
     <div style="background-color:#eff6ff;padding:14px;border-left:4px solid #1d4ed8;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(p.customerName)} (${escapeHtml(p.customerEmail || 'N/A')})</p>
       <p style="margin:4px 0;"><strong>Added By:</strong> ${escapeHtml(p.performedByName)} (${escapeHtml(p.performedByRole.toUpperCase())})</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
       ${p.noteText ? `<p style="margin:8px 0 4px 0;"><strong>Note Content:</strong> ${escapeHtml(p.noteText)}</p>` : ''}
       ${p.attachmentName ? `<p style="margin:4px 0;"><strong>Attachment:</strong> ${escapeHtml(p.attachmentName)}</p>` : ''}
     </div>
     ${renderButton('Review in Admin Dashboard', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Notification'
  ),

  // 2. Assignment & Reassignment Templates
  customerOperatorAssigned: (p: {
    customerName: string;
    serviceName: string;
    appId: string;
    operatorName?: string;
  }) => wrapEmailHtml(
    'Operator Assigned to Your Application',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>An operator has been assigned to process your application.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       ${p.operatorName ? `<p style="margin:4px 0;"><strong>Assigned Operator:</strong> ${escapeHtml(p.operatorName)}</p>` : ''}
     </div>
     ${renderButton('Track Application', `/track?id=${encodeURIComponent(p.appId)}`)}
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  operatorAssigned: (p: {
    operatorName: string;
    customerName: string;
    serviceName: string;
    appId: string;
    assignedByName: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'New Application Assignment',
    `<p>Hello <strong>${escapeHtml(p.operatorName || 'Operator')}</strong>,</p>
     <p>You have been assigned a new application to process.</p>
     <div style="background-color:#f0f9ff;padding:14px;border-left:4px solid #0284c7;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Customer Name:</strong> ${escapeHtml(p.customerName || 'Customer')}</p>
       <p style="margin:4px 0;"><strong>Assigned By:</strong> ${escapeHtml(p.assignedByName)}</p>
       <p style="margin:4px 0;"><strong>Assigned On:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('Open Operator Panel', '/operator', '#0284c7')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Operations</strong></p>`,
    'Operator Assignment'
  ),

  operatorReassigned: (p: {
    operatorName: string;
    customerName: string;
    serviceName: string;
    appId: string;
    assignedByName: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Application Reassigned to You',
    `<p>Hello <strong>${escapeHtml(p.operatorName || 'Operator')}</strong>,</p>
     <p>An application has been reassigned to your queue for processing.</p>
     <div style="background-color:#f0f9ff;padding:14px;border-left:4px solid #0284c7;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Customer Name:</strong> ${escapeHtml(p.customerName || 'Customer')}</p>
       <p style="margin:4px 0;"><strong>Reassigned By:</strong> ${escapeHtml(p.assignedByName)}</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('View in Operator Panel', '/operator', '#0284c7')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Operations</strong></p>`,
    'Operator Reassignment'
  ),

  previousOperatorUnassigned: (p: {
    previousOperatorName: string;
    serviceName: string;
    appId: string;
    unassignedByName: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Application Assignment Removed',
    `<p>Hello <strong>${escapeHtml(p.previousOperatorName || 'Operator')}</strong>,</p>
     <p>The following application is no longer assigned to your account and has been reassigned.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #64748b;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Updated By:</strong> ${escapeHtml(p.unassignedByName)}</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     <p>Please discontinue work on this reference ID. Check your Operator Panel for your current active queue.</p>
     ${renderButton('Open Operator Panel', '/operator', '#475569')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Operations</strong></p>`,
    'Assignment Notice'
  ),

  adminOperatorAssigned: (p: {
    operatorName: string;
    operatorEmail: string;
    previousOperatorEmail?: string;
    customerName: string;
    customerEmail: string;
    serviceName: string;
    appId: string;
    assignedByName: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: Operator Assignment Updated',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>Application operator assignment has been updated.</p>
     <div style="background-color:#eff6ff;padding:14px;border-left:4px solid #1d4ed8;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(p.customerName)} (${escapeHtml(p.customerEmail || 'N/A')})</p>
       <p style="margin:4px 0;"><strong>Assigned Operator:</strong> ${p.operatorEmail ? `${escapeHtml(p.operatorName)} (${escapeHtml(p.operatorEmail)})` : 'Unassigned'}</p>
       ${p.previousOperatorEmail ? `<p style="margin:4px 0;"><strong>Previous Operator:</strong> ${escapeHtml(p.previousOperatorEmail)}</p>` : ''}
       <p style="margin:4px 0;"><strong>Updated By:</strong> ${escapeHtml(p.assignedByName)}</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('Open Admin Dashboard', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Notification'
  ),

  // 3. Application Submission & Payment Templates
  customerApplicationSubmitted: (p: {
    customerName: string;
    serviceName: string;
    appId: string;
    charge?: number;
    paymentStatus?: string;
  }) => wrapEmailHtml(
    'Application Submitted Successfully',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Your service application has been successfully received.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       ${typeof p.charge === 'number' ? `<p style="margin:4px 0;"><strong>Service Fee:</strong> &#8377;${p.charge.toFixed(2)}</p>` : ''}
       ${p.paymentStatus ? `<p style="margin:4px 0;"><strong>Payment Status:</strong> ${escapeHtml(p.paymentStatus.toUpperCase())}</p>` : ''}
     </div>
     ${renderButton('Track Your Application', `/track?id=${encodeURIComponent(p.appId)}`)}
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  adminNewApplication: (p: {
    customerName: string;
    customerEmail: string;
    serviceName: string;
    appId: string;
    charge?: number;
    paymentStatus?: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: New Application Received',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A new service application has been submitted and awaits review.</p>
     <div style="background-color:#eff6ff;padding:14px;border-left:4px solid #1d4ed8;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>
       <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(p.serviceName)}</p>
       <p style="margin:4px 0;"><strong>Customer Name:</strong> ${escapeHtml(p.customerName)}</p>
       <p style="margin:4px 0;"><strong>Customer Email:</strong> ${escapeHtml(p.customerEmail)}</p>
       ${typeof p.charge === 'number' ? `<p style="margin:4px 0;"><strong>Service Fee:</strong> &#8377;${p.charge.toFixed(2)}</p>` : ''}
       ${p.paymentStatus ? `<p style="margin:4px 0;"><strong>Payment Status:</strong> ${escapeHtml(p.paymentStatus.toUpperCase())}</p>` : ''}
       <p style="margin:4px 0;"><strong>Submitted At:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('Review in Admin Panel', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Notification'
  ),

  customerPaymentConfirmed: (p: {
    customerName: string;
    amount: string | number;
    serviceName: string;
    appId?: string;
    transactionId: string;
    paymentMethod?: string;
  }) => wrapEmailHtml(
    'Payment Confirmed',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Thank you! Your payment has been confirmed.</p>
     <div style="background-color:#f0fdf4;padding:14px;border-left:4px solid #16a34a;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Amount Paid:</strong> &#8377;${escapeHtml(String(p.amount))}</p>
       <p style="margin:4px 0;"><strong>Service / Reference:</strong> ${escapeHtml(p.serviceName)}</p>
       ${p.appId ? `<p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>` : ''}
       <p style="margin:4px 0;"><strong>Transaction ID:</strong> <code>${escapeHtml(p.transactionId)}</code></p>
       ${p.paymentMethod ? `<p style="margin:4px 0;"><strong>Payment Method:</strong> ${escapeHtml(p.paymentMethod.toUpperCase())}</p>` : ''}
     </div>
     ${renderButton('View Applications', p.appId ? `/track?id=${encodeURIComponent(p.appId)}` : '/track', '#16a34a')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  adminPaymentReceived: (p: {
    customerName: string;
    customerEmail?: string;
    amount: string | number;
    serviceName: string;
    appId?: string;
    transactionId: string;
    paymentMethod?: string;
    razorpayOrderId?: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: Payment Received',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A payment transaction has been recorded as completed.</p>
     <div style="background-color:#f0fdf4;padding:14px;border-left:4px solid #16a34a;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(p.customerName || 'Guest')}${p.customerEmail ? ` (${escapeHtml(p.customerEmail)})` : ''}</p>
       <p style="margin:4px 0;"><strong>Amount:</strong> &#8377;${escapeHtml(String(p.amount))}</p>
       <p style="margin:4px 0;"><strong>Service / Source:</strong> ${escapeHtml(p.serviceName)}</p>
       ${p.appId ? `<p style="margin:4px 0;"><strong>Application ID:</strong> <code>${escapeHtml(p.appId)}</code></p>` : ''}
       <p style="margin:4px 0;"><strong>Transaction / Payment ID:</strong> <code>${escapeHtml(p.transactionId)}</code></p>
       ${p.razorpayOrderId ? `<p style="margin:4px 0;"><strong>Razorpay Order ID:</strong> <code>${escapeHtml(p.razorpayOrderId)}</code></p>` : ''}
       ${p.paymentMethod ? `<p style="margin:4px 0;"><strong>Method:</strong> ${escapeHtml(p.paymentMethod.toUpperCase())}</p>` : ''}
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('View in Admin Panel', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Payment Alert'
  ),

  // 4. Store Order Templates
  customerOrderConfirmed: (p: {
    customerName: string;
    orderId: string;
    items: any[];
    totalAmount: number;
    paymentMethod: string;
    paymentStatus: string;
    address: any;
    isGuest?: boolean;
    digitalDownloads?: any[];
  }) => wrapEmailHtml(
    'Order Confirmed - India Cyber Cafe Store',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Thank you for your order! Your order has been confirmed.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${escapeHtml(p.orderId)}</code></p>
       <p style="margin:4px 0;"><strong>Payment Method:</strong> ${escapeHtml(p.paymentMethod === 'cod' || p.paymentMethod === 'cash' ? 'Cash on Delivery (COD)' : 'Online (Razorpay)')}</p>
       <p style="margin:4px 0;"><strong>Payment Status:</strong> ${escapeHtml((p.paymentStatus || 'pending').toUpperCase())}</p>
       <p style="margin:4px 0;"><strong>Total Amount:</strong> &#8377;${Number(p.totalAmount || 0).toFixed(2)}</p>
     </div>
    ${renderItemsTable(p.items)}
    ${(p.digitalDownloads || []).map((product: any) => `<div style="margin:20px 0;padding:16px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;"><h3 style="margin:0 0 8px;color:#14532d;font-size:16px;">Your Digital Download: ${escapeHtml(product.productName)}</h3><p style="margin:0 0 10px;color:#166534;font-size:13px;">Sign in with your buyer account to securely download your file.</p>${(product.resources || []).map((resource: any) => { const safeUrl = safePortalUrl(resource.downloadPageUrl || resource.downloadUrl); return `<p style="margin:8px 0 4px;"><strong>${escapeHtml(resource.fileName)}</strong></p>${renderButton(resource.label || 'Download Now', safeUrl, '#15803d')}<p style="margin:4px 0 8px;font-size:12px;word-break:break-all;color:#475569;">Download link: <a href="${escapeHtml(safeUrl)}" style="color:#1d4ed8;">${escapeHtml(safeUrl)}</a></p>${resource.expiresAt ? `<p style="margin:0;color:#64748b;font-size:12px;">Available until ${escapeHtml(new Date(resource.expiresAt).toLocaleString('en-IN'))}</p>` : ''}`; }).join('')}</div>`).join('')}
     ${p.address && (p.address.addressLine1 || p.address.city || p.address.state || p.address.pincode)
       ? `<p><strong>Delivery Address:</strong> ${escapeHtml(p.address.addressLine1 || '')}, ${escapeHtml(p.address.city || '')}, ${escapeHtml(p.address.state || '')} - ${escapeHtml(p.address.pincode || '')}</p>`
       : `<p><strong>Delivery Mode:</strong> Instant Digital Delivery (No physical shipping required)</p>`}
     ${renderButton('Track Your Order', p.isGuest ? `/track-order?orderId=${encodeURIComponent(p.orderId)}` : '/track')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Store Team</strong></p>`
  ),

    customerDigitalDelivery: (p: { customerName: string; orderId: string; downloads: any[]; totalAmount: number }) => wrapEmailHtml(
     'Your Digital Downloads Are Ready',
     `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
      <p>Your payment has been confirmed and your digital purchase is ready. Sign in with the account used to place this order to download your file securely.</p>
      <p><strong>Order ID:</strong> <code>${escapeHtml(p.orderId)}</code><br/><strong>Payment:</strong> COMPLETED<br/><strong>Total paid:</strong> &#8377;${Number(p.totalAmount || 0).toFixed(2)}</p>
      ${(p.downloads || []).map((product: any) => `<div style="margin:20px 0;padding:16px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;"><h3 style="margin:0 0 10px;color:#14532d;font-size:16px;">${escapeHtml(product.productName)}</h3>${(product.resources || []).map((resource: any) => { const safeUrl = safePortalUrl(resource.downloadPageUrl || resource.downloadUrl); return `<p style="margin:8px 0 4px;"><strong>${escapeHtml(resource.fileName)}</strong></p>${renderButton(resource.label || 'Download Now', safeUrl, '#15803d')}<p style="margin:4px 0 8px;font-size:12px;word-break:break-all;color:#475569;">Download link: <a href="${escapeHtml(safeUrl)}" style="color:#1d4ed8;">${escapeHtml(safeUrl)}</a></p>${resource.expiresAt ? `<p style="margin:0;color:#64748b;font-size:12px;">Available until ${escapeHtml(new Date(resource.expiresAt).toLocaleString('en-IN'))}</p>` : ''}`; }).join('')}</div>`).join('')}
      <p>Questions? Contact <a href="mailto:support@indiacybercafe.com">support@indiacybercafe.com</a> or call +91 9203251821.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Store Team</strong></p>`
    ),

  adminOrderCreated: (p: {
    orderId: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    isGuest?: boolean;
    items: any[];
    totalAmount: number;
    paymentMethod: string;
    paymentStatus: string;
    address: any;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: New Store Order Received',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A new store order has been placed.</p>
     <div style="background-color:#eff6ff;padding:14px;border-left:4px solid #1d4ed8;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${escapeHtml(p.orderId)}</code></p>
       <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(p.customerName)} (${escapeHtml(p.customerPhone || 'N/A')})</p>
       <p style="margin:4px 0;"><strong>Email:</strong> ${escapeHtml(p.customerEmail)}</p>
       <p style="margin:4px 0;"><strong>Guest Order:</strong> ${p.isGuest ? 'Yes' : 'No'}</p>
       <p style="margin:4px 0;"><strong>Payment Method:</strong> ${escapeHtml(p.paymentMethod)}</p>
       <p style="margin:4px 0;"><strong>Payment Status:</strong> ${escapeHtml((p.paymentStatus || 'pending').toUpperCase())}</p>
       <p style="margin:4px 0;"><strong>Total Amount:</strong> &#8377;${Number(p.totalAmount || 0).toFixed(2)}</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderItemsTable(p.items)}
     ${p.address && (p.address.addressLine1 || p.address.city || p.address.state || p.address.pincode)
       ? `<p><strong>Shipping Address:</strong> ${escapeHtml(p.address.addressLine1 || '')}, ${escapeHtml(p.address.city || '')}, ${escapeHtml(p.address.state || '')} - ${escapeHtml(p.address.pincode || '')}</p>`
       : `<p><strong>Delivery Mode:</strong> Instant Digital Delivery (Virtual Product)</p>`}
     ${renderButton('Manage Order in Admin Panel', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Order Alert'
  ),

  customerOrderStatusUpdated: (p: {
    customerName: string;
    orderId: string;
    newStatus: string;
    productName: string;
    estimatedDelivery?: string;
    isGuest?: boolean;
  }) => wrapEmailHtml(
    'Store Order Status Updated',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Your store order status has been updated.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${escapeHtml(p.orderId)}</code></p>
       <p style="margin:4px 0;"><strong>Product:</strong> ${escapeHtml(p.productName)}</p>
       <p style="margin:4px 0;"><strong>New Status:</strong> <span style="background-color:#FF9933;color:#ffffff;padding:2px 8px;border-radius:4px;font-weight:700;">${escapeHtml(p.newStatus.toUpperCase())}</span></p>
       ${p.estimatedDelivery ? `<p style="margin:4px 0;"><strong>Estimated Delivery:</strong> ${escapeHtml(p.estimatedDelivery)}</p>` : ''}
     </div>
     ${renderButton('Track Your Order', p.isGuest ? `/track-order?orderId=${encodeURIComponent(p.orderId)}` : '/track')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Store Team</strong></p>`
  ),

  customerOrderCancelled: (p: {
    customerName: string;
    orderId: string;
    productName: string;
    totalAmount: number;
    reason?: string;
  }) => wrapEmailHtml(
    'Store Order Cancelled',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Your store order has been cancelled.</p>
     <div style="background-color:#fef2f2;padding:14px;border-left:4px solid #dc2626;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${escapeHtml(p.orderId)}</code></p>
       <p style="margin:4px 0;"><strong>Product:</strong> ${escapeHtml(p.productName)}</p>
       <p style="margin:4px 0;"><strong>Order Amount:</strong> &#8377;${Number(p.totalAmount || 0).toFixed(2)}</p>
       ${p.reason ? `<p style="margin:4px 0;"><strong>Reason:</strong> ${escapeHtml(p.reason)}</p>` : ''}
     </div>
     <p>If payment was already completed online, eligible refunds are initiated within 5-7 business days to the original payment method.</p>
     <p>Best Regards,<br/><strong>India Cyber Cafe Store Team</strong></p>`
  ),

  adminOrderCancelled: (p: {
    orderId: string;
    customerName: string;
    customerEmail: string;
    productName: string;
    totalAmount: number;
    paymentMethod?: string;
    reason?: string;
    performedByName: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: Store Order Cancelled',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A store order has been marked as cancelled.</p>
     <div style="background-color:#fef2f2;padding:14px;border-left:4px solid #dc2626;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${escapeHtml(p.orderId)}</code></p>
       <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(p.customerName)} (${escapeHtml(p.customerEmail || 'N/A')})</p>
       <p style="margin:4px 0;"><strong>Product:</strong> ${escapeHtml(p.productName)}</p>
       <p style="margin:4px 0;"><strong>Total Amount:</strong> &#8377;${Number(p.totalAmount || 0).toFixed(2)}</p>
       ${p.paymentMethod ? `<p style="margin:4px 0;"><strong>Payment Method:</strong> ${escapeHtml(p.paymentMethod)}</p>` : ''}
       ${p.reason ? `<p style="margin:4px 0;"><strong>Reason:</strong> ${escapeHtml(p.reason)}</p>` : ''}
       <p style="margin:4px 0;"><strong>Updated By:</strong> ${escapeHtml(p.performedByName)}</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('View in Admin Panel', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Order Alert'
  ),

  customerRefundInitiated: (p: {
    customerName: string;
    orderId: string;
    refundAmount: number;
    expectedDays?: number;
    reason?: string;
  }) => wrapEmailHtml(
    'Refund Initiated',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Your refund has been initiated and is being processed.</p>
     <div style="background-color:#f0fdf4;padding:14px;border-left:4px solid #16a34a;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${escapeHtml(p.orderId)}</code></p>
       <p style="margin:4px 0;"><strong>Refund Amount:</strong> &#8377;${Number(p.refundAmount || 0).toFixed(2)}</p>
       <p style="margin:4px 0;"><strong>Expected Timeline:</strong> ${p.expectedDays || 5} business days</p>
       ${p.reason ? `<p style="margin:4px 0;"><strong>Note:</strong> ${escapeHtml(p.reason)}</p>` : ''}
     </div>
     <p>The refund will be credited back to your original payment method.</p>
     <p>Best Regards,<br/><strong>India Cyber Cafe Store Team</strong></p>`
  ),

  adminRefundInitiated: (p: {
    orderId: string;
    customerName: string;
    customerEmail: string;
    refundAmount: number;
    reason?: string;
    performedByName: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: Refund Initiated',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A refund has been initiated for a store order.</p>
     <div style="background-color:#f0fdf4;padding:14px;border-left:4px solid #16a34a;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${escapeHtml(p.orderId)}</code></p>
       <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(p.customerName)} (${escapeHtml(p.customerEmail || 'N/A')})</p>
       <p style="margin:4px 0;"><strong>Refund Amount:</strong> &#8377;${Number(p.refundAmount || 0).toFixed(2)}</p>
       ${p.reason ? `<p style="margin:4px 0;"><strong>Reason:</strong> ${escapeHtml(p.reason)}</p>` : ''}
       <p style="margin:4px 0;"><strong>Initiated By:</strong> ${escapeHtml(p.performedByName)}</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('View in Admin Panel', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Refund Alert'
  ),

  // 5. Account, Profile, Review, Callback & Privacy Templates
  customerRegistration: (p: { userName: string; authProvider?: string; isGuestCheckout?: boolean }) => wrapEmailHtml(
    'Welcome to India Cyber Cafe!',
    `<p>Hello <strong>${escapeHtml(p.userName || 'User')}</strong>,</p>
     <p>Welcome to India Cyber Cafe! Your account has been created successfully.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Sign-In Method:</strong> ${escapeHtml(p.authProvider === 'google' ? 'Google Sign-In' : 'Registered Email & Password')}</p>
       <p style="margin:4px 0;">For your security, passwords are never emailed. You can manage your password anytime using the Forgot Password flow or Profile Settings.</p>
     </div>
     ${renderButton(p.isGuestCheckout ? 'Set or Manage Your Password' : 'Explore Services', p.isGuestCheckout ? '/forgot-password' : '/services')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  adminUserRegistered: (p: {
    userName: string;
    userEmail: string;
    phone?: string;
    authProvider?: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: New User Registered',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A new user has registered on the India Cyber Cafe portal.</p>
     <div style="background-color:#eff6ff;padding:14px;border-left:4px solid #1d4ed8;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Name:</strong> ${escapeHtml(p.userName)}</p>
       <p style="margin:4px 0;"><strong>Email:</strong> ${escapeHtml(p.userEmail)}</p>
       <p style="margin:4px 0;"><strong>Phone:</strong> ${escapeHtml(p.phone || 'Not provided')}</p>
       <p style="margin:4px 0;"><strong>Sign-In Provider:</strong> ${escapeHtml(p.authProvider || 'password')}</p>
       <p style="margin:4px 0;"><strong>Registered On:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('View Users in Admin Panel', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Registration Alert'
  ),

  customerProfileUpdated: (p: { userName: string; updateType: string; timestamp: string }) => wrapEmailHtml(
    'Profile Updated Successfully',
    `<p>Hello <strong>${escapeHtml(p.userName || 'User')}</strong>,</p>
     <p>Your India Cyber Cafe profile details have been updated.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Updated Section:</strong> ${escapeHtml(p.updateType)}</p>
       <p style="margin:4px 0;"><strong>Updated On:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     <p>If you did not perform this change, please contact our support team or reset your password immediately.</p>
     ${renderButton('View Your Profile', '/profile')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  customerCallbackReceived: (p: { customerName?: string; mobileNumber: string; timestamp: string }) => wrapEmailHtml(
    'Call Back Request Received',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Thank you for requesting instant service assistance from India Cyber Cafe.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Callback Number:</strong> ${escapeHtml(p.mobileNumber)}</p>
       <p style="margin:4px 0;"><strong>Requested At:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     <p>Our team will reach out to you shortly.</p>
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  adminCallbackReceived: (p: { mobileNumber: string; customerName?: string; customerEmail?: string; timestamp: string }) => wrapEmailHtml(
    'Admin Alert: New Call Back Request',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A new instant call back request has been submitted from the website.</p>
     <div style="background-color:#fffbeb;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Mobile Number:</strong> ${escapeHtml(p.mobileNumber)}</p>
       ${p.customerName ? `<p style="margin:4px 0;"><strong>Name:</strong> ${escapeHtml(p.customerName)}</p>` : ''}
       ${p.customerEmail ? `<p style="margin:4px 0;"><strong>Email:</strong> ${escapeHtml(p.customerEmail)}</p>` : ''}
       <p style="margin:4px 0;"><strong>Requested At:</strong> ${escapeHtml(p.timestamp)}</p>
       <p style="margin:4px 0;"><strong>Source:</strong> Website Callback Popup</p>
     </div>
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Callback Alert'
  ),

  customerReviewSubmitted: (p: { customerName: string; productName: string }) => wrapEmailHtml(
    'Review Submitted - Thank You',
    `<p>Hello <strong>${escapeHtml(p.customerName || 'Customer')}</strong>,</p>
     <p>Thank you for submitting your review for <strong>${escapeHtml(p.productName)}</strong>!</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:0;">We appreciate your feedback. Your review helps other customers make informed decisions.</p>
     </div>
     ${renderButton('Visit Store', '/store')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>`
  ),

  adminReviewReceived: (p: { productName: string; customerName: string; customerEmail?: string; rating: number; reviewText: string; timestamp: string }) => wrapEmailHtml(
    'Admin Alert: New Product Review Received',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A new product review has been submitted on the store.</p>
     <div style="background-color:#fffbeb;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Product:</strong> ${escapeHtml(p.productName)}</p>
       <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(p.customerName)}${p.customerEmail ? ` (${escapeHtml(p.customerEmail)})` : ''}</p>
       <p style="margin:4px 0;"><strong>Rating:</strong> ${escapeHtml(String(p.rating))}/5</p>
       <p style="margin:6px 0 4px 0;"><strong>Review:</strong> "${escapeHtml(p.reviewText)}"</p>
       <p style="margin:4px 0;"><strong>Submitted At:</strong> ${escapeHtml(p.timestamp)}</p>
     </div>
     ${renderButton('Review in Admin Panel', '/admin', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Review Alert'
  ),

  customerPrivacyRequestReceived: (p: { name: string; ticketId: string; category: string }) => wrapEmailHtml(
    'Privacy & Grievance Request Acknowledgment',
    `<p>Hello <strong>${escapeHtml(p.name || 'User')}</strong>,</p>
     <p>We have received your privacy / grievance request.</p>
     <div style="background-color:#f8fafc;padding:14px;border-left:4px solid #FF9933;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Ticket ID:</strong> <code>${escapeHtml(p.ticketId)}</code></p>
       <p style="margin:4px 0;"><strong>Category:</strong> ${escapeHtml(p.category)}</p>
     </div>
     <p>Our Grievance Redressal Officer will review your request and respond within 48 hours, with resolution within 15 to 30 days as applicable.</p>
     ${renderButton('Track Your Request', '/privacy-request/track')}
     <p>Regards,<br/><strong>Grievance Officer, India Cyber Cafe</strong></p>`
  ),

  adminPrivacyRequestReceived: (p: {
    ticketId: string;
    category: string;
    name: string;
    email: string;
    phone?: string;
    referenceId?: string;
    description: string;
    timestamp: string;
  }) => wrapEmailHtml(
    'Admin Alert: New Privacy / Grievance Request',
    `<p>Hello <strong>Admin Team</strong>,</p>
     <p>A new privacy or grievance request has been filed.</p>
     <div style="background-color:#eff6ff;padding:14px;border-left:4px solid #1d4ed8;border-radius:6px;margin:14px 0;">
       <p style="margin:4px 0;"><strong>Ticket ID:</strong> <code>${escapeHtml(p.ticketId)}</code></p>
       <p style="margin:4px 0;"><strong>Category:</strong> ${escapeHtml(p.category)}</p>
       <p style="margin:4px 0;"><strong>Name:</strong> ${escapeHtml(p.name)}</p>
       <p style="margin:4px 0;"><strong>Email:</strong> ${escapeHtml(p.email)}</p>
       <p style="margin:4px 0;"><strong>Phone:</strong> ${escapeHtml(p.phone || 'N/A')}</p>
       <p style="margin:4px 0;"><strong>Reference ID:</strong> ${escapeHtml(p.referenceId || 'N/A')}</p>
       <p style="margin:4px 0;"><strong>Timestamp:</strong> ${escapeHtml(p.timestamp)}</p>
       <p style="margin:8px 0 4px 0;"><strong>Description:</strong> ${escapeHtml(p.description)}</p>
     </div>
     ${renderButton('Review in Admin Portal', '/admin/privacy-requests', '#1e293b')}
     <p>Best Regards,<br/><strong>India Cyber Cafe Notification System</strong></p>`,
    'Admin Grievance Alert'
  ),
};

// =============================================================================
// HIGH-LEVEL DOMAIN NOTIFICATION DISPATCHERS
// =============================================================================

export async function notifyApplicationUpdate(params: {
  appId: string;
  app: any;
  previousStatus: string;
  newStatus?: string;
  noteText?: string;
  attachmentName?: string;
  performedBy: { uid: string; name: string; email: string; role: string };
  assignedOperator?: { uid?: string; email?: string; name?: string } | null;
  timestamp?: string;
  idempotencyKey?: string;
}): Promise<NotificationDispatchReport> {
  const { appId, app, previousStatus, newStatus, noteText, attachmentName, performedBy, assignedOperator } = params;
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const customerName = String(app?.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(app?.email);
  const serviceName = String(app?.serviceName || 'Service').trim();
  const adminEmails = getAdminEmails();
  const baseKey = params.idempotencyKey || `app_update:${appId}:${newStatus || 'note'}:${Date.now()}`;

  const queue: NotificationDispatchItem[] = [];

  if (newStatus) {
    let customerTemplateId: 'customerStatusUpdated' | 'customerApplicationCompleted' | 'customerApplicationRejected' = 'customerStatusUpdated';
    let customerHtml = '';
    let customerSubject = `Status Update: ${serviceName} (${appId})`;

    if (newStatus === 'completed') {
      customerTemplateId = 'customerApplicationCompleted';
      customerSubject = `Application Completed: ${serviceName} (${appId})`;
      customerHtml = serverEmailTemplates.customerApplicationCompleted({
        customerName,
        serviceName,
        appId,
        noteText,
      });
    } else if (newStatus === 'rejected') {
      customerTemplateId = 'customerApplicationRejected';
      customerSubject = `Application Update: ${serviceName} (${appId})`;
      customerHtml = serverEmailTemplates.customerApplicationRejected({
        customerName,
        serviceName,
        appId,
        noteText,
      });
    } else {
      customerHtml = serverEmailTemplates.customerStatusUpdated({
        customerName,
        serviceName,
        appId,
        newStatus,
        noteText,
        attachmentName,
      });
    }

    // Always queue customer notification (even if missing/invalid email so failure is recorded honestly)
    queue.push({
      templateId: customerTemplateId,
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: customerSubject,
      html: customerHtml,
      idempotencyKey: baseKey,
      required: true,
      context: { appId, uid: app?.uid || app?.userId, actorUid: performedBy.uid, actorRole: performedBy.role },
    });

    const adminHtml = serverEmailTemplates.adminStatusUpdated({
      customerName,
      customerEmail: customerEmail || 'Missing',
      appId,
      serviceName,
      previousStatus,
      newStatus,
      performedByName: performedBy.name || performedBy.email,
      performedByRole: performedBy.role,
      noteText,
      timestamp,
    });
    for (const adminEmail of adminEmails) {
      queue.push({
        templateId: 'adminStatusUpdated',
        recipient: adminEmail,
        recipientRole: 'admin',
        subject: `[Admin Alert] Application ${appId} Status: ${newStatus.toUpperCase()}`,
        html: adminHtml,
        idempotencyKey: baseKey,
        context: { appId, actorUid: performedBy.uid, actorRole: performedBy.role },
      });
    }

    // Notify currently assigned Operator when relevant (e.g. Admin/system updated an assigned app)
    const opTarget = resolveOperatorRecipient(app, assignedOperator);
    if (opTarget && opTarget.email && opTarget.uid !== performedBy.uid && opTarget.email !== normalizeEmailAddress(performedBy.email)) {
      queue.push({
        templateId: 'operatorStatusUpdated',
        recipient: opTarget.email,
        recipientRole: 'operator',
        subject: `[Operator Update] ${serviceName} (${appId}) - ${newStatus.toUpperCase()}`,
        html: serverEmailTemplates.operatorStatusUpdated({
          operatorName: opTarget.name,
          customerName,
          appId,
          serviceName,
          previousStatus,
          newStatus,
          performedByName: performedBy.name || performedBy.email,
          noteText,
        }),
        idempotencyKey: baseKey,
        context: { appId, uid: opTarget.uid, actorUid: performedBy.uid, actorRole: performedBy.role },
      });
    }
  } else if (noteText || attachmentName) {
    const cleanNoteText = noteText || `Attachment uploaded: ${attachmentName}`;
    queue.push({
      templateId: 'customerNoteAdded',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `New Update on Your Application: ${serviceName} (${appId})`,
      html: serverEmailTemplates.customerNoteAdded({
        customerName,
        serviceName,
        appId,
        noteText: cleanNoteText,
        attachmentName,
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { appId, uid: app?.uid || app?.userId, actorUid: performedBy.uid, actorRole: performedBy.role },
    });

    const adminNoteHtml = serverEmailTemplates.adminNoteAdded({
      customerName,
      customerEmail: customerEmail || 'Missing',
      appId,
      serviceName,
      noteText: cleanNoteText,
      performedByName: performedBy.name || performedBy.email,
      performedByRole: performedBy.role,
      attachmentName,
      timestamp,
    });
    for (const adminEmail of adminEmails) {
      queue.push({
        templateId: 'adminNoteAdded',
        recipient: adminEmail,
        recipientRole: 'admin',
        subject: `[Admin Alert] New Note Added: ${serviceName} (${appId})`,
        html: adminNoteHtml,
        idempotencyKey: baseKey,
        context: { appId, actorUid: performedBy.uid, actorRole: performedBy.role },
      });
    }

    const opTarget = resolveOperatorRecipient(app, assignedOperator);
    if (opTarget && opTarget.email && opTarget.uid !== performedBy.uid && opTarget.email !== normalizeEmailAddress(performedBy.email)) {
      queue.push({
        templateId: 'operatorStatusUpdated',
        recipient: opTarget.email,
        recipientRole: 'operator',
        subject: `[Operator Update] New Note on ${serviceName} (${appId})`,
        html: serverEmailTemplates.operatorStatusUpdated({
          operatorName: opTarget.name,
          customerName,
          appId,
          serviceName,
          previousStatus,
          newStatus: String(app?.status || previousStatus || 'processing'),
          performedByName: performedBy.name || performedBy.email,
          noteText: cleanNoteText,
        }),
        idempotencyKey: baseKey,
        context: { appId, uid: opTarget.uid, actorUid: performedBy.uid, actorRole: performedBy.role },
      });
    }
  }

  return dispatchNotificationBatch(queue);
}

export async function notifyUserApplicationReply(params: {
  appId: string;
  app: any;
  noteText: string;
  attachmentNames?: string[];
  performedBy: { uid: string; name: string; email: string };
  assignedOperator?: { uid?: string; email?: string; name?: string } | null;
  timestamp?: string;
  idempotencyKey?: string;
}): Promise<NotificationDispatchReport> {
  const { appId, app, noteText, attachmentNames = [], performedBy, assignedOperator } = params;
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const customerName = String(app?.name || performedBy.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(app?.email || performedBy.email);
  const serviceName = String(app?.serviceName || 'Service').trim();
  const adminEmails = getAdminEmails();
  const baseKey = params.idempotencyKey || `app_user_reply:${appId}:${Date.now()}`;
  const attachmentSummary = attachmentNames.length > 0 ? attachmentNames.join(', ') : undefined;
  const cleanNoteText = noteText || (attachmentSummary ? `Customer uploaded attachments: ${attachmentSummary}` : 'Customer reply');

  const queue: NotificationDispatchItem[] = [];

  const adminNoteHtml = serverEmailTemplates.adminNoteAdded({
    customerName,
    customerEmail: customerEmail || 'Missing',
    appId,
    serviceName,
    noteText: cleanNoteText,
    performedByName: performedBy.name || performedBy.email,
    performedByRole: 'user',
    attachmentName: attachmentSummary,
    timestamp,
  });
  for (const adminEmail of adminEmails) {
    queue.push({
      templateId: 'adminNoteAdded',
      recipient: adminEmail,
      recipientRole: 'admin',
      subject: `[Customer Reply] ${serviceName} (${appId})`,
      html: adminNoteHtml,
      idempotencyKey: baseKey,
      context: { appId, actorUid: performedBy.uid, actorRole: 'user' },
    });
  }

  const opTarget = resolveOperatorRecipient(app, assignedOperator);
  if (opTarget && opTarget.email && opTarget.uid !== performedBy.uid && opTarget.email !== normalizeEmailAddress(performedBy.email)) {
    queue.push({
      templateId: 'operatorStatusUpdated',
      recipient: opTarget.email,
      recipientRole: 'operator',
      subject: `[Customer Reply] ${serviceName} (${appId})`,
      html: serverEmailTemplates.operatorStatusUpdated({
        operatorName: opTarget.name,
        customerName,
        appId,
        serviceName,
        previousStatus: String(app?.status || 'processing'),
        newStatus: String(app?.status || 'processing'),
        performedByName: `${performedBy.name || performedBy.email} (Customer)`,
        noteText: cleanNoteText,
      }),
      idempotencyKey: baseKey,
      context: { appId, uid: opTarget.uid, actorUid: performedBy.uid, actorRole: 'user' },
    });
  }

  return dispatchNotificationBatch(queue);
}

export async function notifyApplicationAssignment(params: {
  appId: string;
  app: any;
  newOperator?: { uid: string; email: string; name: string } | null;
  previousOperator?: { uid?: string; email?: string; name?: string } | null;
  assignedBy: { uid: string; name: string; email: string; role: string };
  timestamp?: string;
  idempotencyKey?: string;
}): Promise<NotificationDispatchReport> {
  const { appId, app, newOperator, previousOperator, assignedBy } = params;
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const customerName = String(app?.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(app?.email);
  const serviceName = String(app?.serviceName || 'Service').trim();
  const adminEmails = getAdminEmails();
  const baseKey = params.idempotencyKey || `app_assign:${appId}:${newOperator?.uid || 'unassigned'}:${Date.now()}`;

  const prevEmail = normalizeEmailAddress(previousOperator?.email);
  const nextEmail = normalizeEmailAddress(newOperator?.email);
  const isReassignment = Boolean(prevEmail && nextEmail && (prevEmail !== nextEmail || previousOperator?.uid !== newOperator?.uid));
  const isUnassignmentOnly = Boolean(prevEmail && !nextEmail);

  const queue: NotificationDispatchItem[] = [];

  if (newOperator && nextEmail) {
    queue.push({
      templateId: isReassignment ? 'operatorReassigned' : 'operatorAssigned',
      recipient: nextEmail,
      recipientRole: 'operator',
      subject: isReassignment
        ? `Application Reassigned to You: ${serviceName} (${appId})`
        : `New Assignment: ${serviceName} (${appId})`,
      html: isReassignment
        ? serverEmailTemplates.operatorReassigned({
            operatorName: newOperator.name,
            customerName,
            serviceName,
            appId,
            assignedByName: assignedBy.name || assignedBy.email,
            timestamp,
          })
        : serverEmailTemplates.operatorAssigned({
            operatorName: newOperator.name,
            customerName,
            serviceName,
            appId,
            assignedByName: assignedBy.name || assignedBy.email,
            timestamp,
          }),
      idempotencyKey: baseKey,
      context: { appId, uid: newOperator.uid, actorUid: assignedBy.uid, actorRole: assignedBy.role },
    });

    queue.push({
      templateId: 'customerOperatorAssigned',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `Operator Assigned: ${serviceName} (${appId})`,
      html: serverEmailTemplates.customerOperatorAssigned({
        customerName,
        serviceName,
        appId,
        operatorName: newOperator.name,
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { appId, uid: app?.uid || app?.userId, actorUid: assignedBy.uid, actorRole: assignedBy.role },
    });
  }

  if ((isReassignment || isUnassignmentOnly) && prevEmail) {
    queue.push({
      templateId: 'previousOperatorUnassigned',
      recipient: prevEmail,
      recipientRole: 'previous_operator',
      subject: `Application Assignment Removed: ${serviceName} (${appId})`,
      html: serverEmailTemplates.previousOperatorUnassigned({
        previousOperatorName: previousOperator?.name || prevEmail.split('@')[0] || 'Operator',
        serviceName,
        appId,
        unassignedByName: assignedBy.name || assignedBy.email,
        timestamp,
      }),
      idempotencyKey: baseKey,
      context: { appId, uid: previousOperator?.uid, actorUid: assignedBy.uid, actorRole: assignedBy.role },
    });
  }

  const adminHtml = serverEmailTemplates.adminOperatorAssigned({
    operatorName: newOperator?.name || 'Unassigned',
    operatorEmail: nextEmail,
    previousOperatorEmail: prevEmail || undefined,
    customerName,
    customerEmail: customerEmail || 'Missing',
    serviceName,
    appId,
    assignedByName: assignedBy.name || assignedBy.email,
    timestamp,
  });

  for (const adminEmail of adminEmails) {
    queue.push({
      templateId: 'adminOperatorAssigned',
      recipient: adminEmail,
      recipientRole: 'admin',
      subject: `[Admin Alert] Operator ${newOperator ? 'Assigned' : 'Unassigned'}: ${serviceName} (${appId})`,
      html: adminHtml,
      idempotencyKey: baseKey,
      context: { appId, actorUid: assignedBy.uid, actorRole: assignedBy.role },
    });
  }

  return dispatchNotificationBatch(queue);
}

export async function notifyApplicationSubmitted(params: {
  appId: string;
  app: any;
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const { appId, app } = params;
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const customerName = String(app?.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(app?.email);
  const serviceName = String(app?.serviceName || 'Service').trim();
  const charge = typeof app?.charge === 'number' ? app.charge : Number(app?.charge) || 0;
  const paymentStatus = String(app?.paymentStatus || 'pending');
  const baseKey = `app_submitted:${appId}`;

  const queue: NotificationDispatchItem[] = [
    {
      templateId: 'customerApplicationSubmitted',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `Application Received: ${serviceName} (${appId})`,
      html: serverEmailTemplates.customerApplicationSubmitted({
        customerName,
        serviceName,
        appId,
        charge,
        paymentStatus,
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { appId, uid: app?.uid },
    },
    ...getAdminEmails().map(adminEmail => ({
      templateId: 'adminNewApplication',
      recipient: adminEmail,
      recipientRole: 'admin' as const,
      subject: `[Admin Alert] New Application Received: ${serviceName} (${appId})`,
      html: serverEmailTemplates.adminNewApplication({
        customerName,
        customerEmail: customerEmail || 'Missing',
        serviceName,
        appId,
        charge,
        paymentStatus,
        timestamp,
      }),
      idempotencyKey: baseKey,
      context: { appId },
    })),
  ];

  if (paymentStatus === 'completed' && charge > 0) {
    const payKey = `app_payment:${appId}`;
    const txId = app?.razorpayPaymentId || `APP-${appId}`;
    queue.push({
      templateId: 'customerPaymentConfirmed',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `Payment Confirmed: ${serviceName} (${appId})`,
      html: serverEmailTemplates.customerPaymentConfirmed({
        customerName,
        amount: charge.toFixed(2),
        serviceName,
        appId,
        transactionId: txId,
        paymentMethod: app?.paymentMethod || 'online',
      }),
      idempotencyKey: payKey,
      required: true,
      context: { appId, uid: app?.uid },
    });
    for (const adminEmail of getAdminEmails()) {
      queue.push({
        templateId: 'adminPaymentReceived',
        recipient: adminEmail,
        recipientRole: 'admin',
        subject: `[Admin Alert] Payment Received: ${serviceName} (${appId})`,
        html: serverEmailTemplates.adminPaymentReceived({
          customerName,
          customerEmail: customerEmail || 'Missing',
          amount: charge.toFixed(2),
          serviceName,
          appId,
          transactionId: txId,
          paymentMethod: app?.paymentMethod || 'online',
          timestamp,
        }),
        idempotencyKey: payKey,
        context: { appId },
      });
    }
  }

  return dispatchNotificationBatch(queue);
}

export async function notifyApplicationPaymentConfirmed(params: {
  appId: string;
  app: any;
  transactionId: string;
  paymentMethod?: string;
  razorpayOrderId?: string;
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const { appId, app, transactionId, paymentMethod, razorpayOrderId } = params;
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const customerName = String(app?.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(app?.email);
  const serviceName = String(app?.serviceName || 'Service').trim();
  const amount = (typeof app?.charge === 'number' ? app.charge : Number(app?.charge) || 0).toFixed(2);
  const baseKey = `app_payment:${appId}:${transactionId}`;

  const queue: NotificationDispatchItem[] = [
    {
      templateId: 'customerPaymentConfirmed',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `Payment Confirmed: ${serviceName} (${appId})`,
      html: serverEmailTemplates.customerPaymentConfirmed({
        customerName,
        amount,
        serviceName,
        appId,
        transactionId,
        paymentMethod: paymentMethod || app?.paymentMethod,
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { appId, uid: app?.uid },
    },
    ...getAdminEmails().map(adminEmail => ({
      templateId: 'adminPaymentReceived',
      recipient: adminEmail,
      recipientRole: 'admin' as const,
      subject: `[Admin Alert] Payment Received: ${serviceName} (${appId})`,
      html: serverEmailTemplates.adminPaymentReceived({
        customerName,
        customerEmail: customerEmail || 'Missing',
        amount,
        serviceName,
        appId,
        transactionId,
        paymentMethod: paymentMethod || app?.paymentMethod,
        razorpayOrderId,
        timestamp,
      }),
      idempotencyKey: baseKey,
      context: { appId },
    })),
  ];

  return dispatchNotificationBatch(queue);
}

export async function notifyDirectPayLinkPayment(params: {
  receiptId: string;
  amount: number;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  reference?: string;
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const baseKey = `paylink:${params.razorpayPaymentId}`;

  const queue: NotificationDispatchItem[] = getAdminEmails().map(adminEmail => ({
    templateId: 'adminPaymentReceived',
    recipient: adminEmail,
    recipientRole: 'admin' as const,
    subject: `[Admin Alert] Direct Payment Received - ₹${params.amount.toFixed(2)} (${params.receiptId})`,
    html: serverEmailTemplates.adminPaymentReceived({
      customerName: params.reference ? `Pay Link (${params.reference})` : 'Direct Pay Link Customer',
      amount: params.amount.toFixed(2),
      serviceName: 'Public /pay Payment Link',
      transactionId: params.razorpayPaymentId,
      paymentMethod: 'razorpay',
      razorpayOrderId: params.razorpayOrderId,
      timestamp,
    }),
    idempotencyKey: baseKey,
  }));

  return dispatchNotificationBatch(queue);
}

export async function notifyOrderConfirmed(params: {
  order: any;
  type: 'cod' | 'online';
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const { order, type } = params;
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const orderId = String(order?.id || '').trim();
  const customerName = String(order?.deliveryAddress?.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(order?.deliveryAddress?.email || order?.email);
  const customerPhone = String(order?.deliveryAddress?.phone || 'N/A').trim();
  const items = Array.isArray(order?.items) ? order.items : Object.values(order?.items || {});
  const totalAmount = Number(order?.total) || 0;
  const baseKey = `order_confirmed:${orderId}`;

  const queue: NotificationDispatchItem[] = [
    {
      templateId: 'customerOrderConfirmed',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `Order Confirmed: ${orderId} - India Cyber Cafe`,
      html: serverEmailTemplates.customerOrderConfirmed({
        customerName,
        orderId,
        items,
        totalAmount,
        paymentMethod: type,
        paymentStatus: order?.paymentStatus || (type === 'cod' ? 'pending' : 'completed'),
        address: order?.deliveryAddress,
        isGuest: Boolean(order?.isGuest),
        digitalDownloads: Array.isArray(order?.digitalDownloads) ? order.digitalDownloads : [],
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { orderId, uid: order?.uid },
    },
    ...getAdminEmails().map(adminEmail => ({
      templateId: 'adminOrderCreated',
      recipient: adminEmail,
      recipientRole: 'admin' as const,
      subject: `[Admin Alert] New ${type.toUpperCase()} Store Order [${orderId}] - ₹${totalAmount.toFixed(2)}`,
      html: serverEmailTemplates.adminOrderCreated({
        orderId,
        customerName,
        customerEmail: customerEmail || 'Missing',
        customerPhone,
        isGuest: Boolean(order?.isGuest),
        items,
        totalAmount,
        paymentMethod: order?.paymentMethod || type,
        paymentStatus: order?.paymentStatus || 'pending',
        address: order?.deliveryAddress,
        timestamp,
      }),
      idempotencyKey: baseKey,
      context: { orderId },
    })),
  ];

  return dispatchNotificationBatch(queue);
}

export async function notifyDigitalDelivery(params: { order: any; downloads: any[]; idempotencyKey: string }): Promise<NotificationDispatchReport> {
  const { order, downloads, idempotencyKey } = params;
  const orderId = String(order?.id || '').trim();
  const customerName = String(order?.deliveryAddress?.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(order?.deliveryAddress?.email || order?.email);
  if (!orderId || order?.paymentStatus !== 'completed' || !customerEmail || !Array.isArray(downloads) || downloads.length === 0) {
    throw new Error('Digital delivery email requires a paid order and download resources.');
  }
  return dispatchNotificationBatch([{
    templateId: 'customerDigitalDelivery',
    recipient: customerEmail,
    recipientRole: 'customer',
    subject: `Your digital downloads are ready: ${orderId} - India Cyber Cafe`,
    html: serverEmailTemplates.customerDigitalDelivery({
      customerName,
      orderId,
      downloads,
      totalAmount: Number(order.total) || 0,
    }),
    idempotencyKey,
    required: true,
    context: { orderId, uid: order?.uid },
  }]);
}

export async function notifyOrderStatusUpdated(params: {
  order: any;
  newStatus: string;
  reason?: string;
  estimatedDelivery?: string;
  performedBy: { uid: string; name: string; email: string };
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const { order, newStatus, reason, estimatedDelivery, performedBy } = params;
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const orderId = String(order?.id || '').trim();
  const customerName = String(order?.deliveryAddress?.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(order?.deliveryAddress?.email || order?.email);
  const items = Array.isArray(order?.items) ? order.items : Object.values(order?.items || {});
  const productName = String((items[0] as any)?.productName || (items[0] as any)?.name || 'Store Order Item');
  const totalAmount = Number(order?.total) || 0;
  const baseKey = `order_status:${orderId}:${newStatus}:${Date.now()}`;

  const queue: NotificationDispatchItem[] = [];

  if (newStatus === 'cancelled') {
    queue.push({
      templateId: 'customerOrderCancelled',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `Order Cancelled: ${orderId} - India Cyber Cafe`,
      html: serverEmailTemplates.customerOrderCancelled({
        customerName,
        orderId,
        productName,
        totalAmount,
        reason,
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { orderId, uid: order?.uid, actorUid: performedBy.uid },
    });

    for (const adminEmail of getAdminEmails()) {
      queue.push({
        templateId: 'adminOrderCancelled',
        recipient: adminEmail,
        recipientRole: 'admin',
        subject: `[Admin Alert] Order Cancelled: ${orderId}`,
        html: serverEmailTemplates.adminOrderCancelled({
          orderId,
          customerName,
          customerEmail: customerEmail || 'Missing',
          productName,
          totalAmount,
          paymentMethod: order?.paymentMethod,
          reason,
          performedByName: performedBy.name || performedBy.email,
          timestamp,
        }),
        idempotencyKey: baseKey,
        context: { orderId, actorUid: performedBy.uid },
      });
    }
  } else {
    queue.push({
      templateId: 'customerOrderStatusUpdated',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `Order Status Updated (${newStatus.toUpperCase()}): ${orderId}`,
      html: serverEmailTemplates.customerOrderStatusUpdated({
        customerName,
        orderId,
        newStatus,
        productName,
        estimatedDelivery,
        isGuest: Boolean(order?.isGuest),
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { orderId, uid: order?.uid, actorUid: performedBy.uid },
    });
  }

  return dispatchNotificationBatch(queue);
}

export async function notifyOrderRefundInitiated(params: {
  order: any;
  refundAmount: number;
  expectedDays?: number;
  reason?: string;
  performedBy: { uid: string; name: string; email: string };
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const { order, refundAmount, expectedDays, reason, performedBy } = params;
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const orderId = String(order?.id || '').trim();
  const customerName = String(order?.deliveryAddress?.name || 'Customer').trim();
  const customerEmail = normalizeEmailAddress(order?.deliveryAddress?.email || order?.email);
  const baseKey = `order_refund:${orderId}:${refundAmount.toFixed(2)}`;

  const queue: NotificationDispatchItem[] = [
    {
      templateId: 'customerRefundInitiated',
      recipient: customerEmail,
      recipientRole: 'customer',
      subject: `Refund Initiated: ${orderId} - India Cyber Cafe`,
      html: serverEmailTemplates.customerRefundInitiated({
        customerName,
        orderId,
        refundAmount,
        expectedDays,
        reason,
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { orderId, uid: order?.uid, actorUid: performedBy.uid },
    },
    ...getAdminEmails().map(adminEmail => ({
      templateId: 'adminRefundInitiated',
      recipient: adminEmail,
      recipientRole: 'admin' as const,
      subject: `[Admin Alert] Refund Initiated: ${orderId}`,
      html: serverEmailTemplates.adminRefundInitiated({
        orderId,
        customerName,
        customerEmail: customerEmail || 'Missing',
        refundAmount,
        reason,
        performedByName: performedBy.name || performedBy.email,
        timestamp,
      }),
      idempotencyKey: baseKey,
      context: { orderId, actorUid: performedBy.uid },
    })),
  ];

  return dispatchNotificationBatch(queue);
}

export async function notifyUserRegistration(params: {
  uid: string;
  userName: string;
  userEmail: string;
  phone?: string;
  authProvider?: string;
  isGuestCheckout?: boolean;
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const email = normalizeEmailAddress(params.userEmail);
  const baseKey = `registration:${params.uid}`;

  const queue: NotificationDispatchItem[] = [
    {
      templateId: 'customerRegistration',
      recipient: email,
      recipientRole: 'customer',
      subject: 'Welcome to India Cyber Cafe!',
      html: serverEmailTemplates.customerRegistration({
        userName: params.userName,
        authProvider: params.authProvider,
        isGuestCheckout: params.isGuestCheckout,
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { uid: params.uid },
    },
    ...getAdminEmails().map(adminEmail => ({
      templateId: 'adminUserRegistered',
      recipient: adminEmail,
      recipientRole: 'admin' as const,
      subject: params.authProvider === 'google'
        ? '[Admin Alert] New Google User Registered - India Cyber Cafe'
        : '[Admin Alert] New User Registered - India Cyber Cafe',
      html: serverEmailTemplates.adminUserRegistered({
        userName: params.userName,
        userEmail: email || 'Missing',
        phone: params.phone,
        authProvider: params.authProvider,
        timestamp,
      }),
      idempotencyKey: baseKey,
      context: { uid: params.uid },
    })),
  ];

  return dispatchNotificationBatch(queue);
}

export async function notifyProfileUpdated(params: {
  uid: string;
  userName: string;
  userEmail: string;
  updateType: string;
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const email = normalizeEmailAddress(params.userEmail);
  return dispatchNotificationBatch([
    {
      templateId: 'customerProfileUpdated',
      recipient: email,
      recipientRole: 'customer',
      subject: 'Profile Updated Successfully - India Cyber Cafe',
      html: serverEmailTemplates.customerProfileUpdated({
        userName: params.userName,
        updateType: params.updateType,
        timestamp,
      }),
      idempotencyKey: `profile_update:${params.uid}:${params.updateType}:${Date.now()}`,
      required: true,
      context: { uid: params.uid },
    },
  ]);
}

export async function notifyCallbackRequest(params: {
  mobileNumber: string;
  customerName?: string;
  customerEmail?: string;
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const baseKey = `callback:${params.mobileNumber}:${Math.floor(Date.now() / 60000)}`;

  const queue: NotificationDispatchItem[] = getAdminEmails().map(adminEmail => ({
    templateId: 'adminCallbackReceived',
    recipient: adminEmail,
    recipientRole: 'admin' as const,
    subject: `[Admin Alert] New Call Back Request - ${params.mobileNumber}`,
    html: serverEmailTemplates.adminCallbackReceived({
      mobileNumber: params.mobileNumber,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      timestamp,
    }),
    idempotencyKey: baseKey,
  }));

  if (params.customerEmail && isValidEmailAddress(params.customerEmail)) {
    queue.push({
      templateId: 'customerCallbackReceived',
      recipient: normalizeEmailAddress(params.customerEmail),
      recipientRole: 'customer',
      subject: 'Call Back Request Received - India Cyber Cafe',
      html: serverEmailTemplates.customerCallbackReceived({
        customerName: params.customerName,
        mobileNumber: params.mobileNumber,
        timestamp,
      }),
      idempotencyKey: baseKey,
    });
  }

  return dispatchNotificationBatch(queue);
}

export async function notifyReviewSubmitted(params: {
  uid: string;
  productId: string;
  productName: string;
  customerName: string;
  customerEmail: string;
  rating: number;
  reviewText: string;
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const email = normalizeEmailAddress(params.customerEmail);
  const baseKey = `review:${params.uid}:${params.productId}:${Date.now()}`;

  const queue: NotificationDispatchItem[] = [
    {
      templateId: 'customerReviewSubmitted',
      recipient: email,
      recipientRole: 'customer',
      subject: `Review Submitted: ${params.productName} - India Cyber Cafe`,
      html: serverEmailTemplates.customerReviewSubmitted({
        customerName: params.customerName,
        productName: params.productName,
      }),
      idempotencyKey: baseKey,
      required: true,
      context: { uid: params.uid, productId: params.productId },
    },
    ...getAdminEmails().map(adminEmail => ({
      templateId: 'adminReviewReceived',
      recipient: adminEmail,
      recipientRole: 'admin' as const,
      subject: `[Admin Alert] New Review Received: ${params.productName}`,
      html: serverEmailTemplates.adminReviewReceived({
        productName: params.productName,
        customerName: params.customerName,
        customerEmail: email,
        rating: params.rating,
        reviewText: params.reviewText,
        timestamp,
      }),
      idempotencyKey: baseKey,
      context: { uid: params.uid, productId: params.productId },
    })),
  ];

  return dispatchNotificationBatch(queue);
}

export async function notifyPrivacyRequestSubmitted(params: {
  ticketId: string;
  category: string;
  name: string;
  email: string;
  phone?: string;
  referenceId?: string;
  description: string;
  timestamp?: string;
}): Promise<NotificationDispatchReport> {
  const timestamp = params.timestamp || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const email = normalizeEmailAddress(params.email);
  const baseKey = `privacy:${params.ticketId}`;

  const queue: NotificationDispatchItem[] = [
    {
      templateId: 'customerPrivacyRequestReceived',
      recipient: email,
      recipientRole: 'customer',
      subject: `[${params.ticketId}] Acknowledgment: Privacy & Grievance Request`,
      html: serverEmailTemplates.customerPrivacyRequestReceived({
        name: params.name,
        ticketId: params.ticketId,
        category: params.category,
      }),
      fromName: 'India Cyber Cafe Grievance Cell',
      idempotencyKey: baseKey,
      required: true,
      context: { ticketId: params.ticketId },
    },
    ...getAdminEmails().map(adminEmail => ({
      templateId: 'adminPrivacyRequestReceived',
      recipient: adminEmail,
      recipientRole: 'admin' as const,
      subject: `[Admin Alert] New Privacy Request [${params.ticketId}] - ${params.name}`,
      html: serverEmailTemplates.adminPrivacyRequestReceived({
        ticketId: params.ticketId,
        category: params.category,
        name: params.name,
        email,
        phone: params.phone,
        referenceId: params.referenceId,
        description: params.description,
        timestamp,
      }),
      fromName: 'India Cyber Cafe Portal',
      idempotencyKey: baseKey,
      context: { ticketId: params.ticketId },
    })),
  ];

  return dispatchNotificationBatch(queue);
}

// =============================================================================
// DURABLE BACKGROUND NOTIFICATION OUTBOX (NON-BLOCKING QUEUE + RETRY + RECOVERY)
// =============================================================================

export type OutboxJobKind =
  | 'application_update'
  | 'user_reply'
  | 'application_submitted'
  | 'application_assigned'
  | 'application_payment'
  | 'order_confirmed'
  | 'digital_delivery'
  | 'order_status'
  | 'order_refund'
  | 'pay_link_payment'
  | 'privacy_request'
  | 'user_registration'
  | 'profile_updated'
  | 'review_submitted'
  | 'callback_request';

export type OutboxJobState = 'queued' | 'processing' | 'completed' | 'failed';

export interface OutboxJobRecord {
  jobId: string;
  idempotencyKey: string;
  kind: OutboxJobKind;
  appId: string;
  orderId?: string;
  ticketId?: string;
  payload: any;
  state: OutboxJobState;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
  lastError?: string;
  report?: NotificationDispatchReport;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

type OutboxOperatorResolver = (uid: string) => Promise<{ uid?: string; email?: string; name?: string } | null>;

const outboxJobs = new Map<string, OutboxJobRecord>();
const outboxIdempotencyIndex = new Map<string, string>();
const outboxDlqJobs = new Map<string, OutboxJobRecord>();
let outboxHydrated = false;
let outboxWorkerTimer: ReturnType<typeof setTimeout> | null = null;
let outboxWorkerPromise: Promise<void> | null = null;
let outboxOperatorResolver: OutboxOperatorResolver | null = null;

const OUTBOX_WORKER_CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.WORKER_CONCURRENCY || '6') || 6));
const OUTBOX_LEASE_MS = 30000;

export function registerOutboxOperatorProfileResolver(resolver: OutboxOperatorResolver | null) {
  outboxOperatorResolver = resolver;
}

function readDiskOutbox(): Record<string, OutboxJobRecord> {
  try {
    if (fs.existsSync(NOTIFICATION_OUTBOX_PATH)) {
      return JSON.parse(fs.readFileSync(NOTIFICATION_OUTBOX_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

let outboxFlushTimer: NodeJS.Timeout | null = null;
let outboxWriting = false;
let outboxDirty = false;

function buildBoundedOutboxSnapshot(): Record<string, OutboxJobRecord> {
  const all = Array.from(outboxJobs.values());
  const activeOrFailed = all.filter(j => j.state !== 'completed');
  const completed = all
    .filter(j => j.state === 'completed')
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 200);
  const bounded = [...activeOrFailed, ...completed];
  const obj: Record<string, OutboxJobRecord> = {};
  for (const j of bounded) {
    obj[j.jobId] = j;
  }
  return obj;
}

async function flushOutboxToDiskAsync(): Promise<void> {
  if (outboxWriting) {
    outboxDirty = true;
    return;
  }
  outboxDirty = false;
  outboxWriting = true;
  try {
    await writeJsonAtomicAsync(NOTIFICATION_OUTBOX_PATH, buildBoundedOutboxSnapshot());
  } catch (err: any) {
    console.warn('[emailOutbox] Could not persist outbox to disk:', err?.message || err);
  } finally {
    outboxWriting = false;
    if (outboxDirty) {
      scheduleOutboxFlush();
    }
  }
}

function scheduleOutboxFlush() {
  outboxDirty = true;
  if (outboxFlushTimer) return;
  outboxFlushTimer = setTimeout(() => {
    outboxFlushTimer = null;
    void flushOutboxToDiskAsync();
  }, 150);
  if (typeof outboxFlushTimer.unref === 'function') outboxFlushTimer.unref();
}

function writeDiskOutbox() {
  try {
    if (isTestMode()) {
      writeJsonAtomicSync(NOTIFICATION_OUTBOX_PATH, buildBoundedOutboxSnapshot());
      return;
    }
    scheduleOutboxFlush();
  } catch (err: any) {
    console.warn('[emailOutbox] Could not persist outbox to disk:', err?.message || err);
  }
}

function hydrateOutboxCache(resetInFlightOnStartup = false) {
  if (outboxHydrated && !resetInFlightOnStartup) return;
  const disk = readDiskOutbox();
  if (!outboxHydrated) {
    outboxJobs.clear();
    outboxIdempotencyIndex.clear();
    outboxDlqJobs.clear();
    for (const [jobId, rec] of Object.entries(disk)) {
      if (!rec || typeof rec !== 'object') continue;
      if (resetInFlightOnStartup && rec.state === 'processing') {
        rec.state = 'queued';
        rec.leaseOwner = null;
        rec.leaseExpiresAt = null;
        rec.nextAttemptAt = Date.now();
        rec.updatedAt = new Date().toISOString();
      }
      outboxJobs.set(jobId, rec);
      if (rec.state === 'failed') {
        outboxDlqJobs.set(jobId, rec);
      }
      if (rec.idempotencyKey) {
        outboxIdempotencyIndex.set(rec.idempotencyKey, jobId);
      }
    }
    outboxHydrated = true;
    if (resetInFlightOnStartup) {
      writeDiskOutbox();
    }
  } else if (resetInFlightOnStartup) {
    let changed = false;
    const now = Date.now();
    for (const job of outboxJobs.values()) {
      if (job.state === 'processing' && (!job.leaseExpiresAt || job.leaseExpiresAt <= now)) {
        job.state = 'queued';
        job.leaseOwner = null;
        job.leaseExpiresAt = null;
        job.nextAttemptAt = now;
        job.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) writeDiskOutbox();
  }
}

export function resetNotificationOutboxForTesting() {
  if (outboxWorkerTimer) {
    clearTimeout(outboxWorkerTimer);
    outboxWorkerTimer = null;
  }
  outboxJobs.clear();
  outboxIdempotencyIndex.clear();
  outboxDlqJobs.clear();
  outboxHydrated = true;
  resetAsyncQueueForTesting();
  if (isTestMode()) {
    try {
      if (fs.existsSync(NOTIFICATION_OUTBOX_PATH)) {
        fs.unlinkSync(NOTIFICATION_OUTBOX_PATH);
      }
    } catch {}
  }
}

export function getOutboxJobsForTesting(filters?: { state?: OutboxJobState; appId?: string }): OutboxJobRecord[] {
  hydrateOutboxCache();
  let list = Array.from(outboxJobs.values());
  if (filters?.state) list = list.filter(j => j.state === filters.state);
  if (filters?.appId) list = list.filter(j => j.appId === filters.appId);
  return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function getNotificationOutboxStats() {
  hydrateOutboxCache();
  let queued = 0;
  let processing = 0;
  let completed = 0;
  let failed = 0;
  for (const job of outboxJobs.values()) {
    if (job.state === 'queued') queued++;
    else if (job.state === 'processing') processing++;
    else if (job.state === 'completed') completed++;
    else failed++;
  }
  return { queued, processing, completed, failed, dlqCount: outboxDlqJobs.size };
}

export function getOutboxDlqJobs(limit = 50): OutboxJobRecord[] {
  hydrateOutboxCache();
  return Array.from(outboxJobs.values())
    .filter(j => j.state === 'failed')
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, Math.max(1, limit));
}

export async function replayOutboxJob(jobId: string): Promise<{ found: boolean; job?: OutboxJobRecord }> {
  hydrateOutboxCache();
  const job = outboxJobs.get(jobId);
  if (!job) return { found: false };
  job.state = 'queued';
  job.attempts = 0;
  job.nextAttemptAt = Date.now();
  job.leaseOwner = null;
  job.leaseExpiresAt = null;
  job.lastError = undefined;
  job.updatedAt = new Date().toISOString();
  outboxDlqJobs.delete(jobId);
  writeDiskOutbox();
  await runOutboxWorkerLoop();
  return { found: true, job: outboxJobs.get(jobId) || job };
}

function mirrorOutboxFailureAsync(job: OutboxJobRecord) {
  if (isTestMode() || getApps().length === 0) return;
  try {
    const db = getDatabase(getApps()[0]);
    Promise.race([
      db.ref(`notificationOutbox/${job.jobId}`).set({
        jobId: job.jobId,
        idempotencyKey: job.idempotencyKey,
        kind: job.kind,
        appId: job.appId || null,
        orderId: job.orderId || null,
        ticketId: job.ticketId || null,
        state: job.state,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError || null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }),
      new Promise(resolve => setTimeout(resolve, 2500)),
    ]).catch(() => {});
  } catch {}
}

function scheduleOutboxWorker(delayMs = 0) {
  if (process.env.DISABLE_EMBEDDED_WORKER === '1') return;
  if (outboxWorkerTimer) {
    clearTimeout(outboxWorkerTimer);
    outboxWorkerTimer = null;
  }
  const safeDelay = Math.max(0, delayMs);
  outboxWorkerTimer = setTimeout(() => {
    outboxWorkerTimer = null;
    void runOutboxWorkerLoop();
  }, safeDelay);
  if (typeof outboxWorkerTimer.unref === 'function') {
    outboxWorkerTimer.unref();
  }
}

async function executeOutboxDispatch(job: OutboxJobRecord): Promise<NotificationDispatchReport> {
  const p = job.payload || {};
  switch (job.kind) {
    case 'application_update': {
      let assignedOperator = p.assignedOperator ?? null;
      const assignedUid = p.appSnapshot?.assignedToUid;
      if (!assignedOperator && assignedUid && outboxOperatorResolver) {
        assignedOperator = await outboxOperatorResolver(String(assignedUid)).catch(() => null);
      }
      return notifyApplicationUpdate({
        appId: job.appId,
        app: p.appSnapshot,
        previousStatus: p.previousStatus || 'processing',
        newStatus: p.newStatus,
        noteText: p.noteText,
        attachmentName: p.attachmentName,
        performedBy: {
          uid: p.performedBy.uid,
          name: p.performedBy.name,
          email: p.performedBy.email,
          role: p.performedBy.role || 'operator',
        },
        assignedOperator,
        timestamp: p.timestamp,
        idempotencyKey: job.idempotencyKey,
      });
    }
    case 'user_reply': {
      let assignedOperator = p.assignedOperator ?? null;
      const assignedUid = p.appSnapshot?.assignedToUid;
      if (!assignedOperator && assignedUid && outboxOperatorResolver) {
        assignedOperator = await outboxOperatorResolver(String(assignedUid)).catch(() => null);
      }
      return notifyUserApplicationReply({
        appId: job.appId,
        app: p.appSnapshot,
        noteText: p.noteText || '',
        attachmentNames: p.attachmentNames || [],
        performedBy: {
          uid: p.performedBy.uid,
          name: p.performedBy.name,
          email: p.performedBy.email,
        },
        assignedOperator,
        timestamp: p.timestamp,
        idempotencyKey: job.idempotencyKey,
      });
    }
    case 'application_submitted':
      return notifyApplicationSubmitted({
        appId: job.appId,
        app: p.app,
        timestamp: p.timestamp,
      });
    case 'application_assigned':
      return notifyApplicationAssignment({
        appId: job.appId,
        app: p.app,
        newOperator: p.newOperator,
        previousOperator: p.previousOperator,
        assignedBy: p.assignedBy,
        timestamp: p.timestamp,
      });
    case 'application_payment':
      return notifyApplicationPaymentConfirmed({
        appId: job.appId,
        app: p.app,
        transactionId: p.transactionId || p.paymentId || `APP-${job.appId}`,
        paymentMethod: p.paymentMethod,
        razorpayOrderId: p.razorpayOrderId,
        timestamp: p.timestamp,
      });
    case 'order_confirmed': {
      const orderType: 'cod' | 'online' =
        p.type === 'cod' || p.order?.paymentMethod === 'cash' ? 'cod' : 'online';
      return notifyOrderConfirmed({
        order: p.order,
        type: orderType,
        timestamp: p.timestamp,
      });
    }
    case 'digital_delivery':
      return notifyDigitalDelivery({
        order: p.order,
        downloads: p.downloads,
        idempotencyKey: job.idempotencyKey,
      });
    case 'order_status':
      return notifyOrderStatusUpdated({
        order: p.order,
        newStatus: p.newStatus,
        reason: p.reason,
        estimatedDelivery: p.estimatedDelivery,
        performedBy: p.performedBy || { uid: 'system', name: 'Admin', email: 'icc@indiacybercafe.com' },
        timestamp: p.timestamp,
      });
    case 'order_refund':
      return notifyOrderRefundInitiated({
        order: p.order,
        refundAmount: p.refundAmount,
        expectedDays: p.expectedDays,
        reason: p.reason,
        performedBy: p.performedBy || { uid: 'system', name: 'Admin', email: 'icc@indiacybercafe.com' },
        timestamp: p.timestamp,
      });
    case 'pay_link_payment':
      return notifyDirectPayLinkPayment({
        receiptId: p.receiptId,
        amount: p.amount,
        razorpayPaymentId: p.razorpayPaymentId,
        razorpayOrderId: p.razorpayOrderId,
        reference: p.reference,
        timestamp: p.timestamp,
      });
    case 'privacy_request':
      return notifyPrivacyRequestSubmitted({
        ticketId: p.ticketId || job.ticketId || '',
        category: p.category,
        name: p.name,
        email: p.email,
        phone: p.phone,
        referenceId: p.referenceId,
        description: p.description,
        timestamp: p.timestamp,
      });
    case 'user_registration':
      return notifyUserRegistration({
        uid: p.uid,
        userName: p.userName || p.name || 'Customer',
        userEmail: p.userEmail || p.email || '',
        phone: p.phone,
        authProvider: p.authProvider || (p.isGoogle ? 'google' : 'password'),
        isGuestCheckout: p.isGuestCheckout,
        timestamp: p.timestamp,
      });
    case 'profile_updated':
      return notifyProfileUpdated({
        uid: p.uid,
        userName: p.userName || p.name || 'Customer',
        userEmail: p.userEmail || p.email || '',
        updateType: p.updateType,
        timestamp: p.timestamp,
      });
    case 'review_submitted':
      return notifyReviewSubmitted({
        uid: p.uid || '',
        productId: p.productId,
        productName: p.productName,
        customerName: p.customerName,
        customerEmail: p.customerEmail,
        rating: p.rating,
        reviewText: p.reviewText,
        timestamp: p.timestamp,
      });
    case 'callback_request':
      return notifyCallbackRequest({
        mobileNumber: p.mobileNumber,
        customerName: p.customerName || p.name,
        customerEmail: p.customerEmail || p.email,
        timestamp: p.timestamp,
      });
    default:
      throw new Error(`Unsupported outbox notification kind: ${String(job.kind)}`);
  }
}

async function processSingleOutboxJob(job: OutboxJobRecord): Promise<void> {
  job.state = 'processing';
  job.attempts += 1;
  job.leaseOwner = `outbox-${process.pid}`;
  job.leaseExpiresAt = Date.now() + OUTBOX_LEASE_MS;
  job.updatedAt = new Date().toISOString();
  writeDiskOutbox();

  try {
    const report = await executeOutboxDispatch(job);
    await persistDigitalEmailStatus(job, report.hasFailures ? 'failed' : 'sent');

    job.report = report;
    if (!report.hasFailures) {
      const doneAt = new Date().toISOString();
      job.state = 'completed';
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.lastError = undefined;
      job.completedAt = doneAt;
      job.updatedAt = doneAt;
      outboxDlqJobs.delete(job.jobId);
      writeDiskOutbox();
      return;
    }

    const failedEvents = report.events.filter(e => e.state === 'failed');
    const summaryErr = failedEvents.map(e => `${e.recipientRole}:${e.error || 'failed'}`).join('; ').slice(0, 300);
    const hasRetryableError = failedEvents.some(
      e => e.error !== 'MISSING_OR_INVALID_CUSTOMER_EMAIL' && e.error !== 'MISSING_OR_INVALID_RECIPIENT_EMAIL'
    );

    if (hasRetryableError && job.attempts < job.maxAttempts) {
      const backoffMs = (isTestMode() || testingTransport)
        ? 15 * job.attempts
        : 2000 * Math.pow(2, job.attempts - 1);
      job.state = 'queued';
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.nextAttemptAt = Date.now() + backoffMs;
      job.lastError = summaryErr || 'Partial email failure scheduled for outbox retry';
      job.updatedAt = new Date().toISOString();
      writeDiskOutbox();
      return;
    }

    job.state = 'failed';
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    job.lastError = summaryErr || 'Email notification delivery failed';
    job.updatedAt = new Date().toISOString();
    outboxDlqJobs.set(job.jobId, job);
    writeDiskOutbox();
    console.error(`[EMAIL OUTBOX] Job permanently failed (jobId=${job.jobId}, kind=${job.kind}, appId=${job.appId || job.orderId || job.ticketId || '-'}, attempts=${job.attempts}): ${job.lastError}`);
    mirrorOutboxFailureAsync(job);
  } catch (err: any) {
    const errMsg = String(err?.message || err || 'Outbox worker error').slice(0, 300);
    await persistDigitalEmailStatus(job, 'failed');
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    if (job.attempts < job.maxAttempts) {
      const backoffMs = (isTestMode() || testingTransport)
        ? 15 * job.attempts
        : 2000 * Math.pow(2, job.attempts - 1);
      job.state = 'queued';
      job.nextAttemptAt = Date.now() + backoffMs;
      job.lastError = errMsg;
      job.updatedAt = new Date().toISOString();
      writeDiskOutbox();
    } else {
      job.state = 'failed';
      job.lastError = errMsg;
      job.updatedAt = new Date().toISOString();
      outboxDlqJobs.set(job.jobId, job);
      writeDiskOutbox();
      console.error(`[EMAIL OUTBOX] Job threw permanent error (jobId=${job.jobId}, kind=${job.kind}, appId=${job.appId || job.orderId || job.ticketId || '-'}): ${errMsg}`);
      mirrorOutboxFailureAsync(job);
    }
  }
}

async function persistDigitalEmailStatus(job: OutboxJobRecord, status: 'sent' | 'failed') {
  if (!job.orderId || !(job.payload?.order?.digitalDownloads?.length || job.payload?.downloads?.length) || isTestMode() || getApps().length === 0) return;
  try {
    const orderKey = String(job.orderId).replace(/[/.#$[\]]/g, '-');
    await getDatabase(getApps()[0]).ref(`orders/${orderKey}`).update({ digitalEmailStatus: status });
  } catch (error: any) {
    console.warn('[EMAIL OUTBOX] Could not update digital delivery status:', error?.message || error);
  }
}

async function runOutboxWorkerLoop(): Promise<void> {
  if (outboxWorkerPromise) {
    return outboxWorkerPromise;
  }

  outboxWorkerPromise = (async () => {
    try {
      hydrateOutboxCache();
      while (true) {
        const now = Date.now();
        const dueJobs = Array.from(outboxJobs.values())
          .filter(j =>
            (j.state === 'queued' && j.nextAttemptAt <= now) ||
            (j.state === 'processing' && typeof j.leaseExpiresAt === 'number' && j.leaseExpiresAt <= now)
          )
          .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);

        if (dueJobs.length === 0) break;

        for (let i = 0; i < dueJobs.length; i += OUTBOX_WORKER_CONCURRENCY) {
          const chunk = dueJobs.slice(i, i + OUTBOX_WORKER_CONCURRENCY);
          await Promise.allSettled(chunk.map(job => processSingleOutboxJob(job)));
        }
      }

      const pendingFuture = Array.from(outboxJobs.values())
        .filter(j => j.state === 'queued' && j.nextAttemptAt > Date.now())
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);

      if (pendingFuture.length > 0) {
        const delayMs = Math.max(5, pendingFuture[0].nextAttemptAt - Date.now());
        scheduleOutboxWorker(delayMs);
      }
    } finally {
      outboxWorkerPromise = null;
    }
  })();

  return outboxWorkerPromise;
}

// Register unified notification processor on asyncQueueService so standalone/Cloud Tasks workers can process notification payloads too
registerQueueProcessor('notification_dispatch', async (queueJob) => {
  const rec: OutboxJobRecord = {
    jobId: queueJob.jobId,
    idempotencyKey: queueJob.idempotencyKey,
    kind: queueJob.payload?.kind,
    appId: queueJob.appId || queueJob.payload?.appId || '',
    orderId: queueJob.orderId || queueJob.payload?.orderId,
    ticketId: queueJob.ticketId || queueJob.payload?.ticketId,
    payload: queueJob.payload?.data || queueJob.payload,
    state: 'processing',
    attempts: queueJob.attempts,
    maxAttempts: queueJob.maxAttempts,
    nextAttemptAt: queueJob.nextAttemptAt,
    createdAt: queueJob.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const report = await executeOutboxDispatch(rec);
  const failedEvents = report.events.filter(e => e.state === 'failed');
  const retryable = failedEvents.some(
    e => e.error !== 'MISSING_OR_INVALID_CUSTOMER_EMAIL' && e.error !== 'MISSING_OR_INVALID_RECIPIENT_EMAIL'
  );
  return {
    ok: !report.hasFailures,
    retryable,
    report,
    error: failedEvents.map(e => `${e.recipientRole}:${e.error || 'failed'}`).join('; ') || undefined,
  };
});

export function buildQueuedEmailDeliverySummary(jobId?: string): NotificationDispatchReport & { queued: boolean; jobId?: string } {
  return {
    queued: true,
    ...(jobId ? { jobId } : {}),
    success: true,
    hasFailures: false,
    totalCount: 0,
    sentCount: 0,
    failedCount: 0,
    skippedDuplicateCount: 0,
    events: [],
  };
}

export function enqueueOutboxNotification(params: {
  idempotencyKey: string;
  kind: OutboxJobKind;
  appId?: string;
  orderId?: string;
  ticketId?: string;
  payload: any;
  maxAttempts?: number;
}): { queued: boolean; duplicate: boolean; job: OutboxJobRecord } {
  hydrateOutboxCache();

  const existingId = params.idempotencyKey ? outboxIdempotencyIndex.get(params.idempotencyKey) : undefined;
  if (existingId) {
    const existing = outboxJobs.get(existingId);
    if (existing && (existing.state === 'queued' || existing.state === 'processing' || existing.state === 'completed')) {
      return { queued: false, duplicate: true, job: existing };
    }
  }

  const nowIso = new Date().toISOString();
  const jobId = `obx_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const job: OutboxJobRecord = {
    jobId,
    idempotencyKey: params.idempotencyKey || jobId,
    kind: params.kind,
    appId: params.appId || '',
    ...(params.orderId ? { orderId: params.orderId } : {}),
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    payload: params.payload,
    state: 'queued',
    attempts: 0,
    maxAttempts: params.maxAttempts ?? 3,
    nextAttemptAt: Date.now(),
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // When external distributed queue (Cloud Tasks / PubSub) is explicitly configured, route via distributed push broker
  const queueDriver = getQueueDriver();
  if (!isTestMode() && (queueDriver === 'cloud_tasks' || queueDriver === 'pubsub')) {
    enqueueAsyncJob({
      kind: 'notification_dispatch',
      idempotencyKey: job.idempotencyKey,
      appId: job.appId || undefined,
      orderId: job.orderId,
      ticketId: job.ticketId,
      maxAttempts: job.maxAttempts,
      payload: {
        kind: job.kind,
        appId: job.appId,
        orderId: job.orderId,
        ticketId: job.ticketId,
        data: job.payload,
      },
    });
    return { queued: true, duplicate: false, job };
  }

  outboxJobs.set(jobId, job);
  outboxIdempotencyIndex.set(job.idempotencyKey, jobId);
  writeDiskOutbox();
  scheduleOutboxWorker(0);

  return { queued: true, duplicate: false, job };
}

export function recoverNotificationOutbox(): number {
  hydrateOutboxCache(true);
  const pendingCount = Array.from(outboxJobs.values()).filter(j => j.state === 'queued').length;
  if (pendingCount > 0) {
    scheduleOutboxWorker(0);
  }
  return pendingCount;
}

export async function flushNotificationOutboxForTesting(): Promise<OutboxJobRecord[]> {
  hydrateOutboxCache();
  if (outboxWorkerTimer) {
    clearTimeout(outboxWorkerTimer);
    outboxWorkerTimer = null;
  }
  if (outboxWorkerPromise) {
    await outboxWorkerPromise;
  }
  while (true) {
    const queued = Array.from(outboxJobs.values()).filter(j => j.state === 'queued');
    if (queued.length === 0) break;
    for (const j of queued) {
      j.nextAttemptAt = 0;
    }
    await runOutboxWorkerLoop();
  }
  return getOutboxJobsForTesting();
}


