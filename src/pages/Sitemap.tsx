import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';
import { Service, Product, ProductCategory, FormDocument } from '../types';

interface SitemapProps {
  services: Service[];
  products: Product[];
  categories: ProductCategory[];
  documents?: FormDocument[];
}

export function Sitemap({ services = [], products = [], categories = [], documents = [] }: SitemapProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const query = searchTerm.trim().toLowerCase();

  const mainPages = [
    { name: 'Home Page & Portal Overview', path: '/', desc: 'Primary landing hub, quick access to CSC services, order tracking, and price calculator' },
    { name: 'All Digital & CSC Services', path: '/services', desc: 'Complete catalog of online government schemes, Aadhaar UCL, GST, PAN, and certificates' },
    { name: 'Official Price List & Charges', path: '/price-list', desc: 'Transparent fee schedule, government charges, and processing turnaround timelines' },
    { name: 'Online Store - PVC Cards & Devices', path: '/store', desc: 'High-durability smart ID cards, biometric RD service scanners, and student medical guides' },
    { name: 'Government Forms & PDF Documents', path: '/forms-documents', desc: 'Free verified PDF application formats, state affidavits, and official document downloads' },
    { name: 'About India Cyber Cafe', path: '/about', desc: 'Company mission, Singrauli operational hub, team ethics, and citizen service commitment' },
    { name: 'Contact & Grievance Redressal', path: '/contact', desc: 'Customer support hotline, email, Singrauli physical address, and grievance desk' },
    { name: 'Online Payment Portal', path: '/pay', desc: 'Instant UPI, QR code, debit/credit card, and net banking payment gateway' },
    { name: 'Submit Privacy & Grievance Request', path: '/privacy-request', desc: 'DPDP Act 2023 statutory rights, data correction, and grievance submission' },
    { name: 'Track Privacy Request Status', path: '/privacy-request/track', desc: 'Real-time tracking of submitted data protection requests with token number' },
  ];

  const legalPages = [
    { name: 'Terms and Conditions', path: '/legal/terms', desc: 'Service agreement, client obligations, and cyber cafe facilitation terms' },
    { name: 'Privacy Notice (DPDP Act 2023)', path: '/legal/privacy', desc: 'Statutory privacy notice, data minimization, consent management, and rights' },
    { name: 'Refund & Cancellation Policy', path: '/legal/refund', desc: 'Fair refund terms, processing dispute rules, and transaction rollback norms' },
    { name: 'Non-Affiliation Disclaimer', path: '/legal/disclaimer', desc: 'Government non-affiliation notice, independent facilitation declaration' },
  ];

  const filteredMainPages = useMemo(() => {
    if (!query) return mainPages;
    return mainPages.filter(p => p.name.toLowerCase().includes(query) || p.desc.toLowerCase().includes(query) || p.path.includes(query));
  }, [query]);

  const filteredServices = useMemo(() => {
    if (!query) return services;
    return services.map(s => ({
      ...s,
      subservices: (s.subservices || []).filter(sub => sub.name.toLowerCase().includes(query) || s.name.toLowerCase().includes(query))
    })).filter(s => s.name.toLowerCase().includes(query) || (s.subservices && s.subservices.length > 0));
  }, [services, query]);

  const filteredProducts = useMemo(() => {
    if (!query) return products;
    return products.filter(p => p.name.toLowerCase().includes(query) || (p.category && p.category.toLowerCase().includes(query)) || (p.shortDescription && p.shortDescription.toLowerCase().includes(query)));
  }, [products, query]);

  const filteredDocuments = useMemo(() => {
    if (!query) return documents;
    return documents.filter(d => d.name.toLowerCase().includes(query) || (d.category && d.category.toLowerCase().includes(query)));
  }, [documents, query]);

  const filteredLegalPages = useMemo(() => {
    if (!query) return legalPages;
    return legalPages.filter(p => p.name.toLowerCase().includes(query) || p.desc.toLowerCase().includes(query));
  }, [query]);

  const slugify = (text: string) => {
    return String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto py-4">
      <SEO
        title="HTML Sitemap & Directory | India Cyber Cafe"
        description="Complete human-readable sitemap and directory of India Cyber Cafe. Browse all digital services, CSC forms, price list, store products, and legal policies."
        url="https://b.indiacybercafe.com/sitemap.html"
      />

      {/* Header Panel */}
      <article className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm space-y-6">
        <div className="border-b border-slate-100 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-600">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span> Universal Directory &amp; Sitemap
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#07166b] mt-2">
              India Cyber Cafe HTML Sitemap &amp; Directory
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 max-w-2xl leading-relaxed">
              A complete, human-readable overview of all public pages, digital government services, store products, and official documents available on India Cyber Cafe.
            </p>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap gap-3 items-center">
            <a
              href="/sitemap.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#07166b] text-white text-xs font-bold hover:bg-slate-800 transition-colors shadow-sm"
            >
              <span>View XML Sitemap (Crawlers)</span>
              <IconRenderer name="arrow-up-right" className="w-3.5 h-3.5" />
            </a>
            <a
              href="/robots.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
            >
              Robots.txt
            </a>
          </div>
        </div>

        {/* Filter / Search input */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between pt-2">
          <div className="relative w-full sm:w-80">
            <IconRenderer name="magnifying-glass" className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter pages, services, products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <a href="#main-pages" className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-primary hover:text-white font-semibold text-slate-700 transition-all">Main Portals</a>
            <a href="#services-list" className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-primary hover:text-white font-semibold text-slate-700 transition-all">Digital Services</a>
            <a href="#store-products" className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-primary hover:text-white font-semibold text-slate-700 transition-all">Store</a>
            <a href="#forms-documents" className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-primary hover:text-white font-semibold text-slate-700 transition-all">Documents</a>
            <a href="#legal-policies" className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-primary hover:text-white font-semibold text-slate-700 transition-all">Legal</a>
          </div>
        </div>
      </article>

      {/* 1. Main Pages */}
      <section id="main-pages" className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#07166b]">1. Core Portals &amp; Navigation Pages</h2>
            <p className="text-xs text-slate-500 mt-0.5">Primary entry points and key utility portals</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">{filteredMainPages.length} Pages</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredMainPages.map((page) => (
            <div key={page.path} className="p-4 rounded-2xl border border-slate-100 hover:border-primary/40 hover:bg-primary/5 transition-all">
              <Link to={page.path} className="text-sm font-bold text-[#07166b] hover:text-primary transition-colors flex items-center justify-between">
                <span>{page.name}</span>
                <span className="text-xs text-slate-400 font-mono">{page.path}</span>
              </Link>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{page.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Digital Services */}
      <section id="services-list" className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#07166b]">2. Digital Government Services &amp; CSC Applications</h2>
            <p className="text-xs text-slate-500 mt-0.5">Aadhaar UCL, GST, PAN, Driving License, fast-track forms, and official certificate services</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">{filteredServices.length} Categories</span>
        </div>
        <div className="space-y-6">
          {filteredServices.map((s) => (
            <div key={s.id} className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-3">
                <div>
                  <Link to={`/services/${s.id}`} className="text-base font-extrabold text-[#07166b] hover:text-primary transition-colors">
                    {s.name}
                  </Link>
                  {s.description && <p className="text-xs text-slate-500 mt-0.5">{s.description}</p>}
                </div>
                <Link to={`/services/${s.id}`} className="text-xs font-semibold text-primary hover:underline whitespace-nowrap self-start sm:self-auto">
                  View Service Page →
                </Link>
              </div>
              {s.subservices && s.subservices.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                  {s.subservices.map((sub) => {
                    const subSlug = slugify(sub.name);
                    return (
                      <Link
                        key={sub.name}
                        to={`/services/${s.id}/${subSlug}`}
                        className="p-3 bg-white rounded-xl border border-slate-200 hover:border-primary/40 hover:shadow-xs transition-all flex flex-col justify-between group"
                      >
                        <span className="text-xs font-bold text-slate-800 group-hover:text-primary transition-colors">{sub.name}</span>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                          <span className="font-bold text-[#07166b]">₹{sub.charge ?? 0}</span>
                          <span>{(sub as any).turnaroundTime || 'Fast Track'}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Direct consultation available.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 3. Products */}
      <section id="store-products" className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#07166b]">3. Online Store - PVC Smart Cards &amp; Print Products</h2>
            <p className="text-xs text-slate-500 mt-0.5">Smart ID card printing, biometric RD service scanners, and student medical reference guides</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">{filteredProducts.length} Products</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProducts.map((p) => (
            <div key={p.id} className="p-4 rounded-2xl border border-slate-100 hover:border-primary/40 hover:shadow-xs transition-all flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{p.category || 'General'}</span>
                <Link to={`/store/${p.category}/${p.id}`} className="block text-sm font-bold text-[#07166b] hover:text-primary transition-colors mt-0.5">
                  {p.name}
                </Link>
                {p.shortDescription && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.shortDescription}</p>}
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="font-bold text-[#07166b]">₹{p.price}</span>
                <Link to={`/store/${p.category}/${p.id}`} className="text-primary font-semibold hover:underline">View Product →</Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Documents */}
      {filteredDocuments.length > 0 && (
        <section id="forms-documents" className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-xl font-extrabold text-[#07166b]">4. Government Forms &amp; PDF Document Downloads</h2>
              <p className="text-xs text-slate-500 mt-0.5">Verified application formats, legal declarations, and official state forms</p>
            </div>
            <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">{filteredDocuments.length} Documents</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDocuments.map((doc) => {
              const catSlug = slugify(doc.category || 'general');
              const docSlug = slugify(doc.name);
              return (
                <div key={doc.id || doc.name} className="p-4 rounded-2xl border border-slate-100 hover:border-primary/40 hover:shadow-xs transition-all flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{doc.category || 'Forms'}</span>
                    <Link to={`/forms-documents/${catSlug}/${docSlug}`} className="block text-sm font-bold text-[#07166b] hover:text-primary transition-colors mt-0.5">
                      {doc.name}
                    </Link>
                    {doc.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{doc.description}</p>}
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      PDF Document
                    </span>
                    <Link to={`/forms-documents/${catSlug}/${docSlug}`} className="text-primary font-semibold hover:underline">Download →</Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 5. Legal */}
      <section id="legal-policies" className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#07166b]">5. Legal, Statutory &amp; Compliance Policies</h2>
            <p className="text-xs text-slate-500 mt-0.5">Consumer protection and privacy framework strictly adhered to by India Cyber Cafe</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">{filteredLegalPages.length} Policies</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredLegalPages.map((page) => (
            <div key={page.path} className="p-4 rounded-2xl border border-slate-100 hover:border-primary/40 hover:bg-primary/5 transition-all">
              <Link to={page.path} className="text-sm font-bold text-[#07166b] hover:text-primary transition-colors flex items-center justify-between">
                <span>{page.name}</span>
                <span className="text-xs text-slate-400 font-mono">{page.path}</span>
              </Link>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{page.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
