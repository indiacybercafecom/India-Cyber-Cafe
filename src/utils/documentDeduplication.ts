import { FormDocument, DocumentCategory } from '../types';
import { generateSlug } from './slugGenerator';

/**
 * Extracts core semantic tokens from a document title by stripping punctuation
 * and optional wrapper terms (e.g., 'certificate', 'form', 'application').
 * This ensures 'Domicile/Niwas Form' and 'Domicile/Niwas Certificate Form'
 * are recognized as the exact same document, preventing UI overlaps and duplicates.
 */
export function extractCoreTokens(title: string): string[] {
  if (!title) return [];
  const noise = new Set([
    'form',
    'certificate',
    'application',
    'official',
    'document',
    'pdf',
    'prapatra',
    'praman',
    'patra',
  ]);

  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !noise.has(w))
    .sort();
}

/**
 * Creates a unique signature string for a document title based on its core tokens.
 */
export function getDocumentSignature(title: string): string {
  const tokens = extractCoreTokens(title);
  return tokens.length > 0 ? tokens.join('-') : generateSlug(title);
}

/**
 * Determines whether docA has higher authority or completeness than docB.
 * Real Firebase/Google Drive URLs take precedence over local dummy placeholders.
 */
function isMoreAuthoritative(docA: FormDocument, docB: FormDocument): boolean {
  const urlA = (docA.downloadUrl || docA.previewUrl || '').toLowerCase();
  const urlB = (docB.downloadUrl || docB.previewUrl || '').toLowerCase();

  const isDummyA = urlA.includes('incomeaay-certificate-form.pdf') || docA.id?.startsWith('mp-') || docA.id?.startsWith('pan-');
  const isDummyB = urlB.includes('incomeaay-certificate-form.pdf') || docB.id?.startsWith('mp-') || docB.id?.startsWith('pan-');

  if (!isDummyA && isDummyB) return true;
  if (isDummyA && !isDummyB) return false;

  const timeA = new Date(docA.updatedAt || docA.createdAt || 0).getTime();
  const timeB = new Date(docB.updatedAt || docB.createdAt || 0).getTime();
  return timeA >= timeB;
}

/**
 * Deduplicate documents by ID, normalized name slug, category/name composite,
 * token signature, and downloadUrl.
 * Strictly prevents overlapping duplicates between real database documents and legacy seeds.
 */
export function deduplicateDocuments(docs: (FormDocument | null | undefined)[]): FormDocument[] {
  if (!Array.isArray(docs)) return [];

  const validDocs = docs.filter((d): d is FormDocument => Boolean(d && typeof d === 'object' && (d.name || d.id)));

  // Group documents by their primary deduplication keys
  const idMap = new Map<string, FormDocument>();
  const categorySignatureMap = new Map<string, FormDocument>();
  const categorySlugMap = new Map<string, FormDocument>();
  const urlMap = new Map<string, FormDocument>();

  for (const doc of validDocs) {
    const id = (doc.id || '').trim();
    const catSlug = generateSlug(doc.category || 'general');
    const nameSlug = generateSlug(doc.name || '');
    const signature = getDocumentSignature(doc.name || '');
    const catSigKey = `${catSlug}::${signature}`;
    const catSlugKey = `${catSlug}::${nameSlug}`;
    const cleanUrl = (doc.downloadUrl || doc.previewUrl || '').trim().toLowerCase();
    const isGenericUrl = !cleanUrl || cleanUrl.includes('incomeaay-certificate-form.pdf');

    // Check existing match across all keys
    const existing =
      (id && idMap.get(id)) ||
      categorySignatureMap.get(catSigKey) ||
      categorySlugMap.get(catSlugKey) ||
      (!isGenericUrl ? urlMap.get(cleanUrl) : undefined);

    if (existing) {
      if (isMoreAuthoritative(doc, existing)) {
        // Replace existing with doc
        if (existing.id) idMap.delete(existing.id);
        const oldCatSlug = generateSlug(existing.category || 'general');
        const oldSig = getDocumentSignature(existing.name || '');
        categorySignatureMap.delete(`${oldCatSlug}::${oldSig}`);
        categorySlugMap.delete(`${oldCatSlug}::${generateSlug(existing.name || '')}`);
        const oldUrl = (existing.downloadUrl || existing.previewUrl || '').trim().toLowerCase();
        if (oldUrl && !oldUrl.includes('incomeaay-certificate-form.pdf')) {
          urlMap.delete(oldUrl);
        }

        // Register new authoritative doc
        if (id) idMap.set(id, doc);
        categorySignatureMap.set(catSigKey, doc);
        categorySlugMap.set(catSlugKey, doc);
        if (!isGenericUrl) urlMap.set(cleanUrl, doc);
      }
      // Otherwise skip lower-priority duplicate
      continue;
    }

    if (id) idMap.set(id, doc);
    categorySignatureMap.set(catSigKey, doc);
    categorySlugMap.set(catSlugKey, doc);
    if (!isGenericUrl) urlMap.set(cleanUrl, doc);
  }

  // Collect distinct documents preserving sorted order by updatedAt / createdAt
  const resultSet = new Set<FormDocument>([
    ...categorySignatureMap.values(),
    ...idMap.values(),
  ]);

  return Array.from(resultSet).sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });
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
 * Tolerates hyphens, underscores, casing, spaces, and category mismatch in embed scenarios.
 */
