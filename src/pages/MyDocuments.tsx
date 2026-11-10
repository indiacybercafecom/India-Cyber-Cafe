import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Folder,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  File as FileIcon,
  Upload,
  FolderPlus,
  Search,
  MoreVertical,
  Download,
  Trash2,
  Edit2,
  Move,
  Eye,
  RefreshCw,
  HardDrive,
  LogOut,
  ChevronRight,
  X,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Lock,
  Plus,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { driveClient, DriveStatusResponse, DriveQuotaResponse } from '../services/driveClient';
import { DriveItem } from '../server/driveService';
import { showToast } from '../components/Toast';
import { MyDocumentsPdfViewerModal } from '../components/MyDocumentsPdfViewerModal';
import { SEO } from '../components/SEO';
import { sortFolders, sortFiles } from '../utils/driveOrdering';

interface BreadcrumbItem {
  id: string;
  name: string;
}

export function MyDocuments() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, authUser, loading: authLoading } = useAuth();

  // Connection & initialization state
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [driveStatus, setDriveStatus] = useState<DriveStatusResponse | null>(null);
  const [storageQuota, setStorageQuota] = useState<DriveQuotaResponse | null>(null);

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: 'root', name: 'My Documents' },
  ]);

  // Items & loading state
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Action Menu state
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);

  // Advanced Global Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DriveItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchRequestIdRef = useRef(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Modals state
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [activeItemForMenu, setActiveItemForMenu] = useState<DriveItem | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [itemToRename, setItemToRename] = useState<DriveItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<DriveItem | null>(null);
  const [moveDestinationId, setMoveDestinationId] = useState<string>('');
  const [moving, setMoving] = useState(false);
  const [availableFolders, setAvailableFolders] = useState<DriveItem[]>([]);
  const [loadingMoveFolders, setLoadingMoveFolders] = useState(false);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DriveItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [isDisconnectOpen, setIsDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Preview modals
  const [previewPdfItem, setPreviewPdfItem] = useState<{ id: string; name: string } | null>(null);
  const [previewImageItem, setPreviewImageItem] = useState<{ id: string; name: string; url?: string } | null>(null);
  const [previewTextItem, setPreviewTextItem] = useState<{ name: string; content: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState<{
    uploading: boolean;
    fileName: string;
    percent: number;
    error?: string;
  } | null>(null);
  const uploadCancelRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Check URL parameters (e.g. from OAuth callback or errors)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const errorParam = params.get('error');
    const connectedParam = params.get('connected');

    if (errorParam) {
      showToast(decodeURIComponent(errorParam), 'error');
      navigate('/my-documents/', { replace: true });
    } else if (connectedParam === '1') {
      showToast('Connected', 'success');
      navigate('/my-documents/', { replace: true });
    }
  }, [location.search, navigate]);

  // Click outside search container to close live suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard escape listener to close search
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSearchFocused(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Advanced Global Search: Debounced recursive search across entire hierarchy
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const currentRequestId = ++searchRequestIdRef.current;
    setIsSearching(true);

    const debounceTimer = setTimeout(async () => {
      try {
        const res = await driveClient.search(q);
        if (searchRequestIdRef.current === currentRequestId) {
          if (res.success) {
            setSearchResults(res.items || []);
          } else {
            setSearchResults([]);
          }
        }
      } catch (err) {
        if (searchRequestIdRef.current === currentRequestId) {
          console.warn('[MyDocuments] Global search notice:', err);
          setSearchResults([]);
        }
      } finally {
        if (searchRequestIdRef.current === currentRequestId) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(debounceTimer);
    };
  }, [searchQuery]);

  // Check status on mount or auth change (restores connection automatically after restarts)
  const refreshStatus = async () => {
    if (!authUser) {
      setCheckingStatus(false);
      return;
    }
    setCheckingStatus(true);
    try {
      const status = await driveClient.getStatus();
      setDriveStatus(status);
      if (status.connected) {
        try {
          const quota = await driveClient.getStorage();
          setStorageQuota(quota);
        } catch (err) {
          console.warn('Storage quota fetch notice:', err);
        }
      }
    } catch (err: any) {
      console.warn('Status check notice:', err);
    } finally {
      setCheckingStatus(false);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      refreshStatus();
    }
  }, [authUser, authLoading]);

  // Load items when current folder changes or status becomes connected
  const loadFolderItems = async (folderId: string) => {
    if (!driveStatus?.connected) return;
    setLoadingItems(true);
    setLoadError(null);
    try {
      const res = await driveClient.listFiles(folderId === 'root' ? undefined : folderId);
      if (res.success) {
        setItems(res.files);
        if (folderId === 'root' && res.currentFolderId) {
          setCurrentFolderId(res.currentFolderId);
        }
      } else {
        setLoadError(res.error || 'Failed to load documents');
      }
    } catch (err: any) {
      console.error('Load items error:', err);
      setLoadError(err.message || 'Unable to reach Google Drive');
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    if (driveStatus?.connected) {
      loadFolderItems(currentFolderId);
    }
  }, [currentFolderId, driveStatus?.connected]);

  // Connect Drive action
  const handleConnectDrive = async () => {
    try {
      const { authUrl } = await driveClient.getConnectUrl('/my-documents/');
      window.location.href = authUrl;
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    }
  };

  // Disconnect Drive action
  const handleDisconnectDrive = async () => {
    setDisconnecting(true);
    try {
      await driveClient.disconnect();
      setDriveStatus({ success: true, connected: false });
      setItems([]);
      setIsDisconnectOpen(false);
      showToast('Disconnected', 'success');
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  // Open a folder from list
  const handleOpenFolder = (folder: DriveItem) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
  };

  // Navigate directly to a specific folder (e.g. from search results)
  const handleNavigateToFolder = (folderId: string, customBreadcrumbs?: BreadcrumbItem[]) => {
    setCurrentFolderId(folderId);
    if (customBreadcrumbs && customBreadcrumbs.length > 0) {
      setBreadcrumbs(customBreadcrumbs);
    } else {
      setBreadcrumbs([
        { id: 'root', name: 'My Documents' },
        { id: folderId, name: 'Folder' },
      ]);
    }
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchFocused(false);
  };

  // Navigate to a file's actual location from search results and open its action menu
  const handleGoToFileLocation = (file: DriveItem) => {
    const parentId = file.parents?.[0] || 'root';
    const parentBreadcrumbs = (file.breadcrumbs && file.breadcrumbs.length > 1)
      ? file.breadcrumbs.slice(0, -1)
      : [{ id: 'root', name: 'My Documents' }];

    setCurrentFolderId(parentId);
    setBreadcrumbs(parentBreadcrumbs);
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchFocused(false);
    setActiveItemForMenu(file);
  };

  // Breadcrumb click
  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumbs[index];
    setBreadcrumbs(prev => prev.slice(0, index + 1));
    setCurrentFolderId(target.id);
  };

  // Create new folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setCreatingFolder(true);
    try {
      const res = await driveClient.createFolder(newFolderName.trim(), currentFolderId);
      if (res.success) {
        showToast('Folder created', 'success');
        setIsNewFolderOpen(false);
        setNewFolderName('');
        loadFolderItems(currentFolderId);
      }
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    } finally {
      setCreatingFolder(false);
    }
  };

  // Rename item
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemToRename || !renameValue.trim()) return;

    setRenaming(true);
    try {
      await driveClient.renameItem(itemToRename.id, renameValue.trim());
      showToast('Renamed', 'success');
      setIsRenameOpen(false);
      setItemToRename(null);
      loadFolderItems(currentFolderId);
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    } finally {
      setRenaming(false);
    }
  };

  // Move item
  const openMoveModal = async (item: DriveItem) => {
    setItemToMove(item);
    setIsMoveOpen(true);
    setLoadingMoveFolders(true);
    setMoveDestinationId('');

    try {
      const rootRes = await driveClient.listFiles(driveStatus?.documentsFolderId || 'root');
      if (rootRes.success) {
        const folders = rootRes.files.filter(f => f.isFolder && f.id !== item.id);
        setAvailableFolders(sortFolders(folders));
      }
    } catch (err) {
      console.warn('Failed to load move folders:', err);
    } finally {
      setLoadingMoveFolders(false);
    }
  };

  const handleMove = async () => {
    if (!itemToMove || !moveDestinationId) return;
    setMoving(true);
    try {
      await driveClient.moveItem(itemToMove.id, moveDestinationId, currentFolderId);
      showToast('Moved', 'success');
      setIsMoveOpen(false);
      setItemToMove(null);
      loadFolderItems(currentFolderId);
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    } finally {
      setMoving(false);
    }
  };

  // Delete item (Move to Trash)
  const handleDelete = async () => {
    if (!itemToDelete) return;
    setDeleting(true);
    try {
      await driveClient.deleteItem(itemToDelete.id);
      showToast('Deleted', 'success');
      setIsDeleteOpen(false);
      setItemToDelete(null);
      loadFolderItems(currentFolderId);
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Download item
  const handleDownload = async (item: DriveItem) => {
    try {
      await driveClient.triggerFileDownload(item.id, item.name);
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    }
  };

  // Preview item
  const handlePreview = async (item: DriveItem) => {
    const mime = item.mimeType?.toLowerCase() || '';
    const name = item.name.toLowerCase();

    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      setPreviewPdfItem({ id: item.id, name: item.name });
    } else if (mime.startsWith('image/')) {
      setLoadingPreview(true);
      try {
        const blobUrl = await driveClient.getPreviewBlobUrl(item.id);
        setPreviewImageItem({ id: item.id, name: item.name, url: blobUrl });
      } catch (err: any) {
        handleDownload(item);
      } finally {
        setLoadingPreview(false);
      }
    } else if (mime.includes('text/') || name.endsWith('.txt')) {
      setLoadingPreview(true);
      try {
        const blobUrl = await driveClient.getPreviewBlobUrl(item.id);
        const resp = await fetch(blobUrl);
        const text = await resp.text();
        setPreviewTextItem({ name: item.name, content: text });
      } catch (err: any) {
        showToast('Operation failed', 'error');
      } finally {
        setLoadingPreview(false);
      }
    } else if (item.webViewLink) {
      window.open(item.webViewLink, '_blank', 'noopener,noreferrer');
    } else {
      handleDownload(item);
    }
  };

  // File Upload Handling
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress({
        uploading: true,
        fileName: file.name,
        percent: 0,
      });

      try {
        const { promise, cancel } = driveClient.uploadFile(
          file,
          currentFolderId,
          (percent) => {
            setUploadProgress(prev => (prev ? { ...prev, percent } : null));
          }
        );
        uploadCancelRef.current = cancel;

        await promise;
        showToast('Uploaded', 'success');
      } catch (err: any) {
        showToast(err.message || 'Operation failed', 'error');
      } finally {
        uploadCancelRef.current = null;
      }
    }

    setUploadProgress(null);
    loadFolderItems(currentFolderId);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      handleFileSelect(e.dataTransfer.files);
    }
  };

  // Consistently sort current folder's items:
  // Folders: Priority categories 1-6 first, custom folders middle, Other Documents at bottom.
  // Files: Newest modified date first, alphabetical fallback.
  const { folderItems, fileItems } = useMemo(() => {
    const rawFolders = items.filter(item => item.isFolder);
    const rawFiles = items.filter(item => !item.isFolder);

    return {
      folderItems: sortFolders(rawFolders),
      fileItems: sortFiles(rawFiles),
    };
  }, [items]);

  // Format file size
  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Format date
  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Helper to get MIME icon
  const getFileIcon = (item: DriveItem) => {
    const mime = item.mimeType?.toLowerCase() || '';
    const name = item.name.toLowerCase();

    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      return <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-red-500 shrink-0" />;
    }
    if (mime.startsWith('image/')) {
      return <FileImage className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500 shrink-0" />;
    }
    if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) {
      return <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500 shrink-0" />;
    }
    if (mime.includes('document') || mime.includes('word')) {
      return <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500 shrink-0" />;
    }
    if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
      return <FileArchive className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500 shrink-0" />;
    }
    if (mime.includes('text/')) {
      return <FileCode className="w-5 h-5 sm:w-6 sm:h-6 text-slate-600 shrink-0" />;
    }
    return <FileIcon className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400 shrink-0" />;
  };

  // 1. Loading state during auth check
  if (authLoading || checkingStatus) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <h3 className="text-lg font-bold text-navy">Checking Documents</h3>
        <p className="text-sm text-slate-500 mt-1">Verifying your Google Drive authorization...</p>
      </div>
    );
  }

  // 2. Unauthenticated state -> Prompt login with return URL
  if (!authUser) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center p-4">
        <SEO
          title="Sign In to Access My Documents - India Cyber Cafe"
          description="Access your personal Google Drive document manager. Sign in securely with your Google account."
        />
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-slate-200 shadow-xl text-center space-y-6">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl mx-auto flex items-center justify-center">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-navy">Sign In Required</h1>
            <p className="text-sm text-slate-600 mt-2">
              Sign in with your Google account to securely manage your personal documents directly in your Google Drive.
            </p>
          </div>
          <button
            onClick={() => navigate(`/login?redirect=${encodeURIComponent('/my-documents/')}`)}
            className="w-full btn-primary py-3.5 rounded-xl font-bold text-sm shadow-md"
          >
            Sign In with Google
          </button>
          <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Zero permanent document storage on ICC servers</span>
          </div>
        </div>
      </div>
    );
  }

  // 3. Authenticated but Drive NOT Connected -> Connect Google Drive Screen
  if (!driveStatus?.connected) {
    const loggedInEmail = user?.email || authUser?.email || '';
    const hasMismatch = driveStatus?.accountMismatch;

    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <SEO
          title="Connect Google Drive - My Documents - India Cyber Cafe"
          description="Connect your personal Google Drive to securely manage your documents with India Cyber Cafe."
        />
        <div className="max-w-xl w-full bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xl space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-50 to-orange-100 border border-amber-200 shadow-sm">
              <HardDrive className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-navy">Connect Google Drive</h1>
            <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              Connect your personal Google Drive to securely manage your documents.
            </p>
          </div>

          {/* Account Mismatch Alert Banner */}
          {hasMismatch && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Account Mismatch</p>
                <p className="mt-0.5">
                  Please connect Google Drive using your logged-in Google account (<strong>{loggedInEmail}</strong>). Connecting with a different account is not permitted.
                </p>
              </div>
            </div>
          )}

          {/* Account Indicator */}
          {loggedInEmail && (
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 flex items-center justify-between text-xs sm:text-sm">
              <span className="text-slate-500">Logged in account:</span>
              <span className="font-bold text-navy truncate max-w-[240px]">{loggedInEmail}</span>
            </div>
          )}

          {/* Benefits list */}
          <div className="bg-slate-50 rounded-2xl p-5 sm:p-6 border border-slate-200/80 space-y-3.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Benefits:</h2>
            <ul className="space-y-3 text-xs sm:text-sm text-slate-700">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Your own Google Drive storage.</strong> All documents remain strictly under your personal Google account.</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Easy document management.</strong> Automatic categorized folders for Identity, Education, Banking, and Certificates.</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Upload and organize documents.</strong> Drag-and-drop, rename, move, and instant mobile file pickers.</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Access your documents through your Google account.</strong> Disconnecting or logging out leaves your Google Drive files 100% intact.</span>
              </li>
            </ul>
          </div>

          {/* Transparency & Security Callout */}
          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 text-xs text-blue-900 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-navy">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span>Limited Scope & Privacy Guarantee</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              We request only <code className="bg-white px-1.5 py-0.5 rounded text-navy border border-blue-200 font-mono text-[11px]">drive.file</code> permission to manage files created through India Cyber Cafe. We never access, read, or alter your unrelated personal Drive files.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleConnectDrive}
              className="w-full btn-primary py-4 rounded-xl font-bold text-sm sm:text-base shadow-lg flex items-center justify-center gap-3 cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-transform"
            >
              <HardDrive className="w-5 h-5" />
              <span>Connect Google Drive</span>
            </button>
            <p className="text-[11px] text-center text-slate-400">
              By connecting, you agree to our{' '}
              <Link to="/legal/privacy" className="text-primary hover:underline">Privacy Policy</Link>{' '}
              and{' '}
              <Link to="/legal/terms" className="text-primary hover:underline">Terms & Conditions</Link>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 4. Drive IS Connected -> Simplified Header Document Manager Dashboard
  return (
    <div className="space-y-4 pb-20" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <SEO
        title="My Documents - India Cyber Cafe"
        description="Manage your personal documents, certificates, and ID proofs securely stored in your personal Google Drive."
      />

      {/* Hidden file input for uploads */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFileSelect(e.target.files)}
        multiple
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.csv,.ppt,.pptx,.zip"
      />

      {/* Drag Over Overlay */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2500] bg-primary/20 backdrop-blur-sm border-4 border-dashed border-primary flex flex-col items-center justify-center p-6 text-navy"
          >
            <div className="bg-white rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center">
              <Upload className="w-16 h-16 text-primary animate-bounce mb-3" />
              <h3 className="text-xl font-extrabold">Drop Files Here to Upload</h3>
              <p className="text-sm text-slate-500 mt-1">
                Files will be uploaded directly to your Google Drive.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1. SIMPLIFIED HEADER WITH ADVANCED RECURSIVE SEARCH (Search on Left + Three-dot Menu on Right) */}
      <div ref={searchContainerRef} className="relative z-30">
        <div className="bg-white rounded-2xl p-2.5 sm:p-3 border border-slate-200/90 shadow-sm flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search all documents and folders..."
              value={searchQuery}
              onFocus={() => setIsSearchFocused(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchFocused(true);
              }}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-navy placeholder:text-slate-400 focus:outline-none focus:border-primary focus:bg-white transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setIsSearchFocused(false);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-navy cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Three-dot Action Menu Trigger */}
          <button
            type="button"
            onClick={() => setIsActionMenuOpen(true)}
            title="Actions"
            className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors cursor-pointer shrink-0"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>

        {/* 2. ADVANCED LIVE SEARCH SUGGESTIONS OVERLAY */}
        <AnimatePresence>
          {isSearchFocused && searchQuery.trim().length >= 2 && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden z-50 flex flex-col max-h-[75vh]"
            >
              {/* Header Status Bar */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200/80 text-xs">
                <span className="font-semibold text-slate-500">
                  {isSearching ? (
                    <span className="flex items-center gap-2 text-primary font-bold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Searching across all folders...
                    </span>
                  ) : (
                    <span>
                      Found <strong>{searchResults.length}</strong> matching item{searchResults.length === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setIsSearchFocused(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-navy hover:bg-slate-200/60 transition-colors cursor-pointer"
                  title="Close search results"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Results List */}
              <div className="overflow-y-auto divide-y divide-slate-100 p-1">
                {isSearching && searchResults.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center p-4">
                    <Loader2 className="w-6 h-6 text-primary animate-spin mb-2" />
                    <p className="text-xs font-semibold text-slate-600">
                      Searching entire My Documents hierarchy...
                    </p>
                  </div>
                ) : searchResults.length === 0 ? (
                  /* Clear Empty State */
                  <div className="py-12 px-6 text-center space-y-2">
                    <Search className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-sm font-bold text-navy">No documents or folders found</p>
                    <p className="text-xs text-slate-500 max-w-xs mx-auto">
                      No items matched &ldquo;{searchQuery}&rdquo; across all categories and subfolders.
                    </p>
                  </div>
                ) : (
                  searchResults.map(item => (
                    <div
                      key={item.id}
                      className="p-3 hover:bg-slate-50 rounded-xl flex items-center justify-between gap-3 transition-colors cursor-pointer group"
                      onClick={() => {
                        if (item.isFolder) {
                          handleNavigateToFolder(item.id, item.breadcrumbs);
                        } else {
                          handleGoToFileLocation(item);
                        }
                      }}
                    >
                      {/* Left: Icon & Info */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                          {item.isFolder ? (
                            <Folder className="w-5 h-5 text-amber-500 fill-amber-500" />
                          ) : (
                            getFileIcon(item)
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-navy text-xs sm:text-sm truncate group-hover:text-primary transition-colors">
                              {item.name}
                            </p>
                            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {item.isFolder ? 'Folder' : formatBytes(item.size)}
                            </span>
                          </div>
                          {/* Complete Folder Path */}
                          <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5 truncate">
                            <FolderOpen className="w-3 h-3 shrink-0 text-slate-400" />
                            <span className="truncate" title={item.folderPath}>
                              {item.folderPath || 'My Documents'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Quick action buttons */}
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {item.isFolder ? (
                          <button
                            type="button"
                            onClick={() => handleNavigateToFolder(item.id, item.breadcrumbs)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-primary hover:text-white text-navy text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Open</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handlePreview(item)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-navy hover:bg-slate-200 transition-colors cursor-pointer"
                              title="Preview document"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownload(item)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-navy hover:bg-slate-200 transition-colors cursor-pointer"
                              title="Download document"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleGoToFileLocation(item)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-navy hover:bg-slate-200 transition-colors cursor-pointer"
                              title="Go to file location"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Upload Progress Bar (if active) */}
      {uploadProgress && (
        <div className="p-3.5 bg-orange-50 border border-orange-200 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-navy truncate">
                Uploading {uploadProgress.fileName}...
              </p>
              <div className="w-full bg-orange-200/60 h-1.5 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-200"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-bold text-primary">{uploadProgress.percent}%</span>
            {uploadCancelRef.current && (
              <button
                type="button"
                onClick={() => uploadCancelRef.current?.()}
                className="p-1 hover:bg-orange-200 rounded text-slate-600"
                title="Cancel upload"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Breadcrumb Navigation when inside subfolders */}
      {breadcrumbs.length > 1 && (
        <div className="flex items-center gap-1.5 text-xs text-slate-600 overflow-x-auto py-1 scrollbar-none px-1">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.id}>
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(idx)}
                  disabled={isLast}
                  className={`whitespace-nowrap transition-colors ${
                    isLast
                      ? 'font-bold text-navy cursor-default'
                      : 'text-slate-500 hover:text-primary cursor-pointer'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      {loadingItems ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
          <p className="text-sm font-semibold text-navy">Loading documents...</p>
        </div>
      ) : loadError ? (
        <div className="p-8 bg-white rounded-3xl border border-red-200 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <div>
            <h3 className="font-bold text-navy text-base">Unable to Load Documents</h3>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">{loadError}</p>
          </div>
          <button
            onClick={() => loadFolderItems(currentFolderId)}
            className="btn-primary text-xs px-4 py-2.5 rounded-xl inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try Again</span>
          </button>
        </div>
      ) : items.length === 0 ? (
        /* Empty Folder State */
        <div className="py-16 bg-white rounded-3xl border border-slate-200/80 p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto text-slate-400">
            <FolderPlus className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-navy">This folder is empty</h3>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Upload your certificates, marksheets, identity cards, or create a new subfolder.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-primary text-xs px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-sm cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Upload Document</span>
            </button>
            <button
              onClick={() => setIsNewFolderOpen(true)}
              className="bg-slate-100 hover:bg-slate-200 text-navy text-xs font-semibold px-4 py-2.5 rounded-xl flex items-center gap-2 border border-slate-200 transition-colors cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 text-primary" />
              <span>New Folder</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* FOLDERS SECTION: Consistent Category Priority (Identity, Education, Govt, Cert, Bank, Personal, Custom, Other) */}
          {folderItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                Folders ({folderItems.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                {folderItems.map(folder => (
                  <div
                    key={folder.id}
                    className="group bg-white rounded-2xl p-3.5 sm:p-4 border border-slate-200 hover:border-primary/50 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer relative"
                    onClick={() => handleOpenFolder(folder)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 group-hover:bg-amber-100 flex items-center justify-center text-amber-600 transition-colors">
                        <Folder className="w-5 h-5 fill-amber-500 text-amber-600" />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveItemForMenu(folder);
                        }}
                        className="p-1 rounded-lg text-slate-400 hover:text-navy hover:bg-slate-100 cursor-pointer"
                        title="Folder options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="mt-3">
                      <h4 className="font-bold text-navy text-xs sm:text-sm truncate" title={folder.name}>
                        {folder.name}
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {formatDate(folder.modifiedTime)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FILES SECTION: Consistent date/name ordering */}
          {fileItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                Files ({fileItems.length})
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {fileItems.map(file => (
                  <div
                    key={file.id}
                    className="group bg-white rounded-2xl p-4 border border-slate-200 hover:border-primary/50 hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center cursor-pointer"
                        onClick={() => handlePreview(file)}
                      >
                        {getFileIcon(file)}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveItemForMenu(file)}
                        className="p-1 rounded-lg text-slate-400 hover:text-navy hover:bg-slate-100 cursor-pointer"
                        title="File options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="mt-3">
                      <h4
                        className="font-bold text-navy text-xs sm:text-sm truncate cursor-pointer hover:text-primary transition-colors"
                        title={file.name}
                        onClick={() => handlePreview(file)}
                      >
                        {file.name}
                      </h4>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                        <span>{formatBytes(file.size)}</span>
                        <span>{formatDate(file.modifiedTime)}</span>
                      </div>
                    </div>

                    {/* Quick action buttons on card */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <button
                        type="button"
                        onClick={() => handlePreview(file)}
                        className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(file)}
                        className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. FLOATING PLUS BUTTON: OPENS EXACT SAME ACTION MENU AS THREE-DOT BUTTON */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          type="button"
          onClick={() => setIsActionMenuOpen(true)}
          className="w-14 h-14 rounded-full bg-primary text-white shadow-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
          title="Actions"
        >
          <Plus className="w-7 h-7" />
        </button>
      </div>

      {/* UNIFIED ACTION MENU MODAL / SHEET (Triggered by Header Three-Dot & Floating Plus Button) */}
      <AnimatePresence>
        {isActionMenuOpen && (
          <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ y: 120, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 120, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h3 className="font-bold text-navy text-sm">Document Actions</h3>
                <button
                  type="button"
                  onClick={() => setIsActionMenuOpen(false)}
                  className="p-1 rounded-full text-slate-400 hover:text-navy cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1.5 text-sm font-semibold text-slate-700">
                <button
                  type="button"
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Upload className="w-5 h-5 text-primary" />
                  <span>Upload Files</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    setIsNewFolderOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <FolderPlus className="w-5 h-5 text-primary" />
                  <span>New Folder</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    loadFolderItems(currentFolderId);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <RefreshCw className="w-5 h-5 text-slate-500" />
                  <span>Refresh Documents</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    setIsDisconnectOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 text-red-600 transition-colors text-left cursor-pointer"
                >
                  <LogOut className="w-5 h-5 text-red-500" />
                  <span>Disconnect Drive</span>
                </button>
              </div>

              {/* Storage Quota display if available */}
              {storageQuota?.quota?.limit && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 px-1">
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                    <span>Google Drive Storage</span>
                  </div>
                  <span className="font-semibold text-slate-700">
                    {formatBytes(storageQuota.quota.usage)} of {formatBytes(storageQuota.quota.limit)}
                  </span>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Item Action Sheet / Context Modal */}
      <AnimatePresence>
        {activeItemForMenu && (
          <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    {activeItemForMenu.isFolder ? (
                      <Folder className="w-4 h-4 text-amber-500 fill-amber-500" />
                    ) : (
                      getFileIcon(activeItemForMenu)
                    )}
                  </div>
                  <h4 className="font-bold text-sm text-navy truncate">
                    {activeItemForMenu.name}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveItemForMenu(null)}
                  className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-navy cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1 text-sm font-semibold text-slate-700">
                {activeItemForMenu.isFolder ? (
                  <button
                    type="button"
                    onClick={() => {
                      const f = activeItemForMenu;
                      setActiveItemForMenu(null);
                      handleOpenFolder(f);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                  >
                    <Folder className="w-4 h-4 text-slate-500" />
                    <span>Open Folder</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const f = activeItemForMenu;
                        setActiveItemForMenu(null);
                        handlePreview(f);
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                    >
                      <Eye className="w-4 h-4 text-slate-500" />
                      <span>Preview</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const f = activeItemForMenu;
                        setActiveItemForMenu(null);
                        handleDownload(f);
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-slate-500" />
                      <span>Download</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const f = activeItemForMenu;
                    setActiveItemForMenu(null);
                    setItemToRename(f);
                    setRenameValue(f.name);
                    setIsRenameOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Edit2 className="w-4 h-4 text-slate-500" />
                  <span>Rename</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const f = activeItemForMenu;
                    setActiveItemForMenu(null);
                    openMoveModal(f);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Move className="w-4 h-4 text-slate-500" />
                  <span>Move</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const f = activeItemForMenu;
                    setActiveItemForMenu(null);
                    setItemToDelete(f);
                    setIsDeleteOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 text-red-600 transition-colors text-left cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                  <span>Move to Trash</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Folder Modal */}
      <AnimatePresence>
        {isNewFolderOpen && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-navy flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-primary" />
                  <span>New Folder</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsNewFolderOpen(false)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-400 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateFolder} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Folder Name
                  </label>
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="e.g. Identity Documents, 10th Marksheet"
                    required
                    autoFocus
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-navy focus:outline-none focus:border-primary focus:bg-white"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsNewFolderOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingFolder || !newFolderName.trim()}
                    className="btn-primary text-xs px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 cursor-pointer"
                  >
                    {creatingFolder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Create Folder</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Rename Modal */}
      <AnimatePresence>
        {isRenameOpen && itemToRename && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-navy flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-primary" />
                  <span>Rename {itemToRename.isFolder ? 'Folder' : 'File'}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsRenameOpen(false)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-400 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleRename} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    required
                    autoFocus
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-navy focus:outline-none focus:border-primary focus:bg-white"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsRenameOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={renaming || !renameValue.trim()}
                    className="btn-primary text-xs px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 cursor-pointer"
                  >
                    {renaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Rename</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Move Modal */}
      <AnimatePresence>
        {isMoveOpen && itemToMove && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-navy flex items-center gap-2">
                  <Move className="w-5 h-5 text-primary" />
                  <span>Move "{itemToMove.name}"</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsMoveOpen(false)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-400 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Select destination folder in My Documents:
                </p>

                {loadingMoveFolders ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-1.5 border border-slate-200 rounded-2xl p-2">
                    <button
                      type="button"
                      onClick={() => setMoveDestinationId(driveStatus?.documentsFolderId || 'root')}
                      className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl text-left text-xs font-semibold transition-colors cursor-pointer ${
                        moveDestinationId === (driveStatus?.documentsFolderId || 'root')
                          ? 'bg-primary text-white'
                          : 'hover:bg-slate-100 text-navy'
                      }`}
                    >
                      <HardDrive className="w-4 h-4 shrink-0" />
                      <span>My Documents (Root)</span>
                    </button>

                    {availableFolders.map(folder => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setMoveDestinationId(folder.id)}
                        className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl text-left text-xs font-semibold transition-colors cursor-pointer ${
                          moveDestinationId === folder.id
                            ? 'bg-primary text-white'
                            : 'hover:bg-slate-100 text-navy'
                        }`}
                      >
                        <Folder className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsMoveOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleMove}
                  disabled={moving || !moveDestinationId}
                  className="btn-primary text-xs px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 cursor-pointer"
                >
                  {moving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Move Here</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete / Move to Trash Confirmation Modal */}
      <AnimatePresence>
        {isDeleteOpen && itemToDelete && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4"
            >
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-lg font-bold text-navy">Move to Trash?</h3>
                <p className="text-xs sm:text-sm text-slate-600">
                  This item will be moved to your Google Drive Trash.
                </p>
                <p className="text-xs font-semibold text-slate-700 bg-slate-100 p-2 rounded-lg mt-2 truncate">
                  "{itemToDelete.name}"
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsDeleteOpen(false)}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-md cursor-pointer"
                >
                  {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Move to Trash</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Disconnect Google Drive Modal */}
      <AnimatePresence>
        {isDisconnectOpen && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4 text-center"
            >
              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto">
                <LogOut className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-navy">Disconnect Google Drive?</h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Disconnecting revokes India Cyber Cafe's access. All your documents and folders remain completely safe and untouched in your personal Google Drive.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsDisconnectOpen(false)}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectDrive}
                  disabled={disconnecting}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-md cursor-pointer"
                >
                  {disconnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Disconnect Drive</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- PREVIEWS --- */}

      {/* PDF Preview Modal: Isolated for My Documents with authenticated fetch */}
      {previewPdfItem && (
        <MyDocumentsPdfViewerModal
          fileId={previewPdfItem.id}
          fileName={previewPdfItem.name}
          onClose={() => setPreviewPdfItem(null)}
        />
      )}

      {/* Image Preview Modal */}
      {previewImageItem && (
        <div className="fixed inset-0 z-[3000] bg-black/90 flex flex-col items-center justify-between p-4">
          <div className="w-full max-w-4xl flex items-center justify-between text-white pb-3">
            <h3 className="font-bold text-sm sm:text-base truncate">{previewImageItem.name}</h3>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (previewImageItem.url) {
                    const a = document.createElement('a');
                    a.href = previewImageItem.url;
                    a.download = previewImageItem.name;
                    a.click();
                  }
                }}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="Download Image"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (previewImageItem.url) window.URL.revokeObjectURL(previewImageItem.url);
                  setPreviewImageItem(null);
                }}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-2 max-h-[85vh] w-full">
            <img
              src={previewImageItem.url}
              alt={previewImageItem.name}
              className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Text Preview Modal */}
      {previewTextItem && (
        <div className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-navy truncate">{previewTextItem.name}</h3>
              <button
                type="button"
                onClick={() => setPreviewTextItem(null)}
                className="p-1 rounded-full text-slate-400 hover:text-navy cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="mt-4 flex-1 overflow-auto bg-slate-50 p-4 rounded-xl text-xs font-mono text-slate-800 whitespace-pre-wrap">
              {previewTextItem.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
