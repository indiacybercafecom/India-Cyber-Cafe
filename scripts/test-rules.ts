import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';
import multer from 'multer';
import {
  verifyCallerWithRole,
  requireAdminMiddleware,
  handleGetOperatorApplication,
  handleOperatorUpdateApplication,
  handleOperatorUploadAttachment,
  handleGetOperatorAttachment,
  handleVerifyApplicationPayment,
} from '../src/server/operatorService';
import {
  planOperatorSecurityMigration,
  createAndVerifyBackup,
  buildRollbackUpdates,
  countNotesAndAttachments,
} from './migrate-operator-security';

/**
 * Automated RTDB Rules Simulator, Express Operator API Integration,
 * and Migration Safety Test Suite for India Cyber Cafe.
 *
 * NOTE: The RulesEngine section below is a local TypeScript rules-semantics
 * simulator for CI environments without Java/Firebase RTDB Emulator. It does
 * not substitute for running the official Firebase Database Emulator when Java
 * is available.
 */

if (!(String.prototype as any).matches) {
  Object.defineProperty(String.prototype, 'matches', {
    value: function (re: RegExp) {
      return re.test(String(this));
    },
    configurable: true,
    writable: true,
  });
}

interface AuthContext {
  uid: string;
  token?: {
    email?: string;
    email_verified?: boolean;
  };
}

interface QueryContext {
  orderByChild?: string;
  equalTo?: string;
}

interface DatabaseState {
  [key: string]: any;
}

class DataSnapshot {
  constructor(
    private _val: any,
    private _parentSnapshot: DataSnapshot | null = null
  ) {}

  val(): any {
    return this._val;
  }

  exists(): boolean {
    return this._val !== undefined && this._val !== null;
  }

  parent(): DataSnapshot {
    return this._parentSnapshot ?? new DataSnapshot(null);
  }

  hasChild(childPath: string): boolean {
    if (!this.exists() || typeof this._val !== 'object') return false;
    const parts = childPath.split('/').filter(Boolean);
    let curr: any = this._val;
    for (const part of parts) {
      if (curr && typeof curr === 'object' && part in curr && curr[part] !== undefined && curr[part] !== null) {
        curr = curr[part];
      } else {
        return false;
      }
    }
    return true;
  }

  hasChildren(children?: string[]): boolean {
    if (!this.exists() || typeof this._val !== 'object') return false;
    if (!children) return Object.keys(this._val).length > 0;
    return children.every(c => this.hasChild(c));
  }

  child(childPath: string): DataSnapshot {
    const parts = childPath.split('/').filter(Boolean);
    let currentSnap: DataSnapshot = this;
    for (const part of parts) {
      const currentVal = currentSnap.val();
      const nextVal =
        currentVal && typeof currentVal === 'object' && part in currentVal
          ? currentVal[part]
          : null;
      currentSnap = new DataSnapshot(nextVal ?? null, currentSnap);
    }
    return currentSnap;
  }

  isString(): boolean {
    return typeof this._val === 'string';
  }

  isNumber(): boolean {
    return typeof this._val === 'number' && !isNaN(this._val);
  }

  isBoolean(): boolean {
    return typeof this._val === 'boolean';
  }
}

class RootSnapshot {
  constructor(private state: DatabaseState) {}

  child(pathStr: string): DataSnapshot {
    const parts = pathStr.split('/').filter(Boolean);
    let currSnap = new DataSnapshot(this.state, null);
    for (const part of parts) {
      currSnap = currSnap.child(part);
    }
    return currSnap;
  }
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function setAtPath(rootObj: any, pathStr: string, val: any): any {
  const cloned = deepClone(rootObj);
  const parts = pathStr.split('/').filter(Boolean);
  if (parts.length === 0) return val;
  let curr = cloned;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!curr[part] || typeof curr[part] !== 'object') {
      curr[part] = {};
    }
    curr = curr[part];
  }
  const last = parts[parts.length - 1];
  if (val === null || val === undefined) {
    delete curr[last];
  } else {
    curr[last] = deepClone(val);
  }
  return cloned;
}

function evaluateExpression(
  expr: string | boolean,
  context: {
    auth: AuthContext | null;
    data: DataSnapshot;
    newData: DataSnapshot;
    root: RootSnapshot;
    query?: QueryContext;
    wildcards: Record<string, string>;
  }
): boolean {
  if (expr === 'true' || expr === true) return true;
  if (expr === 'false' || expr === false) return false;

  const { auth, data, newData, root, query = {}, wildcards } = context;

  const sandbox = {
    auth,
    data,
    newData,
    root,
    query,
    ...wildcards,
  };

  try {
    const fn = new Function(...Object.keys(sandbox), `"use strict"; return Boolean(${expr});`);
    return Boolean(fn(...Object.values(sandbox)));
  } catch {
    return false;
  }
}

class RulesEngine {
  private rules: any;

  constructor(rulesJsonPath: string) {
    const content = fs.readFileSync(rulesJsonPath, 'utf-8');
    this.rules = JSON.parse(content).rules;
  }

  canRead(
    requestPath: string,
    auth: AuthContext | null,
    dbState: DatabaseState,
    query?: QueryContext
  ): boolean {
    const parts = requestPath.split('/').filter(Boolean);
    const rootSnapshot = new RootSnapshot(dbState);

    let currentRuleNode = this.rules;
    const wildcards: Record<string, string> = {};

    if (currentRuleNode['.read'] !== undefined) {
      const allowed = evaluateExpression(currentRuleNode['.read'], {
        auth,
        data: rootSnapshot.child(requestPath),
        newData: new DataSnapshot(null),
        root: rootSnapshot,
        query,
        wildcards,
      });
      if (allowed) return true;
    }

    let traversedPath = '';
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      traversedPath = traversedPath ? `${traversedPath}/${segment}` : segment;

      let nextRuleNode = currentRuleNode[segment];
      if (!nextRuleNode) {
        const wildcardKey = Object.keys(currentRuleNode).find(k => k.startsWith('$'));
        if (wildcardKey) {
          nextRuleNode = currentRuleNode[wildcardKey];
          wildcards[wildcardKey] = segment;
        }
      }

      if (!nextRuleNode) return false;
      currentRuleNode = nextRuleNode;

      if (currentRuleNode['.read'] !== undefined) {
        const allowed = evaluateExpression(currentRuleNode['.read'], {
          auth,
          data: rootSnapshot.child(traversedPath),
          newData: new DataSnapshot(null),
          root: rootSnapshot,
          query,
          wildcards,
        });
        if (allowed) return true;
      }
    }

