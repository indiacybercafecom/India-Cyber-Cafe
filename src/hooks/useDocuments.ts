import { useEffect, useState } from 'react';
import { equalTo, onValue, orderByChild, push, query, ref, remove, set, update } from 'firebase/database';
import { rtdb } from '../firebase';
import { DocumentCategory, FormDocument } from '../types';
import { generateSlug } from '../utils/slugGenerator';
import { normalizePdfUrl } from '../utils/driveUrl';

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
  };

  const deleteDocument = (id: string) => remove(ref(rtdb, `documents/${id}`));
  const saveCategory = async (category: DocumentCategory, existingId?: string) => {
    const normalizedName = category.name.trim();
    if (!normalizedName) throw new Error('Category name is required.');
    const duplicate = categories.find(existing => existing.id !== existingId && existing.name.trim().toLowerCase() === normalizedName.toLowerCase());
    if (duplicate) throw new Error('A category with this name already exists.');
    const id = existingId || category.id || generateSlug(normalizedName);
    if (!id) throw new Error('Could not create a category ID.');
    const payload = sanitizeFirebasePayload({ ...category, id, name: normalizedName });
    await set(ref(rtdb, `documentCategories/${id}`), payload);
  };
  const deleteCategory = (id: string) => remove(ref(rtdb, `documentCategories/${id}`));

  return { documents, categories, loading, error, saveDocument, deleteDocument, saveCategory, deleteCategory };
}
