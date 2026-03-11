import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Service } from '../types';
import { IconRenderer } from '../components/Icons';
import { SEO } from '../components/SEO';

interface ServiceDetailProps {
  services: Service[];
}

export function ServiceDetail({ services }: ServiceDetailProps) {
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();
  
  const service = services.find(s => s.id === serviceId);

  const slugify = (text: string) => text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

  if (!service) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-navy">Service Not Found</h2>
        <button onClick={() => navigate('/services')} className="btn-primary mt-4">Back to Services</button>
      </div>
    );
  }

  return (
    <div className="space-y-8 sm:space-y-12">
      <SEO 
        title={`${service.name} Services`}
        description={service.description}
        keywords={`${service.name}, ${service.subservices.map(ss => ss.name).join(', ')}, India Cyber Cafe`}
        url={`https://b.indiacybercafe.com/services/${service.id}`}
      />
      <div className="flex flex-col sm:flex-row items-center gap-6 bg-white p-6 sm:p-10 rounded-3xl shadow-xl border border-slate-100">
        <div className={`flex items-center justify-center shrink-0 overflow-hidden ${
          service.iconType === 'url' && service.icon
            ? 'w-full sm:w-64 h-48 sm:h-56 rounded-2xl border border-slate-200'
            : 'w-20 h-20 sm:w-24 sm:h-24 bg-linear-to-br from-primary/10 to-navy/10 rounded-full'
        }`}>
          {service.iconType === 'url' && service.icon ? (
            service.icon.toLowerCase().endsWith('.mp4') ? (
              <video src={service.icon} className="w-full h-full object-cover" muted autoPlay loop />
            ) : (
              <img src={service.icon} alt={service.name} className="w-full h-full object-cover" />
            )
          ) : (
            <IconRenderer name={service.icon} className="w-10 h-10 sm:w-12 sm:h-12 text-navy" />
          )}
        </div>
        <div className="text-center sm:text-left space-y-2">
          <h2 className="text-3xl sm:text-4xl font-bold text-navy">{service.name}</h2>
          <p className="text-slate-500 max-w-2xl">{service.description}</p>
        </div>
      </div>

      <div className="space-y-6">
        <h3 className="text-2xl font-bold text-navy px-2">Select a Sub-Service</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {service.subservices.map((ss, i) => (
            <div 
              key={i} 
              className="bg-white rounded-2xl shadow-md border border-slate-100 hover:border-primary hover:shadow-xl transition-all cursor-pointer group overflow-hidden flex flex-col h-full"
              onClick={() => navigate(`/services/${service.id}/${slugify(ss.name)}`)}
            >
              {/* Sub-Service Image/Icon Display */}
              {ss.image && (
                <div className={`w-full flex items-center justify-center overflow-hidden ${
                  ss.imageType === 'url' && ss.image
                    ? 'h-48 sm:h-56 bg-slate-100'
                    : 'h-20 sm:h-24 bg-primary/10'
                }`}>
                  {ss.imageType === 'url' && ss.image ? (
                    ss.image.toLowerCase().endsWith('.mp4') ? (
                      <video src={ss.image} className="w-full h-full object-cover" muted autoPlay loop />
                    ) : (
                      <img src={ss.image} alt={ss.name} className="w-full h-full object-cover" />
                    )
                  ) : (
                    <IconRenderer name={ss.image || 'file-circle-plus'} className="w-10 h-10 sm:w-12 sm:h-12 text-primary" />
                  )}
                </div>
              )}
              
              {/* Sub-Service Content */}
              <div className="p-6 flex flex-col flex-1">
                <div className="flex justify-between items-start mb-4 flex-1">
                  <div className="space-y-2 flex-1">
                    <h4 className="text-lg font-bold text-navy">{ss.name}</h4>
                  </div>
                  <div className="text-right ml-4">
                    <div className="flex items-center gap-2 justify-end">
                      {ss.originalCharge && ss.originalCharge > ss.charge && (
                        <span className="text-xs text-slate-400 line-through">₹{ss.originalCharge}</span>
                      )}
                      <span className="text-lg font-bold text-primary">₹{ss.charge}</span>
                    </div>
                    {ss.originalCharge && ss.originalCharge > ss.charge && (
                      <span className="inline-block bg-green-100 text-green-600 text-[10px] font-bold px-2 py-0.5 rounded-full mt-1">
                        {Math.round(((ss.originalCharge - ss.charge) / ss.originalCharge) * 100)}% OFF
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2 mt-auto">
                  {ss.paymentMethods.map((pm, idx) => (
                    <span key={idx} className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-1 rounded">
                      {pm.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
