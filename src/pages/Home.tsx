import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { Service, Product } from '../types';
import { ServiceSkeleton } from '../components/Skeleton';
import { SEO } from '../components/SEO';

interface HomeProps {
  onNavigate: (page: string) => void;
  services: Service[];
  products?: Product[];
  onSelectService: (service: Service) => void;
  loading?: boolean;
}

export function Home({ onNavigate, services, products = [], onSelectService, loading }: HomeProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  // Get popular products (in stock, filtered)
  const popularProducts = products
    .filter(p => p.inStock)
    .sort((a, b) => (b.ratings?.count || 0) - (a.ratings?.count || 0))
    .slice(0, 3);

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.description.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 3);

  return (
    <div className="space-y-6 sm:space-y-10 md:space-y-12">
      <SEO 
        title="India Cyber Cafe - Digital Seva Simplified"
        description="Apply for Government Services, Jobs & Documents online with India's trusted digital partner. Fast, secure, and reliable digital services."
      />
      {/* Hero Section */}
      <section className="bg-white p-4 sm:p-8 md:p-10 lg:p-12 rounded-2xl sm:rounded-3xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6 md:gap-8 lg:gap-10 border border-slate-100">
        <div className="flex-1 space-y-2 sm:space-y-4 md:space-y-5 text-center md:text-left w-full">
          <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold text-navy leading-snug sm:leading-tight">
            India Cyber Cafe <br className="hidden sm:inline" />
            <span className="text-primary">Digital Seva Simplified</span>
          </h1>
          <p className="text-xs sm:text-sm md:text-base lg:text-lg text-slate-600 max-w-md mx-auto md:mx-0 line-clamp-3">
            Apply for Government Services, Jobs & Documents online with India's trusted digital partner.
          </p>
          <div className="flex flex-col xs:flex-row flex-wrap gap-2 sm:gap-3 justify-center md:justify-start pt-1 sm:pt-2">
            <button className="btn-primary text-xs sm:text-sm md:text-base px-4 sm:px-6 md:px-8 py-2 sm:py-2.5 md:py-3 w-full xs:w-auto min-h-[40px] sm:min-h-[44px]" onClick={() => onNavigate('services')}>Apply Now</button>
            <button className="btn-outline text-xs sm:text-sm md:text-base px-4 sm:px-6 md:px-8 py-2 sm:py-2.5 md:py-3 w-full xs:w-auto min-h-[40px] sm:min-h-[44px]" onClick={() => onNavigate('track')}>Track Status</button>
          </div>
        </div>
        {/* Mobile Animation - Smaller on mobile */}
        <div className="hidden sm:flex items-center justify-center shrink-0 h-[200px] sm:h-[250px] md:h-[280px] lg:h-[300px] w-full sm:w-auto">
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Animated background circles */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 lg:w-40 lg:h-40 rounded-full border-2 border-primary/20 animate-pulse"></div>
              <div className="absolute w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:w-32 lg:h-32 rounded-full border-2 border-primary/30 animate-spin" style={{animationDuration: '8s'}}></div>
            </div>
            {/* Lottie Animation - Responsive sizing */}
            <dotlottie-wc src="https://lottie.host/ec4bf91c-cc73-4056-b87f-9eaedb9293d9/M8QLqGxWFm.lottie" style={{width: 'min(100%, 300px)', height: 'min(100%, 300px)', maxWidth: '300px'}} autoplay loop></dotlottie-wc>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-5 lg:gap-6">
        {[
          { icon: 'users', count: '5000+', label: 'Active Users' },
          { videoUrl: 'https://cdn-icons-mp4.freepik.com/512/18997/18997679.mp4', count: '2500+', label: 'Applications' },
          { videoUrl: 'https://cdn-icons-mp4.freepik.com/512/15370/15370738.mp4', count: '24/7', label: 'Support' },
          { icon: 'star', count: '4.9/5', label: 'Rating' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-3 sm:p-4 md:p-6 lg:p-8 rounded-xl sm:rounded-2xl text-center shadow-md border-t-4 border-primary hover:-translate-y-1 sm:hover:-translate-y-2 active:translate-y-0 active:scale-95 transition-all min-h-[120px] sm:min-h-[140px] md:min-h-[160px] flex flex-col items-center justify-center">
            {stat.videoUrl ? (
              <video 
                src={stat.videoUrl} 
                className="w-5 h-5 sm:w-8 sm:h-8 md:w-10 md:h-10 lg:w-12 lg:h-12 mx-auto mb-1 sm:mb-2 md:mb-3"
                autoPlay
                loop
                muted
                loading="lazy"
              />
            ) : (
              <IconRenderer name={stat.icon} className="w-5 h-5 sm:w-8 sm:h-8 md:w-10 md:h-10 lg:w-12 lg:h-12 text-primary mx-auto mb-1 sm:mb-2 md:mb-3" />
            )}
            <h3 className="text-base sm:text-xl md:text-2xl lg:text-3xl font-bold text-navy mb-0.5 sm:mb-1">{stat.count}</h3>
            <p className="text-[8px] sm:text-[10px] md:text-xs lg:text-sm text-slate-500 font-medium uppercase tracking-widest line-clamp-2">{stat.label}</p>
          </div>
        ))}
      </section>

      {/* Popular Services Section */}
      <section className="space-y-4 sm:space-y-6 md:space-y-8">
        <div className="text-center space-y-2 sm:space-y-3 md:space-y-4">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-navy">Popular Services</h2>
          <div className="max-w-xl mx-auto relative">
            <IconRenderer name="search" className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 sm:w-5 sm:h-5" />
            <input 
              type="text" 
              placeholder="Search services..." 
              className="input-field pl-9 sm:pl-12 py-2 sm:py-2.5 md:py-3 w-full text-xs sm:text-sm"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {loading && services.length === 0 ? (
          <ServiceSkeleton />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
            {filteredServices.map(service => (
              <div 
                key={service.id} 
                className="card group cursor-pointer p-3 sm:p-4 md:p-5 lg:p-6 min-h-[180px] sm:min-h-[200px] flex flex-col"
                onClick={() => navigate(`/services/${service.id}`)}
              >
                <div className={`flex items-center justify-center mx-auto mb-2 sm:mb-3 md:mb-4 transition-all ${
                  service.iconType === 'url' && service.icon
                    ? 'w-full h-28 sm:h-32 md:h-40 lg:h-48 rounded-lg sm:rounded-xl border border-slate-200 overflow-hidden'
                    : 'w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 bg-linear-to-br from-primary/10 to-navy/10 rounded-full group-hover:rotate-12 overflow-hidden flex-shrink-0'
                }`}>
                  {service.iconType === 'url' && service.icon ? (
                    service.icon.toLowerCase().endsWith('.mp4') ? (
                      <video 
                        src={service.icon} 
                        className="w-full h-full object-cover" 
                        muted 
                        autoPlay 
                        loop
                        loading="lazy"
                      />
                    ) : (
                      <img 
                        src={service.icon} 
                        alt={service.name} 
                        className="w-full h-full object-cover" 
                        loading="lazy"
                      />
                    )
                  ) : (
                    <IconRenderer name={service.icon} className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 text-navy group-hover:text-primary transition-all" />
                  )}
                </div>
                <h3 className="text-sm sm:text-base md:text-lg font-bold text-navy mb-1 line-clamp-2">{service.name}</h3>
                <p className="text-slate-500 text-[11px] sm:text-xs md:text-sm line-clamp-2 flex-grow">{service.description}</p>
              </div>
            ))}
            {filteredServices.length === 0 && searchTerm && (
              <div className="col-span-full p-8 sm:p-10 text-center text-slate-400 italic text-sm">No services found for "{searchTerm}"</div>
            )}
          </div>
        )}

        <div className="text-center">
          <button className="btn-primary text-xs sm:text-sm md:text-base px-4 sm:px-6 md:px-8 py-2 sm:py-2.5 md:py-3 min-h-[40px] sm:min-h-[44px]" onClick={() => onNavigate('services')}>View All Services →</button>
        </div>
      </section>

      {/* Features Section */}
      <section className="space-y-4 sm:space-y-6 md:space-y-8 lg:space-y-10">
        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-navy text-center">Why Choose Us?</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 md:gap-4 lg:gap-6">
          {[
            { icon: 'shield-check', title: '100% Secure', desc: 'Encrypted & protected' },
            { icon: 'zap', title: 'Lightning Fast', desc: 'Instant processing' },
            { icon: 'smartphone', title: 'Mobile Friendly', desc: 'Access anywhere' },
            { icon: 'headset', title: 'Expert Support', desc: '24/7 Help' },
            { icon: 'check-circle', title: 'Easy Process', desc: 'Simple steps' },
            { icon: 'clock', title: 'Real-time Updates', desc: 'Instant alerts' },
          ].map((feature, i) => (
            <div key={i} className="bg-white p-3 sm:p-4 md:p-6 lg:p-10 rounded-lg sm:rounded-2xl text-center shadow-md border-t-4 border-primary hover:-translate-y-1 sm:hover:-translate-y-2 active:translate-y-0 active:scale-95 transition-all min-h-[130px] sm:min-h-[150px] md:min-h-[160px] lg:min-h-[180px] flex flex-col items-center justify-center">
              <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 lg:w-16 lg:h-16 bg-linear-to-br from-primary/10 to-navy/10 rounded-full flex items-center justify-center mx-auto mb-1.5 sm:mb-2 md:mb-4 lg:mb-6">
                <IconRenderer name={feature.icon} className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 lg:w-8 lg:h-8 text-primary" />
              </div>
              <h3 className="text-xs sm:text-sm md:text-base lg:text-xl font-bold text-navy mb-0.5 sm:mb-1 lg:mb-2 line-clamp-2">{feature.title}</h3>
              <p className="text-[9px] sm:text-[10px] md:text-sm lg:text-base text-slate-600 line-clamp-2">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Popular Products Section */}
      <section className="space-y-4 sm:space-y-6 md:space-y-8">
        <div className="text-center space-y-1.5 sm:space-y-2 md:space-y-3 lg:space-y-4">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-navy">Popular Products</h2>
          <p className="text-xs sm:text-sm md:text-base text-slate-600">Premium prints & services</p>
        </div>

        {popularProducts.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 md:gap-4 lg:gap-6">
              {popularProducts.map(product => (
                <div
                  key={product.id}
                  className="group cursor-pointer bg-white rounded-lg sm:rounded-xl md:rounded-2xl overflow-hidden border border-slate-200 hover:border-primary hover:shadow-lg transition-all"
                  onClick={() => navigate(`/store/${product.category}/${product.id}`)}
                >
                  {/* Image Container */}
                  <div className="relative aspect-square overflow-hidden bg-slate-100">
                    <img
                      src={product.images[0]}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                    {product.discountedPrice && (
                      <div className="absolute top-1.5 sm:top-2 right-1.5 sm:right-2 bg-red-500 text-white px-1.5 sm:px-2 md:px-3 py-0.5 sm:py-1 rounded-full text-[9px] sm:text-xs md:text-sm font-bold">
                        {Math.round(((product.price - product.discountedPrice) / product.price) * 100)}% OFF
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-2 sm:p-3 md:p-4">
                    {/* Name */}
                    <h3 className="text-[11px] sm:text-sm md:text-base font-bold text-navy mb-0.5 sm:mb-1 line-clamp-2 group-hover:text-primary transition-colors">
                      {product.name}
                    </h3>

                    {/* Description */}
                    <p className="text-[9px] sm:text-xs md:text-xs text-slate-500 mb-1 sm:mb-1.5 md:mb-2 line-clamp-1">
                      {product.shortDescription}
                    </p>

                    {/* Rating */}
                    {product.ratings && product.ratings.count > 0 && (
                      <div className="flex items-center gap-0.5 sm:gap-1 mb-1 sm:mb-1.5 md:mb-2">
                        <div className="flex text-yellow-400">
                          {[...Array(5)].map((_, i) => (
                            <span key={i} className="text-[8px] sm:text-[9px] md:text-xs">
                              {i < Math.round(product.ratings!.average) ? '★' : '☆'}
                            </span>
                          ))}
                        </div>
                        <span className="text-[7px] sm:text-[8px] md:text-[9px] text-slate-500">
                          ({product.ratings.count})
                        </span>
                      </div>
                    )}

                    {/* Price */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className="text-[11px] sm:text-sm md:text-base font-bold text-navy">
                        ₹{product.discountedPrice || product.price}
                      </span>
                      {product.discountedPrice && (
                        <span className="text-[8px] sm:text-[9px] md:text-xs text-slate-400 line-through">
                          ₹{product.price}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-center">
              <button className="btn-primary text-xs sm:text-sm md:text-base px-4 sm:px-6 md:px-8 py-2 sm:py-2.5 md:py-3 min-h-[40px] sm:min-h-[44px]" onClick={() => navigate('store')}>
                Explore Store →
              </button>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-xl sm:rounded-2xl p-6 sm:p-8 md:p-12 lg:p-16 text-center border border-slate-200">
            <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 bg-slate-100 rounded-lg sm:rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-2 sm:mb-3 md:mb-4">
              <svg className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <h3 className="text-base sm:text-lg md:text-xl font-bold text-navy mb-1 sm:mb-2">No Products Available</h3>
            <p className="text-xs sm:text-sm md:text-base text-slate-500 mb-4 sm:mb-6">Our store is coming soon with amazing products!</p>
            <button className="btn-primary text-xs sm:text-sm md:text-base px-4 sm:px-6 md:px-8 py-2 sm:py-2.5 md:py-3 min-h-[40px] sm:min-h-[44px]" onClick={() => navigate('store')}>
              View Store
            </button>
          </div>
        )}
      </section>

      {/* How It Works */}
      <section className="space-y-4 sm:space-y-6 md:space-y-8 lg:space-y-10 bg-navy/5 p-3 sm:p-6 md:p-8 lg:p-12 rounded-2xl sm:rounded-3xl">
        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-navy text-center">How It Works</h2>
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3 md:gap-4 lg:gap-6 md:flex md:flex-row md:items-center md:justify-between max-w-5xl mx-auto">
          {[
            { num: 1, icon: 'user-plus', title: 'Register', desc: 'Account' },
            { num: 2, icon: 'file-text', title: 'Select', desc: 'Service' },
            { num: 3, icon: 'user-pen', title: 'Fill', desc: 'Info' },
            { num: 4, icon: 'paper-plane', title: 'Submit', desc: 'Apply' },
            { num: 5, icon: 'eye', title: 'Track', desc: 'Status' },
          ].map((step, i) => (
            <div key={i} className="flex-1 w-full flex flex-col items-center text-center space-y-1 sm:space-y-2 md:space-y-3 relative">
              <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 lg:w-14 lg:h-14 bg-linear-to-br from-primary to-primary-dark text-white rounded-full flex items-center justify-center font-bold text-[11px] sm:text-sm md:text-base lg:text-lg shadow-lg z-10 flex-shrink-0">
                {step.num}
              </div>
              <IconRenderer name={step.icon} className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 lg:w-10 lg:h-10 text-primary flex-shrink-0" />
              <h3 className="font-bold text-navy text-[10px] sm:text-xs md:text-sm lg:text-base line-clamp-2">{step.title}</h3>
              <p className="text-[8px] sm:text-[9px] md:text-xs lg:text-sm text-slate-600 hidden sm:block">{step.desc}</p>
              {i < 4 && (
                <div className="hidden md:block absolute top-5 lg:top-6 left-[55%] w-[85%] md:w-[100%] lg:w-[110%] h-1 bg-linear-to-r from-primary to-transparent -z-10" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
