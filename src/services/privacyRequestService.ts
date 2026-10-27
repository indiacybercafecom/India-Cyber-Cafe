import { PrivacyRequest, PrivacyRequestCategory, PrivacyRequestStatus } from '../types';

export const PRIVACY_REQUEST_CATEGORIES: { value: PrivacyRequestCategory; label: string; description: string }[] = [
  {
    value: 'privacy_question',
    label: 'Privacy Question / Inquiry',
    description: 'Ask questions about our data collection practices, storage, or third-party processors.',
  },
  {
    value: 'data_access',
    label: 'Data Access / Summary Request',
    description: 'Request a summary of your personal information held by India Cyber Cafe under the DPDP Act / IT Act.',
  },
  {
    value: 'data_correction',
    label: 'Data Correction / Update',
    description: 'Request correction or updating of inaccurate or outdated profile and contact records.',
  },
  {
    value: 'data_deletion',
    label: 'Data Erasure / Deletion',
    description: 'Request deletion of non-essential records (subject to statutory financial/tax retention requirements).',
  },
  {
    value: 'consent_withdrawal',
    label: 'Consent Withdrawal',
    description: 'Withdraw previously given consent for marketing or optional data processing.',
  },
  {
    value: 'consumer_grievance',
    label: 'Consumer E-Commerce Grievance',
    description: 'Escalate a service or order grievance to our designated Grievance Redressal Officer.',
  },
  {
    value: 'other',
    label: 'Other Legal / Privacy Matter',
    description: 'Other privacy, data protection, or compliance inquiries.',
  },
];

export async function submitPrivacyRequest(data: {
  category: PrivacyRequestCategory;
  name: string;
  email: string;
  phone?: string;
  referenceId?: string;
  description: string;
}): Promise<{ success: boolean; ticketId?: string; message?: string; error?: string }> {
  try {
    const response = await fetch('/api/privacy-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      return { success: false, error: result.error || 'Failed to submit privacy request' };
    }

    return {
      success: true,
      ticketId: result.ticketId,
      message: result.message,
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error while submitting request' };
  }
}

export async function trackPrivacyRequest(
  ticketId: string,
  email: string
): Promise<{ success: boolean; request?: PrivacyRequest; error?: string }> {
  try {
    const response = await fetch('/api/privacy-requests/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId, email }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      return { success: false, error: result.error || 'Request not found' };
    }

    return { success: true, request: result.request };
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error while checking status' };
  }
}

export async function fetchAdminPrivacyRequests(): Promise<PrivacyRequest[]> {
  try {
    const response = await fetch('/api/admin/privacy-requests');
    if (!response.ok) return [];
    const result = await response.json();
    return result.requests || [];
  } catch {
    return [];
  }
}

export async function updatePrivacyRequestStatus(
  id: string,
  status: PrivacyRequestStatus,
  adminNotes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/admin/privacy-requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, adminNotes }),
    });
    const result = await response.json();
    return { success: Boolean(result.success), error: result.error };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
