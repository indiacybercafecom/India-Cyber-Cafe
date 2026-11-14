import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

/**
 * Operator Security Migration & Rollback Script (v2)
 *
 * Safely backfills canonical `assignedToUid` on `/applications` and `/orders`
 * from `/users` email -> uid mappings, detects conflicting/duplicate/unmatched
 * assignments for Admin review, and converts legacy array `notes` into
 * append-only child-keyed map entries (`legacy_0`, `legacy_1`, ...).
 *
 * Modes:
 *   --dry-run                (default) Read-only audit + planned update report
 *   --backup-only            Write & verify timestamped JSON backup without modifying DB
 *   --apply                  Create & verify backup, apply idempotent updates, verify counts
 *   --rollback=<backup.json> Inspect rollback diff (add --apply to restore applications & orders)
 *
 * Safety invariants:
 *   - Strictly NEVER modifies `/users`, passwords, or authentication credentials.
 *   - Strictly NEVER deletes applications, orders, notes, or attachment metadata.
 */

const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const DEFAULT_PROJECT_ID = 'india-cyber-cafe';
const DEFAULT_RTDB_URL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';
const BACKUP_DIR = path.join(APP_ROOT, 'data/backups');

export interface CollectionNoteStats {
  recordCount: number;
  noteCount: number;
  attachmentRefCount: number;
  arrayNoteRecords: number;
}

export interface MigrationPlan {
  updates: Record<string, any>;
  appBackfills: Array<{ id: string; email: string; uid: string }>;
  appNoteConversions: Array<{ id: string; count: number }>;
  orderBackfills: Array<{ id: string; email: string; uid: string }>;
  orderNoteConversions: Array<{ id: string; count: number }>;
  unmatchedAppEmails: Array<{ id: string; email: string; reason: string }>;
  unmatchedOrderEmails: Array<{ id: string; email: string; reason: string }>;
  conflictsForAdminReview: Array<{
    collection: 'applications' | 'orders';
    id: string;
    assignedTo?: string;
    assignedToUid?: string;
    reason: string;
  }>;
  beforeStats: {
    users: number;
    applications: CollectionNoteStats;
    orders: CollectionNoteStats;
  };
}

export interface BackupArtifact {
  version: number;
  createdAt: string;
  projectId: string;
  databaseURL: string;
  summary: {
    users: number;
    applications: CollectionNoteStats;
    orders: CollectionNoteStats;
  };
  snapshot: {
    usersMetadata: Record<string, { uid: string; email?: string; role?: string; disabled?: boolean }>;
    applications: Record<string, any>;
    orders: Record<string, any>;
  };
}

function loadEnv() {
  try {
    const envPath = path.join(APP_ROOT, '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true } as any);
    }
  } catch {}
}

function parseServiceAccountRaw(
  raw: string
): (ServiceAccount & { project_id?: string; client_email?: string; private_key?: string }) | null {
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
      const clientEmail =
        typeof parsed.client_email === 'string'
          ? parsed.client_email.trim()
          : typeof parsed.clientEmail === 'string'
            ? parsed.clientEmail.trim()
            : '';
      const rawKey =
        typeof parsed.private_key === 'string'
          ? parsed.private_key
          : typeof parsed.privateKey === 'string'
            ? parsed.privateKey
            : '';
      const privateKey = rawKey.replace(/\\n/g, '\n');
      if (parsed.type !== 'service_account' || !clientEmail || !privateKey.includes('PRIVATE KEY')) {
        return null;
      }
      return { ...parsed, client_email: clientEmail, private_key: privateKey };
    }
  } catch {}
  return null;
}

function initAdminDatabase() {
  loadEnv();
  const inlineEnv =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
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

  if (!cred) {
    return null;
  }

  const projectId = parsed?.project_id || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const databaseURL = (process.env.FIREBASE_DATABASE_URL || DEFAULT_RTDB_URL).replace(/\/+$/, '');

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cred,
        projectId,
        databaseURL,
      });

  return {
    rtdb: getDatabase(app),
    projectId,
    databaseURL,
  };
}

