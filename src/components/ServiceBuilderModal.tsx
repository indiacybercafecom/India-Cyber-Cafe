import React, { useState, useRef } from 'react';
import { Service, ServiceField, SubService } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { motion } from 'motion/react';

interface ServiceBuilderModalProps {
  service: Service | null;
  onClose: () => void;
  onSave: (service: Service) => void;
}

export function ServiceBuilderModal({ service, onClose, onSave }: ServiceBuilderModalProps) {
  const [name, setName] = useState(service?.name || '');
  const [icon, setIcon] = useState(service?.icon || 'file-text');
  const [description, setDescription] = useState(service?.description || '');
  const [fields, setFields] = useState<ServiceField[]>(service?.fields || []);
  const [subservices, setSubservices] = useState<SubService[]>(service?.subservices || []);
  const [css, setCss] = useState(service?.css || '');
  const [isUploading, setIsUploading] = useState(false);
  const [mainFieldsJsonMode, setMainFieldsJsonMode] = useState(false);
  const [subserviceJsonModes, setSubserviceJsonModes] = useState<Record<number, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddField = () => {
    setFields([...fields, { label: '', type: 'text' }]);
  };

  const handleAddSubService = () => {
    setSubservices([...subservices, { name: '', charge: 0, paymentMethods: ['razorpay', 'cash'] }]);
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('category', name || 'general');
    formData.append('icon', file);

    try {
      const response = await fetch('/api/upload-icon', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        setIcon(data.url);
        showToast('Icon uploaded successfully!');
      } else {
        showToast(data.message || 'Upload failed', 'error');
      }
    } catch (error) {
      showToast('Error uploading icon', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = () => {
    if (!name) return showToast('Name is required', 'error');
    
    const newService: Service = {
      id: service?.id || name.toLowerCase().replace(/ /g, '-'),
      name,
      icon,
      description,
      fields,
      subservices,
      css
    };
    onSave(newService);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-4xl relative overflow-hidden shadow-2xl flex flex-col max-h-[95vh]"
      >
        <div className="p-6 bg-primary text-white flex justify-between items-center">
          <h3 className="text-xl font-bold">Service Builder</h3>
          <button onClick={onClose} className="hover:rotate-90 transition-all">
            <IconRenderer name="x" className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block font-bold text-navy">Service Name</label>
              <input type="text" className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Passport Application" />
            </div>
            <div className="space-y-2">
              <label className="block font-bold text-navy">Icon (Class or URL)</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input type="text" className="input-field pr-10" value={icon} onChange={e => setIcon(e.target.value)} placeholder="e.g., fingerprint" />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <IconRenderer name={icon} className="w-5 h-5 text-slate-400" />
                  </div>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleIconUpload} 
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="btn-outline py-2 px-3 text-sm flex items-center gap-2 whitespace-nowrap"
                >
                  {isUploading ? '...' : <IconRenderer name="upload" className="w-4 h-4" />}
                  Upload
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-bold text-navy">Description</label>
            <textarea className="input-field min-h-[80px]" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of the service" />
          </div>

          {/* Sub-Services */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-navy">Sub-Services & Charges</h4>
              <button onClick={handleAddSubService} className="btn-outline py-2 px-4 text-sm flex items-center gap-2"><IconRenderer name="plus" className="w-4 h-4" /> Add Sub-Service</button>
            </div>
            <div className="space-y-4">
              {subservices.map((ss, i) => (
                <div key={i} className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-4">
                  <div className="flex gap-3 items-center">
                    <input type="text" className="input-field py-2" placeholder="Sub-service name" value={ss.name} onChange={e => {
                      const newSS = [...subservices];
                      newSS[i].name = e.target.value;
                      setSubservices(newSS);
                    }} />
                    <input type="number" className="input-field py-2 w-32" placeholder="Charge" value={ss.charge} onChange={e => {
                      const newSS = [...subservices];
                      newSS[i].charge = parseFloat(e.target.value);
                      setSubservices(newSS);
                    }} />
                    <input type="number" className="input-field py-2 w-32" placeholder="Orig. Price" value={ss.originalCharge || ''} onChange={e => {
                      const newSS = [...subservices];
                      newSS[i].originalCharge = parseFloat(e.target.value);
                      setSubservices(newSS);
                    }} />
                    <button onClick={() => setSubservices(subservices.filter((_, idx) => idx !== i))} className="text-red-500 hover:scale-110 transition-all"><IconRenderer name="trash" className="w-5 h-5" /></button>
                  </div>
                  
                  {/* Sub-service specific fields */}
                  <div className="pl-6 border-l-2 border-primary/20 space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <h5 className="text-sm font-bold text-navy/70 uppercase tracking-wider">Sub-Service Fields (Optional)</h5>
                        <button 
                          onClick={() => setSubserviceJsonModes(prev => ({ ...prev, [i]: !prev[i] }))}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${subserviceJsonModes[i] ? 'bg-primary text-white border-primary' : 'text-slate-400 border-slate-200 hover:border-primary hover:text-primary'}`}
                        >
                          {subserviceJsonModes[i] ? 'Manual UI' : 'JSON Mode'}
                        </button>
                      </div>
                      {!subserviceJsonModes[i] && (
                        <button 
                          onClick={() => {
                            const newSS = [...subservices];
                            if (!newSS[i].fields) newSS[i].fields = [];
                            newSS[i].fields!.push({ label: '', type: 'text' });
                            setSubservices(newSS);
                          }}
                          className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                        >
                          <IconRenderer name="plus" className="w-3 h-3" /> Add Field
                        </button>
                      )}
                    </div>

                    {/* Payment Methods for Sub-Service */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-navy/50 uppercase">Payment Methods</label>
                      <div className="flex flex-wrap gap-2">
                        {['cash', 'razorpay', 'pay_after_work', 'free'].map(m => (
                          <label key={m} className="flex items-center gap-1 text-xs bg-white px-2 py-1 rounded border border-slate-200 cursor-pointer hover:border-primary transition-all">
                            <input 
                              type="checkbox" 
                              checked={ss.paymentMethods.includes(m)}
                              onChange={e => {
                                const newSS = [...subservices];
                                if (e.target.checked) {
                                  newSS[i].paymentMethods = [...newSS[i].paymentMethods, m];
                                } else {
                                  newSS[i].paymentMethods = newSS[i].paymentMethods.filter(pm => pm !== m);
                                }
                                setSubservices(newSS);
                              }}
                            />
                            <span className="capitalize">{m.replace(/_/g, ' ')}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    
                    {subserviceJsonModes[i] ? (
                      <textarea 
                        className="input-field font-mono text-xs min-h-[150px] bg-slate-900 text-emerald-400 p-4"
                        value={JSON.stringify(ss.fields || [], null, 2)}
                        onChange={e => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            const newSS = [...subservices];
                            newSS[i].fields = parsed;
                            setSubservices(newSS);
                          } catch (err) {
                            // Don't update if invalid JSON, but allow typing
                          }
                        }}
                      />
                    ) : (
                      <>
                        {ss.fields && ss.fields.length > 0 ? (
                          <div className="space-y-2">
                            {ss.fields.map((f, fi) => (
                              <div key={fi} className="flex gap-2 items-center">
                                <input type="text" className="input-field py-1 text-sm" placeholder="Field Label" value={f.label} onChange={e => {
                                  const newSS = [...subservices];
                                  newSS[i].fields![fi].label = e.target.value;
                                  setSubservices(newSS);
                                }} />
                                <select className="input-field py-1 text-sm w-32" value={f.type} onChange={e => {
                                  const newSS = [...subservices];
                                  newSS[i].fields![fi].type = e.target.value as any;
                                  setSubservices(newSS);
                                }}>
                                  <option value="text">Text</option>
                                  <option value="email">Email</option>
                                  <option value="phone">Phone</option>
                                  <option value="date">Date</option>
                                  <option value="file">File</option>
                                  <option value="textarea">Textarea</option>
                                  <option value="select">Select</option>
                                </select>
                                <button onClick={() => {
                                  const newSS = [...subservices];
                                  newSS[i].fields = newSS[i].fields!.filter((_, idx) => idx !== fi);
                                  setSubservices(newSS);
                                }} className="text-red-400 hover:text-red-600"><IconRenderer name="x" className="w-4 h-4" /></button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No specific fields. Will use main service fields.</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Main Fields */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h4 className="font-bold text-navy">Main Form Fields (Default)</h4>
                <button 
                  onClick={() => setMainFieldsJsonMode(!mainFieldsJsonMode)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${mainFieldsJsonMode ? 'bg-primary text-white border-primary' : 'text-slate-400 border-slate-200 hover:border-primary hover:text-primary'}`}
                >
                  {mainFieldsJsonMode ? 'Manual UI' : 'JSON Mode'}
                </button>
              </div>
              {!mainFieldsJsonMode && (
                <button onClick={handleAddField} className="btn-outline py-2 px-4 text-sm flex items-center gap-2"><IconRenderer name="plus" className="w-4 h-4" /> Add Field</button>
              )}
            </div>
            
            {mainFieldsJsonMode ? (
              <textarea 
                className="input-field font-mono text-xs min-h-[200px] bg-slate-900 text-emerald-400 p-4"
                value={JSON.stringify(fields, null, 2)}
                onChange={e => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setFields(parsed);
                  } catch (err) {
                    // Allow typing
                  }
                }}
              />
            ) : (
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div key={i} className="flex gap-3 items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <input type="text" className="input-field py-2" placeholder="Field Label" value={f.label} onChange={e => {
                      const newFields = [...fields];
                      newFields[i].label = e.target.value;
                      setFields(newFields);
                    }} />
                    <select className="input-field py-2 w-48" value={f.type} onChange={e => {
                      const newFields = [...fields];
                      newFields[i].type = e.target.value as any;
                      setFields(newFields);
                    }}>
                      <option value="text">Text</option>
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                      <option value="date">Date</option>
                      <option value="file">File Upload</option>
                      <option value="textarea">Textarea</option>
                      <option value="select">Select Dropdown</option>
                    </select>
                    <button onClick={() => setFields(fields.filter((_, idx) => idx !== i))} className="text-red-500 hover:scale-110 transition-all"><IconRenderer name="trash" className="w-5 h-5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleSave} className="btn-primary w-full py-4 text-lg">Save Service</button>
        </div>
      </motion.div>
    </div>
  );
}
