import { useEffect, useState, useRef } from 'react';
import { onValue, push, ref, remove, set, update } from 'firebase/database';
import { auth, rtdb } from '../firebase';
import { DocumentCategory, FormDocument } from '../types';
import { cacheManager } from '../utils/cacheManager';
import { generateSlug } from '../utils/slugGenerator';
import { normalizePdfUrl } from '../utils/driveUrl';
import { deduplicateDocuments, deduplicateCategories } from '../utils/documentDeduplication';
import { checkAndInvalidateFormsCache, FORMS_CACHE_VERSION } from '../utils/cacheVersionManager';

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

  // Track if authoritative Firebase snapshots have already arrived
  const firebaseDocsReceivedRef = useRef(false);
  const firebaseCatsReceivedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    // Step 1: Detect version bump and invalidate stale Forms/PDF cache if needed
    checkAndInvalidateFormsCache();

    // Step 2: Immediate local cache inspection for fast rendering while live sync connects
    const cacheKey = includeInactive ? 'documents_all' : 'documents';
    const cachedDocs = cacheManager.get(cacheKey);
    const cachedCats = cacheManager.get('documentCategories');

    if (Array.isArray(cachedDocs) && cachedDocs.length > 0) {
      setDocuments(deduplicateDocuments(cachedDocs));
      setLoading(false);
    }
    if (Array.isArray(cachedCats) && cachedCats.length > 0) {
      setCategories(deduplicateCategories(cachedCats));
    }

    // Step 3: Fetch fresh snapshot from server API (with cache buster and versioning)
    const loadApiData = async () => {
      try {
        const queryParams = `includeInactive=${includeInactive}&v=${FORMS_CACHE_VERSION}&_t=${Date.now()}`;
        const [docsResp, catsResp] = await Promise.all([
          fetch(`/api/documents?${queryParams}`, { cache: 'no-store' })
            .catch(() => fetch(`/data/documents.json?_t=${Date.now()}`, { cache: 'no-store' })),
          fetch(`/api/document-categories?v=${FORMS_CACHE_VERSION}&_t=${Date.now()}`, { cache: 'no-store' })
            .catch(() => fetch(`/data/document-categories.json?_t=${Date.now()}`, { cache: 'no-store' })),
        ]);

        if (docsResp && docsResp.ok && isMounted) {
          // If a Firebase real-time snapshot has already arrived, it takes strict precedence
          if (!firebaseDocsReceivedRef.current) {
            const data = await docsResp.json();
            const rawDocs: FormDocument[] = Array.isArray(data.documents)
              ? data.documents
              : Array.isArray(data)
                ? data
                : [];
            const deduplicated = deduplicateDocuments(rawDocs);
            const filtered = includeInactive ? deduplicated : deduplicated.filter(d => d.active !== false);

            if (!firebaseDocsReceivedRef.current) {
              setDocuments(filtered);
              cacheManager.set(cacheKey, filtered);
              setLoading(false);
            }
          }
        }

        if (catsResp && catsResp.ok && isMounted) {
          if (!firebaseCatsReceivedRef.current) {
            const data = await catsResp.json();
            const rawCats: DocumentCategory[] = Array.isArray(data.categories)
              ? data.categories
              : Array.isArray(data)
                ? data
                : [];
            const deduplicatedCats = deduplicateCategories(rawCats);
            if (!firebaseCatsReceivedRef.current) {
              setCategories(deduplicatedCats);
              cacheManager.set('documentCategories', deduplicatedCats);
            }
          }
        }
      } catch (err) {
        console.warn('[useDocuments] API fetch notice:', err);
      } finally {
        if (isMounted && !firebaseDocsReceivedRef.current && !cachedDocs) {
          setLoading(false);
        }
      }
    };

    loadApiData();

    // Step 4: Real-time Firebase RTDB subscription (Firebase is the single source of truth!)
    const documentsRef = ref(rtdb, 'documents');
    const categoriesRef = ref(rtdb, 'documentCategories');

    const documentsUnsubscribe = onValue(
      documentsRef,
      snapshot => {
        firebaseDocsReceivedRef.current = true;
        const data = snapshot.val();
        let remoteDocs: FormDocument[] = [];

        if (data && typeof data === 'object') {
          remoteDocs = Object.entries(data).map(([id, value]) => ({
            id,
            ...(value as Omit<FormDocument, 'id'>),
          }));
        }

        if (isMounted) {
          // Firebase snapshot COMPLETELY replaces the entire collection.
          // NEVER merge old local records with new Firebase data.
          const deduplicated = deduplicateDocuments(remoteDocs);
          const filtered = includeInactive
            ? deduplicated
            : deduplicated.filter(d => d.active !== false);

          setDocuments(filtered);
          setLoading(false);
          setError(null);
          cacheManager.set(cacheKey, filtered);

          // Mirror authoritative Firebase state to server store
          fetch('/api/documents/sync-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documents: deduplicated }),
          }).catch(() => {});
        }
      },
      err => {
        console.warn('[useDocuments] Firebase documents subscription notice:', err);
        if (isMounted) {
          // If Firebase is unavailable, report error but do not wipe existing valid UI state
          if (!documents.length && !cachedDocs) {
            setError(err instanceof Error ? err : new Error(String(err)));
          }
          setLoading(false);
        }
      }
    );

    const categoriesUnsubscribe = onValue(
      categoriesRef,
      snapshot => {
        firebaseCatsReceivedRef.current = true;
        const data = snapshot.val();
        let remoteCats: DocumentCategory[] = [];

        if (data && typeof data === 'object') {
          remoteCats = Object.entries(data).map(([id, value]) => ({
            id,
            ...(value as Omit<DocumentCategory, 'id'>),
          }));
        }

        if (isMounted) {
          // Firebase snapshot completely replaces the categories collection.
          const deduplicatedCats = deduplicateCategories(remoteCats);
          setCategories(deduplicatedCats);
          cacheManager.set('documentCategories', deduplicatedCats);

          // Mirror authoritative categories to server store
          fetch('/api/document-categories/sync-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: deduplicatedCats }),
          }).catch(() => {});
        }
      },
      err => {
        console.warn('[useDocuments] Firebase categories subscription notice:', err);
      }
    );

    return () => {
      isMounted = false;
      documentsUnsubscribe();
      categoriesUnsubscribe();
    };
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

    // 1. Save directly to server-side persistent store first
    try {
      const serverResp = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (serverResp.ok) {
        const serverData = await serverResp.json();
        if (serverData?.document) {
          setDocuments(prev => deduplicateDocuments([serverData.document, ...prev.filter(d => d.id !== serverData.document.id)]));
        }
      }
    } catch (serverErr) {
      console.warn('Direct server document save notice:', serverErr);
    }

    // 2. Write to Firebase RTDB (source of truth)
    try {
      if (documentId) {
        await update(ref(rtdb, `documents/${documentId}`), payload);
      } else {
        const newDocumentRef = push(ref(rtdb, 'documents'));
        if (newDocumentRef.key) {
          const createdPayload = sanitizeFirebasePayload({
            ...payload,
            id: newDocumentRef.key,
            createdAt: new Date().toISOString(),
          });
          await set(newDocumentRef, createdPayload);
        }
      }
    } catch (rtdbErr) {
      console.warn('RTDB write notice during saveDocument:', rtdbErr);
    }

    triggerJsonSync('documents');
  };

  const deleteDocument = async (id: string) => {
    // 1. Delete on server store
    try {
      await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('Server delete document notice:', err);
    }

    // 2. Delete on Firebase RTDB (triggers real-time update across all clients)
    try {
      await remove(ref(rtdb, `documents/${id}`));
    } catch (err) {
      console.warn('RTDB delete document notice:', err);
    }

    // Optimistically remove from state
    setDocuments(prev => prev.filter(d => d.id !== id));
    triggerJsonSync('documents');
  };

  const saveCategory = async (category: DocumentCategory, existingId?: string) => {
    const normalizedName = category.name.trim();
    if (!normalizedName) throw new Error('Category name is required.');
    const duplicate = categories.find(
      existing => existing.id !== existingId && existing.name.trim().toLowerCase() === normalizedName.toLowerCase()
    );
    if (duplicate) throw new Error('A category with this name already exists.');
    const id = existingId || category.id || generateSlug(normalizedName);
    if (!id) throw new Error('Could not create a category ID.');
    const payload = sanitizeFirebasePayload({ ...category, id, name: normalizedName });

    try {
      await fetch('/api/document-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {}

    try {
      await set(ref(rtdb, `documentCategories/${id}`), payload);
    } catch {}

    setCategories(prev => deduplicateCategories([...prev.filter(c => c.id !== id), payload]));
    triggerJsonSync('documentCategories');
  };

  const deleteCategory = async (id: string) => {
    try {
      await fetch(`/api/document-categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {}

    try {
      await remove(ref(rtdb, `documentCategories/${id}`));
    } catch {}

    setCategories(prev => prev.filter(c => c.id !== id));
    triggerJsonSync('documentCategories');
  };

  const triggerJsonSync = async (type: 'documents' | 'documentCategories') => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      await fetch(`/api/sync-data/${type === 'documents' ? 'documents' : 'documentCategories'}`, {
        method: 'POST',
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
      });
    } catch {}
  };

  return { documents, categories, loading, error, saveDocument, deleteDocument, saveCategory, deleteCategory };
}
