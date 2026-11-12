import fs from 'fs';
import path from 'path';

/**
 * Automated Security Rules Test Suite for India Cyber Cafe
 * Evaluates database.rules.json against all required security scenarios.
 */

interface AuthContext {
  uid: string;
  token?: {
    email?: string;
  };
}

interface QueryContext {
  orderByChild?: string;
  equalTo?: string;
}

interface NodeData {
  [key: string]: any;
}

interface DatabaseState {
  users?: Record<string, any>;
  services?: Record<string, any>;
  products?: Record<string, any>;
  productCategories?: Record<string, any>;
  documentCategories?: Record<string, any>;
  documents?: Record<string, any>;
  applications?: Record<string, any>;
  orders?: Record<string, any>;
  payments?: Record<string, any>;
  productReviews?: Record<string, any>;
  gateways?: Record<string, any>;
  driveConnections?: Record<string, any>;
  documentPreferences?: Record<string, any>;
  privacy_requests?: Record<string, any>;
  [key: string]: any;
}

// Helpers simulating Firebase RTDB Rule Environment
class DataSnapshot {
  constructor(private _val: any) {}

  val(): any {
    return this._val;
  }

  exists(): boolean {
    return this._val !== undefined && this._val !== null;
  }

  hasChild(childPath: string): boolean {
    if (!this.exists() || typeof this._val !== 'object') return false;
    return childPath in this._val && this._val[childPath] !== undefined;
  }

  hasChildren(children?: string[]): boolean {
    if (!this.exists() || typeof this._val !== 'object') return false;
    if (!children) return Object.keys(this._val).length > 0;
    return children.every(c => this.hasChild(c));
  }

  child(childPath: string): DataSnapshot {
    if (!this.exists() || typeof this._val !== 'object') return new DataSnapshot(null);
    return new DataSnapshot(this._val[childPath] ?? null);
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
    let curr: any = this.state;
    for (const part of parts) {
      if (curr && typeof curr === 'object') {
        curr = curr[part];
      } else {
        return new DataSnapshot(null);
      }
    }
    return new DataSnapshot(curr ?? null);
  }
}

/**
 * Evaluates rule expressions safely with RTDB primitives
 */
