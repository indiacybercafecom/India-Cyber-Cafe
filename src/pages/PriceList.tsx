import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { SEO } from '../components/SEO';
import { Product, ProductCategory, Service } from '../types';

interface PriceListProps {
  services: Service[];
  products: Product[];
  categories: ProductCategory[];
}

const formatPrice = (value: number) => `₹${value.toLocaleString('en-IN')}`;

export function PriceList({ services, products, categories }: PriceListProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const visibleServices = useMemo(() => services.map(service => ({
    ...service,
    subservices: (service.subservices || []).filter(subservice =>
      !normalizedSearch ||
      service.name.toLowerCase().includes(normalizedSearch) ||
      subservice.name.toLowerCase().includes(normalizedSearch)
    ),
  })).filter(service => !normalizedSearch || service.subservices.length > 0 || service.name.toLowerCase().includes(normalizedSearch)), [services, normalizedSearch]);

  const visibleProducts = useMemo(() => products.filter(product =>
    !normalizedSearch ||
    product.name.toLowerCase().includes(normalizedSearch) ||
    product.category.toLowerCase().includes(normalizedSearch) ||
    product.shortDescription.toLowerCase().includes(normalizedSearch)
  ), [products, normalizedSearch]);

  const categoryName = (categoryId: string) => categories.find(category => category.id === categoryId)?.name || categoryId;
  const servicePriceCount = services.reduce((total, service) => total + (service.subservices || []).length, 0);
  const offerItems = [
    ...services.flatMap(service => (service.subservices || []).map(subservice => ({
      '@type': 'Offer',
      name: `${service.name} - ${subservice.name}`,
      price: subservice.charge,
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
      url: `https://b.indiacybercafe.com/services/${service.id}/${encodeURIComponent(subservice.name)}`,
    }))),
    ...products.map(product => ({
      '@type': 'Offer',
      name: product.name,
      price: product.discountedPrice || product.price,
      priceCurrency: 'INR',
      availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `https://b.indiacybercafe.com/store/${product.category}/${product.id}`,
    })),
  ];

  return (
    <div className="space-y-8 sm:space-y-12">
      <SEO
        title="Price List - Services, Subservices & Products"
        description={`Check the latest India Cyber Cafe price list for ${servicePriceCount} digital service charges and ${products.length} product prices. Transparent pricing for online applications, documents and products.`}
        url="https://b.indiacybercafe.com/price-list"
        keywords="India Cyber Cafe price list, service charges, online service price, product price list, digital seva charges"
        ogType="website"
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'India Cyber Cafe Price List',
          description: 'Current prices for digital services, subservices and products.',
          url: 'https://b.indiacybercafe.com/price-list',
          mainEntity: { '@type': 'OfferCatalog', name: 'India Cyber Cafe Price List', itemListElement: offerItems },
        }}
      />

      <header className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-linear-to-br from-navy via-navy-light to-slate-800 px-5 py-8 text-white shadow-xl sm:px-10 sm:py-12">
        <div className="relative z-10 max-w-3xl">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">Transparent pricing</p>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">India Cyber Cafe Price List</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-200 sm:text-base">All service charges, subservice prices and product prices in one public, easy-to-check list.</p>
        </div>
        <div className="absolute -right-8 -top-10 h-48 w-48 rounded-full border-[24px] border-primary/20" aria-hidden="true" />
      </header>

      <div className="mx-auto max-w-2xl relative">
        <IconRenderer name="search" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input type="search" aria-label="Search price list" placeholder="Search services, subservices or products..." className="input-field pl-12 py-3" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} />
      </div>

      <section aria-labelledby="service-prices-heading" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Digital seva</p>
            <h2 id="service-prices-heading" className="text-2xl font-bold text-navy sm:text-3xl">Services & subservices</h2>
          </div>
          <span className="text-right text-xs font-semibold text-slate-500">{servicePriceCount} price{servicePriceCount === 1 ? '' : 's'}</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleServices.map(service => (
            <article key={service.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-4 sm:px-5">
                <h3 className="font-bold text-navy">{service.name}</h3>
                <button type="button" className="text-xs font-bold text-primary hover:text-primary-dark" onClick={() => navigate(`/services/${service.id}`)}>View service</button>
              </div>
              {service.subservices.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {service.subservices.map(subservice => (
                    <div key={subservice.name} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                      <span className="min-w-0 text-sm text-slate-700">{subservice.name}</span>
                      <span className="shrink-0 text-right font-bold text-navy">
                        {subservice.originalCharge && subservice.originalCharge > subservice.charge && <span className="mr-2 text-xs font-normal text-slate-400 line-through">{formatPrice(subservice.originalCharge)}</span>}
                        {formatPrice(subservice.charge)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">Pricing details available on request.</p>}
            </article>
          ))}
        </div>
        {visibleServices.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No service prices match your search.</p>}
      </section>

      <section aria-labelledby="product-prices-heading" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">ICC store</p>
            <h2 id="product-prices-heading" className="text-2xl font-bold text-navy sm:text-3xl">Products</h2>
          </div>
          <span className="text-right text-xs font-semibold text-slate-500">{visibleProducts.length} product{visibleProducts.length === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden grid-cols-[1fr_10rem] border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 sm:grid"><span>Product</span><span className="text-right">Price</span></div>
          {visibleProducts.map(product => (
            <button type="button" key={product.id} className="grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-slate-100 px-4 py-4 text-left transition-colors last:border-0 hover:bg-orange-50 sm:grid-cols-[1fr_10rem] sm:px-5" onClick={() => navigate(`/store/${product.category}/${product.id}`)}>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-navy sm:text-base">{product.name}</span><span className="mt-1 block text-xs text-slate-500">{categoryName(product.category)}</span></span>
              <span className="text-right font-bold text-primary">{formatPrice(product.discountedPrice || product.price)}{product.discountedPrice && product.discountedPrice < product.price && <span className="block text-xs font-normal text-slate-400 line-through">{formatPrice(product.price)}</span>}</span>
            </button>
          ))}
        </div>
        {visibleProducts.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No product prices match your search.</p>}
      </section>
      <p className="text-center text-xs leading-relaxed text-slate-500">Prices shown are current catalog prices. Final charges, delivery fees or government fees may vary where applicable.</p>
    </div>
  );
}