import { Application, ApplicationNote, ApplicationNoteAttachment, Order, UserProfile, UserRole } from '../types';

export const SUPER_ADMIN_UID = 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2';
export const SUPER_ADMIN_EMAIL = 'indiacybercafe.com@gmail.com';
export const ALLOWED_ROLES: readonly UserRole[] = ['user', 'operator', 'admin'] as const;
export const ALLOWED_OPERATOR_STATUSES = ['processing', 'clarification', 'completed', 'rejected'] as const;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_REPLY_ATTACHMENTS = 5;
export const MAX_REPLY_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function isValidUserRole(role: unknown): role is UserRole {
  return role === 'user' || role === 'operator' || role === 'admin';
}

export function isUserDisabled(user?: Partial<UserProfile> | null): boolean {
  return Boolean(user?.disabled === true);
}

export function isSuperAdmin(user?: Partial<UserProfile> | null): boolean {
  if (!user) return false;
  return (
    user.uid === SUPER_ADMIN_UID ||
    (user.email || '').toLowerCase().trim() === SUPER_ADMIN_EMAIL
  );
}

export function isAdminUser(user?: Partial<UserProfile> | null): boolean {
  if (!user || isUserDisabled(user)) return false;
  return isSuperAdmin(user) || user.role === 'admin';
}

export function isOperatorUser(user?: Partial<UserProfile> | null): boolean {
  if (!user || isUserDisabled(user)) return false;
  return user.role === 'operator';
}

export function isAssignedToOperator(
  record: Pick<Application, 'assignedTo' | 'assignedToUid'> | Pick<Order, never> & { assignedTo?: string; assignedToUid?: string } | null | undefined,
  operator?: Partial<UserProfile> | null
): boolean {
  if (!record || !operator || isUserDisabled(operator)) return false;
  const opUid = (operator.uid || '').trim();
  const recUid = (record.assignedToUid || '').trim();
  return Boolean(recUid && opUid && recUid === opUid);
}

export function isApplicationOwner(
  app: Pick<Application, 'uid' | 'userId'> | null | undefined,
  user?: Partial<UserProfile> | null
): boolean {
  if (!app || !user || !user.uid || isUserDisabled(user)) return false;
  return app.uid === user.uid || app.userId === user.uid;
}

export interface ApplicationPermissions {
  isAdmin: boolean;
  isOperator: boolean;
  isAssignedOperator: boolean;
  isApplicationOwner: boolean;
  canViewApplication: boolean;
  canUpdateStatus: boolean;
  canAddNote: boolean;
  canReplyToApplication: boolean;
  canUploadNoteAttachment: boolean;
  canAssignOperator: boolean;
  canUpdatePayment: boolean;
  canDeleteApplication: boolean;
}

export function getApplicationPermissions(
  app: Application | null | undefined,
  currentUser: UserProfile | null | undefined
): ApplicationPermissions {
  const admin = isAdminUser(currentUser);
  const operator = isOperatorUser(currentUser);
  const assignedOperator = operator && isAssignedToOperator(app, currentUser);
  const owner = isApplicationOwner(app, currentUser);

  return {
    isAdmin: admin,
    isOperator: operator,
    isAssignedOperator: assignedOperator,
    isApplicationOwner: owner,
    canViewApplication: Boolean(app && (admin || assignedOperator || owner)),
    canUpdateStatus: Boolean(app && (admin || assignedOperator)),
    canAddNote: Boolean(app && (admin || assignedOperator)),
    canReplyToApplication: Boolean(app && owner && !admin && !assignedOperator),
    canUploadNoteAttachment: Boolean(app && (admin || assignedOperator)),
    canAssignOperator: Boolean(app && admin),
    canUpdatePayment: Boolean(app && admin),
    canDeleteApplication: Boolean(app && admin),
  };
}

/**
 * Normalizes both legacy array notes and append-only child-keyed map notes
 * into a clean chronologically sorted array.
 */
