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
      <div className="text-center space-y-2 sm:space-y-4">
        <h2 className="text-2xl sm:text-4xl font-bold text-navy">Select Service</h2>
        <p className="text-sm sm:text-base text-slate-500">Choose the service you want to apply for</p>
      </div>

      <div className="max-w-xl mx-auto relative">
        <IconRenderer name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input 
          type="text" 
          placeholder="Search services..." 
          className="input-field pl-12"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-8">
        {filteredServices.map(service => (
          <div 
            key={service.id} 
            className="card group cursor-pointer p-6 sm:p-8"
            onClick={() => navigate(`/services/${service.id}`)}
          >
            <div className="w-14 h-14 sm:w-20 sm:h-20 bg-linear-to-br from-primary/10 to-navy/10 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6 group-hover:rotate-12 active:rotate-12 transition-all overflow-hidden">
              {service.iconType === 'url' && service.icon ? (
                service.icon.toLowerCase().endsWith('.mp4') ? (
                  <video src={service.icon} className="w-full h-full object-cover" muted autoPlay loop />
                ) : (
                  <img src={service.icon} alt={service.name} className="w-full h-full object-cover" />
                )
              ) : (
                <IconRenderer name={service.icon} className="w-6 h-6 sm:w-10 sm:h-10 text-navy group-hover:text-primary active:text-primary transition-all" />
              )}
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-navy mb-1 sm:mb-2">{service.name}</h3>
            <p className="text-slate-500 text-xs sm:text-sm line-clamp-2">{service.description}</p>
          </div>
        ))}
      </div>

      {filteredServices.length === 0 && (
        <div className="text-center py-20 bg-white rounded-3xl shadow-sm border-2 border-dashed border-slate-200">
          <IconRenderer name="search" className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 font-medium">No services found matching your search.</p>
        </div>
      )}
    </div>
  );
}
