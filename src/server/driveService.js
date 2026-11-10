import { encryptToken, decryptToken } from './crypto.js';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const USER_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export const DEFAULT_CATEGORY_FOLDERS = [
  'Identity Documents',
  'Education Documents',
  'Banking Documents',
  'Certificates',
  'Government Documents',
  'Personal Documents',
  'Other Documents',
];

// In-memory token and state cache with per-user isolation
const tokenStore = new Map();
const stateStore = new Map();

// Clean up stale OAuth states every 15 minutes (unref so process can exit cleanly)
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

export function getOAuthClientId() {
  return process.env.GOOGLE_CLIENT_ID || '';
}

export function getOAuthClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET || '';
}

export function generateOAuthState(uid, redirectUrl = '/my-documents/') {
  const cryptoRandom = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  stateStore.set(cryptoRandom, {
    uid,
    createdAt: Date.now(),
    redirectUrl,
  });
  return cryptoRandom;
}

export function validateOAuthState(state) {
  const record = stateStore.get(state);
  if (!record) return null;
  stateStore.delete(state); // one-time use
  return { uid: record.uid, redirectUrl: record.redirectUrl };
}

export function buildOAuthUrl(state, redirectUri) {
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
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeOAuthCode(code, redirectUri) {
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
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in || 3600;

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

export function saveUserCredentials(
  uid,
  accessToken,
  refreshToken,
  expiresIn,
  googleEmail,
  googleSubject
) {
  const encryptedRefresh = encryptToken(refreshToken);
  tokenStore.set(uid, {
    accessToken,
    refreshTokenEncrypted: encryptedRefresh,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
    googleEmail,
    googleSubject,
  });
}

export async function getValidAccessToken(uid) {
  const record = tokenStore.get(uid);
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
    throw new Error(`Google Drive token refresh failed (${refreshResp.status}): ${errText}`);
  }

  const refreshData = await refreshResp.json();
  const newAccessToken = refreshData.access_token;
  const expiresIn = refreshData.expires_in || 3600;

  record.accessToken = newAccessToken;
  record.expiresAt = Date.now() + (expiresIn - 60) * 1000;
  tokenStore.set(uid, record);

  return newAccessToken;
}

export async function disconnectUserDrive(uid) {
  const record = tokenStore.get(uid);
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
}

export function hasDriveToken(uid) {
  return tokenStore.has(uid);
}

export function getUserDriveEmail(uid) {
  return tokenStore.get(uid)?.googleEmail;
}

// -------------------------------------------------------------
// Google Drive API v3 Methods
// -------------------------------------------------------------

async function executeDriveApi(accessToken, endpoint, init) {
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
    err.status = response.status;
    throw err;
  }

  return response;
}

export async function findOrCreateFolder(accessToken, folderName, parentId) {
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

  // Folder does not exist, create it
  const createResp = await executeDriveApi(accessToken, 'files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });

  const created = await createResp.json();
  return created.id;
}

export async function ensureDefaultFolders(accessToken) {
  // 1. Root folder "India Cyber Cafe"
  const rootFolderId = await findOrCreateFolder(accessToken, 'India Cyber Cafe');

  // 2. Main folder "My Documents" inside "India Cyber Cafe"
  const documentsFolderId = await findOrCreateFolder(accessToken, 'My Documents', rootFolderId);

  // 3. Category subfolders inside "My Documents"
  const defaultFolders = {};
  for (const categoryName of DEFAULT_CATEGORY_FOLDERS) {
    const catId = await findOrCreateFolder(accessToken, categoryName, documentsFolderId);
    defaultFolders[categoryName] = catId;
  }

  return {
    rootFolderId,
    documentsFolderId,
    defaultFolders,
  };
}

export async function listFolderContents(accessToken, folderId, options) {
  const parentClause = `'${folderId}' in parents and trashed = false`;
  const orderByClause = options?.orderBy || 'folder,modifiedTime desc';
  const pageSize = options?.pageSize || 100;

  const params = new URLSearchParams({
    q: parentClause,
    pageSize: String(pageSize),
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, iconLink, thumbnailLink, webViewLink, webContentLink, parents)',
    orderBy: orderByClause,
    spaces: 'drive',
  });

  if (options?.pageToken) {
    params.set('pageToken', options.pageToken);
  }

  const response = await executeDriveApi(accessToken, `files?${params.toString()}`);
  const data = await response.json();

  const files = (data.files || []).map((file) => ({
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

  return {
    files,
    nextPageToken: data.nextPageToken,
  };
}

export async function createSubFolder(accessToken, name, parentId) {
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

export async function renameDriveItem(accessToken, fileId, newName) {
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

async function isDescendant(accessToken, folderId, targetFolderId) {
  if (folderId === targetFolderId) return true;

  let currentId = targetFolderId;
  const visited = new Set();

  while (currentId && currentId !== 'root') {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    try {
      const resp = await executeDriveApi(accessToken, `files/${currentId}?fields=id,parents`);
      const file = await resp.json();
      const parents = file.parents || [];
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

export async function moveDriveItem(accessToken, fileId, newParentId, oldParentId) {
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

export async function trashDriveItem(accessToken, fileId) {
  await executeDriveApi(accessToken, `files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });

  return { success: true, id: fileId };
}

export async function uploadFileToDrive(accessToken, fileBuffer, fileName, mimeType, parentId) {
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

export async function getFileDownloadStream(accessToken, fileId) {
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
    body: mediaResp.body,
  };
}

export async function searchUserDrive(accessToken, documentsFolderId, query, categoryMime) {
  const sanitizedQuery = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let q = `trashed = false`;

  if (sanitizedQuery) {
    q += ` and name contains '${sanitizedQuery}'`;
  }

  if (categoryMime) {
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

  const params = new URLSearchParams({
    q,
    pageSize: '50',
    fields: 'files(id, name, mimeType, size, modifiedTime, createdTime, iconLink, thumbnailLink, webViewLink, webContentLink, parents)',
    orderBy: 'modifiedTime desc',
    spaces: 'drive',
  });

  const response = await executeDriveApi(accessToken, `files?${params.toString()}`);
  const data = await response.json();

  return (data.files || []).map((file) => ({
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
}

export async function getDriveStorageQuota(accessToken) {
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