function evaluateExpression(
  expr: string,
  context: {
    auth: AuthContext | null;
    data: DataSnapshot;
    newData: DataSnapshot;
    root: RootSnapshot;
    query?: QueryContext;
    wildcards: Record<string, string>;
  }
): boolean {
  if (expr === 'true' || expr === true as any) return true;
  if (expr === 'false' || expr === false as any) return false;

  const { auth, data, newData, root, query = {}, wildcards } = context;

  // Build evaluation sandbox
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
  } catch (err) {
    // If expression throws (e.g. accessing undefined property on null), in RTDB it evaluates to false
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

    // Check cascading .read permissions from root down to target path
    let currentRuleNode = this.rules;
    const wildcards: Record<string, string> = {};

    // Root level read
    if (currentRuleNode['.read']) {
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
        // Look for wildcard child (e.g. $uid, $appId)
        const wildcardKey = Object.keys(currentRuleNode).find(k => k.startsWith('$'));
        if (wildcardKey) {
          nextRuleNode = currentRuleNode[wildcardKey];
          wildcards[wildcardKey] = segment;
        }
      }

      if (!nextRuleNode) return false;
      currentRuleNode = nextRuleNode;

      if (currentRuleNode['.read']) {
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

  canWrite(
    requestPath: string,
    auth: AuthContext | null,
    dbState: DatabaseState,
    newVal: any
  ): boolean {
    const parts = requestPath.split('/').filter(Boolean);
    const rootSnapshot = new RootSnapshot(dbState);
    const wildcards: Record<string, string> = {};

    let currentRuleNode = this.rules;
    let writeAllowedByAncestor = false;
    const validationRulesToCheck: Array<{
      rule: string;
      targetPath: string;
      wildcards: Record<string, string>;
    }> = [];

    // Check root level
    if (currentRuleNode['.write']) {
      const allowed = evaluateExpression(currentRuleNode['.write'], {
        auth,
        data: rootSnapshot.child(requestPath),
        newData: new DataSnapshot(newVal),
        root: rootSnapshot,
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

      if (currentRuleNode['.write']) {
        const allowed = evaluateExpression(currentRuleNode['.write'], {
          auth,
          data: rootSnapshot.child(traversedPath),
          newData: new DataSnapshot(newVal),
          root: rootSnapshot,
          wildcards: { ...wildcards },
        });
        if (allowed) writeAllowedByAncestor = true;
      }

      if (currentRuleNode['.validate']) {
        validationRulesToCheck.push({
          rule: currentRuleNode['.validate'],
          targetPath: traversedPath,
          wildcards: { ...wildcards },
        });
      }
    }

    if (!writeAllowedByAncestor) return false;

    // Check all applicable .validate rules
    for (const item of validationRulesToCheck) {
      const valid = evaluateExpression(item.rule, {
        auth,
        data: rootSnapshot.child(item.targetPath),
        newData: new DataSnapshot(newVal),
        root: rootSnapshot,
        wildcards: item.wildcards,
      });
      if (!valid) return false;
    }

    return true;
  }
}

// ==========================================
// TEST SUITE EXECUTION
// ==========================================

const rulesPath = path.resolve('database.rules.json');
const engine = new RulesEngine(rulesPath);

const SUPER_ADMIN_UID = 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2';
const ADMIN_USER: AuthContext = { uid: SUPER_ADMIN_UID, token: { email: 'indiacybercafe.com@gmail.com' } };
const OPERATOR_USER: AuthContext = { uid: 'op_uid_123', token: { email: 'operator1@indiacybercafe.com' } };
const CUSTOMER_A: AuthContext = { uid: 'cust_uid_A', token: { email: 'customerA@gmail.com' } };
const CUSTOMER_B: AuthContext = { uid: 'cust_uid_B', token: { email: 'customerB@gmail.com' } };

// Mock initial database state
const mockDb: DatabaseState = {
  users: {
    [SUPER_ADMIN_UID]: { uid: SUPER_ADMIN_UID, email: 'indiacybercafe.com@gmail.com', role: 'admin' },
    'op_uid_123': { uid: 'op_uid_123', email: 'operator1@indiacybercafe.com', role: 'operator' },
    'cust_uid_A': { uid: 'cust_uid_A', email: 'customerA@gmail.com', role: 'user', name: 'Customer A', phone: '9876543210' },
    'cust_uid_B': { uid: 'cust_uid_B', email: 'customerB@gmail.com', role: 'user', name: 'Customer B', phone: '9123456789' }
  },
  services: {
    'srv_1': { id: 'srv_1', name: 'PAN Card Application', active: true }
  },
  products: {
    'prod_1': { id: 'prod_1', name: 'PVC Smart Card', price: 99 }
  },
  documents: {
    'doc_1': { id: 'doc_1', name: 'Aadhaar Form', active: true, fileType: 'PDF' }
  },
  applications: {
    'app_custA': { id: 'app_custA', uid: 'cust_uid_A', userId: 'cust_uid_A', serviceId: 'srv_1', status: 'pending' },
    'app_custB': { id: 'app_custB', uid: 'cust_uid_B', userId: 'cust_uid_B', serviceId: 'srv_1', status: 'pending', assignedTo: 'operator1@indiacybercafe.com' }
  },
  orders: {
    'ord_custA': { id: 'ord_custA', uid: 'cust_uid_A', userId: 'cust_uid_A', total: 198, paymentStatus: 'pending' },
    'ord_custB': { id: 'ord_custB', uid: 'cust_uid_B', userId: 'cust_uid_B', total: 99, paymentStatus: 'paid' }
  },
  payments: {},
  productReviews: {
    'rev_custA': { productId: 'prod_1', rating: 5, uid: 'cust_uid_A', userName: 'Customer A', comment: 'Excellent' }
  },
  driveConnections: {
    'cust_uid_A': { connected: true, googleEmail: 'customerA@gmail.com', status: 'active' },
    'cust_uid_B': { connected: true, googleEmail: 'customerB@gmail.com', status: 'active' }
  },
  privacy_requests: {
    'PRV-10001': { id: 'PRV-10001', name: 'Secret User', email: 'secret@gmail.com', description: 'Please delete data', status: 'submitted' }
  }
};

interface TestCase {
  id: number;
  description: string;
  run: () => boolean;
  expected: boolean;
}

const tests: TestCase[] = [
  // User Profile Security
  {
    id: 1,
    description: 'Unauthenticated visitor reading /users collection',
    run: () => engine.canRead('users', null, mockDb),
    expected: false
  },
  {
    id: 2,
    description: 'Unauthenticated visitor reading /users/cust_uid_A',
    run: () => engine.canRead('users/cust_uid_A', null, mockDb),
    expected: false
  },
  {
    id: 3,
    description: 'Unauthenticated visitor writing to /users/cust_uid_A',
    run: () => engine.canWrite('users/cust_uid_A', null, mockDb, { uid: 'cust_uid_A', email: 'attacker@evil.com' }),
    expected: false
  },
  {
    id: 4,
    description: 'Customer A reading Customer B user profile /users/cust_uid_B',
    run: () => engine.canRead('users/cust_uid_B', CUSTOMER_A, mockDb),
    expected: false
  },
  {
    id: 5,
    description: 'Customer A reading own profile /users/cust_uid_A',
    run: () => engine.canRead('users/cust_uid_A', CUSTOMER_A, mockDb),
    expected: true
  },
  {
    id: 6,
    description: 'Customer A updating own profile (name/phone) on /users/cust_uid_A',
    run: () => engine.canWrite('users/cust_uid_A', CUSTOMER_A, mockDb, {
      ...mockDb.users!['cust_uid_A'],
      name: 'Customer A Updated',
      phone: '9988776655'
    }),
    expected: true
  },
  {
    id: 7,
    description: 'Customer A attempting privilege escalation (setting role: "admin")',
    run: () => engine.canWrite('users/cust_uid_A', CUSTOMER_A, mockDb, {
      ...mockDb.users!['cust_uid_A'],
      role: 'admin'
    }),
    expected: false
  },
  {
    id: 8,
    description: 'Customer A attempting to save plaintext password field on /users/cust_uid_A',
    run: () => engine.canWrite('users/cust_uid_A', CUSTOMER_A, mockDb, {
      ...mockDb.users!['cust_uid_A'],
      password: 'PlaintextPassword123!'
    }),
    expected: false
  },
  {
    id: 9,
    description: 'Admin reading all user profiles under /users',
    run: () => engine.canRead('users', ADMIN_USER, mockDb),
    expected: true
  },
  {
    id: 10,
    description: 'Admin updating user profile and role on /users/cust_uid_A',
    run: () => engine.canWrite('users/cust_uid_A', ADMIN_USER, mockDb, {
      ...mockDb.users!['cust_uid_A'],
      role: 'operator'
    }),
    expected: true
  },

  // Applications Security & Cascading Fix
  {
    id: 11,
    description: 'Unauthenticated visitor reading /applications collection',
    run: () => engine.canRead('applications', null, mockDb),
    expected: false
  },
  {
    id: 12,
    description: 'Customer A reading entire /applications collection without query filtering',
    run: () => engine.canRead('applications', CUSTOMER_A, mockDb),
    expected: false
  },
  {
    id: 13,
    description: 'Customer A querying own applications (orderByChild: "uid", equalTo: "cust_uid_A")',
    run: () => engine.canRead('applications', CUSTOMER_A, mockDb, { orderByChild: 'uid', equalTo: 'cust_uid_A' }),
    expected: true
  },
  {
    id: 14,
    description: 'Customer A reading Customer B application /applications/app_custB directly',
    run: () => engine.canRead('applications/app_custB', CUSTOMER_A, mockDb),
    expected: false
  },
  {
    id: 15,
    description: 'Customer A attempting to create application on behalf of Customer B (uid mismatch)',
    run: () => engine.canWrite('applications/app_spoofed', CUSTOMER_A, mockDb, {
      id: 'app_spoofed',
      uid: 'cust_uid_B', // Spoofed UID
      userId: 'cust_uid_B',
      status: 'pending'
    }),
    expected: false
  },

  // Orders Security & Public Tampering Prevention
  {
    id: 16,
    description: 'Unauthenticated visitor reading /orders collection (was public in old rules)',
    run: () => engine.canRead('orders', null, mockDb),
    expected: false
  },
  {
    id: 17,
    description: 'Customer A querying own orders (orderByChild: "uid", equalTo: "cust_uid_A")',
    run: () => engine.canRead('orders', CUSTOMER_A, mockDb, { orderByChild: 'uid', equalTo: 'cust_uid_A' }),
    expected: true
  },
  {
    id: 18,
    description: 'Unauthenticated visitor or non-admin writing fake payment to /payments/pay_fake',
    run: () => engine.canWrite('payments/pay_fake', null, mockDb, {
      id: 'PAY123',
      amount: 100,
      currency: 'INR',
      paymentId: 'pay_123456',
      orderId: 'order_123456',
      status: 'completed',
      type: 'direct_payment',
      createdAt: new Date().toISOString()
    }),
    expected: false
  },

  // Reviews, Drive Connections & Privacy Requests
  {
    id: 19,
    description: 'Customer B modifying or deleting Customer A review in /productReviews/rev_custA',
    run: () => engine.canWrite('productReviews/rev_custA', CUSTOMER_B, mockDb, {
      productId: 'prod_1',
      rating: 1,
      uid: 'cust_uid_B',
      userName: 'Vandal',
      comment: 'Hacked review'
    }),
    expected: false
  },
  {
    id: 20,
    description: 'Customer B reading Customer A Google Drive connection /driveConnections/cust_uid_A',
    run: () => engine.canRead('driveConnections/cust_uid_A', CUSTOMER_B, mockDb),
    expected: false
  },
  {
    id: 21,
    description: 'Unauthenticated visitor reading public service catalog /services (SEO preserve)',
    run: () => engine.canRead('services', null, mockDb),
    expected: true
  },
  {
    id: 22,
    description: 'Unauthenticated visitor reading public product catalog /products (SEO preserve)',
    run: () => engine.canRead('products', null, mockDb),
    expected: true
  },
  {
    id: 23,
    description: 'Unauthenticated visitor reading public documents catalog /documents (SEO preserve)',
    run: () => engine.canRead('documents', null, mockDb),
    expected: true
  },
  {
    id: 24,
    description: 'Unauthenticated visitor reading or writing directly to /privacy_requests/PRV-10001',
    run: () => engine.canRead('privacy_requests/PRV-10001', null, mockDb) || engine.canWrite('privacy_requests/PRV-10001', null, mockDb, {}),
    expected: false
  }
];

console.log('======================================================================');
console.log('🔍 INDIA CYBER CAFE — RTDB SECURITY RULES AUTOMATED TEST SUITE');
console.log('======================================================================\n');

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = t.run();
  const isMatch = result === t.expected;

  if (isMatch) {
    passed++;
    console.log(`✅ [PASS] Scenario #${t.id}: ${t.description}`);
    console.log(`   Result: ${result ? 'ALLOWED' : 'DENIED'} (Expected: ${t.expected ? 'ALLOWED' : 'DENIED'})`);
  } else {
    failed++;
    console.log(`❌ [FAIL] Scenario #${t.id}: ${t.description}`);
    console.log(`   Result: ${result ? 'ALLOWED' : 'DENIED'} (Expected: ${t.expected ? 'ALLOWED' : 'DENIED'})`);
  }
}

console.log('\n======================================================================');
console.log(`📊 TEST EXECUTION SUMMARY:`);
console.log(`   Total Scenarios Tested : ${tests.length}`);
console.log(`   Passed                 : ${passed}`);
console.log(`   Failed                 : ${failed}`);
console.log(`   Success Rate           : ${((passed / tests.length) * 100).toFixed(1)}%`);
console.log('======================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🛡️ All Firebase Realtime Database Security Rules verified successfully!');
  process.exit(0);
}