export function normalizeApplicationNotes(
  notes: ApplicationNote[] | Record<string, ApplicationNote> | null | undefined
): ApplicationNote[] {
  if (!notes) return [];

  const entries: Array<ApplicationNote & { _sortOrder: number }> = [];

  if (Array.isArray(notes)) {
    notes.forEach((item, idx) => {
      if (item && typeof item === 'object') {
        const parsedTime = typeof item.createdAt === 'number'
          ? item.createdAt
          : Date.parse(String(item.createdAt || item.time || ''));
        entries.push({
          ...item,
          id: item.id || String(idx),
          _sortOrder: Number.isFinite(parsedTime) ? parsedTime : idx,
        });
      }
    });
  } else if (typeof notes === 'object') {
    Object.entries(notes).forEach(([key, item], idx) => {
      if (item && typeof item === 'object') {
        const parsedTime = typeof item.createdAt === 'number'
          ? item.createdAt
          : Date.parse(String(item.createdAt || item.time || ''));
        entries.push({
          ...item,
          id: item.id || key,
          _sortOrder: Number.isFinite(parsedTime) ? parsedTime : idx,
        });
      }
    });
  }

  const seenIds = new Set<string>();
  const seenReplyIds = new Set<string>();
  const seenRequestIds = new Set<string>();
  const deduped: Array<ApplicationNote & { _sortOrder: number }> = [];

  for (const entry of entries) {
    const noteId = typeof entry.id === 'string' ? entry.id.trim() : '';
    const replyKey = typeof entry.clientReplyId === 'string' ? entry.clientReplyId.trim() : '';
    const requestKey = typeof entry.clientRequestId === 'string' ? entry.clientRequestId.trim() : '';

    if (
      (noteId && seenIds.has(noteId)) ||
      (replyKey && seenReplyIds.has(replyKey)) ||
      (requestKey && seenRequestIds.has(requestKey))
    ) {
      continue;
    }

    if (noteId) seenIds.add(noteId);
    if (replyKey) seenReplyIds.add(replyKey);
    if (requestKey) seenRequestIds.add(requestKey);
    deduped.push(entry);
  }

  return deduped
    .sort((a, b) => a._sortOrder - b._sortOrder)
    .map(({ _sortOrder, ...note }) => note);
}

const ORDINAL_WORDS = [
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
] as const;

export function getOrdinalLabel(index: number): string {
  if (index < ORDINAL_WORDS.length) {
    return ORDINAL_WORDS[index];
  }
  const num = index + 1;
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1:
      return `${num}st`;
    case 2:
      return `${num}nd`;
    case 3:
      return `${num}rd`;
    default:
      return `${num}th`;
  }
}

export function isSafeNoteAttachmentUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }
  return (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('/api/operator/attachments/') ||
    lower.includes('/uploads/')
  );
}

/**
 * Normalizes both `attachments[]` (array or RTDB numeric map of strings or {url, name})
 * and legacy `attachment` + `attachmentName` fields into a deduplicated ordered array.
 */
export function normalizeNoteAttachments(
  note: Partial<ApplicationNote> | null | undefined
): ApplicationNoteAttachment[] {
  if (!note || typeof note !== 'object') return [];

  const result: ApplicationNoteAttachment[] = [];
  const seenUrls = new Set<string>();

  const pushAttachment = (rawUrl: unknown, rawName?: unknown, fallbackIndex?: number) => {
    if (!isSafeNoteAttachmentUrl(rawUrl)) return;
    const url = rawUrl.trim();
    if (seenUrls.has(url)) return;
    seenUrls.add(url);
    const cleanedName = typeof rawName === 'string' ? rawName.trim() : '';
    result.push({
      url,
      name: cleanedName || (fallbackIndex !== undefined ? `Attachment ${fallbackIndex + 1}` : 'Attachment'),
    });
  };

  let rawList: unknown[] = [];
  if (Array.isArray(note.attachments)) {
    rawList = note.attachments;
  } else if (note.attachments && typeof note.attachments === 'object') {
    const record = note.attachments as Record<string, unknown>;
    rawList = Object.keys(record)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => record[k]);
  }

  rawList.forEach((item, idx) => {
    if (typeof item === 'string') {
      pushAttachment(item, undefined, idx);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      pushAttachment(obj.url, obj.name, idx);
    }
  });

  if (note.attachment) {
    pushAttachment(note.attachment, note.attachmentName);
  }

  return result;
}