    return false;
  }

  private validateSubtree(
    ruleNode: any,
    currentPath: string,
    auth: AuthContext | null,
    oldRoot: RootSnapshot,
    newRoot: RootSnapshot,
    wildcards: Record<string, string>
  ): boolean {
    const newDataSnap = newRoot.child(currentPath);
    if (!newDataSnap.exists()) return true;

    if (ruleNode['.validate'] !== undefined) {
      const ok = evaluateExpression(ruleNode['.validate'], {
        auth,
        data: oldRoot.child(currentPath),
        newData: newDataSnap,
        root: oldRoot,
        wildcards,
      });
      if (!ok) return false;
    }

    const val = newDataSnap.val();
    if (val && typeof val === 'object') {
      for (const childKey of Object.keys(val)) {
        let childRuleNode = ruleNode[childKey];
        const nextWildcards = { ...wildcards };
        if (!childRuleNode) {
          const wildcardKey = Object.keys(ruleNode).find(k => k.startsWith('$'));
          if (wildcardKey) {
            childRuleNode = ruleNode[wildcardKey];
            nextWildcards[wildcardKey] = childKey;
          }
        }
        if (childRuleNode) {
          const childOk = this.validateSubtree(
            childRuleNode,
            `${currentPath}/${childKey}`,
            auth,
            oldRoot,
            newRoot,
            nextWildcards
          );
          if (!childOk) return false;
        }
      }
    }
    return true;
  }

  canWrite(
    requestPath: string,
    auth: AuthContext | null,
    dbState: DatabaseState,
    newVal: any,
    precomputedPostState?: DatabaseState
  ): boolean {
    const parts = requestPath.split('/').filter(Boolean);
    const oldRoot = new RootSnapshot(dbState);
    const postState = precomputedPostState ?? setAtPath(dbState, requestPath, newVal);
    const newRoot = new RootSnapshot(postState);
    const wildcards: Record<string, string> = {};

    let currentRuleNode = this.rules;
    let writeAllowedByAncestor = false;
    const validationRulesToCheck: Array<{
      rule: string | boolean;
      targetPath: string;
      wildcards: Record<string, string>;
    }> = [];

    if (currentRuleNode['.write'] !== undefined) {
      const allowed = evaluateExpression(currentRuleNode['.write'], {
        auth,
        data: oldRoot.child(requestPath),
        newData: newRoot.child(requestPath),
        root: oldRoot,
        wildcards,
      });
      if (allowed) writeAllowedByAncestor = true;
    }

    let traversedPath = '';
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      traversedPath = traversedPath ? `${traversedPath}/${segment}` : segment;

      let nextRuleNode = currentRuleNode[segment];
      if (!nextRuleNode) {
        const wildcardKey = Object.keys(currentRuleNode).find(k => k.startsWith('$'));
        if (wildcardKey) {
          nextRuleNode = currentRuleNode[wildcardKey];
          wildcards[wildcardKey] = segment;
        }
      }

      if (!nextRuleNode) {
        if (!writeAllowedByAncestor) return false;
        break;
      }

      currentRuleNode = nextRuleNode;

      if (currentRuleNode['.write'] !== undefined) {
        const allowed = evaluateExpression(currentRuleNode['.write'], {
          auth,
          data: oldRoot.child(traversedPath),
          newData: newRoot.child(traversedPath),
          root: oldRoot,
          wildcards: { ...wildcards },
        });
        if (allowed) writeAllowedByAncestor = true;
      }

      if (currentRuleNode['.validate'] !== undefined) {
        validationRulesToCheck.push({
          rule: currentRuleNode['.validate'],
          targetPath: traversedPath,
          wildcards: { ...wildcards },
        });
      }
    }

    if (!writeAllowedByAncestor) return false;

    for (const item of validationRulesToCheck) {
      const valid = evaluateExpression(item.rule, {
        auth,
        data: oldRoot.child(item.targetPath),
        newData: newRoot.child(item.targetPath),
        root: oldRoot,
        wildcards: item.wildcards,
      });
      if (!valid) return false;
    }

    if (traversedPath === requestPath && currentRuleNode) {
      const val = newRoot.child(requestPath).val();
      if (val && typeof val === 'object') {
        for (const childKey of Object.keys(val)) {
          let childRuleNode = currentRuleNode[childKey];
          const nextWildcards = { ...wildcards };
          if (!childRuleNode) {
            const wildcardKey = Object.keys(currentRuleNode).find(k => k.startsWith('$'));
            if (wildcardKey) {
              childRuleNode = currentRuleNode[wildcardKey];
              nextWildcards[wildcardKey] = childKey;
            }
          }
          if (childRuleNode) {
            const childOk = this.validateSubtree(
              childRuleNode,
              `${requestPath}/${childKey}`,
              auth,
              oldRoot,
              newRoot,
              nextWildcards
            );
            if (!childOk) return false;
          }
        }
      }
    }

    return true;
  }

  canMultiWrite(
    updates: Record<string, any>,
    auth: AuthContext | null,
    dbState: DatabaseState
  ): boolean {
    let postState = deepClone(dbState);
    for (const [p, v] of Object.entries(updates)) {
      postState = setAtPath(postState, p, v);
    }
    for (const [p, v] of Object.entries(updates)) {
      if (!this.canWrite(p, auth, dbState, v, postState)) {
        return false;
      }
    }
    return true;
  }
}

// ==========================================
// TEST IDENTITIES & FIXTURE DATA
// ==========================================

const rulesPath = path.resolve('database.rules.json');
const engine = new RulesEngine(rulesPath);

const SUPER_ADMIN_UID = 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2';
const ADMIN_USER: AuthContext = { uid: SUPER_ADMIN_UID, token: { email: 'indiacybercafe.com@gmail.com', email_verified: true } };
const OPERATOR_USER: AuthContext = { uid: 'op_uid_123', token: { email: 'operator1@indiacybercafe.com', email_verified: true } };
const OPERATOR_SAME_EMAIL_OTHER_UID: AuthContext = { uid: 'op_uid_reused_999', token: { email: 'operator1@indiacybercafe.com', email_verified: true } };
const OPERATOR_2: AuthContext = { uid: 'op_uid_456', token: { email: 'operator2@indiacybercafe.com', email_verified: true } };
const DISABLED_OPERATOR: AuthContext = { uid: 'op_uid_disabled', token: { email: 'disabledop@indiacybercafe.com', email_verified: true } };
const CUSTOMER_A: AuthContext = { uid: 'cust_uid_A', token: { email: 'customerA@gmail.com', email_verified: true } };

