// ============= EMAIL CONFIGURATION & NOTIFICATION API CLIENT =============
import { auth } from '../firebase';

export interface EmailDeliveryEventSummary {
  id: string;
  eventType: string;
  recipientRole: 'customer' | 'admin' | 'operator';
  recipient: string;
  state: 'queued' | 'sent_to_smtp' | 'failed' | 'retried';
  attempts: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  lastError?: string | null;
}

export interface EmailDeliverySummary {
  success: boolean;
  hasFailures: boolean;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedDuplicateCount: number;
  events: EmailDeliveryEventSummary[];
}

export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(url: unknown, fallback = 'https://b.indiacybercafe.com'): string {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return escapeHtml(raw);
  if (raw.startsWith('/')) return escapeHtml(`https://b.indiacybercafe.com${raw}`);
  return fallback;
}

// Professional Email Footer with Gmail-mobile compatible table layout
const emailFooter = `
  <div style="background: #f8f9fa; padding: 25px 20px; margin-top: 30px; border-top: 3px solid #FF9933; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 10px 10px;">
    <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e0e0e0;">
      <p style="margin: 0; font-weight: bold; font-size: 13px; color: #333;">India Cyber Cafe Support Center</p>
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 400px; margin: 0 auto 15px; border-collapse: collapse; text-align: left;">
      <tr>
        <td style="width: 50%; padding: 6px 8px; vertical-align: top;">
          <p style="margin: 0 0 4px 0; font-weight: bold; color: #FF9933;">Email</p>
          <p style="margin: 0;"><a href="mailto:icc@indiacybercafe.com" style="color: #FF9933; text-decoration: none;">icc@indiacybercafe.com</a></p>
        </td>
        <td style="width: 50%; padding: 6px 8px; vertical-align: top;">
          <p style="margin: 0 0 4px 0; font-weight: bold; color: #FF9933;">Website</p>
          <p style="margin: 0;"><a href="https://b.indiacybercafe.com" style="color: #FF9933; text-decoration: none;">b.indiacybercafe.com</a></p>
        </td>
      </tr>
    </table>
    <div style="padding: 12px; background: #fff3e0; border-radius: 6px; margin-bottom: 12px;">
      <p style="margin: 0; font-size: 11px; color: #666;">Available 24/7 for your support needs</p>
      <p style="margin: 5px 0 0 0; font-size: 11px; color: #999;">Support portal &amp; order tracking updates</p>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 10px;">&copy; 2024-2026 India Cyber Cafe. All rights reserved. | <a href="https://b.indiacybercafe.com/legal/privacy" style="color: #FF9933; text-decoration: none;">Privacy Policy</a></p>
  </div>
`;

// Professional Email Header with Logo
const emailHeader = (title: string) => `
  <div style="background: linear-gradient(135deg, #FF9933 0%, #FF7F00 100%); padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0;">
    <div style="margin-bottom: 15px;">
      <img src="https://indiacybercafe.com/wp-content/uploads/2025/12/india-cyber-cafe-main-logo-headeer.png" alt="India Cyber Cafe" style="max-width: 200px; height: auto; max-height: 60px; display: inline-block;">
    </div>
    <h1 style="color: #fff; margin: 10px 0 0 0; font-size: 22px; font-weight: 600; letter-spacing: -0.3px;">India Cyber Cafe</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0 0; font-size: 12px;">Digital Seva Simplified</p>
  </div>
  <div style="padding: 20px; border-bottom: 2px solid #FF9933; background: #fafafa;">
    <h2 style="color: #FF9933; margin: 0; font-size: 20px; font-weight: 600;">${escapeHtml(title)}</h2>
  </div>
`;

// Reusable Email Template Base
const baseTemplate = (title: string, content: string) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif; max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    ${emailHeader(title)}
    <div style="padding: 25px 20px; color: #333; line-height: 1.7; font-size: 14px;">
      ${content}
    </div>
    ${emailFooter}
  </div>
