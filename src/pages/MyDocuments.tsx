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
  Grid,
  List,
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
  ChevronLeft,
  X,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Lock,
  ArrowUpDown,
  Filter,
  Plus,
  Loader2,
  FileCheck,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { driveClient, DriveStatusResponse, DriveQuotaResponse } from '../services/driveClient';
import { DriveItem } from '../server/driveService';
import { showToast } from '../components/Toast';
import { PdfViewerModal } from '../components/PdfViewerModal';
import { SEO } from '../components/SEO';

interface BreadcrumbItem {
  id: string;
  name: string;
}

type SortOption = 'name_asc' | 'name_desc' | 'date_desc' | 'date_asc' | 'size_desc' | 'size_asc';
type FilterCategory = 'all' | 'folder' | 'pdf' | 'image' | 'document' | 'spreadsheet';

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

  // Search & Filter & Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    return (localStorage.getItem('icc_drive_sort') as SortOption) || 'date_desc';
  });
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('icc_drive_view') as 'grid' | 'list') || 'grid';
  });

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

  // Mobile Bottom Sheet for Main Actions
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Check URL parameters (e.g. from OAuth callback or errors)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const errorParam = params.get('error');
    const connectedParam = params.get('connected');

    if (errorParam) {
      showToast(decodeURIComponent(errorParam), 'error');
      // Clean query params from URL
      navigate('/my-documents/', { replace: true });
    } else if (connectedParam === '1') {
      showToast('Google Drive connected successfully!', 'success');
      navigate('/my-documents/', { replace: true });
    }
  }, [location.search, navigate]);

  // Check status on mount or auth change
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
        // Fetch storage quota
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

  // Save viewMode & sort preference
  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('icc_drive_view', mode);
  };

  const handleSortChange = (sort: SortOption) => {
    setSortBy(sort);
    localStorage.setItem('icc_drive_sort', sort);
  };

  // Connect Drive action
  const handleConnectDrive = async () => {
    try {
      showToast('Redirecting to Google authorization...', 'info');
      const { authUrl } = await driveClient.getConnectUrl('/my-documents/');
      window.location.href = authUrl;
    } catch (err: any) {
      showToast(err.message || 'Failed to initiate Google Drive connection', 'error');
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
      showToast('Google Drive disconnected. Your files remain safe in your Google Drive.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to disconnect Google Drive', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  // Open a folder
  const handleOpenFolder = (folder: DriveItem) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
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
        showToast(`Folder "${newFolderName.trim()}" created successfully`, 'success');
        setIsNewFolderOpen(false);
        setNewFolderName('');
        loadFolderItems(currentFolderId);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to create folder', 'error');
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
      showToast('Item renamed successfully', 'success');
      setIsRenameOpen(false);
      setItemToRename(null);
      loadFolderItems(currentFolderId);
    } catch (err: any) {
      showToast(err.message || 'Failed to rename item', 'error');
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
      // List root folder categories and subfolders for move targets
      const rootRes = await driveClient.listFiles(driveStatus?.documentsFolderId || 'root');
      if (rootRes.success) {
        const folders = rootRes.files.filter(f => f.isFolder && f.id !== item.id);
        setAvailableFolders(folders);
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
      showToast('Item moved successfully', 'success');
      setIsMoveOpen(false);
      setItemToMove(null);
      loadFolderItems(currentFolderId);
    } catch (err: any) {
      showToast(err.message || 'Failed to move item', 'error');
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
      showToast(`"${itemToDelete.name}" moved to Google Drive Trash`, 'success');
      setIsDeleteOpen(false);
      setItemToDelete(null);
      loadFolderItems(currentFolderId);
    } catch (err: any) {
      showToast(err.message || 'Failed to move item to Trash', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Download item
  const handleDownload = async (item: DriveItem) => {
    try {
      showToast(`Preparing "${item.name}" for download...`, 'info');
      await driveClient.triggerFileDownload(item.id, item.name);
    } catch (err: any) {
      showToast(err.message || 'Failed to download file', 'error');
    }
  };

  // Preview item
  const handlePreview = async (item: DriveItem) => {
    const mime = item.mimeType?.toLowerCase() || '';
    const name = item.name.toLowerCase();

    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      // Re-use PdfViewerModal!
      setPreviewPdfItem({ id: item.id, name: item.name });
    } else if (mime.startsWith('image/')) {
      setLoadingPreview(true);
      try {
        const blobUrl = await driveClient.getPreviewBlobUrl(item.id);
        setPreviewImageItem({ id: item.id, name: item.name, url: blobUrl });
      } catch (err: any) {
        showToast('Unable to preview image. Downloading instead...', 'info');
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
        showToast('Unable to preview text file.', 'error');
      } finally {
        setLoadingPreview(false);
      }
    } else if (item.webViewLink) {
      // Google Docs, Sheets, Slides or Office -> open in official Google Drive preview tab
      window.open(item.webViewLink, '_blank', 'noopener,noreferrer');
    } else {
      showToast('No in-app preview for this file type. Starting download...', 'info');
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
        showToast(`Uploaded "${file.name}" to your Google Drive`, 'success');
      } catch (err: any) {
        showToast(err.message || `Failed to upload "${file.name}"`, 'error');
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

  // Filtered and sorted items
  const { folderItems, fileItems } = useMemo(() => {
    let filtered = items;

    // Apply text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(item => item.name.toLowerCase().includes(q));
    }

    // Apply category filter
    if (filterCategory !== 'all') {
      if (filterCategory === 'folder') {
        filtered = filtered.filter(item => item.isFolder);
      } else if (filterCategory === 'pdf') {
        filtered = filtered.filter(item => !item.isFolder && (item.mimeType === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')));
      } else if (filterCategory === 'image') {
        filtered = filtered.filter(item => !item.isFolder && item.mimeType?.startsWith('image/'));
      } else if (filterCategory === 'document') {
        filtered = filtered.filter(item => !item.isFolder && (item.mimeType?.includes('document') || item.mimeType?.includes('word') || item.mimeType?.includes('text')));
      } else if (filterCategory === 'spreadsheet') {
        filtered = filtered.filter(item => !item.isFolder && (item.mimeType?.includes('sheet') || item.mimeType?.includes('excel') || item.mimeType?.includes('csv')));
      }
    }

    // Sort items
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      if (sortBy === 'name_desc') return b.name.localeCompare(a.name);
      if (sortBy === 'date_desc') {
        const tA = new Date(a.modifiedTime || 0).getTime();
        const tB = new Date(b.modifiedTime || 0).getTime();
        return tB - tA;
      }
      if (sortBy === 'date_asc') {
        const tA = new Date(a.modifiedTime || 0).getTime();
        const tB = new Date(b.modifiedTime || 0).getTime();
        return tA - tB;
      }
      if (sortBy === 'size_desc') return (b.size || 0) - (a.size || 0);
      if (sortBy === 'size_asc') return (a.size || 0) - (b.size || 0);
      return 0;
    });

    const folders = sorted.filter(item => item.isFolder);
    const files = sorted.filter(item => !item.isFolder);

    return { folderItems: folders, fileItems: files };
  }, [items, searchQuery, filterCategory, sortBy]);

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
      return <FileText className="w-6 h-6 text-red-500" />;
    }
    if (mime.startsWith('image/')) {
      return <FileImage className="w-6 h-6 text-blue-500" />;
    }
    if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) {
      return <FileSpreadsheet className="w-6 h-6 text-emerald-500" />;
    }
    if (mime.includes('document') || mime.includes('word')) {
      return <FileText className="w-6 h-6 text-indigo-500" />;
    }
    if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
      return <FileArchive className="w-6 h-6 text-amber-500" />;
    }
    if (mime.includes('text/')) {
      return <FileCode className="w-6 h-6 text-slate-600" />;
    }
    return <FileIcon className="w-6 h-6 text-slate-400" />;
  };

  // 1. Loading state during auth check
  if (authLoading || checkingStatus) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <h3 className="text-lg font-bold text-navy">Checking My Documents</h3>
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

  // 3. Authenticated but Drive NOT Connected -> Premium Connect Google Drive Screen
  if (!driveStatus?.connected) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <SEO
          title="Connect Google Drive - My Documents - India Cyber Cafe"
          description="Connect your personal Google Drive to securely manage your documents with India Cyber Cafe."
        />
        <div className="max-w-xl w-full bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xl space-y-8">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-50 to-orange-100 border border-amber-200 shadow-sm">
              <HardDrive className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-navy">Connect Google Drive</h1>
            <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              Connect your personal Google Drive to securely manage your documents.
            </p>
          </div>

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

  // 4. Drive IS Connected -> Full Document Manager Dashboard
  return (
    <div className="space-y-6 pb-12" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <SEO
        title="My Documents - Personal Google Drive Manager - India Cyber Cafe"
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
                Files will be uploaded directly to current folder in your Google Drive.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Dashboard Banner */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/90 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-navy">My Documents</h1>
                <p className="text-xs text-slate-500">
                  Personal Document Management powered by Google Drive
                </p>
              </div>
            </div>
          </div>

          {/* Connection badge & Storage quota */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="truncate max-w-[180px] sm:max-w-[220px]">
                {driveStatus.googleEmail || user?.email}
              </span>
            </div>

            {storageQuota?.quota?.limit && (
              <div className="hidden sm:flex items-center gap-2 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full text-xs text-slate-700">
                <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                <span>
                  {formatBytes(storageQuota.quota.usage)} of {formatBytes(storageQuota.quota.limit)}
                </span>
              </div>
            )}

            {/* Desktop Action Buttons */}
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-primary text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Upload</span>
              </button>
              <button
                onClick={() => setIsNewFolderOpen(true)}
                className="bg-slate-100 hover:bg-slate-200 text-navy text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5 border border-slate-200 transition-colors cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-primary" />
                <span>New Folder</span>
              </button>
              <button
                onClick={() => loadFolderItems(currentFolderId)}
                title="Refresh"
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer border border-slate-200"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsDisconnectOpen(true)}
                title="Disconnect Google Drive"
                className="p-2 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors cursor-pointer border border-slate-200"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

            {/* Mobile Three-dot button */}
            <div className="md:hidden ml-auto">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2 rounded-xl bg-slate-100 text-slate-700 border border-slate-200"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>
          </div>
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

        {/* Search, Filter & View Controls */}
        <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-100">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search documents or folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-navy placeholder:text-slate-400 focus:outline-none focus:border-primary focus:bg-white transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-navy"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort & Grid/List view buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value as SortOption)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="date_desc">Modified (Newest)</option>
              <option value="date_asc">Modified (Oldest)</option>
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
              <option value="size_desc">Size (Largest)</option>
              <option value="size_asc">Size (Smallest)</option>
            </select>

            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
              <button
                onClick={() => handleViewModeChange('grid')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'grid' ? 'bg-white shadow-sm text-navy' : 'text-slate-500 hover:text-navy'
                }`}
                title="Grid view"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleViewModeChange('list')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'list' ? 'bg-white shadow-sm text-navy' : 'text-slate-500 hover:text-navy'
                }`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
          {[
            { id: 'all', label: 'All Items' },
            { id: 'folder', label: 'Folders' },
            { id: 'pdf', label: 'PDFs' },
            { id: 'image', label: 'Images' },
            { id: 'document', label: 'Documents' },
            { id: 'spreadsheet', label: 'Spreadsheets' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterCategory(f.id as FilterCategory)}
              className={`px-3 py-1 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer ${
                filterCategory === f.id
                  ? 'bg-navy text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-1.5 text-xs text-slate-600 overflow-x-auto py-1 scrollbar-none">
        {breadcrumbs.map((crumb, idx) => {
          const isLast = idx === breadcrumbs.length - 1;
          return (
            <React.Fragment key={crumb.id}>
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
              <button
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
              className="btn-primary text-xs px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-sm"
            >
              <Upload className="w-4 h-4" />
              <span>Upload Document</span>
            </button>
            <button
              onClick={() => setIsNewFolderOpen(true)}
              className="bg-slate-100 hover:bg-slate-200 text-navy text-xs font-semibold px-4 py-2.5 rounded-xl flex items-center gap-2 border border-slate-200 transition-colors"
            >
              <FolderPlus className="w-4 h-4 text-primary" />
              <span>New Folder</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* FOLDERS SECTION */}
          {folderItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
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
                        className="p-1 rounded-lg text-slate-400 hover:text-navy hover:bg-slate-100"
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

          {/* FILES SECTION */}
          {fileItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Files ({fileItems.length})
              </h3>

              {viewMode === 'grid' ? (
                /* Grid View */
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
                          className="p-1 rounded-lg text-slate-400 hover:text-navy hover:bg-slate-100"
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
              ) : (
                /* List View */
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {fileItems.map(file => (
                    <div
                      key={file.id}
                      className="p-3 sm:p-4 hover:bg-slate-50 flex items-center justify-between gap-3 transition-colors"
                    >
                      <div
                        className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                        onClick={() => handlePreview(file)}
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
                          {getFileIcon(file)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-navy text-xs sm:text-sm truncate hover:text-primary transition-colors">
                            {file.name}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {formatDate(file.modifiedTime)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-slate-500 hidden sm:inline">
                          {formatBytes(file.size)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handlePreview(file)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-navy hover:bg-slate-200 transition-colors"
                          title="Preview"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownload(file)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-navy hover:bg-slate-200 transition-colors"
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveItemForMenu(file)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-navy hover:bg-slate-200 transition-colors"
                          title="More options"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating Action Button on Mobile */}
      <div className="md:hidden fixed bottom-6 right-6 z-40">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-14 h-14 rounded-full bg-primary text-white shadow-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          title="Upload File"
        >
          <Plus className="w-7 h-7" />
        </button>
      </div>

      {/* --- MODALS & CONTEXT ACTIONS --- */}

      {/* Item Action Sheet / Menu Modal */}
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
                  onClick={() => setActiveItemForMenu(null)}
                  className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-navy"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1 text-sm font-semibold text-slate-700">
                {activeItemForMenu.isFolder ? (
                  <button
                    onClick={() => {
                      const f = activeItemForMenu;
                      setActiveItemForMenu(null);
                      handleOpenFolder(f);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
                  >
                    <Folder className="w-4 h-4 text-slate-500" />
                    <span>Open Folder</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const f = activeItemForMenu;
                        setActiveItemForMenu(null);
                        handlePreview(f);
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
                    >
                      <Eye className="w-4 h-4 text-slate-500" />
                      <span>Preview</span>
                    </button>
                    <button
                      onClick={() => {
                        const f = activeItemForMenu;
                        setActiveItemForMenu(null);
                        handleDownload(f);
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
                    >
                      <Download className="w-4 h-4 text-slate-500" />
                      <span>Download</span>
                    </button>
                  </>
                )}

                <button
                  onClick={() => {
                    const f = activeItemForMenu;
                    setActiveItemForMenu(null);
                    setItemToRename(f);
                    setRenameValue(f.name);
                    setIsRenameOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
                >
                  <Edit2 className="w-4 h-4 text-slate-500" />
                  <span>Rename</span>
                </button>

                <button
                  onClick={() => {
                    const f = activeItemForMenu;
                    setActiveItemForMenu(null);
                    openMoveModal(f);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
                >
                  <Move className="w-4 h-4 text-slate-500" />
                  <span>Move</span>
                </button>

                <button
                  onClick={() => {
                    const f = activeItemForMenu;
                    setActiveItemForMenu(null);
                    setItemToDelete(f);
                    setIsDeleteOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 text-red-600 transition-colors text-left"
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
                  onClick={() => setIsNewFolderOpen(false)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-400"
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
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingFolder || !newFolderName.trim()}
                    className="btn-primary text-xs px-5 py-2.5 rounded-xl font-bold flex items-center gap-2"
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
                  onClick={() => setIsRenameOpen(false)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-400"
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
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={renaming || !renameValue.trim()}
                    className="btn-primary text-xs px-5 py-2.5 rounded-xl font-bold flex items-center gap-2"
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
                  onClick={() => setIsMoveOpen(false)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-400"
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
                      className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl text-left text-xs font-semibold transition-colors ${
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
                        className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl text-left text-xs font-semibold transition-colors ${
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
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleMove}
                  disabled={moving || !moveDestinationId}
                  className="btn-primary text-xs px-5 py-2.5 rounded-xl font-bold flex items-center gap-2"
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
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
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
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
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

      {/* Mobile Actions Bottom Sheet */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ y: 200, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 200, opacity: 0 }}
              className="bg-white w-full rounded-t-3xl p-5 shadow-2xl space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h3 className="font-bold text-navy text-sm">Document Actions</h3>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1 rounded-full text-slate-400 hover:text-navy"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1.5 text-sm font-semibold text-slate-700">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <Upload className="w-5 h-5 text-primary" />
                  <span>Upload Files</span>
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setIsNewFolderOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <FolderPlus className="w-5 h-5 text-primary" />
                  <span>New Folder</span>
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    loadFolderItems(currentFolderId);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <RefreshCw className="w-5 h-5 text-slate-500" />
                  <span>Refresh Documents</span>
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handleConnectDrive();
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <HardDrive className="w-5 h-5 text-slate-500" />
                  <span>Reconnect Drive</span>
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setIsDisconnectOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 text-red-600 transition-colors"
                >
                  <LogOut className="w-5 h-5 text-red-500" />
                  <span>Disconnect Drive</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- PREVIEWS --- */}

      {/* PDF Preview Modal: Reusing PdfViewerModal! */}
      {previewPdfItem && (
        <PdfViewerModal
          title={previewPdfItem.name}
          sourceUrl={`/api/drive/preview/${previewPdfItem.id}`}
          downloadUrl={`/api/drive/download/${previewPdfItem.id}`}
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
                onClick={() => setPreviewTextItem(null)}
                className="p-1 rounded-full text-slate-400 hover:text-navy"
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
