import { useMemo, useState } from 'react';
import { IconRenderer } from '../components/Icons';
import { SEO } from '../components/SEO';
import { SelectDropdown } from '../components/SelectDropdown';

export const documentCategories = [
  'Government Forms',
  'Applications',
  'Affidavit & Declaration',
  'Resume/CV',
  'Biodata',
  'Education',
  'Jobs',
  'Banking',
  'Aadhaar/PAN',
  'Vehicle',
  'Legal',
  'Business',
  'Undertaking',
  'Other',
] as const;

export interface FormDocument {
  id: string;
  name: string;
  description: string;
  category: (typeof documentCategories)[number];
  previewUrl: string;
  downloadUrl: string;
  fileType: 'PDF';
}

const sampleDriveFileId = '1HzmXcOlSft17NdUgK7w7CFszRryP8M2K';
const sampleDrivePreviewUrl = `https://drive.google.com/file/d/${sampleDriveFileId}/preview`;
const sampleDriveDownloadUrl = `https://drive.google.com/uc?export=download&id=${sampleDriveFileId}`;

// This collection can later be replaced by a Firebase/Storage query without changing the card UI.
export const sampleDocuments: FormDocument[] = [
  {
    id: 'sample-government-form',
    name: 'Sample Government Form',
    description: 'Example PDF document for testing the Forms & Documents library.',
    category: 'Government Forms',
    previewUrl: sampleDrivePreviewUrl,
    downloadUrl: sampleDriveDownloadUrl,
    fileType: 'PDF',
  },
];

export function FormsDocuments() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | (typeof documentCategories)[number]>('All');
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredDocuments = useMemo(() => sampleDocuments.filter(document => {
    const matchesCategory = selectedCategory === 'All' || document.category === selectedCategory;
    const matchesSearch = !normalizedSearch || [document.name, document.description, document.category]
      .some(value => value.toLowerCase().includes(normalizedSearch));
    return matchesCategory && matchesSearch;
  }), [normalizedSearch, selectedCategory]);

  const categoryOptions = [
    { value: 'All', label: 'All Categories' },
    ...documentCategories.map(category => ({ value: category, label: category })),
  ];

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
          <SelectDropdown
            options={categoryOptions}
            value={selectedCategory}
            onChange={value => setSelectedCategory(value as typeof selectedCategory)}
            containerClassName="w-full sm:w-64 shrink-0"
            className="input-field py-3"
            ariaLabel="Filter documents by category"
            leadingIcon="filter"
          />
        </div>
      </section>

      <section aria-labelledby="documents-heading" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Document library</p>
            <h2 id="documents-heading" className="text-2xl font-bold text-navy sm:text-3xl">Available PDFs</h2>
          </div>
          <span className="text-right text-xs font-semibold text-slate-500">{filteredDocuments.length} document{filteredDocuments.length === 1 ? '' : 's'}</span>
        </div>

        {filteredDocuments.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredDocuments.map(document => (
              <article key={document.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-primary">
                    <IconRenderer name="file-text" className="h-6 w-6" />
                  </div>
                  <span className="rounded-md bg-red-50 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-red-600">{document.fileType}</span>
                </div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-primary">{document.category}</p>
                <h3 className="text-lg font-bold leading-snug text-navy">{document.name}</h3>
                <p className="mt-2 min-h-12 text-sm leading-relaxed text-slate-500">{document.description}</p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <a href={document.previewUrl} target="_blank" rel="noopener noreferrer" className="btn-outline px-3 py-2 text-xs" aria-label={`Preview ${document.name}`}>
                    <IconRenderer name="eye" className="h-4 w-4" />
                    Preview
                  </a>
                  <a href={document.downloadUrl} download={`${document.name}.pdf`} target="_blank" rel="noopener noreferrer" className="btn-primary px-3 py-2 text-xs" aria-label={`Download ${document.name}`}>
                    <IconRenderer name="download" className="h-4 w-4" />
                    Download
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <IconRenderer name="file-text" className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-600">No documents match your search.</p>
            <p className="mt-1 text-sm text-slate-500">Try another search term or category.</p>
          </div>
        )}
      </section>
    </div>
  );
}
