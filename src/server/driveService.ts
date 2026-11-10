import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { encryptToken, decryptToken } from './crypto.js';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const USER_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export const DEFAULT_CATEGORY_FOLDERS = [
  'Identity Documents',
  'Education Documents',
  'Government Documents',
  'Certificates',
  'Banking Documents',
  'Personal Documents',
  'Other Documents',
] as const;

export interface DriveTokenRecord {
  accessToken: string;
  refreshTokenEncrypted: string;
  expiresAt: number;
  googleEmail?: string;
  googleSubject?: string;
}

export interface DriveConnectionMeta {
  connected: boolean;
  googleEmail: string;
  googleSubject?: string;
  rootFolderId: string;
  documentsFolderId: string;
  connectedAt: number;
  status: 'active' | 'disconnected' | 'mismatch';
  defaultFolders: Record<string, string>;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  createdTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
  isFolder: boolean;
  folderPath?: string;
  breadcrumbs?: { id: string; name: string }[];
}

export interface PersistedCredentialRecord {
  refreshTokenEncrypted: string;
  googleEmail?: string;
  googleSubject?: string;
  rootFolderId?: string;
  documentsFolderId?: string;
  defaultFolders?: Record<string, string>;
  connectedAt?: number;
  updatedAt?: number;
}

// Durable local storage path for credentials across server restarts & redeployments
const CREDENTIALS_STORE_PATH = path.join(process.cwd(), 'data/drive_credentials.json');

function ensureDataDir(): void {
  const dir = path.dirname(CREDENTIALS_STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readPersistedCredentials(): Record<string, PersistedCredentialRecord> {
  try {
    if (fs.existsSync(CREDENTIALS_STORE_PATH)) {
      const raw = fs.readFileSync(CREDENTIALS_STORE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[driveService] Notice reading persisted credentials store:', err);
  }
  return {};
}

function savePersistedCredential(uid: string, record: PersistedCredentialRecord): void {
  try {
    ensureDataDir();
    const current = readPersistedCredentials();
    current[uid] = {
      ...record,
      updatedAt: Date.now(),
    };
    const tempPath = `${CREDENTIALS_STORE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(current, null, 2), 'utf-8');
    fs.renameSync(tempPath, CREDENTIALS_STORE_PATH);
  } catch (err) {
    console.error('[driveService] Error saving persisted credential:', err);
  }
}

function removePersistedCredential(uid: string): void {
  try {
    if (!fs.existsSync(CREDENTIALS_STORE_PATH)) return;
    const current = readPersistedCredentials();
    if (current[uid]) {
      delete current[uid];
      const tempPath = `${CREDENTIALS_STORE_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(current, null, 2), 'utf-8');
      fs.renameSync(tempPath, CREDENTIALS_STORE_PATH);
    }
  } catch (err) {
    console.error('[driveService] Error removing persisted credential:', err);
  }
}

// In-memory token cache (access tokens stay in memory only; refresh tokens are encrypted)
const tokenStore = new Map<string, DriveTokenRecord>();

// In-memory state cache & nonce tracking
const stateStore = new Map<string, { uid: string; email?: string; createdAt: number; redirectUrl: string }>();

// Cleanup stale in-memory states every 15 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [state, meta] of stateStore.entries()) {
    if (now - meta.createdAt > 15 * 60 * 1000) {
      stateStore.delete(state);
    }
  }
}, 15 * 60 * 1000);
if (typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}

export function getOAuthClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || '';
}

export function getOAuthClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || '';
}

/**
 * Generates a signed, expiring, encrypted OAuth state token that works across
 * multiple server instances and survives server restarts.
 */
export function generateOAuthState(uid: string, redirectUrl = '/my-documents/', email?: string): string {
  const payload = {
    uid,
    email: email ? email.toLowerCase().trim() : undefined,
    redirectUrl: redirectUrl || '/my-documents/',
    createdAt: Date.now(),
    nonce: crypto.randomBytes(8).toString('hex'),
  };

  const stateToken = encryptToken(JSON.stringify(payload));
  stateStore.set(stateToken, payload);
  return stateToken;
}

/**
 * Validates OAuth state token. Verifies signature/decryption and enforces 15-min expiration.
 */
