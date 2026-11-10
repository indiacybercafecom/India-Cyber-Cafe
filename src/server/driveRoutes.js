import { Router } from 'express';
import multer from 'multer';
import {
  generateOAuthState,
  validateOAuthState,
  buildOAuthUrl,
  exchangeOAuthCode,
  saveUserCredentials,
  getValidAccessToken,
  disconnectUserDrive,
  hasDriveToken,
  getUserDriveEmail,
  ensureDefaultFolders,
  listFolderContents,
  createSubFolder,
  renameDriveItem,
  moveDriveItem,
  trashDriveItem,
  uploadFileToDrive,
  getFileDownloadStream,
  searchUserDrive,
  getDriveStorageQuota,
} from './driveService.js';

export const driveRouter = Router();

// Memory-only upload handler (Zero local disk persistence)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file limit
    files: 10,
  },
});

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  'AIzaSyAMTND9rIAw-76Oey3c7c43-TW2t6mxEfw';

const RTDB_URL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';

/**
 * Verifies the caller's Firebase ID token via Google Identity Toolkit
 */
async function verifyFirebaseToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const idToken = authHeader.substring(7).trim();
  if (!idToken) return null;

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const user = data.users?.[0];
      if (user?.localId) {
        return { uid: user.localId, email: user.email };
      }
    }

    const parts = idToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      if (payload.user_id || payload.sub) {
        const now = Math.floor(Date.now() / 1000);
        if (!payload.exp || payload.exp > now) {
          return {
            uid: payload.user_id || payload.sub,
            email: payload.email,
          };
        }
      }
    }
  } catch (error) {
    console.warn('[driveRoutes] Token verification notice:', error);
  }

  return null;
}

/**
 * Updates user's drive connection metadata in Firebase Realtime Database
 */
