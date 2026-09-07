import { useEffect, useState } from 'react';
import { equalTo, onValue, orderByChild, push, query, ref, remove, set, update } from 'firebase/database';
import { auth, rtdb } from '../firebase';
import { DocumentCategory, FormDocument } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { generateSlug } from '../utils/slugGenerator';
import { normalizePdfUrl } from '../utils/driveUrl';
import { syncManager } from '../utils/syncManager';

interface DocumentsJsonData {
  version: number;
  generatedAt: string;
  documents: FormDocument[];
}

interface DocumentCategoriesJsonData {
  version: number;
  generatedAt: string;
  categories: DocumentCategory[];
}

export function sanitizeFirebasePayload<T>(payload: T): T {
  if (payload === undefined || payload === null) return undefined as T;

  if (Array.isArray(payload)) {
    return payload
      .map(item => sanitizeFirebasePayload(item))
      .filter(item => item !== undefined) as T;
  }

  if (typeof payload !== 'object') return payload;

  const sanitized: Record<string, any> = {};

  Object.entries(payload as Record<string, any>).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === 'thumbnailUrl' && value === '') return;

    const cleanedValue = sanitizeFirebasePayload(value);
    if (cleanedValue === undefined) return;
    sanitized[key] = cleanedValue;
  });

  return sanitized as T;
}

