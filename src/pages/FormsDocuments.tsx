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

  const filteredDocuments = useMemo(() => documents.filter(document => {
    if (document.active === false) return false;
    const matchesCategory = selectedCategory === 'All' || document.category === selectedCategory;
    const matchesSearch = !normalizedSearch || [document.name, document.description, document.category]
      .some(value => value.toLowerCase().includes(normalizedSearch));
    return matchesCategory && matchesSearch;
  }), [documents, normalizedSearch, selectedCategory]);

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

  if (activeCategorySlug && !selectedCategoryName) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="font-semibold text-slate-600">Category not found.</p><Link to="/forms-documents" className="btn-primary mx-auto mt-4">View all documents</Link></div>;
  }

  return (
    <div className="space-y-8 sm:space-y-10">
      <SEO
        title="Forms & Documents"
        description="Find and download useful government forms, applications, affidavits, resumes and other documents from India Cyber Cafe."
        url="https://b.indiacybercafe.com/forms-documents"
        keywords="forms and documents, government forms, PDF download, India Cyber Cafe documents"
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Forms & Documents',
          description: 'Downloadable forms and documents from India Cyber Cafe.',
          url: 'https://b.indiacybercafe.com/forms-documents',
        }}
      />

      <section aria-label="Find a document">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
          <IconRenderer name="search" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="Search forms and documents"
            placeholder="Search by document name, description or category..."
            className="input-field py-3 pl-12"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
          />
          </div>
          {categories.length > 0 ? <SelectDropdown
              options={categoryOptions}
              value={selectedCategory}
              onChange={handleCategoryChange}
              containerClassName="w-full sm:w-64 shrink-0"
              className="input-field py-3"
              ariaLabel="Filter documents by category"
              leadingIcon="filter"
            /> : <div className="flex w-full shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-500 sm:w-64">No categories yet</div>}
        </div>
      </section>

      <section aria-labelledby="documents-heading" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Document library</p>
            <h2 id="documents-heading" className="text-2xl font-bold text-navy sm:text-3xl">{selectedCategoryName ? `${selectedCategoryName} PDFs` : 'Available PDFs'}</h2>
          </div>
          <span className="text-right text-xs font-semibold text-slate-500">{filteredDocuments.length} document{filteredDocuments.length === 1 ? '' : 's'}</span>
        </div>

        {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading PDFs...</div> : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center text-red-700">Unable to load PDFs right now.</div> : filteredDocuments.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredDocuments.map(document => {
              const listingPath = location.pathname;
              const detailPath = `/forms-documents/${generateSlug(document.category)}/${generateSlug(document.name)}?from=${encodeURIComponent(listingPath)}`;

              return (
                <article
                  key={document.id}
                  className="flex cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10"
                  onClick={() => navigate(detailPath)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(detailPath);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${document.name}`}
                >
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-primary">
                      <IconRenderer name="file-text" className="h-6 w-6" />
                    </div>
                    <span className="rounded-md bg-red-50 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-red-600">{document.fileType}</span>
                  </div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-primary">{document.category}</p>
                  <div className="text-lg font-bold leading-snug text-navy hover:text-primary">{document.name}</div>
                  <p className="mt-2 min-h-12 text-sm leading-relaxed text-slate-500">{document.description}</p>
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
  const { categorySlug, pdfSlug } = useParams<{ categorySlug: string; pdfSlug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { documents, categories, loading, error } = useDocuments();
  const document = documents.find(item => generateSlug(item.category) === categorySlug && generateSlug(item.name) === pdfSlug);
  const category = categories.find(item => generateSlug(item.name) === categorySlug);

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading PDF...</div>;
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center text-red-700">Unable to load this PDF right now.</div>;
  if (!document) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="font-semibold text-slate-600">PDF not found.</p><button type="button" onClick={() => navigate('/forms-documents')} className="btn-primary mx-auto mt-4">Back to Forms & Documents</button></div>;

  const normalizedUrls = normalizePdfUrl(document.previewUrl || document.downloadUrl);
  const pdfSourceUrl = normalizedUrls?.downloadUrl || document.downloadUrl || document.previewUrl;
  const pdfDownloadUrl = normalizedUrls?.downloadUrl || document.downloadUrl;
  const returnPath = new URLSearchParams(location.search).get('from');
  const closePath = returnPath?.startsWith('/forms-documents') ? returnPath : '/forms-documents';

  return <>
    <SEO title={`${document.name} - ${category?.name || 'Forms & Documents'}`} description={document.description || `Download ${document.name} from India Cyber Cafe.`} url={`https://b.indiacybercafe.com/forms-documents/${categorySlug}/${pdfSlug}`} keywords={`${document.name}, PDF, ${category?.name || 'forms and documents'}`} />
    <PdfViewerModal title={document.name} sourceUrl={pdfSourceUrl} downloadUrl={pdfDownloadUrl} onClose={() => navigate(closePath)} />
  </>;
}