const mockDb: DatabaseState = {
  users: {
    [SUPER_ADMIN_UID]: { uid: SUPER_ADMIN_UID, email: 'indiacybercafe.com@gmail.com', role: 'admin' },
    'op_uid_123': { uid: 'op_uid_123', email: 'operator1@indiacybercafe.com', role: 'operator', name: 'Operator One', phone: '9876543211', disabled: false },
    'op_uid_reused_999': { uid: 'op_uid_reused_999', email: 'operator1@indiacybercafe.com', role: 'operator', name: 'Operator Reused', disabled: false },
    'op_uid_456': { uid: 'op_uid_456', email: 'operator2@indiacybercafe.com', role: 'operator', name: 'Operator Two', disabled: false },
    'op_uid_disabled': { uid: 'op_uid_disabled', email: 'disabledop@indiacybercafe.com', role: 'operator', name: 'Disabled Operator', disabled: true },
    'cust_uid_A': { uid: 'cust_uid_A', email: 'customerA@gmail.com', role: 'user', name: 'Customer A', phone: '9876543210' },
    'cust_uid_B': { uid: 'cust_uid_B', email: 'customerB@gmail.com', role: 'user', name: 'Customer B', phone: '9123456789' },
  },
  services: {
    'srv_1': { id: 'srv_1', name: 'PAN Card Application', active: true },
  },
  products: {
    'prod_1': { id: 'prod_1', name: 'PVC Smart Card', price: 99 },
  },
  documents: {
    'doc_1': { id: 'doc_1', name: 'Aadhaar Form', active: true, fileType: 'PDF' },
  },
  applications: {
    'app_unassigned': {
      id: 'app_unassigned',
      uid: 'cust_uid_A',
      userId: 'cust_uid_A',
      name: 'Customer A',
      email: 'customerA@gmail.com',
      serviceId: 'srv_1',
      serviceName: 'PAN Card Application',
      charge: 199,
      paymentStatus: 'pending',
      status: 'processing',
    },
    'app_op1_uid': {
      id: 'app_op1_uid',
      uid: 'cust_uid_B',
      userId: 'cust_uid_B',
      name: 'Customer B',
      email: 'customerB@gmail.com',
      serviceId: 'srv_1',
      serviceName: 'PAN Card Application',
      charge: 199,
      paymentStatus: 'pending',
      status: 'processing',
      assignedTo: 'operator1@indiacybercafe.com',
      assignedToUid: 'op_uid_123',
      notes: {
        note_existing: {
          id: 'note_existing',
          type: 'note',
          by: 'Admin',
          email: 'indiacybercafe.com@gmail.com',
          authorUid: SUPER_ADMIN_UID,
          authorRole: 'admin',
          text: 'Initial assignment note',
          time: '14/11/2026',
        },
      },
    },
    'app_conflicting_email_uid': {
      id: 'app_conflicting_email_uid',
      uid: 'cust_uid_A',
      userId: 'cust_uid_A',
      name: 'Customer A',
      email: 'customerA@gmail.com',
      serviceId: 'srv_1',
      serviceName: 'PAN Card Application',
      charge: 149,
      paymentStatus: 'pending',
      status: 'processing',
      assignedTo: 'operator1@indiacybercafe.com',
      assignedToUid: 'op_uid_456',
    },
    'app_legacy_email_only': {
      id: 'app_legacy_email_only',
      uid: 'cust_uid_A',
      userId: 'cust_uid_A',
      name: 'Customer A',
      email: 'customerA@gmail.com',
      serviceId: 'srv_1',
      serviceName: 'PAN Card Application',
      charge: 149,
      paymentStatus: 'pending',
      status: 'processing',
      assignedTo: 'operator1@indiacybercafe.com',
    },
    'app_op2': {
      id: 'app_op2',
      uid: 'cust_uid_B',
      userId: 'cust_uid_B',
      name: 'Customer B',
      email: 'customerB@gmail.com',
      serviceId: 'srv_1',
      serviceName: 'PAN Card Application',
      charge: 149,
      paymentStatus: 'pending',
      status: 'processing',
      assignedTo: 'operator2@indiacybercafe.com',
      assignedToUid: 'op_uid_456',
    },
    'app_disabled_op': {
      id: 'app_disabled_op',
      uid: 'cust_uid_A',
      serviceId: 'srv_1',
      status: 'processing',
      assignedTo: 'disabledop@indiacybercafe.com',
      assignedToUid: 'op_uid_disabled',
    },
  },
  orders: {
    'ord_custA': { id: 'ord_custA', uid: 'cust_uid_A', userId: 'cust_uid_A', total: 198, paymentMethod: 'razorpay', paymentStatus: 'pending', orderStatus: 'pending' },
    'ord_custB': { id: 'ord_custB', uid: 'cust_uid_B', userId: 'cust_uid_B', total: 99, paymentMethod: 'cash', paymentStatus: 'completed', orderStatus: 'processing', assignedTo: 'operator1@indiacybercafe.com', assignedToUid: 'op_uid_123' },
    'ord_conflict': { id: 'ord_conflict', uid: 'cust_uid_A', userId: 'cust_uid_A', total: 99, paymentMethod: 'cash', paymentStatus: 'completed', orderStatus: 'processing', assignedTo: 'operator1@indiacybercafe.com', assignedToUid: 'op_uid_456' },
  },
  payments: {},
  productReviews: {
    'rev_custA': { productId: 'prod_1', rating: 5, uid: 'cust_uid_A', userName: 'Customer A', comment: 'Excellent' },
  },
  driveConnections: {
    'cust_uid_A': { connected: true, googleEmail: 'customerA@gmail.com', status: 'active' },
    'cust_uid_B': { connected: true, googleEmail: 'customerB@gmail.com', status: 'active' },
  },
  privacy_requests: {
    'PRV-10001': { id: 'PRV-10001', name: 'Secret User', email: 'secret@gmail.com', description: 'Please delete data', status: 'submitted' },
  },
};

interface TestCase {
  id: number;
  description: string;
  run: () => boolean | Promise<boolean>;
  expected: boolean;
}