export function validateOAuthState(state: string): { uid: string; email?: string; redirectUrl: string } | null {
  if (!state) return null;

  // 1. Check in-memory first
  const cached = stateStore.get(state);
  if (cached) {
    stateStore.delete(state);
    if (Date.now() - cached.createdAt > 15 * 60 * 1000) {
      return null;
    }
    return { uid: cached.uid, email: cached.email, redirectUrl: cached.redirectUrl };
  }

  // 2. Multi-instance or post-restart fallback: decrypt and validate the state token
  try {
    const decrypted = decryptToken(state);
    const payload = JSON.parse(decrypted);
    if (!payload || !payload.uid || !payload.createdAt) {
      return null;
    }
    if (Date.now() - payload.createdAt > 15 * 60 * 1000) {
      return null;
    }
    return {
      uid: payload.uid,
      email: payload.email,
      redirectUrl: payload.redirectUrl || '/my-documents/',
    };
  } catch (err) {
    console.warn('[driveService] Invalid OAuth state token:', err);
    return null;
  }
}

export function buildOAuthUrl(state: string, redirectUri: string, loginHint?: string): string {
  const clientId = getOAuthClientId();
  const scopes = [DRIVE_FILE_SCOPE, USER_EMAIL_SCOPE].join(' ');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) {
    params.set('login_hint', loginHint.trim());
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  email?: string;
  sub?: string;
}> {
  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const errorBody = await tokenResp.text();
    throw new Error(`Failed to exchange authorization code: ${errorBody}`);
  }

  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token as string;
  const refreshToken = tokenData.refresh_token as string | undefined;
  const expiresIn = (tokenData.expires_in as number) || 3600;

  // Retrieve user identity info
  let email = '';
  let sub = '';
  try {
    const userInfoResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userInfoResp.ok) {
      const userInfo = await userInfoResp.json();
      email = userInfo.email || '';
      sub = userInfo.sub || '';
    }
  } catch (err) {
    console.warn('[driveService] UserInfo fetch notice:', err);
  }

  return {
    accessToken,
    refreshToken,
    expiresIn,
    email,
    sub,
  };
}

/**
 * Saves user credentials in memory and persists encrypted refresh token to durable storage.
 * Never stores plaintext tokens to disk.
 */
export function saveUserCredentials(
  uid: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  googleEmail?: string,
  googleSubject?: string,
  extraMeta?: { rootFolderId?: string; documentsFolderId?: string; defaultFolders?: Record<string, string> }
): void {
  const encryptedRefresh = encryptToken(refreshToken);

  // In-memory active session
  tokenStore.set(uid, {
    accessToken,
    refreshTokenEncrypted: encryptedRefresh,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
    googleEmail,
    googleSubject,
  });

  // Durable persistent storage across restarts and deployments
  savePersistedCredential(uid, {
    refreshTokenEncrypted: encryptedRefresh,
    googleEmail,
    googleSubject,
    rootFolderId: extraMeta?.rootFolderId,
    documentsFolderId: extraMeta?.documentsFolderId,
    defaultFolders: extraMeta?.defaultFolders,
    connectedAt: Date.now(),
  });
}

/**
 * Retrieves valid Google Drive access token.
 * Automatically restores connection from persistent storage after server restart or redeployment.
 */
export async function getValidAccessToken(uid: string): Promise<string> {
  let record = tokenStore.get(uid);

  // If not in memory, restore from persistent storage!
  if (!record) {
    const persisted = readPersistedCredentials()[uid];
    if (persisted && persisted.refreshTokenEncrypted) {
      record = {
        accessToken: '',
        refreshTokenEncrypted: persisted.refreshTokenEncrypted,
        expiresAt: 0,
        googleEmail: persisted.googleEmail,
        googleSubject: persisted.googleSubject,
      };
      tokenStore.set(uid, record);
    }
  }

  if (!record) {
    throw new Error('Google Drive is not connected for this account. Please connect your Google Drive.');
  }

  // If still valid (with 60-second safety window), return it
  if (record.accessToken && record.expiresAt > Date.now()) {
    return record.accessToken;
  }

  // Refresh token required
  if (!record.refreshTokenEncrypted) {
    tokenStore.delete(uid);
    removePersistedCredential(uid);
    throw new Error('Google Drive authorization has expired. Please reconnect your Google Drive.');
  }

  const plainRefreshToken = decryptToken(record.refreshTokenEncrypted);
  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();

  const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: plainRefreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!refreshResp.ok) {
    const errText = await refreshResp.text();
    tokenStore.delete(uid);
    removePersistedCredential(uid);
    throw new Error(`Google Drive token refresh failed (${refreshResp.status}): ${errText}`);
  }

  const refreshData = await refreshResp.json();
  const newAccessToken = refreshData.access_token as string;
  const expiresIn = (refreshData.expires_in as number) || 3600;

  record.accessToken = newAccessToken;
  record.expiresAt = Date.now() + (expiresIn - 60) * 1000;
  tokenStore.set(uid, record);

  return newAccessToken;
}

