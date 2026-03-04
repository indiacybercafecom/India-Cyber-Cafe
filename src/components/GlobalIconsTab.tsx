import React, { useState, useRef } from 'react';
import { GlobalIcon, Service } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';

interface GlobalIconsTabProps {
  icons: GlobalIcon[];
  services: Service[];
  onUpdate: (id: string, icon: string) => Promise<void>;
  onAdd: (icon: Omit<GlobalIcon, 'id'>) => Promise<void>;
  onUpdateService: (service: Service) => void;
}

export function GlobalIconsTab({ icons, services, onUpdate, onAdd, onUpdateService }: GlobalIconsTabProps) {
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);

  const categories = Array.from(new Set(icons.map(i => i.category)));

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, id: string, isService = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(id);
    const formData = new FormData();
    formData.append('category', isService ? 'services' : 'global');
    formData.append('icon', file);

    try {
      const response = await fetch('/api/upload-icon', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        if (isService) {
          const service = services.find(s => s.id === id);
          if (service) {
            onUpdateService({ ...service, icon: data.url });
          }
        } else {
          await onUpdate(id, data.url);
        }
        showToast('Icon updated successfully!');
      } else {
        showToast(data.message || 'Upload failed', 'error');
      }
    } catch (error) {
      showToast('Error uploading icon', 'error');
    } finally {
      setIsUploading(null);
      setActiveUploadId(null);
      setActiveServiceId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h3 className="text-2xl font-bold text-navy">Global Website Icons</h3>
        <p className="text-sm text-slate-500">Manage icons used across the website layout</p>
      </div>

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/png, image/svg+xml, image/jpeg, image/webp" 
        onChange={(e) => {
          if (activeUploadId) handleUpload(e, activeUploadId, false);
          if (activeServiceId) handleUpload(e, activeServiceId, true);
        }} 
      />

      {categories.length === 0 && (
        <div className="bg-white p-12 rounded-3xl text-center border-2 border-dashed border-slate-200">
          <IconRenderer name="image" className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500">No global icons configured yet.</p>
        </div>
      )}

      {categories.map(category => (
        <div key={category} className="space-y-4">
          <h4 className="text-lg font-bold text-navy flex items-center gap-2 uppercase tracking-wider">
            <span className="w-2 h-2 bg-primary rounded-full"></span>
            {category}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {icons.filter(i => i.category === category).map(icon => (
              <div key={icon.id} className="bg-white p-6 rounded-2xl shadow-md border border-slate-100 hover:border-primary transition-all group">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-primary/5 transition-colors">
                    <IconRenderer name={icon.icon} className="w-10 h-10 text-primary" />
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{icon.location}</span>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="relative">
                    <input 
                      type="text" 
                      className="input-field py-2 text-sm pr-10" 
                      value={icon.icon} 
                      onChange={(e) => onUpdate(icon.id, e.target.value)}
                      placeholder="Icon class or URL"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <IconRenderer name={icon.icon} className="w-4 h-4 text-slate-300" />
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => {
                      setActiveUploadId(icon.id);
                      fileInputRef.current?.click();
                    }}
                    disabled={isUploading === icon.id}
                    className="w-full btn-outline py-2 text-xs flex items-center justify-center gap-2"
                  >
                    {isUploading === icon.id ? (
                      <span className="animate-spin">...</span>
                    ) : (
                      <>
                        <IconRenderer name="upload" className="w-3 h-3" />
                        Upload New (PNG/SVG)
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Services Icons Section */}
      <div className="space-y-4 pt-8 border-t border-slate-200">
        <h4 className="text-lg font-bold text-navy flex items-center gap-2 uppercase tracking-wider">
          <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
          Service Icons
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map(service => (
            <div key={service.id} className="bg-white p-6 rounded-2xl shadow-md border border-slate-100 hover:border-emerald-500 transition-all group">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-emerald-50 transition-colors">
                  <IconRenderer name={service.icon} className="w-10 h-10 text-emerald-600" />
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Service: {service.name}</span>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="relative">
                  <input 
                    type="text" 
                    className="input-field py-2 text-sm pr-10" 
                    value={service.icon} 
                    onChange={(e) => onUpdateService({ ...service, icon: e.target.value })}
                    placeholder="Icon class or URL"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <IconRenderer name={service.icon} className="w-4 h-4 text-slate-300" />
                  </div>
                </div>
                
                <button 
                  onClick={() => {
                    setActiveServiceId(service.id);
                    fileInputRef.current?.click();
                  }}
                  disabled={isUploading === service.id}
                  className="w-full btn-outline py-2 text-xs flex items-center justify-center gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  {isUploading === service.id ? (
                    <span className="animate-spin">...</span>
                  ) : (
                    <>
                      <IconRenderer name="upload" className="w-3 h-3" />
                      Upload New (PNG/SVG)
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