const tests: TestCase[] = [
  {
    id: 1,
    description: '[RulesEngine] Unauthenticated visitor denied reading /users or /users/cust_uid_A',
    run: () => engine.canRead('users', null, mockDb) || engine.canRead('users/cust_uid_A', null, mockDb),
    expected: false,
  },
  {
    id: 2,
    description: '[RulesEngine] Customer A denied reading Customer B /users/cust_uid_B; allowed own profile safe update',
    run: () =>
      !engine.canRead('users/cust_uid_B', CUSTOMER_A, mockDb) &&
      engine.canRead('users/cust_uid_A', CUSTOMER_A, mockDb) &&
      engine.canWrite('users/cust_uid_A', CUSTOMER_A, mockDb, { ...mockDb.users['cust_uid_A'], name: 'Customer A Updated' }),
    expected: true,
  },
  {
    id: 3,
    description: '[RulesEngine] Privilege escalation (role=admin) or plaintext password save blocked',
    run: () =>
      engine.canWrite('users/cust_uid_A', CUSTOMER_A, mockDb, { ...mockDb.users['cust_uid_A'], role: 'admin' }) ||
      engine.canWrite('users/cust_uid_A', CUSTOMER_A, mockDb, { ...mockDb.users['cust_uid_A'], password: '123' }) ||
      engine.canWrite('users/op_uid_123', OPERATOR_USER, mockDb, { ...mockDb.users['op_uid_123'], role: 'admin' }) ||
      engine.canWrite('users/op_uid_disabled', DISABLED_OPERATOR, mockDb, { ...mockDb.users['op_uid_disabled'], disabled: false }),
    expected: false,
  },
  {
    id: 4,
    description: '[RulesEngine] Operator denied global /users directory & any other user profile',
    run: () =>
      engine.canRead('users', OPERATOR_USER, mockDb) ||
      engine.canRead('users/cust_uid_A', OPERATOR_USER, mockDb) ||
      engine.canRead('users/op_uid_456', OPERATOR_USER, mockDb),
    expected: false,
  },
  {
    id: 5,
    description: '[RulesEngine] Operator can read & update ONLY canonically assigned UID application + assignedToUid query',
    run: () =>
      engine.canRead('applications/app_op1_uid', OPERATOR_USER, mockDb) &&
      engine.canRead('applications', OPERATOR_USER, mockDb, { orderByChild: 'assignedToUid', equalTo: 'op_uid_123' }),
    expected: true,
  },
  {
    id: 6,
    description: '[RulesEngine] Operator with SAME email but DIFFERENT UID is denied read/write & query',
    run: () =>
      engine.canRead('applications/app_op1_uid', OPERATOR_SAME_EMAIL_OTHER_UID, mockDb) ||
      engine.canRead('applications/app_conflicting_email_uid', OPERATOR_USER, mockDb) ||
      engine.canRead('applications', OPERATOR_SAME_EMAIL_OTHER_UID, mockDb, { orderByChild: 'assignedToUid', equalTo: 'op_uid_123' }) ||
      engine.canWrite('applications/app_op1_uid/status', OPERATOR_SAME_EMAIL_OTHER_UID, mockDb, 'completed') ||
      engine.canWrite('applications/app_conflicting_email_uid/status', OPERATOR_USER, mockDb, 'completed'),
    expected: false,
  },
  {
    id: 7,
    description: '[RulesEngine] Broad assignedTo email queries & unmigrated legacy email-only records are NOT exposed (Apps & Orders)',
    run: () =>
      engine.canRead('applications', OPERATOR_USER, mockDb, { orderByChild: 'assignedTo', equalTo: 'operator1@indiacybercafe.com' }) ||
      engine.canRead('applications/app_legacy_email_only', OPERATOR_USER, mockDb) ||
      engine.canRead('orders', OPERATOR_USER, mockDb, { orderByChild: 'assignedTo', equalTo: 'operator1@indiacybercafe.com' }) ||
      engine.canRead('orders/ord_conflict', OPERATOR_USER, mockDb),
    expected: false,
  },
  {
    id: 8,
    description: '[RulesEngine] Operator A cannot read Operator B applications or unassigned apps or root /applications',
    run: () =>
      engine.canRead('applications/app_unassigned', OPERATOR_USER, mockDb) ||
      engine.canRead('applications/app_op2', OPERATOR_USER, mockDb) ||
      engine.canRead('applications', OPERATOR_USER, mockDb) ||
      engine.canRead('applications', OPERATOR_USER, mockDb, { orderByChild: 'uid', equalTo: 'cust_uid_B' }),
    expected: false,
  },
  {
    id: 9,
    description: '[RulesEngine] Operator loses read/write access immediately when assignment removed or reassigned to another Operator',
    run: () => {
      const removedDb = setAtPath(mockDb, 'applications/app_op1_uid/assignedToUid', null);
      const reassignedDb = setAtPath(mockDb, 'applications/app_op1_uid/assignedToUid', 'op_uid_456');
      return (
        !engine.canRead('applications/app_op1_uid', OPERATOR_USER, removedDb) &&
        !engine.canWrite('applications/app_op1_uid/status', OPERATOR_USER, removedDb, 'completed') &&
        !engine.canRead('applications/app_op1_uid', OPERATOR_USER, reassignedDb) &&
        !engine.canWrite('applications/app_op1_uid/status', OPERATOR_USER, reassignedDb, 'completed') &&
        engine.canRead('applications/app_op1_uid', OPERATOR_2, reassignedDb)
      );
    },
    expected: true,
  },
  {
    id: 10,
    description: '[RulesEngine] Disabled Operator denied reading or writing even assigned application',
    run: () =>
      engine.canRead('applications/app_disabled_op', DISABLED_OPERATOR, mockDb) ||
      engine.canRead('applications', DISABLED_OPERATOR, mockDb, { orderByChild: 'assignedToUid', equalTo: 'op_uid_disabled' }) ||
      engine.canWrite('applications/app_disabled_op/status', DISABLED_OPERATOR, mockDb, 'completed'),
    expected: false,
  },
  {
    id: 11,
    description: '[RulesEngine] Assigned Operator can multi-write allowed status + updatedAt + append-only note',
    run: () =>
      engine.canMultiWrite(
        {
          'applications/app_op1_uid/status': 'clarification',
          'applications/app_op1_uid/updatedAt': '2026-11-14T12:00:00.000Z',
          'applications/app_op1_uid/notes/note_new_1': {
            id: 'note_new_1',
            type: 'status',
            by: 'Operator One',
            email: 'operator1@indiacybercafe.com',
            authorUid: 'op_uid_123',
            authorRole: 'operator',
            text: 'Please upload clear front scan.',
            time: '14/11/2026, 12:00 pm',
            status: 'clarification',
            attachment: '/api/operator/attachments/att_1.pdf?appId=app_op1_uid',
          },
        },
        OPERATOR_USER,
        mockDb
      ),
    expected: true,
  },
  {
    id: 12,
    description: '[RulesEngine] Payment modification & deletion attempts by Operator or Customer fail',
    run: () =>
      engine.canWrite('applications/app_unassigned/paymentStatus', CUSTOMER_A, mockDb, 'completed') ||
      engine.canWrite('applications/app_op1_uid/paymentStatus', OPERATOR_USER, mockDb, 'completed') ||
      engine.canWrite('applications/app_op1_uid/charge', OPERATOR_USER, mockDb, 0) ||
      engine.canWrite('applications/app_op1_uid/razorpayPaymentId', OPERATOR_USER, mockDb, 'pay_fake') ||
      engine.canWrite('payments/pay_1', OPERATOR_USER, mockDb, { amount: 1 }) ||
      engine.canWrite('applications/app_op1_uid', OPERATOR_USER, mockDb, null) ||
      engine.canWrite('orders/ord_custB', OPERATOR_USER, mockDb, null) ||
      engine.canWrite('users/cust_uid_A', OPERATOR_USER, mockDb, null),
    expected: false,
  },
  {
    id: 13,
    description: '[RulesEngine] Operator note edit, note delete, or replacing whole notes node fails',
    run: () =>
      engine.canWrite('applications/app_op1_uid/notes/note_existing', OPERATOR_USER, mockDb, {
        type: 'note',
        by: 'Operator One',
        email: 'operator1@indiacybercafe.com',
        authorUid: 'op_uid_123',
        authorRole: 'operator',
        text: 'Tampered existing note',
        time: '14/11/2026',
      }) ||
      engine.canWrite('applications/app_op1_uid/notes/note_existing', OPERATOR_USER, mockDb, null) ||
      engine.canWrite('applications/app_op1_uid/notes', OPERATOR_USER, mockDb, null) ||
      engine.canWrite('applications/app_op1_uid/notes', OPERATOR_USER, mockDb, []),
    expected: false,
  },
  {
    id: 14,
    description: '[RulesEngine] Multi-location atomic write attacks & parent inheritance tampering fail',
    run: () =>
      engine.canMultiWrite(
        {
          'applications/app_op1_uid/status': 'completed',
          'applications/app_op1_uid/paymentStatus': 'completed',
        },
        OPERATOR_USER,
        mockDb
      ) ||
      engine.canMultiWrite(
        {
          'applications/app_op1_uid/status': 'completed',
          'applications/app_op1_uid/assignedToUid': 'op_uid_456',
        },
        OPERATOR_USER,
        mockDb
      ) ||
      engine.canMultiWrite(
        {
          'applications/app_op1_uid/status': 'completed',
          'users/op_uid_123/role': 'admin',
        },
        OPERATOR_USER,
        mockDb
      ),
    expected: false,
  },
  {
    id: 15,
    description: '[RulesEngine] Orders UID isolation: Operator reads assigned order via assignedToUid, denied unassigned/conflict/write',
    run: () =>
      engine.canRead('orders/ord_custB', OPERATOR_USER, mockDb) &&
      engine.canRead('orders', OPERATOR_USER, mockDb, { orderByChild: 'assignedToUid', equalTo: 'op_uid_123' }) &&
      !engine.canRead('orders/ord_custA', OPERATOR_USER, mockDb) &&
      !engine.canRead('orders/ord_conflict', OPERATOR_USER, mockDb) &&
      !engine.canWrite('orders/ord_custB/orderStatus', OPERATOR_USER, mockDb, 'delivered'),
    expected: true,
  },
  {
    id: 16,
    description: '[RulesEngine] Admin can still read /users and update roles; public catalogs remain readable',
    run: () =>
      engine.canRead('users', ADMIN_USER, mockDb) &&
      engine.canRead('services', null, mockDb) &&
      engine.canRead('products', null, mockDb) &&
      engine.canRead('documents', null, mockDb) &&
      !engine.canRead('privacy_requests/PRV-10001', OPERATOR_USER, mockDb),
    expected: true,
  },
];