/**
 * Disconnects user drive, revokes tokens with Google, and removes persistent records.
 */
export async function disconnectUserDrive(uid: string): Promise<void> {
  const record = tokenStore.get(uid) || readPersistedCredentials()[uid];
  if (record?.refreshTokenEncrypted) {
    try {
      const plainRefresh = decryptToken(record.refreshTokenEncrypted);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(plainRefresh)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (revokeErr) {
      console.warn('[driveService] Token revoke notice:', revokeErr);
    }
  }

  tokenStore.delete(uid);
  removePersistedCredential(uid);
}

/**
 * Checks whether user has an active or restorable Google Drive connection.
 */
export function hasDriveToken(uid: string): boolean {
  if (tokenStore.has(uid)) return true;
  const persisted = readPersistedCredentials()[uid];
  return Boolean(persisted && persisted.refreshTokenEncrypted);
}

export function getUserDriveEmail(uid: string): string | undefined {
  const inMemory = tokenStore.get(uid)?.googleEmail;
  if (inMemory) return inMemory;
  return readPersistedCredentials()[uid]?.googleEmail;
}

export function getPersistedMeta(uid: string): PersistedCredentialRecord | undefined {
  return readPersistedCredentials()[uid];
}

// -------------------------------------------------------------
// Consistent Ordering Helpers
// -------------------------------------------------------------

/**
 * Standardized category priority ranking everywhere in ICC My Documents:
 * 1. Identity Documents (10)
 * 2. Education Documents (20)
 * 3. Government Documents (30)
 * 4. Certificates (40)
 * 5. Banking Documents (50)
 * 6. Personal Documents (60)
 * 7. Custom folders (alphabetically: 500)
 * 8. Other Documents (always last: 999999)
 */
export function getFolderPriorityRank(name: string): number {
  const n = (name || '').trim().toLowerCase();

  // 8. Other Documents (always last)
  if (n === 'other documents' || n === 'other' || n === 'others' || n.startsWith('other')) {
    return 999999;
  }
  // 1. Identity Documents
  if (
    n.includes('identity') ||
    n.includes('aadhaar') ||
    n.includes('pan') ||
    n.includes('voter') ||
    n.includes('passport')
  ) {
    return 10;
  }
  // 2. Education Documents
  if (
    n.includes('education') ||
    n.includes('marksheet') ||
    n.includes('degree') ||
    n.includes('school') ||
    n.includes('college') ||
    n.includes('academic')
  ) {
    return 20;
  }
  // 3. Government Documents
  if (
    n.includes('government') ||
    n.includes('govt') ||
    n.includes('ration') ||
    n.includes('domicile') ||
    n.includes('caste') ||
    n.includes('official')
  ) {
    return 30;
  }
  // 4. Certificates
  if (n.includes('certificate') || n.includes('cert')) {
    return 40;
  }
  // 5. Banking Documents
  if (
    n.includes('bank') ||
    n.includes('banking') ||
    n.includes('financial') ||
    n.includes('passbook') ||
    n.includes('statement') ||
    n.includes('income')
  ) {
    return 50;
  }
  // 6. Personal Documents
  if (
    n.includes('personal') ||
    n.includes('resume') ||
    n.includes('cv') ||
    n.includes('photo') ||
    n.includes('profile')
  ) {
    return 60;
  }
  // 7. Custom folders (alphabetically)
  return 500;
}

/**
 * Consistently sorts folders: Priority categories first, custom folders alphabetically, Other Documents last.
 */
export function sortFolders(folders: DriveItem[]): DriveItem[] {
  return [...folders].sort((a, b) => {
    const rankA = getFolderPriorityRank(a.name);
    const rankB = getFolderPriorityRank(b.name);
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

/**
 * Consistently sorts files: Newest modified date first, with alphabetical name fallback.
 */
export function sortFiles(files: DriveItem[]): DriveItem[] {
  return [...files].sort((a, b) => {
    const tA = new Date(a.modifiedTime || 0).getTime();
    const tB = new Date(b.modifiedTime || 0).getTime();
    if (tB !== tA) return tB - tA;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

// -------------------------------------------------------------
// Google Drive API v3 Methods
// -------------------------------------------------------------

async function executeDriveApi(
  accessToken: string,
  endpoint: string,
  init?: RequestInit
): Promise<Response> {
  const url = endpoint.startsWith('https://')
    ? endpoint
    : `https://www.googleapis.com/drive/v3/${endpoint.replace(/^\/+/, '')}`;

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Accept', 'application/json');

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorJson = await response.json();
      errorDetail = errorJson?.error?.message || JSON.stringify(errorJson);
    } catch {
      errorDetail = await response.text();
    }
    const err = new Error(`Google Drive API error (${response.status}): ${errorDetail}`);
    (err as any).status = response.status;
    throw err;
  }

  return response;
}

/**
 * Searches for an existing folder with given name under given parent, or creates it.
 * Prevents folder duplication.
 */
export async function findOrCreateFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<string> {
  const parentClause = parentId ? `'${parentId}' in parents` : `'root' in parents`;
  const sanitizedName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name = '${sanitizedName}' and ${parentClause} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const searchResp = await executeDriveApi(
    accessToken,
    `files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`
  );
  const searchData = await searchResp.json();
  const existingFiles = searchData.files || [];

  if (existingFiles.length > 0) {
    return existingFiles[0].id;
  }

  const metadata: Record<string, any> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const createResp = await executeDriveApi(accessToken, 'files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });

  const createData = await createResp.json();
  return createData.id;
}

/**
 * Initializes and guarantees default folder hierarchy inside user's Google Drive.
 * Zero duplicate folders.
 */
export async function ensureDefaultCategoryFolders(
  accessToken: string
): Promise<{ rootFolderId: string; documentsFolderId: string; defaultFolders: Record<string, string> }> {
  const rootFolderId = await findOrCreateFolder(accessToken, 'India Cyber Cafe');
  const documentsFolderId = await findOrCreateFolder(accessToken, 'My Documents', rootFolderId);

  const defaultFolders: Record<string, string> = {};
  for (const category of DEFAULT_CATEGORY_FOLDERS) {
    const categoryFolderId = await findOrCreateFolder(accessToken, category, documentsFolderId);
    defaultFolders[category] = categoryFolderId;
  }

  return {
    rootFolderId,
    documentsFolderId,
    defaultFolders,
  };
}

export const ensureDefaultFolders = ensureDefaultCategoryFolders;
export const listFolderContents = listFolderItems;

/**
 * Lists files and folders inside a specific parent folder with consistent ordering.
 */
export async function listFolderItems(
  accessToken: string,
  folderId: string,
  options?: {
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }
): Promise<{ files: DriveItem[]; nextPageToken?: string }> {
  const parentClause = `'${folderId}' in parents and trashed = false`;
  const pageSize = options?.pageSize || 100;

  const params = new URLSearchParams({
    q: parentClause,
    pageSize: String(pageSize),
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, iconLink, thumbnailLink, webViewLink, webContentLink, parents)',
    orderBy: options?.orderBy || 'folder,modifiedTime desc',
    spaces: 'drive',
  });

  if (options?.pageToken) {
    params.set('pageToken', options.pageToken);
  }

  const response = await executeDriveApi(accessToken, `files?${params.toString()}`);
  const data = await response.json();

  const rawItems: DriveItem[] = (data.files || []).map((file: any) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : undefined,
    modifiedTime: file.modifiedTime,
    createdTime: file.createdTime,
    iconLink: file.iconLink,
    thumbnailLink: file.thumbnailLink,
    webViewLink: file.webViewLink,
    webContentLink: file.webContentLink,
    parents: file.parents,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
  }));

  // Separate and consistently sort folders and files
  const folders = rawItems.filter(i => i.isFolder);
  const files = rawItems.filter(i => !i.isFolder);

  const sortedFolders = sortFolders(folders);
  const sortedFiles = sortFiles(files);

  return {
    files: [...sortedFolders, ...sortedFiles],
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Creates a new custom subfolder inside parentId.
 */
export async function createSubFolder(
  accessToken: string,
  name: string,
  parentId: string
): Promise<DriveItem> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Folder name cannot be empty');

  const existingId = await findOrCreateFolder(accessToken, cleanName, parentId);

  const getResp = await executeDriveApi(
    accessToken,
    `files/${existingId}?fields=id,name,mimeType,modifiedTime,createdTime,iconLink,parents`
  );
  const file = await getResp.json();

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    createdTime: file.createdTime,
    iconLink: file.iconLink,
    parents: file.parents,
    isFolder: true,
  };
}

/**
 * Renames a file or folder.
 */
export async function renameDriveItem(
  accessToken: string,
  fileId: string,
  newName: string
): Promise<DriveItem> {
  const cleanName = newName.trim();
  if (!cleanName) throw new Error('Name cannot be empty');

  const patchResp = await executeDriveApi(
    accessToken,
    `files/${fileId}?fields=id,name,mimeType,size,modifiedTime,iconLink,parents`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cleanName }),
    }
  );

  const file = await patchResp.json();
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : undefined,
    modifiedTime: file.modifiedTime,
    iconLink: file.iconLink,
    parents: file.parents,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
  };
}

