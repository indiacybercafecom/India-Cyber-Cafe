import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { PdfViewerModal } from '../components/PdfViewerModal';
import { SEO } from '../components/SEO';
import { SelectDropdown } from '../components/SelectDropdown';
import { Skeleton } from '../components/Skeleton';
import { useDocuments } from '../hooks/useDocuments';
import { normalizePdfUrl } from '../utils/driveUrl';
import { generateSlug } from '../utils/slugGenerator';
import { findDocumentBySlug, deduplicateDocuments } from '../utils/documentDeduplication';
import { FormDocument } from '../types';

interface FormsDocumentsProps {
  categorySlug?: string;
}

function FormsDocumentsSkeleton() {
  return (
    <div className="space-y-8 sm:space-y-10" aria-label="Loading forms and documents" aria-busy="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-12 flex-1 rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl sm:w-64" />
      </div>
      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-64 max-w-[70vw]" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(card => (
            <div key={card} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-start justify-between gap-3">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <Skeleton className="h-6 w-12 rounded-md" />
              </div>
              <Skeleton className="mb-3 h-3 w-32" />
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-3/4" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function FormsDocuments({ categorySlug }: FormsDocumentsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { categorySlug: routeCategorySlug } = useParams<{ categorySlug?: string }>();
  const { documents, categories, loading, error } = useDocuments();
  const [searchTerm, setSearchTerm] = useState('');
  const activeCategorySlug = categorySlug ?? routeCategorySlug;
  const selectedCategoryName = activeCategorySlug ? categories.find(category => generateSlug(category.name) === activeCategorySlug)?.name : undefined;
  const [selectedCategory, setSelectedCategory] = useState('All');

  useEffect(() => {
    setSelectedCategory(selectedCategoryName || 'All');
  }, [selectedCategoryName]);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const categoryNames = [...categories].sort((a, b) => (a.order || 0) - (b.order || 0)).map(category => category.name);

  const filteredDocuments = useMemo(() => {
    const deduplicated = deduplicateDocuments(documents);
    return deduplicated.filter(document => {
      if (document.active === false) return false;
      const matchesCategory = selectedCategory === 'All' || document.category === selectedCategory;
      const matchesSearch = !normalizedSearch || [document.name, document.description, document.category]
        .some(value => value.toLowerCase().includes(normalizedSearch));
      return matchesCategory && matchesSearch;
    });
  }, [documents, normalizedSearch, selectedCategory]);

  const categoryOptions = [
    { value: 'All', label: 'All Categories' },
    ...categoryNames.map(category => ({ value: category, label: category })),
  ];

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    const nextPath = value === 'All' ? '/forms-documents' : `/forms-documents/${generateSlug(value)}`;
    if (window.location.pathname !== nextPath) {
      navigate(nextPath, { replace: false });
    }
  };

  if (loading) return <FormsDocumentsSkeleton />;

  return (
    <div className="space-y-8 sm:space-y-10">
      <SEO
        title="Forms & Documents - India Cyber Cafe"
        description="Browse, preview, and download official government forms, applications, and documents directly from India Cyber Cafe."
        url="https://b.indiacybercafe.com/forms-documents"
        keywords="forms, documents, government applications, pdf download, MP online forms"
      />

      <section className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <IconRenderer name="magnifying-glass" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Search forms, certificates, or documents..."
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-medium text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="w-full sm:w-64">
          <SelectDropdown
            value={selectedCategory}
            onChange={handleCategoryChange}
            options={categoryOptions}
            className="w-full text-sm"
          />
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Browse Catalogue</p>
            <h1 className="text-2xl font-bold text-navy sm:text-3xl">
              {selectedCategory === 'All' ? 'Forms & Documents' : selectedCategory}
            </h1>
          </div>
          <p className="text-xs font-semibold text-slate-500 sm:text-sm">
            {filteredDocuments.length} {filteredDocuments.length === 1 ? 'document' : 'documents'}
          </p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error.message || 'Unable to refresh documents catalogue right now.'}
          </div>
        )}

        {filteredDocuments.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredDocuments.map(document => {
              const categorySlugValue = generateSlug(document.category);
              const pdfSlugValue = generateSlug(document.name);
              const previewPath = `/forms-documents/${categorySlugValue}/${pdfSlugValue}?from=${encodeURIComponent(location.pathname + location.search)}`;

              return (
                <article
                  key={document.id}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-lg"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white">
                        <IconRenderer name="file-text" className="h-6 w-6" />
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-slate-600">
                        {document.fileType || 'PDF'}
                      </span>
                    </div>

                    <p className="mt-4 text-xs font-bold uppercase tracking-wider text-primary">
                      {document.category}
                    </p>

                    <h2 className="mt-1 text-lg font-bold text-navy transition group-hover:text-primary">
                      {document.name}
                    </h2>

                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-600">
                      {document.description}
                    </p>
                  </div>

                  <div className="mt-6 border-t border-slate-100 pt-4">
                    <Link
                      to={previewPath}
                      className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-xs font-semibold"
                    >
                      <IconRenderer name="eye" className="h-4 w-4" />
                      <span>Preview Document</span>
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <IconRenderer name="file-text" className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-600">{documents.length === 0 ? 'No documents available.' : 'No documents match your search.'}</p>
            <p className="mt-1 text-sm text-slate-500">{documents.length === 0 ? 'Documents will appear here when they are published.' : 'Try another search term or category.'}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function FormsDocumentDetail() {
  const params = useParams<{ categorySlug?: string; pdfSlug?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);

  // Handle both /:categorySlug/:pdfSlug and /:pdfSlug routes
  const categorySlug = params.pdfSlug ? params.categorySlug : undefined;
  const targetPdfSlug = params.pdfSlug || params.categorySlug || '';

  const isEmbed = Boolean(
    searchParams.get('embed') === '1' ||
    searchParams.get('embed') === 'true'
  );

  const { documents, categories, loading, error } = useDocuments(true);
  const [fetchedDoc, setFetchedDoc] = useState<FormDocument | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupAttempted, setLookupAttempted] = useState(false);

  // Format slug to readable title as instant fallback while documents are loading
  const fallbackTitle = targetPdfSlug
    ? targetPdfSlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : 'Document Preview';

  // 1. Try finding in loaded documents
  const document = useMemo(() => {
    return findDocumentBySlug(documents, targetPdfSlug, categorySlug) || fetchedDoc || null;
  }, [documents, targetPdfSlug, categorySlug, fetchedDoc]);

  // 2. If not found in loaded documents, immediately query the server API lookup
  useEffect(() => {
    if (document || !targetPdfSlug) return;
    let cancelled = false;
    setLookupLoading(true);

    const lookupUrl = `/api/documents/lookup?slug=${encodeURIComponent(targetPdfSlug)}&category=${encodeURIComponent(categorySlug || '')}`;
    fetch(lookupUrl)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data?.document) {
          setFetchedDoc(data.document);
        }
      })
      .catch(err => {
        console.warn('[FormsDocumentDetail] Document lookup notice:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setLookupLoading(false);
          setLookupAttempted(true);
        }
      });

    return () => { cancelled = true; };
  }, [targetPdfSlug, categorySlug, document]);

  const category = categories.find(item => generateSlug(item.name) === categorySlug) ||
    (document ? categories.find(item => item.name === document.category) : undefined);

  // Support direct fallback url in query params if provided
  const queryDirectUrl = searchParams.get('url') || searchParams.get('source') || '';
  const normalizedUrls = document
    ? normalizePdfUrl(document.previewUrl || document.downloadUrl)
    : (queryDirectUrl ? normalizePdfUrl(queryDirectUrl) : null);

  const pdfSourceUrl = normalizedUrls?.downloadUrl || document?.previewUrl || document?.downloadUrl || queryDirectUrl || '';
  const pdfDownloadUrl = normalizedUrls?.downloadUrl || document?.downloadUrl || document?.previewUrl || queryDirectUrl || '';

  const returnPath = searchParams.get('from');
  const closePath = returnPath?.startsWith('/forms-documents') ? returnPath : '/forms-documents';

  const handleClose = () => {
    if (!isEmbed) {
      navigate(closePath);
    }
  };

  const documentTitle = document?.name || searchParams.get('title') || fallbackTitle;

  // Only declare documentError when both initial load and async lookup have concluded without finding a doc
  const isResolving = (loading && !document) || (lookupLoading && !document);
  const documentError = (!isResolving && !document && lookupAttempted)
    ? 'Document not found or no longer available.'
    : error && !document
      ? 'Unable to load this PDF right now.'
      : null;

  return (
    <>
      <SEO
        title={`${documentTitle} - ${category?.name || 'Forms & Documents'} | India Cyber Cafe`}
        description={document?.description || `Download and preview ${documentTitle} from India Cyber Cafe.`}
        url={`https://b.indiacybercafe.com/forms-documents/${categorySlug || 'doc'}/${targetPdfSlug}`}
        keywords={`${documentTitle}, PDF, ${category?.name || 'forms and documents'}`}
      />
      <PdfViewerModal
        title={documentTitle}
        sourceUrl={pdfSourceUrl}
        downloadUrl={pdfDownloadUrl}
        onClose={handleClose}
        isEmbed={isEmbed}
        isLoadingDocument={isResolving}
        documentError={documentError}
      />
    </>
  );
}