// ==========================================
// EXPRESS API INTEGRATION TESTS (OPERATOR_TEST_MODE=1)
// ==========================================

async function runApiIntegrationTests(): Promise<Array<{ name: string; ok: boolean; detail?: string }>> {
  process.env.OPERATOR_TEST_MODE = '1';

  const dataDir = path.resolve('data');
  fs.mkdirSync(dataDir, { recursive: true });
  const testStorePath = path.join(dataDir, 'operator_test_store.json');
  const prevStoreExists = fs.existsSync(testStorePath);
  const prevStoreContent = prevStoreExists ? fs.readFileSync(testStorePath, 'utf-8') : null;

  const writeSeedStore = (overrideApps?: Record<string, any>) => {
    fs.writeFileSync(
      testStorePath,
      JSON.stringify(
        {
          users: {
            [SUPER_ADMIN_UID]: { uid: SUPER_ADMIN_UID, email: 'indiacybercafe.com@gmail.com', role: 'admin', name: 'Super Admin' },
            'op_uid_123': { uid: 'op_uid_123', email: 'operator1@indiacybercafe.com', role: 'operator', name: 'Operator One', disabled: false },
            'op_uid_reused_999': { uid: 'op_uid_reused_999', email: 'operator1@indiacybercafe.com', role: 'operator', name: 'Operator Reused', disabled: false },
            'op_uid_456': { uid: 'op_uid_456', email: 'operator2@indiacybercafe.com', role: 'operator', name: 'Operator Two', disabled: false },
            'op_uid_disabled': { uid: 'op_uid_disabled', email: 'disabledop@indiacybercafe.com', role: 'operator', name: 'Disabled Operator', disabled: true },
            'cust_uid_A': { uid: 'cust_uid_A', email: 'customerA@gmail.com', role: 'user', name: 'Customer A' },
          },
          applications: overrideApps ?? {
            'app_op1_test': {
              id: 'app_op1_test',
              uid: 'cust_uid_A',
              userId: 'cust_uid_A',
              name: 'Customer A',
              email: 'customerA@gmail.com',
              serviceId: 'srv_1',
              serviceName: 'PAN Card Application',
              charge: 199,
              paymentStatus: 'pending',
              status: 'processing',
              assignedTo: 'operator1@indiacybercafe.com',
              assignedToUid: 'op_uid_123',
              notes: {},
            },
            'app_op2_test': {
              id: 'app_op2_test',
              uid: 'cust_uid_A',
              name: 'Customer A',
              email: 'customerA@gmail.com',
              serviceId: 'srv_1',
              serviceName: 'PAN Card Application',
              charge: 199,
              paymentStatus: 'pending',
              status: 'processing',
              assignedTo: 'operator2@indiacybercafe.com',
              assignedToUid: 'op_uid_456',
              notes: {},
            },
          },
        },
        null,
        2
      )
    );
  };

  writeSeedStore();

  const testApp = express();
  testApp.use(express.json());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  const uploadMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    upload.single('file')(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      return res.status(400).json({ success: false, error: err?.message || 'Upload failed' });
    });
  };

  testApp.get('/api/operator/applications/:appId', handleGetOperatorApplication);
  testApp.post('/api/operator/applications/:appId/update', handleOperatorUpdateApplication);
  testApp.post('/api/operator/applications/:appId/upload-attachment', uploadMiddleware, handleOperatorUploadAttachment);
  testApp.get('/api/operator/attachments/:attachmentId', handleGetOperatorAttachment);
  testApp.post('/api/applications/:appId/verify-payment', handleVerifyApplicationPayment);
  testApp.post('/api/admin-protected-test', requireAdminMiddleware, (_req, res) => res.json({ success: true }));
  testApp.post('/api/check-caller-test', async (req, res) => {
    const caller = await verifyCallerWithRole(req);
    res.json({ caller });
  });

  const server = http.createServer(testApp);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const tokenOp1 = 'test-token:op_uid_123:operator1@indiacybercafe.com:verified';
  const tokenOp1SameEmailDifferentUid = 'test-token:op_uid_reused_999:operator1@indiacybercafe.com:verified';
  const tokenOp2 = 'test-token:op_uid_456:operator2@indiacybercafe.com:verified';
  const tokenDisabled = 'test-token:op_uid_disabled:disabledop@indiacybercafe.com:verified';
  const tokenCustA = 'test-token:cust_uid_A:customerA@gmail.com:verified';
  const tokenAdmin = `test-token:${SUPER_ADMIN_UID}:indiacybercafe.com@gmail.com:verified`;

  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

  try {
    // 1. Assigned Operator GET vs Unassigned vs Same-Email-Different-UID
    const r1a = await fetch(`${baseUrl}/api/operator/applications/app_op1_test`, { headers: { Authorization: `Bearer ${tokenOp1}` } });
    const r1b = await fetch(`${baseUrl}/api/operator/applications/app_op2_test`, { headers: { Authorization: `Bearer ${tokenOp1}` } });
    const r1c = await fetch(`${baseUrl}/api/operator/applications/app_op1_test`, { headers: { Authorization: `Bearer ${tokenOp1SameEmailDifferentUid}` } });
    results.push({
      name: 'API: Assigned Operator GET allowed (200); unassigned (403) & same-email different-UID (403) blocked',
      ok: r1a.status === 200 && r1b.status === 403 && r1c.status === 403,
      detail: `op1=${r1a.status}, op2App=${r1b.status}, sameEmailOtherUid=${r1c.status}`,
    });

    // 2. Disabled Operator rejected
    const r2 = await fetch(`${baseUrl}/api/operator/applications/app_op1_test/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenDisabled}` },
      body: JSON.stringify({ status: 'completed', note: 'Should fail' }),
    });
    results.push({ name: 'API: Disabled Operator update blocked -> 403', ok: r2.status === 403, detail: `HTTP ${r2.status}` });

    // 3. Reject protected fields, unknown fields (e.g. legacy noteText/attachment), and empty submissions
    const r3a = await fetch(`${baseUrl}/api/operator/applications/app_op1_test/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOp1}` },
      body: JSON.stringify({ status: 'completed', paymentStatus: 'completed' }),
    });
    const r3b = await fetch(`${baseUrl}/api/operator/applications/app_op1_test/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOp1}` },
      body: JSON.stringify({ noteText: 'Wrong field name' }),
    });
    const r3c = await fetch(`${baseUrl}/api/operator/applications/app_op1_test/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOp1}` },
      body: JSON.stringify({ status: '', note: '   ' }),
    });
    results.push({
      name: 'API: Update rejects protected fields (403), unknown/mismatched fields (400), and empty payload (400)',
      ok: r3a.status === 403 && r3b.status === 400 && r3c.status === 400,
      detail: `protected=${r3a.status}, unknown=${r3b.status}, empty=${r3c.status}`,
    });

    // 4. Upload validation: PDF, JPG, PNG, WEBP accepted under field 'file'; wrong field 'attachment', invalid format, >5MB rejected cleanly
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
    const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const webpBytes = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ');

    const uploadWithField = async (fieldName: string, bytes: Buffer, filename: string, mime: string, appId = 'app_op1_test', token = tokenOp1) => {
      const form = new FormData();
      form.append(fieldName, new Blob([bytes], { type: mime }), filename);
      return fetch(`${baseUrl}/api/operator/applications/${appId}/upload-attachment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    };

    const upPdf = await uploadWithField('file', pdfBytes, 'receipt.pdf', 'application/pdf');
    const upPdfJson = await upPdf.json();
    const upJpg = await uploadWithField('file', jpgBytes, 'scan.jpg', 'image/jpeg');
    const upPng = await uploadWithField('file', pngBytes, 'proof.png', 'image/png');
    const upWebp = await uploadWithField('file', webpBytes, 'photo.webp', 'image/webp');
    const upWrongField = await uploadWithField('attachment', pdfBytes, 'wrongfield.pdf', 'application/pdf');
    const upBadMagic = await uploadWithField('file', Buffer.from('<script>alert(1)</script>'), 'evil.pdf', 'application/pdf');
    const upTooBig = await uploadWithField('file', Buffer.alloc(5 * 1024 * 1024 + 512, 0x41), 'huge.pdf', 'application/pdf');
    const upUnauthOp = await uploadWithField('file', pdfBytes, 'unauth.pdf', 'application/pdf', 'app_op1_test', tokenOp2);

    // Inspect binary + .meta.json on disk for uploaded PDF
    let metaPersistedOk = false;
    const uploadedPdfUrl = upPdfJson.attachmentUrl || '';
    if (upPdf.status === 200 && uploadedPdfUrl.startsWith('/api/operator/attachments/')) {
      const attId = decodeURIComponent(new URL(uploadedPdfUrl, 'http://localhost').pathname.split('/').pop() || '');
      const diskFile = path.join(APP_ROOT_ATTACHMENTS_DIR(), 'app_op1_test', attId);
      const diskMeta = `${diskFile}.meta.json`;
      if (fs.existsSync(diskFile) && fs.existsSync(diskMeta)) {
        const meta = JSON.parse(fs.readFileSync(diskMeta, 'utf-8'));
        metaPersistedOk =
          meta.appId === 'app_op1_test' &&
          meta.uploadedByUid === 'op_uid_123' &&
          meta.contentType === 'application/pdf' &&
          meta.originalName === 'receipt.pdf' &&
          meta.size === pdfBytes.length;
      }
    }

    results.push({
      name: 'API: Attachments accept PDF/JPG/PNG/WEBP via "file" & persist binary + .meta.json; reject wrong field, spoofed file, >5MB, unauthorized op',
      ok:
        upPdf.status === 200 &&
        upJpg.status === 200 &&
        upPng.status === 200 &&
        upWebp.status === 200 &&
        metaPersistedOk &&
        upWrongField.status === 400 &&
        upBadMagic.status === 400 &&
        upTooBig.status === 400 &&
        upUnauthOp.status === 403,
      detail: `pdf=${upPdf.status}, jpg=${upJpg.status}, png=${upPng.status}, webp=${upWebp.status}, metaOk=${metaPersistedOk}, wrongField=${upWrongField.status}, bad=${upBadMagic.status}, >5MB=${upTooBig.status}, unauth=${upUnauthOp.status}`,
    });

    // 5. Canonical Update Payload + Actual Saved Store Inspection (NOT just HTTP 200!)
    const updateResp = await fetch(`${baseUrl}/api/operator/applications/app_op1_test/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOp1}` },
      body: JSON.stringify({
        status: 'clarification',
        note: 'Verified <script>alert(1)</script> clear scan uploaded.',
        attachmentUrl: uploadedPdfUrl,
        attachmentName: 'receipt.pdf',
      }),
    });
    const updateJson = await updateResp.json();
    const persistedStore = JSON.parse(fs.readFileSync(testStorePath, 'utf-8'));
    const persistedApp = persistedStore.applications['app_op1_test'];
    const persistedNote = persistedApp?.notes?.[updateJson.note?.id];

    const persistedOk = Boolean(
      updateResp.status === 200 &&
      persistedApp &&
      persistedApp.status === 'clarification' &&
      persistedNote &&
      typeof persistedNote.text === 'string' &&
      persistedNote.text.includes('clear scan uploaded.') &&
      !persistedNote.text.includes('<script>') &&
      persistedNote.attachment === uploadedPdfUrl &&
      persistedNote.attachmentName === 'receipt.pdf' &&
      persistedNote.authorUid === 'op_uid_123' &&
      persistedNote.authorRole === 'operator'
    );

    results.push({
      name: 'API: Canonical { status, note, attachmentUrl, attachmentName } persists exact note text, status, attachmentUrl & attachmentName in DB',
      ok: persistedOk,
      detail: `HTTP ${updateResp.status}, savedStatus=${persistedApp?.status}, savedAttachmentName=${persistedNote?.attachmentName}`,
    });

    // 6. Cross-app internal attachment injection rejected (400)
    const rCrossAtt = await fetch(`${baseUrl}/api/operator/applications/app_op2_test/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOp2}` },
      body: JSON.stringify({
        note: 'Cross app URL test',
        attachmentUrl: uploadedPdfUrl,
        attachmentName: 'receipt.pdf',
      }),
    });
    results.push({
      name: 'API: Rejects cross-application internal attachment URL on update -> 400',
      ok: rCrossAtt.status === 400,
      detail: `HTTP ${rCrossAtt.status}`,
    });

    // 7. Attachment download before & AFTER reassignment to another Operator
    const dlUnauth = await fetch(`${baseUrl}${uploadedPdfUrl}`);
    const dlOtherOpBefore = await fetch(`${baseUrl}${uploadedPdfUrl}`, { headers: { Authorization: `Bearer ${tokenOp2}` } });
    const dlAssignedOpBefore = await fetch(`${baseUrl}${uploadedPdfUrl}`, { headers: { Authorization: `Bearer ${tokenOp1}` } });
    const dlOwner = await fetch(`${baseUrl}${uploadedPdfUrl}`, { headers: { Authorization: `Bearer ${tokenCustA}` } });

    // Reassign app_op1_test from op_uid_123 -> op_uid_456
    const storeNow = JSON.parse(fs.readFileSync(testStorePath, 'utf-8'));
    storeNow.applications['app_op1_test'].assignedToUid = 'op_uid_456';
    storeNow.applications['app_op1_test'].assignedTo = 'operator2@indiacybercafe.com';
    fs.writeFileSync(testStorePath, JSON.stringify(storeNow, null, 2));

    const dlOp1AfterReassign = await fetch(`${baseUrl}${uploadedPdfUrl}`, { headers: { Authorization: `Bearer ${tokenOp1}` } });
    const dlOp2AfterReassign = await fetch(`${baseUrl}${uploadedPdfUrl}`, { headers: { Authorization: `Bearer ${tokenOp2}` } });
    const uploadOp1AfterReassign = await uploadWithField('file', pdfBytes, 'after_reassign.pdf', 'application/pdf', 'app_op1_test', tokenOp1);

    results.push({
      name: 'API: Reassigning application immediately blocks previous Operator from downloading/uploading attachments (403) while authorizing new Operator (200)',
      ok:
        dlUnauth.status === 401 &&
        dlOtherOpBefore.status === 403 &&
        dlAssignedOpBefore.status === 200 &&
        dlOwner.status === 200 &&
        dlOp1AfterReassign.status === 403 &&
        dlOp2AfterReassign.status === 200 &&
        uploadOp1AfterReassign.status === 403,
      detail: `unauth=${dlUnauth.status}, beforeOp1=${dlAssignedOpBefore.status}, afterOp1Dl=${dlOp1AfterReassign.status}, afterOp1Up=${uploadOp1AfterReassign.status}, afterOp2Dl=${dlOp2AfterReassign.status}`,
    });

    // 8. Payment verification: Operator denied (403), Customer bad sig denied (400), Customer valid sig allowed (200)
    const rPayOp = await fetch(`${baseUrl}/api/applications/app_op1_test/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOp1}` },
      body: JSON.stringify({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'ord_1', razorpay_signature: 'test_valid_sig' }),
    });
    const rPayBad = await fetch(`${baseUrl}/api/applications/app_op1_test/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCustA}` },
      body: JSON.stringify({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'ord_1', razorpay_signature: 'bad_sig' }),
    });
    const rPayOk = await fetch(`${baseUrl}/api/applications/app_op1_test/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCustA}` },
      body: JSON.stringify({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'ord_1', razorpay_signature: 'test_valid_sig' }),
    });
    results.push({
      name: 'API: /verify-payment denies Operator (403), rejects invalid sig (400), allows owner valid sig (200)',
      ok: rPayOp.status === 403 && rPayBad.status === 400 && rPayOk.status === 200,
      detail: `op=${rPayOp.status}, bad=${rPayBad.status}, ok=${rPayOk.status}`,
    });

    // 9. Admin middleware blocks Operator (403) & allows Admin (200)
    const rAdmOp = await fetch(`${baseUrl}/api/admin-protected-test`, { method: 'POST', headers: { Authorization: `Bearer ${tokenOp1}` } });
    const rAdmOk = await fetch(`${baseUrl}/api/admin-protected-test`, { method: 'POST', headers: { Authorization: `Bearer ${tokenAdmin}` } });
    results.push({
      name: 'API: requireAdminMiddleware blocks Operator (403) and allows Super Admin (200)',
      ok: rAdmOp.status === 403 && rAdmOk.status === 200,
      detail: `op=${rAdmOp.status}, admin=${rAdmOk.status}`,
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    const testUploadSubdir = path.join(APP_ROOT_ATTACHMENTS_DIR(), 'app_op1_test');
    if (fs.existsSync(testUploadSubdir)) {
      fs.rmSync(testUploadSubdir, { recursive: true, force: true });
    }
    if (prevStoreExists && prevStoreContent !== null) {
      fs.writeFileSync(testStorePath, prevStoreContent);
    } else if (fs.existsSync(testStorePath)) {
      fs.unlinkSync(testStorePath);
    }
  }

  return results;
}

// ==========================================
// MIGRATION SAFETY & FRONTEND CONTRACT TESTS
// ==========================================

function runMigrationAndContractTests(): Array<{ name: string; ok: boolean; detail?: string }> {
  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // 1. Migration planning, backup verification, conflict detection, note/attachment preservation & idempotency
  const sampleUsers = {
    op1: { uid: 'op1', email: 'op1@icc.com', role: 'operator' },
    op2: { uid: 'op2', email: 'op2@icc.com', role: 'operator' },
    dupA: { uid: 'dupA', email: 'dup@icc.com', role: 'operator' },
    dupB: { uid: 'dupB', email: 'dup@icc.com', role: 'operator' },
    cust1: { uid: 'cust1', email: 'cust@gmail.com', role: 'user' },
  };
  const sampleApps: Record<string, any> = {
    appLegacyOk: {
      id: 'appLegacyOk',
      assignedTo: 'op1@icc.com',
      notes: [
        { text: 'First note', attachment: 'https://example.com/a.pdf', attachmentName: 'a.pdf' },
        { text: 'Second note' },
      ],
    },
    appConflict: {
      id: 'appConflict',
      assignedTo: 'op1@icc.com',
      assignedToUid: 'op2', // Must NEVER be overwritten!
    },
    appUnmatched: {
      id: 'appUnmatched',
      assignedTo: 'former_staff@icc.com',
    },
    appDupEmail: {
      id: 'appDupEmail',
      assignedTo: 'dup@icc.com',
    },
  };
  const sampleOrders: Record<string, any> = {
    ordLegacyOk: {
      id: 'ordLegacyOk',
      assignedTo: 'op2@icc.com',
      notes: [{ text: 'Packed', attachment: '/api/operator/attachments/1.png?appId=ordLegacyOk' }],
    },
  };

  const plan = planOperatorSecurityMigration(sampleUsers, sampleApps, sampleOrders);
  const tmpBackupPath = path.resolve('data/backups/test_tmp_migration_backup.json');
  let backupOk = false;
  try {
    const verified = createAndVerifyBackup(
      tmpBackupPath,
      { projectId: 'india-cyber-cafe', databaseURL: 'https://india-cyber-cafe-default-rtdb.firebaseio.com' },
      sampleUsers,
      sampleApps,
      sampleOrders
    );
    const rollbackPayload = buildRollbackUpdates(verified);
    backupOk =
      verified.summary.applications.recordCount === 4 &&
      verified.summary.applications.noteCount === 2 &&
      verified.summary.applications.attachmentRefCount === 1 &&
      Object.keys(rollbackPayload.applications).length === 4;
  } finally {
    if (fs.existsSync(tmpBackupPath)) fs.unlinkSync(tmpBackupPath);
  }

  // Apply planned updates in memory and check post-stats + idempotency
  const migratedApps = deepClone(sampleApps);
  const migratedOrders = deepClone(sampleOrders);
  migratedApps.appLegacyOk.assignedToUid = plan.updates['applications/appLegacyOk/assignedToUid'];
  migratedApps.appLegacyOk.notes = plan.updates['applications/appLegacyOk/notes'];
  migratedOrders.ordLegacyOk.assignedToUid = plan.updates['orders/ordLegacyOk/assignedToUid'];
  migratedOrders.ordLegacyOk.notes = plan.updates['orders/ordLegacyOk/notes'];

  const postAppStats = countNotesAndAttachments(migratedApps);
  const postOrderStats = countNotesAndAttachments(migratedOrders);
  const idempotentPlan = planOperatorSecurityMigration(sampleUsers, migratedApps, migratedOrders);

  results.push({
    name: 'Migration: Verified backup/rollback, UID backfill, array-to-map conversion preserving note/attachment counts, conflict & unmatched flagging, and idempotency',
    ok:
      backupOk &&
      plan.appBackfills.length === 1 &&
      plan.orderBackfills.length === 1 &&
      plan.unmatchedAppEmails.length === 1 &&
      plan.conflictsForAdminReview.length === 2 &&
      !('applications/appConflict/assignedToUid' in plan.updates) &&
      postAppStats.noteCount === plan.beforeStats.applications.noteCount &&
      postAppStats.attachmentRefCount === plan.beforeStats.applications.attachmentRefCount &&
      postAppStats.arrayNoteRecords === 0 &&
      postOrderStats.noteCount === plan.beforeStats.orders.noteCount &&
      postOrderStats.arrayNoteRecords === 0 &&
      Object.keys(idempotentPlan.updates).length === 0,
    detail: `backfills=${plan.appBackfills.length}+${plan.orderBackfills.length}, conflicts=${plan.conflictsForAdminReview.length}, idempotentUpdates=${Object.keys(idempotentPlan.updates).length}`,
  });

  // 2. Frontend contract & no-Storage-fallback verification
  const modalSrc = fs.readFileSync(path.resolve('src/components/ApplicationDetailsModal.tsx'), 'utf-8');
  const hookSrc = fs.readFileSync(path.resolve('src/hooks/useApplications.ts'), 'utf-8');
  const hasNoStorageFallback = !modalSrc.includes('uploadService') && !modalSrc.includes('uploadFile(');
  const usesFileFormField = modalSrc.includes("formData.append('file'");
  const sendsCanonicalKeys = modalSrc.includes('note: sanitizedNote') && modalSrc.includes('attachmentUrl: attachmentUrl');
  const noBroadEmailQuery = !hookSrc.includes("orderByChild('assignedTo')");

  results.push({
    name: 'Frontend Contract: ApplicationDetailsModal has NO Firebase Storage fallback, uploads via "file" field, sends canonical update keys, and useApplications removes assignedTo email query',
    ok: hasNoStorageFallback && usesFileFormField && sendsCanonicalKeys && noBroadEmailQuery,
    detail: `noStorageFallback=${hasNoStorageFallback}, fileField=${usesFileFormField}, canonicalKeys=${sendsCanonicalKeys}, noEmailQuery=${noBroadEmailQuery}`,
  });

  return results;
}

function APP_ROOT_ATTACHMENTS_DIR() {
  return path.resolve('data/uploads/attachments');
}

async function main() {
  console.log('======================================================================');
  console.log('🔍 INDIA CYBER CAFE — SECURITY RULES SIMULATOR & API TEST SUITE');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    const result = await t.run();
    const isMatch = result === t.expected;
    if (isMatch) {
      passed++;
      console.log(`✅ [PASS] Rule #${t.id}: ${t.description}`);
    } else {
      failed++;
      console.log(`❌ [FAIL] Rule #${t.id}: ${t.description} (Got ${result}, expected ${t.expected})`);
    }
  }

  console.log('\n--- Express API Integration Tests (OPERATOR_TEST_MODE=1) ---');
  const apiResults = await runApiIntegrationTests();
  for (const r of apiResults) {
    if (r.ok) {
      passed++;
      console.log(`✅ [PASS] ${r.name} (${r.detail})`);
    } else {
      failed++;
      console.log(`❌ [FAIL] ${r.name} (${r.detail})`);
    }
  }

  console.log('\n--- Migration Safety & Frontend Security Contract Tests ---');
  const contractResults = runMigrationAndContractTests();
  for (const r of contractResults) {
    if (r.ok) {
      passed++;
      console.log(`✅ [PASS] ${r.name} (${r.detail})`);
    } else {
      failed++;
      console.log(`❌ [FAIL] ${r.name} (${r.detail})`);
    }
  }

  const total = tests.length + apiResults.length + contractResults.length;
  console.log('\n======================================================================');
  console.log(`📊 TEST EXECUTION SUMMARY:`);
  console.log(`   Total Scenarios Tested : ${total}`);
  console.log(`   Passed                 : ${passed}`);
  console.log(`   Failed                 : ${failed}`);
  console.log(`   Success Rate           : ${((passed / total) * 100).toFixed(1)}%`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  console.log('🛡️ All RulesEngine Simulator, Operator API, and Migration Safety checks passed!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Test suite crashed:', err);
  process.exit(1);
});