/**
 * Validates circular dependency before moving folders.
 */
async function isDescendant(
  accessToken: string,
  folderId: string,
  targetParentId: string
): Promise<boolean> {
  let currentId: string = targetParentId;
  const visited = new Set<string>();

  while (currentId && currentId !== 'root') {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    try {
      const resp = await executeDriveApi(accessToken, `files/${currentId}?fields=id,parents`);
      const file = await resp.json();
      const parents: string[] = file.parents || [];
      if (parents.includes(folderId)) {
        return true;
      }
      currentId = parents[0] || '';
    } catch {
      break;
    }
  }

  return false;
}

/**
 * Moves a file or folder to a new parent folder.
 */
export async function moveDriveItem(
  accessToken: string,
  fileId: string,
  newParentId: string,
  oldParentId?: string
): Promise<DriveItem> {
  if (fileId === newParentId) {
    throw new Error('Cannot move an item into itself');
  }

  const isLoop = await isDescendant(accessToken, fileId, newParentId);
  if (isLoop) {
    throw new Error('Cannot move a folder into its own subfolder');
  }

  let removeParents = oldParentId;
  if (!removeParents) {
    const metaResp = await executeDriveApi(accessToken, `files/${fileId}?fields=parents`);
    const meta = await metaResp.json();
    removeParents = (meta.parents || []).join(',');
  }

  const patchResp = await executeDriveApi(
    accessToken,
    `files/${fileId}?addParents=${newParentId}&removeParents=${removeParents}&fields=id,name,mimeType,size,modifiedTime,parents`,
    {
      method: 'PATCH',
    }
  );

  const file = await patchResp.json();
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : undefined,
    modifiedTime: file.modifiedTime,
    parents: file.parents,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
  };
}

