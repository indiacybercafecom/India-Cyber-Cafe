import { FormDocument, DocumentCategory } from '../types';
import { generateSlug } from './slugGenerator';

/**
 * Deduplicate documents by ID, normalized name slug, category/name composite, and downloadUrl.
 * If duplicates exist, the most recently updated or active document is preserved.
 */
export function deduplicateDocuments(docs: (FormDocument | null | undefined)[]): FormDocument[] {
  if (!Array.isArray(docs)) return [];

  const seenIds = new Set<string>();
  const seenSlugs = new Map<string, FormDocument>();
  const seenUrls = new Map<string, FormDocument>();
  const result: FormDocument[] = [];

  // Sort descending by updatedAt / createdAt so newer entries take priority
  const sorted = [...docs]
    .filter((d): d is FormDocument => Boolean(d && typeof d === 'object' && d.name))
    .sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

  for (const doc of sorted) {
    const id = doc.id?.trim();
    const nameSlug = generateSlug(doc.name || '');
    const categorySlug = generateSlug(doc.category || '');
    const compositeKey = `${categorySlug}/${nameSlug}`;
    const cleanUrl = (doc.previewUrl || doc.downloadUrl || '').trim().toLowerCase();

    // 1. Exact ID duplicate check
    if (id && seenIds.has(id)) {
      continue;
    }

    // 2. Composite category + name slug duplicate check
    if (compositeKey && seenSlugs.has(compositeKey)) {
      continue;
    }

    // 3. Name slug duplicate check (prevents duplicate seed/custom files with same name across variations)
    if (nameSlug && seenSlugs.has(nameSlug)) {
      continue;
    }

    // 4. Duplicate identical file URL check (unless it's an empty or generic path)
    if (cleanUrl && cleanUrl.length > 5 && !cleanUrl.endsWith('incomeaay-certificate-form.pdf') && seenUrls.has(cleanUrl)) {
      continue;
    }

    if (id) seenIds.add(id);
    if (compositeKey) seenSlugs.set(compositeKey, doc);
    if (nameSlug) seenSlugs.set(nameSlug, doc);
    if (cleanUrl) seenUrls.set(cleanUrl, doc);

    result.push(doc);
  }

  return result;
}

/**
 * Deduplicate document categories by ID and normalized name slug.
 */
export function deduplicateCategories(cats: (DocumentCategory | null | undefined)[]): DocumentCategory[] {
  if (!Array.isArray(cats)) return [];

  const seen = new Set<string>();
  const result: DocumentCategory[] = [];

  for (const cat of cats) {
    if (!cat || !cat.name) continue;
    const key = generateSlug(cat.name).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(cat);
  }

  return result;
}

/**
 * Robust document finder matching by categorySlug, pdfSlug, document.id, or document.name.
 * Tolerates hyphens, underscores, casing, and spaces.
 */
export function findDocumentBySlug(
  documents: FormDocument[],
  pdfSlug?: string,
  categorySlug?: string
): FormDocument | undefined {
  if (!pdfSlug || !Array.isArray(documents) || documents.length === 0) return undefined;

  const cleanTargetSlug = generateSlug(pdfSlug).replace(/[_-]+/g, '-');
  const cleanTargetCompact = cleanTargetSlug.replace(/-/g, '');
  const cleanCategorySlug = categorySlug ? generateSlug(categorySlug).replace(/[_-]+/g, '-') : '';

  // 1. Exact match by ID or exact slug + categorySlug
  const exactMatch = documents.find(d => {
    const docId = (d.id || '').trim();
    const docNameSlug = generateSlug(d.name || '').replace(/[_-]+/g, '-');
    const docCatSlug = generateSlug(d.category || '').replace(/[_-]+/g, '-');

    if (docId === pdfSlug || docId === cleanTargetSlug) return true;
    if (cleanCategorySlug && docCatSlug === cleanCategorySlug && docNameSlug === cleanTargetSlug) return true;
    return false;
  });

  if (exactMatch) return exactMatch;

  // 2. Match by document name slug regardless of category
  const slugMatch = documents.find(d => {
    const docNameSlug = generateSlug(d.name || '').replace(/[_-]+/g, '-');
    return docNameSlug === cleanTargetSlug;
  });

  if (slugMatch) return slugMatch;

  // 3. Compact alphanumeric match (e.g., "pyqbt102" matching "pyq-bt-102")
  const compactMatch = documents.find(d => {
    const docCompact = generateSlug(d.name || '').replace(/-/g, '');
    const docIdCompact = (d.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return docCompact === cleanTargetCompact || docIdCompact === cleanTargetCompact;
  });

  if (compactMatch) return compactMatch;

  // 4. Raw title case-insensitive search
  const rawTitleMatch = documents.find(d => {
    return (d.name || '').trim().toLowerCase() === pdfSlug.trim().toLowerCase();
  });

  return rawTitleMatch;
}
