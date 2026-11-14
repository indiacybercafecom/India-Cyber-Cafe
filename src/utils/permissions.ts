import { Application, ApplicationNote, Order, UserProfile, UserRole } from '../types';

export const SUPER_ADMIN_UID = 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2';
export const SUPER_ADMIN_EMAIL = 'indiacybercafe.com@gmail.com';
export const ALLOWED_ROLES: readonly UserRole[] = ['user', 'operator', 'admin'] as const;
export const ALLOWED_OPERATOR_STATUSES = ['processing', 'clarification', 'completed', 'rejected'] as const;
export const MAX_NOTE_LENGTH = 2000;

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

  return entries
    .sort((a, b) => a._sortOrder - b._sortOrder)
    .map(({ _sortOrder, ...note }) => note);
}
