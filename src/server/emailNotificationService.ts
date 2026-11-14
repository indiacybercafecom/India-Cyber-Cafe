import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const NOTIFICATION_LEDGER_PATH = path.join(APP_ROOT, 'data/notification_events.json');
const DEFAULT_ADMIN_EMAILS = ['icc@indiacybercafe.com', 'indiacybercafe.com@gmail.com'];
const BRAND_LOGO_URL = 'https://indiacybercafe.com/wp-content/uploads/2025/12/india-cyber-cafe-main-logo-headeer.png';
const SITE_URL = 'https://b.indiacybercafe.com';

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
    if (parsed.protocol === 'https:' && (parsed.hostname === 'b.indiacybercafe.com' || parsed.hostname === 'indiacybercafe.com')) {
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

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
    auth: { user: smtpUser, pass: smtpPass },
    tls: { rejectUnauthorized: false },
  });

  return { transporter, fromEmail: smtpUser };
}

function readDiskLedger(): Record<string, NotificationEventRecord> {
  try {
    if (fs.existsSync(NOTIFICATION_LEDGER_PATH)) {
      return JSON.parse(fs.readFileSync(NOTIFICATION_LEDGER_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function writeDiskLedger(records: Record<string, NotificationEventRecord>) {
  try {
    fs.mkdirSync(path.dirname(NOTIFICATION_LEDGER_PATH), { recursive: true });
    // Keep last 500 events so disk file remains bounded
    const entries = Object.entries(records)
      .sort((a, b) => new Date(b[1].createdAt || 0).getTime() - new Date(a[1].createdAt || 0).getTime())
      .slice(0, 500);
    const trimmed = Object.fromEntries(entries);
    fs.writeFileSync(NOTIFICATION_LEDGER_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[emailNotificationService] Could not persist ledger:', err?.message || err);
  }
}

function hydrateLedgerCache() {
  if (memoryLedger.size > 0) return;
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

  const disk = readDiskLedger();
  disk[record.eventId] = record;
  writeDiskLedger(disk);

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

  const reportEvents: NotificationDispatchReport['events'] = [];
  let sentCount = 0;
  let failedCount = 0;
  let skippedDuplicateCount = 0;

  for (const item of items) {
    const normalizedRecipient = normalizeEmailAddress(item.recipient);
    const dedupKey = `${item.idempotencyKey}|${item.recipientRole}|${normalizedRecipient}`;

    if (item.idempotencyKey && normalizedRecipient && dedupIndex.has(dedupKey)) {
      const existingId = dedupIndex.get(dedupKey)!;
      const existing = memoryLedger.get(existingId);
      if (existing && existing.state === 'sent_to_smtp') {
        skippedDuplicateCount += 1;
        reportEvents.push({
          eventId: existing.eventId,
          templateId: existing.templateId,
          recipient: existing.recipient,
          recipientRole: existing.recipientRole,
          state: existing.state,
          wasRetried: existing.wasRetried,
          attempts: existing.attempts,
          smtpAccepted: existing.smtpAccepted,
          skippedDuplicate: true,
        });
        continue;
      }
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

    await persistNotificationEvent(record);
    const finalRecord = await deliverSingleEvent(record, options);

    if (finalRecord.state === 'sent_to_smtp') {
      sentCount += 1;
    } else {
      failedCount += 1;
    }

    reportEvents.push({
      eventId: finalRecord.eventId,
      templateId: finalRecord.templateId,
      recipient: finalRecord.recipient,
      recipientRole: finalRecord.recipientRole,
      state: finalRecord.state,
      wasRetried: finalRecord.wasRetried,
      attempts: finalRecord.attempts,
      smtpAccepted: finalRecord.smtpAccepted,
      ...(finalRecord.error ? { error: finalRecord.error } : {}),
    });
  }

  return {
    success: failedCount === 0,
    hasFailures: failedCount > 0,
    totalCount: reportEvents.length,
    sentCount,
    failedCount,
    skippedDuplicateCount,
    events: reportEvents,
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

function wrapEmailHtml(title: string, contentHtml: string, badgeLabel = 'Digital Seva Simplified'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f6f9;padding:16px 8px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          <tr>
            <td style="background-color:#FF9933;padding:24px 20px;text-align:center;">
              <img src="${BRAND_LOGO_URL}" alt="India Cyber Cafe" width="160" style="max-width:160px;width:100%;height:auto;display:inline-block;margin-bottom:8px;" />
              <div style="font-size:20px;font-weight:700;color:#ffffff;margin:4px 0 0 0;">India Cyber Cafe</div>
              <div style="font-size:12px;color:#fff7ed;margin:4px 0 0 0;">${escapeHtml(badgeLabel)}</div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#fffaf5;padding:16px 20px;border-bottom:2px solid #FF9933;">
              <h2 style="margin:0;font-size:18px;font-weight:700;color:#c2410c;">${escapeHtml(title)}</h2>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 20px;font-size:14px;line-height:1.65;color:#334155;word-break:break-word;">
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
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;">${qty}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">&#8377;${unitPrice.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">&#8377;${lineTotal.toFixed(2)}</td>
    </tr>`;
  }).join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;">
    <thead>
      <tr style="background-color:#f1f5f9;border-bottom:2px solid #FF9933;">
        <th style="padding:8px;text-align:left;">Product</th>
        <th style="padding:8px;text-align:center;">Qty</th>
        <th style="padding:8px;text-align:right;">Price</th>
        <th style="padding:8px;text-align:right;">Total</th>
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
     ${p.address ? `<p><strong>Delivery Address:</strong> ${escapeHtml(p.address.addressLine1 || '')}, ${escapeHtml(p.address.city || '')}, ${escapeHtml(p.address.state || '')} - ${escapeHtml(p.address.pincode || '')}</p>` : ''}
     ${renderButton('Track Your Order', p.isGuest ? `/track-order?orderId=${encodeURIComponent(p.orderId)}` : '/track')}
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
     ${p.address ? `<p><strong>Shipping Address:</strong> ${escapeHtml(p.address.addressLine1 || '')}, ${escapeHtml(p.address.city || '')}, ${escapeHtml(p.address.state || '')} - ${escapeHtml(p.address.pincode || '')}</p>` : ''}
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