`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }
  } catch {}
  return headers;
}

async function postJson<T = any>(
  url: string,
  body: Record<string, any>,
  options: { throwOnError?: boolean } = {}
): Promise<T & { success: boolean; status?: number; error?: string; emailDelivery?: EmailDeliverySummary }> {
  const headers = await getAuthHeaders();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    const errMsg = data?.error || `Request failed with status ${response.status}`;
    if (options.throwOnError) {
      throw new Error(errMsg);
    }
    return { ...data, success: false, status: response.status, error: errMsg };
  }
  return { ...data, success: true, status: response.status };
}

// ============= SERVER-AUTHORITATIVE NOTIFICATION & MUTATION APIS =============

export async function notifyApplicationSubmittedApi(appId: string) {
  return postJson('/api/notifications/application-submitted', { appId });
}

export async function assignApplicationOperatorApi(
  appId: string,
  operatorUid: string,
  operatorEmail: string
) {
  return postJson(
    `/api/applications/${encodeURIComponent(appId)}/assign`,
    { operatorUid, operatorEmail },
    { throwOnError: true }
  );
}

export async function updateApplicationPaymentStatusApi(
  appId: string,
  paymentStatus: 'pending' | 'completed'
) {
  return postJson(
    `/api/applications/${encodeURIComponent(appId)}/payment-status`,
    { paymentStatus },
    { throwOnError: true }
  );
}

export async function notifyRegistrationApi(opts?: { isGoogle?: boolean; isGuestCheckout?: boolean }) {
  return postJson('/api/notifications/registration', {
    isGoogle: Boolean(opts?.isGoogle),
    isGuestCheckout: Boolean(opts?.isGuestCheckout),
  });
}

export async function notifyProfileUpdatedApi(updateType: string) {
  return postJson('/api/notifications/profile-updated', { updateType });
}

export async function notifyReviewSubmittedApi(payload: {
  productId: string;
  productName: string;
  rating: number;
  reviewText: string;
}) {
  return postJson('/api/notifications/review-submitted', payload);
}

export async function notifyCallbackApi(payload: {
  mobileNumber: string;
  name?: string;
  email?: string;
}) {
  return postJson('/api/notifications/callback', payload, { throwOnError: true });
}

export async function updateAdminOrderStatusApi(
  orderId: string,
  payload: {
    orderStatus?: string;
    paymentStatus?: string;
    reason?: string;
    estimatedDelivery?: string;
  }
) {
  return postJson(
    `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
    payload,
    { throwOnError: true }
  );
}

export async function initiateAdminOrderRefundApi(
  orderId: string,
  payload?: {
    refundAmount?: number;
    expectedDays?: number;
    reason?: string;
  }
) {
  return postJson(
    `/api/admin/orders/${encodeURIComponent(orderId)}/refund`,
    payload || {},
    { throwOnError: true }
  );
}

// ============= DEPRECATED GENERIC CLIENT EMAIL HELPERS =============
// Direct arbitrary HTML emails from the client are disabled; all email routing
// and HTML generation live in src/server/emailNotificationService.

/** @deprecated Direct arbitrary email sending from the client is disabled. */
export async function sendEmail(_to: string, _subject: string, _html: string) {
  console.warn('[emailService] sendEmail() is deprecated and disabled; use server notification APIs.');
  return {
    success: false,
    code: 'ARBITRARY_EMAIL_DISABLED',
    error: 'Direct email sending from client is disabled. Use server notification endpoints.',
  };
}

/** @deprecated Direct arbitrary admin email sending from the client is disabled. */
export async function sendEmailToAllAdmins(_subject: string, _html: string) {
  return [await sendEmail('', _subject, _html)];
}

/** @deprecated Use notifyRegistrationApi({ isGuestCheckout: true }). Never emails passwords. */
export async function sendWelcomeEmail(_customerEmail: string, _customerName: string, _unused?: string) {
  return notifyRegistrationApi({ isGuestCheckout: true });
}

