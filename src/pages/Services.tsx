import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Service } from '../types';
import { IconRenderer } from '../components/Icons';
import { SEO } from '../components/SEO';

interface ServicesProps {
  services: Service[];
}

export function Services({ services }: ServicesProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.subservices.some(ss => ss.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6 sm:space-y-10">
      <SEO 
        title="All Services"
        description="Explore all digital services provided by India Cyber Cafe. From government documents to job applications, we handle it all."
        url="https://b.indiacybercafe.com/services"
      />
      <div className="text-center space-y-1 sm:space-y-2 md:space-y-3 px-2 sm:px-4">
        <h2 className="text-lg sm:text-2xl md:text-4xl font-bold text-navy line-clamp-2">Select Service</h2>
        <p className="text-[11px] sm:text-xs md:text-base text-slate-500">Choose the service you want</p>
      </div>

      <div className="max-w-xl mx-auto relative px-2 sm:px-4">
        <IconRenderer name="search" className="absolute left-4 sm:left-6 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 sm:w-5 sm:h-5" />
        <input 
          type="text" 
          placeholder="Search services..." 
          className="input-field pl-9 sm:pl-12"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6 lg:gap-8">
        {filteredServices.map(service => (
          <div 
            key={service.id} 
            className="card group cursor-pointer"
            onClick={() => navigate(`/services/${service.id}`)}
          >
            <div className={`flex items-center justify-center mx-auto mb-3 sm:mb-4 md:mb-6 transition-all w-full ${
              service.iconType === 'url' && service.icon
                ? 'aspect-video rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden'
                : 'w-12 h-12 sm:w-16 sm:h-16 bg-linear-to-br from-primary/10 to-navy/10 rounded-full group-hover:rotate-12 active:rotate-12 overflow-hidden mx-auto'
            }`}>
              {service.iconType === 'url' && service.icon ? (
                service.icon.toLowerCase().endsWith('.mp4') ? (
                  <video src={service.icon} className="w-full h-full object-contain bg-slate-100" muted autoPlay loop />
                ) : (
                  <img src={service.icon} alt={service.name} className="w-full h-full object-contain bg-slate-100" />
                )
              ) : (
                <IconRenderer name={service.icon} className="w-5 h-5 sm:w-8 sm:h-8 text-navy group-hover:text-primary active:text-primary transition-all" />
              )}
            </div>
            <h3 className="text-base sm:text-lg font-bold text-navy mb-1 sm:mb-2 line-clamp-2">{service.name}</h3>
            <p className="text-slate-500 text-xs sm:text-sm line-clamp-2">{service.description}</p>
          </div>
        ))}
      </div>

      {filteredServices.length === 0 && (
        <div className="text-center py-12 sm:py-16 md:py-20 bg-white rounded-2xl sm:rounded-3xl shadow-sm border-2 border-dashed border-slate-200 mx-2 sm:mx-4">
          <IconRenderer name="search" className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-slate-300 mx-auto mb-3 sm:mb-4" />
          <p className="text-xs sm:text-sm md:text-base text-slate-500 font-medium">No services found matching your search.</p>
        </div>
      )}
    </div>
  );
}