export function convertArrayNotesToMap(notes: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  notes.forEach((item, idx) => {
    if (item && typeof item === 'object') {
      const baseKey = item.id && !/[/.#$[\]]/.test(String(item.id)) ? String(item.id) : `legacy_${idx}`;
      const key = baseKey in out ? `legacy_${idx}` : baseKey;
      out[key] = {
        ...item,
        id: item.id || key,
      };
    }
  });
  return out;
}

export function countNotesAndAttachments(records: Record<string, any>): CollectionNoteStats {
  let recordCount = 0;
  let noteCount = 0;
  let attachmentRefCount = 0;
  let arrayNoteRecords = 0;

  for (const rec of Object.values(records || {})) {
    if (!rec || typeof rec !== 'object') continue;
    recordCount++;
    if (rec.fileUrl) attachmentRefCount++;

    const notes = rec.notes;
    if (Array.isArray(notes)) {
      arrayNoteRecords++;
      for (const n of notes) {
        if (n && typeof n === 'object') {
          noteCount++;
          if (n.attachment || n.attachmentName) attachmentRefCount++;
        }
      }
    } else if (notes && typeof notes === 'object') {
      for (const n of Object.values(notes)) {
        if (n && typeof n === 'object') {
          noteCount++;
          if ((n as any).attachment || (n as any).attachmentName) attachmentRefCount++;
        }
      }
    }
  }

  return { recordCount, noteCount, attachmentRefCount, arrayNoteRecords };
}

export function planOperatorSecurityMigration(
  usersData: Record<string, any>,
  appsData: Record<string, any>,
  ordersData: Record<string, any>
): MigrationPlan {
  const emailToMatches = new Map<string, Array<{ uid: string; role: string; disabled: boolean }>>();
  const uidToUser = new Map<string, { email: string; role: string; disabled: boolean }>();

  Object.entries(usersData || {}).forEach(([uid, profile]) => {
    if (!profile || typeof profile !== 'object') return;
    const email = String(profile.email || '').toLowerCase().trim();
    const role = String(profile.role || 'user');
    const disabled = Boolean(profile.disabled === true);
    uidToUser.set(uid, { email, role, disabled });
    if (email) {
      const list = emailToMatches.get(email) || [];
      list.push({ uid, role, disabled });
      emailToMatches.set(email, list);
    }
  });

  const updates: Record<string, any> = {};
  const appBackfills: MigrationPlan['appBackfills'] = [];
  const appNoteConversions: MigrationPlan['appNoteConversions'] = [];
  const orderBackfills: MigrationPlan['orderBackfills'] = [];
  const orderNoteConversions: MigrationPlan['orderNoteConversions'] = [];
  const unmatchedAppEmails: MigrationPlan['unmatchedAppEmails'] = [];
  const unmatchedOrderEmails: MigrationPlan['unmatchedOrderEmails'] = [];
  const conflictsForAdminReview: MigrationPlan['conflictsForAdminReview'] = [];

  const inspectRecord = (collection: 'applications' | 'orders', id: string, rec: any) => {
    if (!rec || typeof rec !== 'object') return;

    const rawAssignedEmail = String(rec.assignedTo || '').toLowerCase().trim();
    const rawAssignedUid = String(rec.assignedToUid || '').trim();

    if (rawAssignedUid) {
      const ownerProfile = uidToUser.get(rawAssignedUid);
      if (!ownerProfile) {
        conflictsForAdminReview.push({
          collection,
          id,
          assignedTo: rawAssignedEmail || undefined,
          assignedToUid: rawAssignedUid,
          reason: 'assignedToUid does not exist in /users',
        });
      } else if (rawAssignedEmail && ownerProfile.email && ownerProfile.email !== rawAssignedEmail) {
        conflictsForAdminReview.push({
          collection,
          id,
          assignedTo: rawAssignedEmail,
          assignedToUid: rawAssignedUid,
          reason: `assignedTo email (${rawAssignedEmail}) differs from assignedToUid user email (${ownerProfile.email}); leaving assignedToUid unchanged`,
        });
      }
    } else if (rawAssignedEmail) {
      const matches = emailToMatches.get(rawAssignedEmail) || [];
      if (matches.length === 0) {
        const entry = { id, email: rawAssignedEmail, reason: 'No matching user email in /users' };
        if (collection === 'applications') unmatchedAppEmails.push(entry);
        else unmatchedOrderEmails.push(entry);
      } else if (matches.length > 1) {
        conflictsForAdminReview.push({
          collection,
          id,
          assignedTo: rawAssignedEmail,
          reason: `Ambiguous email (${matches.length} users match ${rawAssignedEmail}); requires Admin review`,
        });
      } else {
        const match = matches[0];
        if (match.role !== 'operator' && match.role !== 'admin') {
          const entry = {
            id,
            email: rawAssignedEmail,
            reason: `Matched user (${match.uid}) has role "${match.role}", not operator/admin`,
          };
          if (collection === 'applications') unmatchedAppEmails.push(entry);
          else unmatchedOrderEmails.push(entry);
        } else {
          updates[`${collection}/${id}/assignedToUid`] = match.uid;
          if (collection === 'applications') {
            appBackfills.push({ id, email: rawAssignedEmail, uid: match.uid });
          } else {
            orderBackfills.push({ id, email: rawAssignedEmail, uid: match.uid });
          }
        }
      }
    }

    if (Array.isArray(rec.notes)) {
      const converted = convertArrayNotesToMap(rec.notes);
      updates[`${collection}/${id}/notes`] = converted;
      const count = Object.keys(converted).length;
      if (collection === 'applications') appNoteConversions.push({ id, count });
      else orderNoteConversions.push({ id, count });
    }
  };

  Object.entries(appsData || {}).forEach(([id, app]) => inspectRecord('applications', id, app));
  Object.entries(ordersData || {}).forEach(([id, ord]) => inspectRecord('orders', id, ord));

  return {
    updates,
    appBackfills,
    appNoteConversions,
    orderBackfills,
    orderNoteConversions,
    unmatchedAppEmails,
    unmatchedOrderEmails,
    conflictsForAdminReview,
    beforeStats: {
      users: Object.keys(usersData || {}).length,
      applications: countNotesAndAttachments(appsData),
      orders: countNotesAndAttachments(ordersData),
    },
  };
}

export function createAndVerifyBackup(
  backupFilePath: string,
  meta: { projectId: string; databaseURL: string },
  usersData: Record<string, any>,
  appsData: Record<string, any>,
  ordersData: Record<string, any>
): BackupArtifact {
  const usersMetadata: BackupArtifact['snapshot']['usersMetadata'] = {};
  for (const [uid, u] of Object.entries(usersData || {})) {
    if (u && typeof u === 'object') {
      usersMetadata[uid] = {
        uid,
        email: u.email,
        role: u.role,
        disabled: Boolean(u.disabled === true),
      };
    }
  }

  const appStats = countNotesAndAttachments(appsData);
  const orderStats = countNotesAndAttachments(ordersData);

  const artifact: BackupArtifact = {
    version: 2,
    createdAt: new Date().toISOString(),
    projectId: meta.projectId,
    databaseURL: meta.databaseURL,
    summary: {
      users: Object.keys(usersMetadata).length,
      applications: appStats,
      orders: orderStats,
    },
    snapshot: {
      usersMetadata,
      applications: appsData || {},
      orders: ordersData || {},
    },
  };

  fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });
  fs.writeFileSync(backupFilePath, JSON.stringify(artifact, null, 2), 'utf-8');

  // Re-read and verify backup file integrity on disk before allowing mutations
  const raw = fs.readFileSync(backupFilePath, 'utf-8');
  const parsed: BackupArtifact = JSON.parse(raw);
  const parsedAppStats = countNotesAndAttachments(parsed.snapshot?.applications || {});
  const parsedOrderStats = countNotesAndAttachments(parsed.snapshot?.orders || {});

  if (
    parsedAppStats.recordCount !== appStats.recordCount ||
    parsedAppStats.noteCount !== appStats.noteCount ||
    parsedAppStats.attachmentRefCount !== appStats.attachmentRefCount ||
    parsedOrderStats.recordCount !== orderStats.recordCount ||
    parsedOrderStats.noteCount !== orderStats.noteCount ||
    parsedOrderStats.attachmentRefCount !== orderStats.attachmentRefCount
  ) {
    throw new Error('Backup integrity check failed after writing backup file.');
  }

  return parsed;
}