/** @deprecated Store confirmation emails are sent automatically by store checkout endpoints. */
export async function sendOrderConfirmationEmail(
  _customerEmail: string,
  _customerName: string,
  _orderId: string,
  _items: Array<{ name: string; quantity: number; price: number }>,
  _totalAmount: number,
  _paymentMethod: 'online' | 'cod'
) {
  return { success: false, code: 'SERVER_HANDLED', error: 'Sent automatically by store order service.' };
}

/** @deprecated Store admin emails are sent automatically by store checkout endpoints. */
export async function sendAdminOrderNotification(
  _orderId: string,
  _customerName: string,
  _customerEmail: string,
  _customerPhone: string,
  _items: Array<{ name: string; quantity: number; price: number }>,
  _totalAmount: number,
  _paymentMethod: 'online' | 'cod',
  _address: { addressLine1: string; city: string; state: string; pincode: string }
) {
  return [{ success: false, code: 'SERVER_HANDLED', error: 'Sent automatically by store order service.' }];
}

/** @deprecated Use updateAdminOrderStatusApi. */
export async function sendOrderStatusUpdateEmail(
  _customerEmail: string,
  _customerName: string,
  orderId: string,
  newStatus: string,
  _productName: string,
  estimatedDelivery?: string
) {
  return updateAdminOrderStatusApi(orderId, { orderStatus: newStatus, estimatedDelivery });
}

/** @deprecated Use updateAdminOrderStatusApi. */
export async function sendOrderCancellationEmail(
  _customerEmail: string,
  _customerName: string,
  orderId: string,
  _productName: string,
  _totalAmount: number,
  reason?: string
) {
  return updateAdminOrderStatusApi(orderId, { orderStatus: 'cancelled', reason });
}

/** @deprecated Use initiateAdminOrderRefundApi. */
export async function sendRefundInitiatedEmail(
  _customerEmail: string,
  _customerName: string,
  orderId: string,
  refundAmount: number,
  expectedDays: number = 5
) {
  return initiateAdminOrderRefundApi(orderId, { refundAmount, expectedDays });
}

/** @deprecated Use initiateAdminOrderRefundApi. */
export async function sendAdminRefundNotification(
  orderId: string,
  _customerName: string,
  _customerEmail: string,
  refundAmount: number,
  reason?: string
) {
  return [await initiateAdminOrderRefundApi(orderId, { refundAmount, reason })];
}

/** @deprecated Use notifyReviewSubmittedApi. */
export async function sendReviewConfirmationEmail(
  _customerEmail: string,
  _customerName: string,
  _productName: string
) {
  return { success: false, code: 'SERVER_HANDLED', error: 'Use notifyReviewSubmittedApi.' };
}

/** @deprecated Use notifyReviewSubmittedApi. */
export async function sendAdminReviewNotification(
  _productName: string,
  _customerName: string,
  _rating: number,
  _reviewText: string
) {
  return [{ success: false, code: 'SERVER_HANDLED', error: 'Use notifyReviewSubmittedApi.' }];
}

