import { auth } from '../firebase';
import { DriveItem } from '../server/driveService';

export interface DriveStatusResponse {
  success: boolean;
  connected: boolean;
  googleEmail?: string;
  rootFolderId?: string;
  documentsFolderId?: string;
  defaultFolders?: Record<string, string>;
  connectedAt?: number;
  error?: string;
  accountMismatch?: boolean;
}

export interface DriveFilesResponse {
  success: boolean;
  currentFolderId: string;
  files: DriveItem[];
  nextPageToken?: string;
  error?: string;
}

export interface DriveQuotaResponse {
  success: boolean;
  quota?: {
    limit?: number;
    usage?: number;
    usageInDrive?: number;
    usageInDriveTrash?: number;
  };
  user?: {
    displayName?: string;
    emailAddress?: string;
    photoLink?: string;
  };
  error?: string;
}

/**
 * Gets the current user's Firebase ID token for backend authentication
 */
async function getAuthToken(): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in to access your documents');
  }
  return await currentUser.getIdToken();
}

/**
 * Helper to execute authorized requests to /api/drive/*
 */
async function driveFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  let data: any = {};
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = { error: text };
  }

  if (!response.ok) {
    const errMsg = data.error || `Request failed with status ${response.status}`;
    const error = new Error(errMsg);
    (error as any).status = response.status;
    throw error;
  }

  return data;
}

export const driveClient = {
  /**
   * Check connection status of user's Google Drive
   */
  async getStatus(): Promise<DriveStatusResponse> {
    return driveFetch<DriveStatusResponse>('/api/drive/status');
  },

  /**
   * Request OAuth authorization URL to connect personal Google Drive
   */
  async getConnectUrl(returnUrl = '/my-documents/'): Promise<{ authUrl: string; state: string }> {
    return driveFetch<{ authUrl: string; state: string }>(
      `/api/drive/connect?returnUrl=${encodeURIComponent(returnUrl)}`
    );
  },

  /**
   * Disconnect Google Drive
   */
  async disconnect(): Promise<{ success: boolean; message: string }> {
    return driveFetch('/api/drive/disconnect', { method: 'POST' });
  },

  /**
   * List files and folders inside a specific folder
   */
  async listFiles(
    folderId?: string,
    pageToken?: string,
    orderBy?: string
  ): Promise<DriveFilesResponse> {
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    if (pageToken) params.set('pageToken', pageToken);
    if (orderBy) params.set('orderBy', orderBy);

    const queryStr = params.toString() ? `?${params.toString()}` : '';
    return driveFetch<DriveFilesResponse>(`/api/drive/files${queryStr}`);
  },

  /**
   * Create a new folder
   */
  async createFolder(name: string, parentId?: string): Promise<{ success: boolean; folder: DriveItem }> {
    return driveFetch('/api/drive/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    });
  },

  /**
   * Rename a file or folder
   */
  async renameItem(fileId: string, name: string): Promise<{ success: boolean; item: DriveItem }> {
    return driveFetch(`/api/drive/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },

  /**
   * Move a file or folder to a new parent
   */
  async moveItem(
    fileId: string,
    newParentId: string,
    oldParentId?: string
  ): Promise<{ success: boolean; item: DriveItem }> {
    return driveFetch('/api/drive/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, newParentId, oldParentId }),
    });
  },

  /**
   * Move item to Google Drive Trash
   */
  async deleteItem(fileId: string): Promise<{ success: boolean; id: string }> {
    return driveFetch(`/api/drive/files/${fileId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Uploads a file directly into user's Google Drive with real-time progress
   * ZERO server disk storage.
   */
  uploadFile(
    file: File,
    parentId?: string,
    onProgress?: (percent: number) => void
  ): { promise: Promise<{ success: boolean; file: DriveItem }>; cancel: () => void } {
    let xhr: XMLHttpRequest | null = new XMLHttpRequest();

    const cancel = () => {
      if (xhr) {
        xhr.abort();
        xhr = null;
      }
    };

    const promise = new Promise<{ success: boolean; file: DriveItem }>(async (resolve, reject) => {
      try {
        const token = await getAuthToken();
        const formData = new FormData();
        formData.append('file', file);
        if (parentId) {
          formData.append('parentId', parentId);
        }

        xhr!.open('POST', '/api/drive/upload', true);
        xhr!.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr!.setRequestHeader('Accept', 'application/json');

        if (onProgress && xhr!.upload) {
          xhr!.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              onProgress(percent);
            }
          };
        }

        xhr!.onload = () => {
          if (!xhr) return;
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(data);
            } else {
              reject(new Error(data.error || `Upload failed with status ${xhr.status}`));
            }
          } catch {
            reject(new Error(`Upload failed with response: ${xhr.statusText}`));
          }
        };

        xhr!.onerror = () => {
          reject(new Error('Network error during file upload. Please check your connection and try again.'));
        };

        xhr!.onabort = () => {
          reject(new Error('Upload canceled'));
        };

        xhr!.send(formData);
      } catch (err) {
        reject(err);
      }
    });

    return { promise, cancel };
  },

  /**
   * Search files inside My Documents
   */
  async search(query: string, category?: string): Promise<{ success: boolean; items: DriveItem[] }> {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (category && category !== 'all') params.set('category', category);

    return driveFetch(`/api/drive/search?${params.toString()}`);
  },

  /**
   * Query storage quota and user info from Google Drive
   */
  async getStorage(): Promise<DriveQuotaResponse> {
    return driveFetch<DriveQuotaResponse>('/api/drive/storage');
  },

  /**
   * Downloads a private file from Drive
   */
  async triggerFileDownload(fileId: string, fileName: string): Promise<void> {
    const token = await getAuthToken();
    const downloadUrl = `/api/drive/download/${fileId}`;

    const resp = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      throw new Error(`Failed to download file (${resp.status})`);
    }

    const blob = await resp.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    }, 2000);
  },

  /**
   * Streams a file to an object URL for preview
   */
  async getPreviewBlobUrl(fileId: string): Promise<string> {
    const token = await getAuthToken();
    const previewUrl = `/api/drive/preview/${fileId}`;

    const resp = await fetch(previewUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      throw new Error(`Failed to load file preview (${resp.status})`);
    }

    const blob = await resp.blob();
    return window.URL.createObjectURL(blob);
  },

  /**
   * Fetches authenticated PDF bytes and creates a blob URL for preview
   */
  async getPreviewPdfBytes(fileId: string): Promise<{ buffer: ArrayBuffer; blob: Blob; blobUrl: string }> {
    const token = await getAuthToken();
    const previewUrl = `/api/drive/preview/${fileId}`;

    const resp = await fetch(previewUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/pdf,application/octet-stream,*/*',
      },
    });

    if (!resp.ok) {
      let errMsg = `Failed to load file preview (${resp.status})`;
      try {
        const data = await resp.json();
        if (data?.error) errMsg = data.error;
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(errMsg);
    }

    const blob = await resp.blob();
    const buffer = await blob.arrayBuffer();
    const blobUrl = window.URL.createObjectURL(blob);
    return { buffer, blob, blobUrl };
  },
};