export function buildRollbackUpdates(backup: BackupArtifact): Record<string, any> {
  if (!backup?.snapshot || typeof backup.snapshot.applications !== 'object' || typeof backup.snapshot.orders !== 'object') {
    throw new Error('Invalid backup file format: missing snapshot.applications or snapshot.orders');
  }
  return {
    applications: backup.snapshot.applications,
    orders: backup.snapshot.orders,
  };
}

function formatTimestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function runMigrationCli() {
  const applyMode = process.argv.includes('--apply');
  const backupOnly = process.argv.includes('--backup-only');
  const rollbackArg = process.argv.find((arg) => arg.startsWith('--rollback='));

  const modeLabel = rollbackArg
    ? `ROLLBACK (${applyMode ? 'APPLY' : 'DRY-RUN'})`
    : backupOnly
      ? 'BACKUP-ONLY'
      : applyMode
        ? 'APPLY MODE'
        : 'DRY-RUN MODE';

  console.log('======================================================================');
  console.log(`🔐 OPERATOR SECURITY MIGRATION (${modeLabel})`);
  console.log('======================================================================\n');

  const adminConn = initAdminDatabase();
  if (!adminConn) {
    console.error('❌ No Firebase Admin credentials found.');
    console.error('   Set FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or place firebase-service-account.json in project root.');
    process.exit(1);
  }
  const { rtdb, projectId, databaseURL } = adminConn;

  if (rollbackArg) {
    const rawPath = rollbackArg.slice('--rollback='.length).trim();
    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.join(APP_ROOT, rawPath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`❌ Rollback backup file not found: ${resolvedPath}`);
      process.exit(1);
    }
    const backup: BackupArtifact = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    const rollbackUpdates = buildRollbackUpdates(backup);

    console.log(`Loaded backup created at : ${backup.createdAt}`);
    console.log(`Applications in backup   : ${backup.summary?.applications?.recordCount ?? Object.keys(backup.snapshot.applications).length}`);
    console.log(`Orders in backup         : ${backup.summary?.orders?.recordCount ?? Object.keys(backup.snapshot.orders).length}`);

    if (!applyMode) {
      console.log('\nℹ️ Rollback dry-run complete. Re-run with `--apply` to restore applications and orders:');
      console.log(`   npx tsx scripts/migrate-operator-security.ts --rollback=${rawPath} --apply`);
      process.exit(0);
    }

    await rtdb.ref().update(rollbackUpdates);
    const [postApps, postOrders] = await Promise.all([
      rtdb.ref('applications').get(),
      rtdb.ref('orders').get(),
    ]);
    const postAppStats = countNotesAndAttachments(postApps.val() || {});
    const postOrderStats = countNotesAndAttachments(postOrders.val() || {});
    console.log('\n✅ Rollback applied successfully!');
    console.log(`   Applications restored: ${postAppStats.recordCount} (notes=${postAppStats.noteCount}, attachments=${postAppStats.attachmentRefCount})`);
    console.log(`   Orders restored      : ${postOrderStats.recordCount} (notes=${postOrderStats.noteCount}, attachments=${postOrderStats.attachmentRefCount})`);
    process.exit(0);
  }

  const [usersSnap, appsSnap, ordersSnap] = await Promise.all([
    rtdb.ref('users').get(),
    rtdb.ref('applications').get(),
    rtdb.ref('orders').get(),
  ]);

  const usersData: Record<string, any> = usersSnap.val() || {};
  const appsData: Record<string, any> = appsSnap.val() || {};
  const ordersData: Record<string, any> = ordersSnap.val() || {};

  if (backupOnly) {
    const backupFile = path.join(BACKUP_DIR, `operator-migration-backup-${formatTimestampForFilename()}.json`);
    const verified = createAndVerifyBackup(backupFile, { projectId, databaseURL }, usersData, appsData, ordersData);
    console.log(`✅ Verified backup written to: ${path.relative(APP_ROOT, backupFile)}`);
    console.log(`   Applications: ${verified.summary.applications.recordCount}, Notes: ${verified.summary.applications.noteCount}, Attachments: ${verified.summary.applications.attachmentRefCount}`);
    console.log(`   Orders      : ${verified.summary.orders.recordCount}, Notes: ${verified.summary.orders.noteCount}, Attachments: ${verified.summary.orders.attachmentRefCount}`);
    process.exit(0);
  }

  const plan = planOperatorSecurityMigration(usersData, appsData, ordersData);

  console.log(`Users indexed              : ${plan.beforeStats.users}`);
  console.log(`Applications inspected     : ${plan.beforeStats.applications.recordCount}`);
  console.log(`  existing notes           : ${plan.beforeStats.applications.noteCount}`);
  console.log(`  attachment references    : ${plan.beforeStats.applications.attachmentRefCount}`);
  console.log(`  assignedToUid to backfill: ${plan.appBackfills.length}`);
  console.log(`  notes arrays to convert  : ${plan.appNoteConversions.length}`);
  console.log(`  unmatched for review     : ${plan.unmatchedAppEmails.length}`);
  console.log(`Orders inspected           : ${plan.beforeStats.orders.recordCount}`);
  console.log(`  existing notes           : ${plan.beforeStats.orders.noteCount}`);
  console.log(`  attachment references    : ${plan.beforeStats.orders.attachmentRefCount}`);
  console.log(`  assignedToUid to backfill: ${plan.orderBackfills.length}`);
  console.log(`  notes arrays to convert  : ${plan.orderNoteConversions.length}`);
  console.log(`  unmatched for review     : ${plan.unmatchedOrderEmails.length}`);
  console.log(`Conflicts for Admin review : ${plan.conflictsForAdminReview.length}`);

  if (plan.appBackfills.length > 0) {
    console.log('\nPlanned application UID backfills:');
    plan.appBackfills.forEach((b) => console.log(`  - ${b.id}: ${b.email} -> ${b.uid}`));
  }
  if (plan.orderBackfills.length > 0) {
    console.log('\nPlanned order UID backfills:');
    plan.orderBackfills.forEach((b) => console.log(`  - ${b.id}: ${b.email} -> ${b.uid}`));
  }
  if (plan.unmatchedAppEmails.length > 0) {
    console.warn('\n⚠️ Unmatched application assignments (skipped for Admin review):', plan.unmatchedAppEmails);
  }
  if (plan.unmatchedOrderEmails.length > 0) {
    console.warn('⚠️ Unmatched order assignments (skipped for Admin review):', plan.unmatchedOrderEmails);
  }
  if (plan.conflictsForAdminReview.length > 0) {
    console.warn('\n⚠️ Conflicts requiring Admin review (never auto-overwritten):', plan.conflictsForAdminReview);
  }

  const updateEntries = Object.entries(plan.updates);
  if (updateEntries.length === 0) {
    console.log('\n✅ No migration updates required. Database is already up to date (idempotent).');
    process.exit(0);
  }

  if (!applyMode) {
    console.log(`\nℹ️ Dry-run complete. ${updateEntries.length} path update(s) prepared.`);
    console.log('   Step 1: Backup & Apply -> npx tsx scripts/migrate-operator-security.ts --apply');
    process.exit(0);
  }

  // Create and verify timestamped pre-migration backup BEFORE modifying any data
  const stamp = formatTimestampForFilename();
  const backupFile = path.join(BACKUP_DIR, `operator-migration-backup-${stamp}.json`);
  const relBackupPath = path.relative(APP_ROOT, backupFile);
  createAndVerifyBackup(backupFile, { projectId, databaseURL }, usersData, appsData, ordersData);
  console.log(`\n💾 Pre-migration backup verified: ${relBackupPath}`);

  // Apply updates in chunks of 200 paths
  const CHUNK_SIZE = 200;
  for (let i = 0; i < updateEntries.length; i += CHUNK_SIZE) {
    const chunkObj = Object.fromEntries(updateEntries.slice(i, i + CHUNK_SIZE));
    await rtdb.ref().update(chunkObj);
  }

  // Post-migration verification (record counts, note counts, attachment counts, remaining array notes)
  const [postUsers, postApps, postOrders] = await Promise.all([
    rtdb.ref('users').get(),
    rtdb.ref('applications').get(),
    rtdb.ref('orders').get(),
  ]);

  const postUsersData = postUsers.val() || {};
  const postAppsData = postApps.val() || {};
  const postOrdersData = postOrders.val() || {};

  const afterAppStats = countNotesAndAttachments(postAppsData);
  const afterOrderStats = countNotesAndAttachments(postOrdersData);
  const totalUsersAfter = Object.keys(postUsersData).length;

  console.log('\n✅ Migration applied! Post-migration verification:');
  console.log(`  Users              : ${plan.beforeStats.users} -> ${totalUsersAfter}`);
  console.log(`  Applications       : ${plan.beforeStats.applications.recordCount} -> ${afterAppStats.recordCount}`);
  console.log(`  Application Notes  : ${plan.beforeStats.applications.noteCount} -> ${afterAppStats.noteCount}`);
  console.log(`  App Attachments    : ${plan.beforeStats.applications.attachmentRefCount} -> ${afterAppStats.attachmentRefCount}`);
  console.log(`  App Array Notes    : ${plan.beforeStats.applications.arrayNoteRecords} -> ${afterAppStats.arrayNoteRecords}`);
  console.log(`  Orders             : ${plan.beforeStats.orders.recordCount} -> ${afterOrderStats.recordCount}`);
  console.log(`  Order Notes        : ${plan.beforeStats.orders.noteCount} -> ${afterOrderStats.noteCount}`);
  console.log(`  Order Attachments  : ${plan.beforeStats.orders.attachmentRefCount} -> ${afterOrderStats.attachmentRefCount}`);
  console.log(`  Order Array Notes  : ${plan.beforeStats.orders.arrayNoteRecords} -> ${afterOrderStats.arrayNoteRecords}`);

  const verificationFailed =
    totalUsersAfter !== plan.beforeStats.users ||
    afterAppStats.recordCount !== plan.beforeStats.applications.recordCount ||
    afterAppStats.noteCount !== plan.beforeStats.applications.noteCount ||
    afterAppStats.attachmentRefCount !== plan.beforeStats.applications.attachmentRefCount ||
    afterAppStats.arrayNoteRecords !== 0 ||
    afterOrderStats.recordCount !== plan.beforeStats.orders.recordCount ||
    afterOrderStats.noteCount !== plan.beforeStats.orders.noteCount ||
    afterOrderStats.attachmentRefCount !== plan.beforeStats.orders.attachmentRefCount ||
    afterOrderStats.arrayNoteRecords !== 0;

  if (verificationFailed) {
    console.error('\n❌ Post-migration verification failed! Roll back immediately using:');
    console.error(`   npx tsx scripts/migrate-operator-security.ts --rollback=${relBackupPath} --apply`);
    process.exit(1);
  }

  console.log('\n🔄 Rollback command (if ever needed):');
  console.log(`   npx tsx scripts/migrate-operator-security.ts --rollback=${relBackupPath} --apply`);
  process.exit(0);
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  runMigrationCli().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
}