export function useDocuments(includeInactive = false) {
  const [documents, setDocuments] = useState<FormDocument[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!includeInactive) {
      let isMounted = true;

      const loadPublicData = async () => {
        try {
          console.log('[useDocuments] Attempting to load public PDFs from JSON...');

          let documentsLoadedFromJson = false;
          let categoriesLoadedFromJson = false;

          try {
            const [documentsResponse, categoriesResponse] = await Promise.all([
              fetch('/data/documents.json', { cache: 'no-store' }),
              fetch('/data/document-categories.json', { cache: 'no-store' }),
            ]);

            if (documentsResponse.ok) {
              const jsonData: DocumentsJsonData = await documentsResponse.json();
              if (jsonData && Array.isArray(jsonData.documents)) {
                const normalizedDocuments = jsonData.documents.filter((document) => document.active !== false);
                if (isMounted) {
                  setDocuments(normalizedDocuments);
                  cacheManager.set('documents', normalizedDocuments);
                  documentsLoadedFromJson = true;
                }
              }
            }

            if (categoriesResponse.ok) {
              const jsonData: DocumentCategoriesJsonData = await categoriesResponse.json();
              if (jsonData && Array.isArray(jsonData.categories)) {
                if (isMounted) {
                  setCategories(jsonData.categories);
                  cacheManager.set('documentCategories', jsonData.categories);
                  categoriesLoadedFromJson = true;
                }
              }
            }

            if (documentsLoadedFromJson || categoriesLoadedFromJson) {
              setLoading(false);
              setError(null);
            }
          } catch (jsonError) {
            console.warn('[useDocuments] JSON fetch failed, falling back to Firebase:', jsonError);
          }

          const lastSync = syncManager.getLastSync('documents');
          const now = Date.now();
          const SYNC_THRESHOLD = 5 * 60 * 1000;

          if (documentsLoadedFromJson || categoriesLoadedFromJson || now - lastSync > SYNC_THRESHOLD) {
            console.log('[useDocuments] Loading PDFs from Firebase fallback...');

            const documentsRef = query(ref(rtdb, 'documents'), orderByChild('active'), equalTo(true));
            const categoriesRef = ref(rtdb, 'documentCategories');

            const documentsUnsubscribe = onValue(documentsRef, snapshot => {
              const data = snapshot.val() || {};
              const nextDocuments = Object.entries(data).map(([id, value]) => ({
                id,
                ...(value as Omit<FormDocument, 'id'>),
              }));

              if (isMounted) {
                setDocuments(nextDocuments);
                cacheManager.set('documents', nextDocuments);
                syncManager.updateSync('documents');
                setLoading(false);
                setError(null);
              }
            }, err => {
              console.error('[useDocuments] Firebase documents error:', err);
              if (isMounted) {
                setError(err);
                setLoading(false);
              }
            });

            const categoriesUnsubscribe = onValue(categoriesRef, snapshot => {
              const data = snapshot.val() || {};
              const nextCategories = Object.entries(data).map(([id, value]) => ({
                id,
                ...(value as Omit<DocumentCategory, 'id'>),
              }));

              if (isMounted) {
                setCategories(nextCategories);
                cacheManager.set('documentCategories', nextCategories);
                syncManager.updateSync('documentCategories');
              }
            }, err => {
              console.error('[useDocuments] Firebase categories error:', err);
              if (isMounted) {
                setError(err);
              }
            });

            return () => {
              documentsUnsubscribe();
              categoriesUnsubscribe();
            };
          }

          const cachedDocuments = cacheManager.get('documents');
          const cachedCategories = cacheManager.get('documentCategories');
          if (cachedDocuments && cachedDocuments.length > 0 && isMounted) {
            setDocuments(cachedDocuments);
          }
          if (cachedCategories && cachedCategories.length > 0 && isMounted) {
            setCategories(cachedCategories);
          }
          if (isMounted) {
            setLoading(false);
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (isMounted) {
            setError(error);
            setLoading(false);
          }
        }
      };

      loadPublicData();

      return () => {
        isMounted = false;
      };
    }

    const documentsRef = includeInactive
      ? ref(rtdb, 'documents')
      : query(ref(rtdb, 'documents'), orderByChild('active'), equalTo(true));
    const documentsUnsubscribe = onValue(documentsRef, snapshot => {
      const data = snapshot.val() || {};
      setDocuments(Object.entries(data).map(([id, value]) => ({ id, ...(value as Omit<FormDocument, 'id'>) })));
      setLoading(false);
      setError(null);
    }, err => { setError(err); setLoading(false); });
    const categoriesUnsubscribe = onValue(ref(rtdb, 'documentCategories'), snapshot => {
      const data = snapshot.val() || {};
      setCategories(Object.entries(data).map(([id, value]) => ({ id, ...(value as Omit<DocumentCategory, 'id'>) })));
    }, err => setError(err));
    void triggerJsonSync('documents');
    void triggerJsonSync('documentCategories');
    return () => { documentsUnsubscribe(); categoriesUnsubscribe(); };
  }, [includeInactive]);

  const saveDocument = async (document: Omit<FormDocument, 'id'>, id?: string) => {
    const urls = normalizePdfUrl(document.previewUrl || document.downloadUrl);
    if (!urls) throw new Error('Enter a valid HTTPS PDF or Google Drive sharing URL.');

    const documentId = id || undefined;
    const payload = sanitizeFirebasePayload({
      ...document,
      ...urls,
      id: documentId,
      fileType: 'PDF' as const,
      active: document.active !== false,
      updatedAt: new Date().toISOString(),
    });

    if (documentId) {
      await update(ref(rtdb, `documents/${documentId}`), payload);
      await triggerJsonSync('documents');
      return;
    }

    const newDocumentRef = push(ref(rtdb, 'documents'));
    if (!newDocumentRef.key) throw new Error('Could not generate a document ID.');

    const createdPayload = sanitizeFirebasePayload({
      ...payload,
      id: newDocumentRef.key,
      createdAt: new Date().toISOString(),
    });

    await set(newDocumentRef, createdPayload);
    await triggerJsonSync('documents');
  };

  const deleteDocument = async (id: string) => {
    await remove(ref(rtdb, `documents/${id}`));
    await triggerJsonSync('documents');
  };
  const saveCategory = async (category: DocumentCategory, existingId?: string) => {
    const normalizedName = category.name.trim();
    if (!normalizedName) throw new Error('Category name is required.');
    const duplicate = categories.find(existing => existing.id !== existingId && existing.name.trim().toLowerCase() === normalizedName.toLowerCase());
    if (duplicate) throw new Error('A category with this name already exists.');
    const id = existingId || category.id || generateSlug(normalizedName);
    if (!id) throw new Error('Could not create a category ID.');
    const payload = sanitizeFirebasePayload({ ...category, id, name: normalizedName });
    await set(ref(rtdb, `documentCategories/${id}`), payload);
    await triggerJsonSync('documentCategories');
  };
  const deleteCategory = async (id: string) => {
    await remove(ref(rtdb, `documentCategories/${id}`));
    await triggerJsonSync('documentCategories');
  };

  const triggerJsonSync = async (type: 'documents' | 'documentCategories') => {
    try {
      console.log(`[useDocuments] Triggering JSON sync for ${type}...`);
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/sync-data/${type === 'documents' ? 'documents' : 'documentCategories'}`, {
        method: 'POST',
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success) {
        const message = result?.error || result?.message || `JSON sync failed (${response.status})`;
        console.error('[useDocuments] JSON sync failed:', message);
      }
    } catch (err) {
      console.error('[useDocuments] Error triggering JSON sync:', err);
    }
  };

  return { documents, categories, loading, error, saveDocument, deleteDocument, saveCategory, deleteCategory };
}