export function findDocumentBySlug(
  documents: FormDocument[],
  pdfSlug?: string,
  categorySlug?: string
): FormDocument | undefined {
  if (!pdfSlug || !Array.isArray(documents) || documents.length === 0) return undefined;

  const rawTarget = pdfSlug.trim().toLowerCase();
  const cleanTargetSlug = generateSlug(pdfSlug).replace(/[_-]+/g, '-');
  const cleanTargetCompact = cleanTargetSlug.replace(/-/g, '');
  const cleanCategorySlug = categorySlug ? generateSlug(categorySlug).replace(/[_-]+/g, '-') : '';
  const targetSignature = getDocumentSignature(pdfSlug);

  // 1. Exact match by ID or (categorySlug + slug)
  const exactMatch = documents.find(d => {
    const docId = (d.id || '').trim();
    const docNameSlug = generateSlug(d.name || '').replace(/[_-]+/g, '-');
    const docCatSlug = generateSlug(d.category || '').replace(/[_-]+/g, '-');

    if (docId === pdfSlug || docId.toLowerCase() === rawTarget || docId === cleanTargetSlug) return true;
    if (cleanCategorySlug && docCatSlug === cleanCategorySlug && docNameSlug === cleanTargetSlug) return true;
    return false;
  });

  if (exactMatch) return exactMatch;

  // 2. Match by document name slug regardless of category (critical for flexible embeds)
  const slugMatch = documents.find(d => {
    const docNameSlug = generateSlug(d.name || '').replace(/[_-]+/g, '-');
    return docNameSlug === cleanTargetSlug;
  });

  if (slugMatch) return slugMatch;

  // 3. Match by semantic token signature (e.g. 'pyq-bt-102')
  const signatureMatch = documents.find(d => {
    const docSig = getDocumentSignature(d.name || '');
    return docSig && docSig === targetSignature;
  });

  if (signatureMatch) return signatureMatch;

  // 4. Compact alphanumeric match (e.g., "pyqbt102" matching "pyq-bt-102")
  const compactMatch = documents.find(d => {
    const docCompact = generateSlug(d.name || '').replace(/-/g, '');
    const docIdCompact = (d.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return docCompact === cleanTargetCompact || docIdCompact === cleanTargetCompact;
  });

  if (compactMatch) return compactMatch;

  // 5. Raw title case-insensitive search
  const rawTitleMatch = documents.find(d => {
    return (d.name || '').trim().toLowerCase() === rawTarget;
  });

  if (rawTitleMatch) return rawTitleMatch;

  // 6. Substring match if slug is at least 4 characters
  if (cleanTargetSlug.length >= 4) {
    const subMatch = documents.find(d => {
      const docNameSlug = generateSlug(d.name || '');
      return docNameSlug.includes(cleanTargetSlug) || cleanTargetSlug.includes(docNameSlug);
    });
    if (subMatch) return subMatch;
  }

  return undefined;
}