export const emailTemplates = {
  registration: (name: string) => baseTemplate(
    'Welcome to India Cyber Cafe!',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>Thank you for registering with India Cyber Cafe! We are thrilled to have you join our community.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 0;"><strong>What's Next?</strong></p>
        <ul style="margin: 10px 0 0 0; padding-left: 20px;">
          <li>Complete your profile with required details</li>
          <li>Browse our cyber services</li>
          <li>Apply for services you need</li>
          <li>Track your applications in real-time</li>
        </ul>
      </div>
      <p><a href="https://b.indiacybercafe.com/login" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Login to Your Account</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  applicationSubmitted: (name: string, serviceName: string, appId: string) => baseTemplate(
    'Application Submitted Successfully',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>Your application has been successfully submitted to our system.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
        <p style="margin: 5px 0;"><strong>Application ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${escapeHtml(appId)}</code></p>
        <p style="margin: 5px 0;"><strong>Status:</strong> Processing</p>
      </div>
      <p><a href="https://b.indiacybercafe.com/track?id=${encodeURIComponent(appId)}" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Track Your Application</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  statusUpdate: (name: string, serviceName: string, status: string, statusColor: string = '#FF9933') => baseTemplate(
    'Application Status Updated',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>Your application status has been updated.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid ${escapeHtml(statusColor)};">
        <p style="margin: 5px 0;"><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
        <p style="margin: 5px 0;"><strong>New Status:</strong> <span style="background: ${escapeHtml(statusColor)}; padding: 3px 10px; border-radius: 3px; color: white; font-weight: bold;">${escapeHtml(status.toUpperCase())}</span></p>
      </div>
      <p><a href="https://b.indiacybercafe.com/track" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Applications</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  noteAdded: (name: string, serviceName: string, note: string) => baseTemplate(
    'New Update on Your Application',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>A new update has been added to your application for <strong>${escapeHtml(serviceName)}</strong>:</p>
      <div style="background: #fff9e6; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #ffe6cc; border-left: 4px solid #FF9933;">
        <p style="margin: 0; color: #333;">${escapeHtml(note)}</p>
      </div>
      <p><a href="https://b.indiacybercafe.com/track" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Application</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  operatorAssigned: (name: string, serviceName: string, operatorName?: string) => baseTemplate(
    'Operator Assigned to Your Application',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>An operator has been assigned to handle your application.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
        ${operatorName ? `<p style="margin: 5px 0;"><strong>Assigned Operator:</strong> ${escapeHtml(operatorName)}</p>` : ''}
      </div>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  profileUpdated: (name: string, updateType: string) => baseTemplate(
    'Profile Updated Successfully',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>Your profile has been updated successfully.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Updated:</strong> ${escapeHtml(updateType)}</p>
        <p style="margin: 5px 0; color: #666;">Updated on ${escapeHtml(new Date().toLocaleDateString('en-IN'))}</p>
      </div>
      <p><a href="https://b.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Profile</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  passwordReset: (name: string, resetLink?: string) => baseTemplate(
    'Password Reset Request',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>Use the secure link below to reset your password.</p>
      <p style="margin: 20px 0;">
        ${resetLink
          ? `<a href="${safeHref(resetLink)}" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Reset Password</a>`
          : `<a href="https://b.indiacybercafe.com/forgot-password" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Reset Password</a>`}
      </p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  userPasswordDelivery: (name: string, _unused?: string) => baseTemplate(
    'Set or Reset Your Password - India Cyber Cafe',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>For your security, India Cyber Cafe never transmits account passwords by email.</p>
      <p>If you need to set a new password, please request a one-time password reset link from our login page.</p>
      <p style="margin-top: 20px;">
        <a href="https://b.indiacybercafe.com/forgot-password" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Reset Password Securely</a>
      </p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  guestAccountWelcome: (customerName: string, email: string, _unused?: string) => baseTemplate(
    'Welcome to Your India Cyber Cafe Account',
    `
      <p>Hello <strong>${escapeHtml(customerName)}</strong>,</p>
      <p>Welcome to India Cyber Cafe! An account associated with <strong>${escapeHtml(email)}</strong> is now active so you can track orders and view receipts anytime.</p>
      <div style="background: #ffe6e6; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff6b6b;">
        <strong>Account Security Notice:</strong><br/>
        <span style="color: #555; font-size: 13px;">
          For your protection, temporary passwords are never sent via email. If you sign out and wish to set your own password, click "Forgot Password?" on the login page.
        </span>
      </div>
      <p style="margin-top: 20px;">
        <a href="https://b.indiacybercafe.com/login" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Sign In / Reset Password</a>
      </p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  paymentReceived: (name: string, amount: string, serviceName: string, transactionId: string) => baseTemplate(
    'Payment Received Successfully',
    `
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>We have successfully received your payment.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <p style="margin: 5px 0;"><strong>Amount Paid:</strong> &#8377;${escapeHtml(amount)}</p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
        <p style="margin: 5px 0;"><strong>Transaction ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${escapeHtml(transactionId)}</code></p>
      </div>
      <p><a href="https://b.indiacybercafe.com/track" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Applications</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),
};