async function syncConnectionMetaToRtdb(uid, data) {
  try {
    await fetch(`${RTDB_URL}/driveConnections/${uid}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.warn(`[driveRoutes] RTDB metadata sync notice for ${uid}:`, err);
  }
}

/**
 * Reads user's drive connection metadata from Firebase Realtime Database
 */
async function getRtdbConnectionMeta(uid) {
  try {
    const res = await fetch(`${RTDB_URL}/driveConnections/${uid}.json`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn(`[driveRoutes] RTDB read notice for ${uid}:`, err);
  }
  return null;
}

// -------------------------------------------------------------
// Endpoints
// -------------------------------------------------------------

/**
 * GET /api/drive/status
 */
driveRouter.get('/status', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const connectedInMem = hasDriveToken(authUser.uid);
    const rtdbMeta = await getRtdbConnectionMeta(authUser.uid);

    const isConnected = connectedInMem || (Boolean(rtdbMeta?.connected) && rtdbMeta?.status === 'active');
    const googleEmail = getUserDriveEmail(authUser.uid) || rtdbMeta?.googleEmail || authUser.email;

    return res.json({
      success: true,
      connected: isConnected,
      googleEmail: isConnected ? googleEmail : undefined,
      rootFolderId: rtdbMeta?.rootFolderId,
      documentsFolderId: rtdbMeta?.documentsFolderId,
      defaultFolders: rtdbMeta?.defaultFolders || {},
      connectedAt: rtdbMeta?.connectedAt,
    });
  } catch (error) {
    console.error('[drive/status] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/drive/connect
 */
driveRouter.get('/connect', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required to connect Drive' });
    }

    const redirectPath = typeof req.query.returnUrl === 'string' ? req.query.returnUrl : '/my-documents/';
    const state = generateOAuthState(authUser.uid, redirectPath);

    const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const redirectUri = `${proto}://${host}/api/drive/callback`;

    const authUrl = buildOAuthUrl(state, redirectUri);

    return res.json({
      success: true,
      authUrl,
      state,
    });
  } catch (error) {
    console.error('[drive/connect] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/drive/callback
 */
driveRouter.get('/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const error = req.query.error;

  if (error) {
    console.warn('[drive/callback] OAuth error from Google:', error);
    return res.redirect(`/my-documents/?error=${encodeURIComponent('Google Drive authorization was denied or canceled.')}`);
  }

  if (!code || !state) {
    return res.redirect(`/my-documents/?error=${encodeURIComponent('Invalid OAuth callback response.')}`);
  }

  const validated = validateOAuthState(state);
  if (!validated) {
    return res.redirect(`/my-documents/?error=${encodeURIComponent('OAuth state verification failed or expired. Please try connecting again.')}`);
  }

  try {
    const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const redirectUri = `${proto}://${host}/api/drive/callback`;

    const tokenData = await exchangeOAuthCode(code, redirectUri);

    saveUserCredentials(
      validated.uid,
      tokenData.accessToken,
      tokenData.refreshToken || '',
      tokenData.expiresIn,
      tokenData.email,
      tokenData.sub
    );

    const folders = await ensureDefaultFolders(tokenData.accessToken);

    await syncConnectionMetaToRtdb(validated.uid, {
      connected: true,
      googleEmail: tokenData.email || '',
      googleSubject: tokenData.sub || '',
      rootFolderId: folders.rootFolderId,
      documentsFolderId: folders.documentsFolderId,
      defaultFolders: folders.defaultFolders,
      connectedAt: Date.now(),
      status: 'active',
    });

    return res.redirect(`${validated.redirectUrl || '/my-documents/'}?connected=1`);
  } catch (exchangeError) {
    console.error('[drive/callback] Exchange error:', exchangeError);
    return res.redirect(`/my-documents/?error=${encodeURIComponent(exchangeError.message || 'Failed to complete Google Drive authorization.')}`);
  }
});

/**
 * POST /api/drive/disconnect
 */
driveRouter.post('/disconnect', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    await disconnectUserDrive(authUser.uid);

    await syncConnectionMetaToRtdb(authUser.uid, {
      connected: false,
      status: 'disconnected',
      disconnectedAt: Date.now(),
    });

    return res.json({
      success: true,
      message: 'Google Drive disconnected successfully. Your files remain untouched in your Google Drive.',
    });
  } catch (error) {
    console.error('[drive/disconnect] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/drive/files
 */
driveRouter.get('/files', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const accessToken = await getValidAccessToken(authUser.uid);

    let folderId = req.query.folderId;
    if (!folderId || folderId === 'root') {
      const rtdbMeta = await getRtdbConnectionMeta(authUser.uid);
      folderId = rtdbMeta?.documentsFolderId;
      if (!folderId) {
        const folders = await ensureDefaultFolders(accessToken);
        folderId = folders.documentsFolderId;
      }
    }

    const pageToken = req.query.pageToken;
    const orderBy = req.query.orderBy;

    const result = await listFolderContents(accessToken, folderId, {
      pageToken,
      orderBy,
    });

    return res.json({
      success: true,
      currentFolderId: folderId,
      files: result.files,
      nextPageToken: result.nextPageToken,
    });
  } catch (error) {
    console.error('[drive/files] Error:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/drive/folders
 */
driveRouter.post('/folders', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { name, parentId } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'Folder name is required' });
    }

    const accessToken = await getValidAccessToken(authUser.uid);
    let targetParentId = parentId;

    if (!targetParentId || targetParentId === 'root') {
      const rtdbMeta = await getRtdbConnectionMeta(authUser.uid);
      targetParentId = rtdbMeta?.documentsFolderId;
      if (!targetParentId) {
        const folders = await ensureDefaultFolders(accessToken);
        targetParentId = folders.documentsFolderId;
      }
    }

    const createdFolder = await createSubFolder(accessToken, name, targetParentId);

    return res.json({
      success: true,
      folder: createdFolder,
    });
  } catch (error) {
    console.error('[drive/folders] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/drive/files/:id
 */
driveRouter.patch('/files/:id', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const fileId = req.params.id;
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'New name is required' });
    }

    const accessToken = await getValidAccessToken(authUser.uid);
    const updatedItem = await renameDriveItem(accessToken, fileId, name);

    return res.json({
      success: true,
      item: updatedItem,
    });
  } catch (error) {
    console.error('[drive/rename] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/drive/upload
 */
driveRouter.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file provided for upload' });
    }

    const accessToken = await getValidAccessToken(authUser.uid);
    let parentId = req.body.parentId;

    if (!parentId || parentId === 'root') {
      const rtdbMeta = await getRtdbConnectionMeta(authUser.uid);
      parentId = rtdbMeta?.documentsFolderId;
      if (!parentId) {
        const folders = await ensureDefaultFolders(accessToken);
        parentId = folders.documentsFolderId;
      }
    }

    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const mimeType = file.mimetype || 'application/octet-stream';

    const uploadedItem = await uploadFileToDrive(
      accessToken,
      file.buffer,
      originalName,
      mimeType,
      parentId
    );

    return res.json({
      success: true,
      file: uploadedItem,
    });
  } catch (error) {
    console.error('[drive/upload] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/drive/download/:id
 */
driveRouter.get('/download/:id', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const fileId = req.params.id;
    const accessToken = await getValidAccessToken(authUser.uid);

    const streamInfo = await getFileDownloadStream(accessToken, fileId);

    res.setHeader('Content-Type', streamInfo.mimeType);
    if (streamInfo.size) {
      res.setHeader('Content-Length', streamInfo.size.toString());
    }

    const downloadMode = req.query.inline !== '1';
    const dispositionType = downloadMode ? 'attachment' : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${dispositionType}; filename="${encodeURIComponent(streamInfo.name)}"`
    );
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

    if (streamInfo.body) {
      const reader = streamInfo.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } else {
      res.end();
    }
  } catch (error) {
    console.error('[drive/download] Error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
});

/**
 * GET /api/drive/preview/:id
 */
driveRouter.get('/preview/:id', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const fileId = req.params.id;
    const accessToken = await getValidAccessToken(authUser.uid);

    const streamInfo = await getFileDownloadStream(accessToken, fileId);

    res.setHeader('Content-Type', streamInfo.mimeType);
    if (streamInfo.size) {
      res.setHeader('Content-Length', streamInfo.size.toString());
    }
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(streamInfo.name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (streamInfo.body) {
      const reader = streamInfo.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } else {
      res.end();
    }
  } catch (error) {
    console.error('[drive/preview] Error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
});

/**
 * DELETE /api/drive/files/:id
 */
driveRouter.delete('/files/:id', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const fileId = req.params.id;
    const accessToken = await getValidAccessToken(authUser.uid);

    const result = await trashDriveItem(accessToken, fileId);

    return res.json({
      success: true,
      message: 'Item moved to Google Drive Trash',
      id: result.id,
    });
  } catch (error) {
    console.error('[drive/trash] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/drive/move
 */
driveRouter.post('/move', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { fileId, newParentId, oldParentId } = req.body;
    if (!fileId || !newParentId) {
      return res.status(400).json({ success: false, error: 'fileId and newParentId are required' });
    }

    const accessToken = await getValidAccessToken(authUser.uid);
    const moved = await moveDriveItem(accessToken, fileId, newParentId, oldParentId);

    return res.json({
      success: true,
      item: moved,
    });
  } catch (error) {
    console.error('[drive/move] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/drive/search
 */
driveRouter.get('/search', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';

    const accessToken = await getValidAccessToken(authUser.uid);
    const rtdbMeta = await getRtdbConnectionMeta(authUser.uid);
    const documentsFolderId = rtdbMeta?.documentsFolderId || 'root';

    const items = await searchUserDrive(accessToken, documentsFolderId, query, category);

    return res.json({
      success: true,
      items,
    });
  } catch (error) {
    console.error('[drive/search] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/drive/storage
 */
driveRouter.get('/storage', async (req, res) => {
  try {
    const authUser = await verifyFirebaseToken(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const accessToken = await getValidAccessToken(authUser.uid);
    const quotaData = await getDriveStorageQuota(accessToken);

    return res.json({
      success: true,
      ...quotaData,
    });
  } catch (error) {
    console.error('[drive/storage] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});
