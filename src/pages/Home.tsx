import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { Service } from '../types';
import { ServiceSkeleton } from '../components/Skeleton';
import { SEO } from '../components/SEO';

interface HomeProps {
  onNavigate: (page: string) => void;
  services: Service[];
  onSelectService: (service: Service) => void;
  loading?: boolean;
}

export function Home({ onNavigate, services, onSelectService, loading }: HomeProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.description.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 3);

  return (
    <div className="space-y-8 sm:space-y-12">
      <SEO 
        title="India Cyber Cafe - Digital Seva Simplified"
        description="Apply for Government Services, Jobs & Documents online with India's trusted digital partner. Fast, secure, and reliable digital services."
      />
      {/* Hero Section */}
      <section className="bg-white p-6 sm:p-10 lg:p-12 rounded-3xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 md:gap-10 border border-slate-100">
        <div className="flex-1 space-y-3 sm:space-y-5 text-center md:text-left">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-navy leading-tight">
            India Cyber Cafe <br />
            <span className="text-primary">Digital Seva Simplified</span>
          </h1>
          <p className="text-sm sm:text-base lg:text-lg text-slate-600 max-w-md mx-auto md:mx-0">
            Apply for Government Services, Jobs & Documents online with India's trusted digital partner.
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center md:justify-start pt-2">
            <button className="btn-primary text-sm sm:text-base px-6 sm:px-8 py-2.5 sm:py-3" onClick={() => onNavigate('services')}>Apply Now</button>
            <button className="btn-outline text-sm sm:text-base px-6 sm:px-8 py-2.5 sm:py-3" onClick={() => onNavigate('track')}>Track Status</button>
          </div>
        </div>
        <div className="hidden md:flex items-center justify-center shrink-0 h-[200px] lg:h-[250px]">
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Animated background circles */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute w-32 h-32 lg:w-40 lg:h-40 rounded-full border-2 border-primary/20 animate-pulse"></div>
              <div className="absolute w-24 h-24 lg:w-32 lg:h-32 rounded-full border-2 border-primary/30 animate-spin" style={{animationDuration: '8s'}}></div>
            </div>
            {/* Monitor Icon with animation */}
            <IconRenderer name="monitor" className="w-[120px] h-[120px] lg:w-[150px] lg:h-[150px] text-primary drop-shadow-lg animate-bounce" style={{animationDuration: '2s'}} />
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {[
          { icon: 'users', count: '5000+', label: 'Active Users' },
          { icon: 'file-check', count: '2500+', label: 'Applications' },
          { icon: 'headset', count: '24/7', label: 'Support' },
          { icon: 'star', count: '4.9/5', label: 'Rating' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-4 sm:p-8 rounded-2xl text-center shadow-md border-t-4 border-primary hover:-translate-y-2 active:translate-y-0 active:scale-95 transition-all">
            <IconRenderer name={stat.icon} className="w-6 h-6 sm:w-10 sm:h-10 text-primary mx-auto mb-2 sm:mb-4" />
            <h3 className="text-xl sm:text-3xl font-bold text-navy mb-1">{stat.count}</h3>
            <p className="text-[10px] sm:text-sm text-slate-500 font-medium uppercase tracking-wider">{stat.label}</p>
          </div>
        ))}
      </section>

      {/* Popular Services Section */}
      <section className="space-y-6 sm:space-y-8">
        <div className="text-center space-y-3 sm:space-y-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-navy">Popular Services</h2>
          <div className="max-w-xl mx-auto relative">
            <IconRenderer name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search all services..." 
              className="input-field pl-12 py-2.5 sm:py-3"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <ServiceSkeleton />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredServices.map(service => (
              <div 
                key={service.id} 
                className="card group cursor-pointer p-4 sm:p-6"
                onClick={() => navigate(`/services/${service.id}`)}
              >
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-linear-to-br from-primary/10 to-navy/10 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4 group-hover:rotate-12 transition-all">
                  <IconRenderer name={service.icon} className="w-6 h-6 sm:w-8 sm:h-8 text-navy group-hover:text-primary transition-all" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-navy mb-1">{service.name}</h3>
                <p className="text-slate-500 text-[10px] sm:text-xs line-clamp-2">{service.description}</p>
              </div>
            ))}
            {filteredServices.length === 0 && searchTerm && (
              <div className="col-span-full p-10 text-center text-slate-400 italic">No services found for "{searchTerm}"</div>
            )}
          </div>
        )}

        <div className="text-center">
          <button className="btn-primary" onClick={() => onNavigate('services')}>View All Services →</button>
        </div>
      </section>

      {/* Features Section */}
      <section className="space-y-6 sm:space-y-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-navy text-center">Why Choose Us?</h2>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6 lg:gap-8">
          {[
            { icon: 'shield-check', title: '100% Secure', desc: 'Encrypted & protected data' },
            { icon: 'zap', title: 'Lightning Fast', desc: 'Instant processing' },
            { icon: 'smartphone', title: 'Mobile Friendly', desc: 'Access anywhere' },
            { icon: 'headset', title: 'Expert Support', desc: '24/7 Professional help' },
            { icon: 'check-circle', title: 'Easy Process', desc: 'Simple steps' },
            { icon: 'clock', title: 'Real-time Updates', desc: 'Instant notifications' },
          ].map((feature, i) => (
            <div key={i} className="bg-white p-4 sm:p-6 lg:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary hover:-translate-y-2 active:translate-y-0 active:scale-95 transition-all">
              <div className="w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 bg-linear-to-br from-primary/10 to-navy/10 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4 lg:mb-6">
                <IconRenderer name={feature.icon} className="w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 text-primary" />
              </div>
              <h3 className="text-sm sm:text-base lg:text-xl font-bold text-navy mb-1 sm:mb-2 lg:mb-3">{feature.title}</h3>
              <p className="text-[10px] sm:text-sm lg:text-base text-slate-600 leading-tight sm:leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="space-y-6 sm:space-y-10 bg-navy/5 p-4 sm:p-12 rounded-3xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-navy text-center">How It Works</h2>
        <div className="grid grid-cols-3 sm:grid-cols-3 lg:flex lg:flex-row items-center justify-between gap-4 sm:gap-8">
          {[
            { num: 1, icon: 'user-plus', title: 'Register', desc: 'Account' },
            { num: 2, icon: 'file-text', title: 'Select', desc: 'Service' },
            { num: 3, icon: 'user-pen', title: 'Fill', desc: 'Info' },
            { num: 4, icon: 'paper-plane', title: 'Submit', desc: 'Apply' },
            { num: 5, icon: 'eye', title: 'Track', desc: 'Status' },
          ].map((step, i) => (
            <div key={i} className="flex-1 w-full flex flex-col items-center text-center space-y-1 sm:space-y-4 relative">
              <div className="w-6 h-6 sm:w-12 sm:h-12 bg-linear-to-br from-primary to-primary-dark text-white rounded-full flex items-center justify-center font-bold text-xs sm:text-xl shadow-lg z-10">
                {step.num}
              </div>
              <IconRenderer name={step.icon} className="w-5 h-5 sm:w-10 sm:h-10 text-primary" />
              <h3 className="font-bold text-navy text-[10px] sm:text-base">{step.title}</h3>
              <p className="text-[8px] sm:text-sm text-slate-500 hidden sm:block">{step.desc}</p>
              {i < 4 && (
                <div className="hidden lg:block absolute top-6 left-[60%] w-[80%] h-1 bg-linear-to-r from-primary to-transparent" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
