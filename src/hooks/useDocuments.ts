import { useEffect, useState } from 'react';
import { onValue, push, ref, remove, set, update } from 'firebase/database';
import { rtdb } from '../firebase';
import { DocumentCategory, FormDocument } from '../types';
import { generateSlug } from '../utils/slugGenerator';
import { normalizePdfUrl } from '../utils/driveUrl';

export function useDocuments() {
  const [documents, setDocuments] = useState<FormDocument[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const documentsUnsubscribe = onValue(ref(rtdb, 'documents'), snapshot => {
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
  }, []);

  const saveDocument = async (document: Omit<FormDocument, 'id'>, id?: string) => {
    const urls = normalizePdfUrl(document.previewUrl || document.downloadUrl);
    if (!urls) throw new Error('Enter a valid HTTPS PDF or Google Drive sharing URL.');
    const payload = { ...document, ...urls, fileType: 'PDF' as const, updatedAt: new Date().toISOString() };
    if (id) await update(ref(rtdb, `documents/${id}`), payload);
    else await set(push(ref(rtdb, 'documents')), { ...payload, active: document.active !== false, createdAt: new Date().toISOString() });
  };

  const deleteDocument = (id: string) => remove(ref(rtdb, `documents/${id}`));
  const saveCategory = async (category: DocumentCategory, existingId?: string) => {
    const normalizedName = category.name.trim();
    if (!normalizedName) throw new Error('Category name is required.');
    const duplicate = categories.find(existing => existing.id !== existingId && existing.name.trim().toLowerCase() === normalizedName.toLowerCase());
    if (duplicate) throw new Error('A category with this name already exists.');
    const id = existingId || category.id || generateSlug(normalizedName);
    if (!id) throw new Error('Could not create a category ID.');
    await set(ref(rtdb, `documentCategories/${id}`), { ...category, id, name: normalizedName });
  };
  const deleteCategory = (id: string) => remove(ref(rtdb, `documentCategories/${id}`));

  return { documents, categories, loading, error, saveDocument, deleteDocument, saveCategory, deleteCategory };
}