/**
 * Moves a file or folder to Google Drive Trash (safe delete).
 */
export async function trashDriveItem(
  accessToken: string,
  fileId: string
): Promise<{ success: boolean; id: string }> {
  await executeDriveApi(accessToken, `files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });

  return { success: true, id: fileId };
}

/**
 * In-memory file upload: streams a multipart buffer directly to Google Drive API.
 * ZERO persistent local storage on ICC servers.
 */
export async function uploadFileToDrive(
  accessToken: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  parentId: string
): Promise<DriveItem> {
  const boundary = `-------314159265358979323846_${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    mimeType,
    parents: [parentId],
  };

  const metadataHeader =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n`;

  const multipartBody = Buffer.concat([
    Buffer.from(metadataHeader, 'utf8'),
    fileBuffer,
    Buffer.from(closeDelimiter, 'utf8'),
  ]);

  const uploadResp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,iconLink,thumbnailLink,webViewLink,webContentLink,parents',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': multipartBody.length.toString(),
      },
      body: multipartBody,
    }
  );

  if (!uploadResp.ok) {
    const errorText = await uploadResp.text();
    throw new Error(`Google Drive upload failed (${uploadResp.status}): ${errorText}`);
  }

  const file = await uploadResp.json();
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : undefined,
    modifiedTime: file.modifiedTime,
    iconLink: file.iconLink,
    thumbnailLink: file.thumbnailLink,
    webViewLink: file.webViewLink,
    webContentLink: file.webContentLink,
    parents: file.parents,
    isFolder: false,
  };
}

/**
 * Downloads file stream and metadata directly from Google Drive.
 */
export async function getFileDownloadStream(
  accessToken: string,
  fileId: string
): Promise<{
  name: string;
  mimeType: string;
  size?: number;
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null;
}> {
  const metaResp = await executeDriveApi(
    accessToken,
    `files/${fileId}?fields=id,name,mimeType,size`
  );
  const meta = await metaResp.json();

  let mediaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  let mimeType = meta.mimeType;

  if (meta.mimeType === 'application/vnd.google-apps.document') {
    mediaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
    mimeType = 'application/pdf';
  } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
    mediaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
    mimeType = 'application/pdf';
  } else if (meta.mimeType === 'application/vnd.google-apps.presentation') {
    mediaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
    mimeType = 'application/pdf';
  }

  const mediaResp = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!mediaResp.ok) {
    const errText = await mediaResp.text();
    throw new Error(`Failed to stream file from Google Drive (${mediaResp.status}): ${errText}`);
  }

  return {
    name: meta.name,
    mimeType,
    size: meta.size ? Number(meta.size) : undefined,
    body: mediaResp.body as any,
  };
}

// In-memory cache for folder ancestry lookups during path resolution
const folderAncestryCache = new Map<string, { id: string; name: string; parents: string[] }>();

async function getFolderAncestry(
  accessToken: string,
  folderId: string
): Promise<{ id: string; name: string; parents: string[] } | null> {
  if (folderAncestryCache.has(folderId)) {
    return folderAncestryCache.get(folderId)!;
  }
  try {
    const resp = await executeDriveApi(accessToken, `files/${folderId}?fields=id,name,parents`);
    const data = await resp.json();
    const record = { id: data.id, name: data.name, parents: data.parents || [] };
    folderAncestryCache.set(folderId, record);
    return record;
  } catch {
    return null;
  }
}

/**
 * Advanced Global Search across the entire "My Documents" hierarchy.
 * - Searches all category folders, custom folders, and nested documents.
 * - Filters out any unrelated files outside My Documents.
 * - Resolves complete folder path & breadcrumbs for every match.
 * - Supports pagination and prevents duplicate results.
 * - Sorts folders by category priority and files by date/name.
 */
export async function searchUserDrive(
  accessToken: string,
  documentsFolderId: string,
  query: string,
  options?: {
    category?: string;
    pageToken?: string;
    pageSize?: number;
    maxResults?: number;
  }
): Promise<{ items: DriveItem[]; nextPageToken?: string }> {
  const sanitizedQuery = (query || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let q = `trashed = false`;

  if (sanitizedQuery) {
    q += ` and name contains '${sanitizedQuery}'`;
  }

  const categoryMime = options?.category;
  if (categoryMime && categoryMime !== 'all') {
    if (categoryMime === 'folder') {
      q += ` and mimeType = 'application/vnd.google-apps.folder'`;
    } else if (categoryMime === 'pdf') {
      q += ` and mimeType = 'application/pdf'`;
    } else if (categoryMime === 'image') {
      q += ` and mimeType contains 'image/'`;
    } else if (categoryMime === 'document') {
      q += ` and (mimeType contains 'document' or mimeType contains 'text' or mimeType contains 'msword')`;
    } else if (categoryMime === 'spreadsheet') {
      q += ` and (mimeType contains 'sheet' or mimeType contains 'excel' or mimeType contains 'csv')`;
    }
  }

  const pageSize = Math.min(options?.pageSize || 100, 100);
  const targetLimit = options?.maxResults || 100;
  const rawFiles: any[] = [];
  let currentToken = options?.pageToken;
  let nextPageToken: string | undefined = undefined;
  let attempts = 0;

  do {
    const params = new URLSearchParams({
      q,
      pageSize: String(pageSize),
      fields:
        'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, iconLink, thumbnailLink, webViewLink, webContentLink, parents)',
      orderBy: 'folder, modifiedTime desc',
      spaces: 'drive',
    });
    if (currentToken) {
      params.set('pageToken', currentToken);
    }

    const response = await executeDriveApi(accessToken, `files?${params.toString()}`);
    const data = await response.json();
    const files = data.files || [];
    rawFiles.push(...files);
    currentToken = data.nextPageToken;
    nextPageToken = data.nextPageToken;
    attempts++;
  } while (currentToken && rawFiles.length < targetLimit && attempts < 3);

  // Pre-seed folder cache with root
  folderAncestryCache.set(documentsFolderId, {
    id: documentsFolderId,
    name: 'My Documents',
    parents: [],
  });

  // Verify ancestry and compute complete folder path for each item
  const validItems: DriveItem[] = [];
  const seenIds = new Set<string>();

  for (const file of rawFiles) {
    if (seenIds.has(file.id)) continue;
    seenIds.add(file.id);

    const isFolder = file.mimeType === 'application/vnd.google-apps.folder';

    // If the item itself IS the documents folder, skip or label root
    if (file.id === documentsFolderId) {
      continue;
    }

    // Walk up parents to verify it belongs inside documentsFolderId hierarchy
    const parentId = file.parents?.[0];
    let isInHierarchy = false;
    const breadcrumbTrail: { id: string; name: string }[] = [];

    if (parentId) {
      let currentParentId = parentId;
      let depth = 0;

      while (currentParentId && depth < 12) {
        if (currentParentId === documentsFolderId) {
          isInHierarchy = true;
          break;
        }

        const pMeta = await getFolderAncestry(accessToken, currentParentId);
        if (!pMeta) break;

        breadcrumbTrail.unshift({ id: pMeta.id, name: pMeta.name });
        currentParentId = pMeta.parents[0] || '';
        depth++;
      }
    }

    // Fallback if documentsFolderId is root or direct match
    if (!isInHierarchy && parentId === documentsFolderId) {
      isInHierarchy = true;
    }

    // Exclude any file outside My Documents hierarchy
    if (!isInHierarchy && documentsFolderId !== 'root') {
      continue;
    }

    // Construct full breadcrumbs list
    const fullBreadcrumbs = [{ id: 'root', name: 'My Documents' }, ...breadcrumbTrail];
    if (isFolder) {
      fullBreadcrumbs.push({ id: file.id, name: file.name });
    }

    const folderPath = fullBreadcrumbs.map(b => b.name).join(' / ');

    validItems.push({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size ? Number(file.size) : undefined,
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      iconLink: file.iconLink,
      thumbnailLink: file.thumbnailLink,
      webViewLink: file.webViewLink,
      webContentLink: file.webContentLink,
      parents: file.parents,
      isFolder,
      folderPath,
      breadcrumbs: fullBreadcrumbs,
    });
  }

  // Consistent ordering of search results: Folders by priority, then files by date/name
  const matchingFolders = validItems.filter(i => i.isFolder);
  const matchingFiles = validItems.filter(i => !i.isFolder);

  const sortedFolders = sortFolders(matchingFolders);
  const sortedFiles = sortFiles(matchingFiles);

  return {
    items: [...sortedFolders, ...sortedFiles],
    nextPageToken,
  };
}

/**
 * Retrieves user's Google Drive storage quota and user profile.
 */
export async function getDriveStorageQuota(accessToken: string): Promise<{
  quota: {
    limit?: number;
    usage?: number;
    usageInDrive?: number;
    usageInDriveTrash?: number;
  };
  user: {
    displayName?: string;
    emailAddress?: string;
    photoLink?: string;
  };
}> {
  const response = await executeDriveApi(accessToken, 'about?fields=storageQuota,user');
  const data = await response.json();

  return {
    quota: {
      limit: data.storageQuota?.limit ? Number(data.storageQuota.limit) : undefined,
      usage: data.storageQuota?.usage ? Number(data.storageQuota.usage) : undefined,
      usageInDrive: data.storageQuota?.usageInDrive ? Number(data.storageQuota.usageInDrive) : undefined,
      usageInDriveTrash: data.storageQuota?.usageInDriveTrash ? Number(data.storageQuota.usageInDriveTrash) : undefined,
    },
    user: {
      displayName: data.user?.displayName,
      emailAddress: data.user?.emailAddress,
      photoLink: data.user?.photoLink,
    },
  };
}
