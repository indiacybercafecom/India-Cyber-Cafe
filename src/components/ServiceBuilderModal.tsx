import { useState } from 'react';
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
  const [iconType, setIconType] = useState<'class' | 'url'>(service?.iconType || 'class');
  const [description, setDescription] = useState(service?.description || '');
  const [fields, setFields] = useState<ServiceField[]>(service?.fields || []);
  const [subservices, setSubservices] = useState<SubService[]>(service?.subservices || []);
  const [css, setCss] = useState(service?.css || '');
  
  // JSON Mode states
  const [jsonModeMain, setJsonModeMain] = useState(false);
  const [mainFieldsJson, setMainFieldsJson] = useState(JSON.stringify(fields, null, 2));
  const [jsonModeSubs, setJsonModeSubs] = useState<Record<number, boolean>>({});
  const [subFieldsJson, setSubFieldsJson] = useState<Record<number, string>>({});
  
  // Media loading error states
  const [mediaErrors, setMediaErrors] = useState<Record<string, boolean>>({});
  
  // Expanded/collapsed states for sub-services to optimize rendering
  const [expandedSubServices, setExpandedSubServices] = useState<Record<number, boolean>>(
    subservices.length <= 3 ? Object.fromEntries(subservices.map((_, i) => [i, true])) : { 0: true }
  );

  const handleAddField = () => {
    setFields([...fields, { label: '', type: 'text' }]);
  };

  const handleAddSubService = () => {
    const newIndex = subservices.length;
    setSubservices([...subservices, { name: '', charge: 0, paymentMethods: ['razorpay', 'cash'] }]);
    setExpandedSubServices({ ...expandedSubServices, [newIndex]: true });
  };

  const handleToggleJsonModeMain = () => {
    if (!jsonModeMain) {
      // Entering JSON mode
      setMainFieldsJson(JSON.stringify(fields, null, 2));
    } else {
      // Exiting JSON mode - parse JSON
      try {
        const parsed = JSON.parse(mainFieldsJson);
        if (Array.isArray(parsed)) {
          setFields(parsed);
          showToast('✅ Fields updated from JSON', 'success');
        } else {
          throw new Error('Must be an array');
        }
      } catch (error) {
        showToast('❌ Invalid JSON format', 'error');
        return;
      }
    }
    setJsonModeMain(!jsonModeMain);
  };

  const handleToggleJsonModeSub = (index: number) => {
    if (!jsonModeSubs[index]) {
      // Entering JSON mode
      setSubFieldsJson({
        ...subFieldsJson,
        [index]: JSON.stringify(subservices[index].fields || [], null, 2)
      });
    } else {
      // Exiting JSON mode - parse JSON
      try {
        const parsed = JSON.parse(subFieldsJson[index] || '[]');
        if (Array.isArray(parsed)) {
          const newSS = [...subservices];
          newSS[index].fields = parsed;
          setSubservices(newSS);
          showToast('✅ Fields updated from JSON', 'success');
        } else {
          throw new Error('Must be an array');
        }
      } catch (error) {
        showToast('❌ Invalid JSON format', 'error');
        return;
      }
    }
    setJsonModeSubs({ ...jsonModeSubs, [index]: !jsonModeSubs[index] });
  };

  const handleMediaError = (key: string) => {
    setMediaErrors({ ...mediaErrors, [key]: true });
  };

  const handleMediaLoad = (key: string) => {
    setMediaErrors({ ...mediaErrors, [key]: false });
  };

  const toggleSubServiceExpanded = (index: number) => {
    setExpandedSubServices({
      ...expandedSubServices,
      [index]: !expandedSubServices[index]
    });
  };

  const handleSave = () => {
    if (!name) return showToast('Name is required', 'error');
    
    const newService: Service = {
      id: service?.id || name.toLowerCase().replace(/ /g, '-'),
      name,
      icon,
      iconType,
      description,
      fields,
      subservices,
      css
    };
    onSave(newService);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2000] flex items-center justify-center p-2 sm:p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-2xl sm:max-w-4xl relative overflow-hidden shadow-2xl flex flex-col max-h-[90vh] sm:max-h-[95vh]"
      >
        <div className="p-4 sm:p-6 bg-primary text-white flex justify-between items-center sticky top-0 z-10">
          <h3 className="text-lg sm:text-xl font-bold">Service Builder</h3>
          <button onClick={onClose} className="hover:rotate-90 transition-all p-1 hover:bg-white/20 rounded-lg">
            <IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div className="space-y-2">
              <label className="block font-bold text-navy text-sm sm:text-base">Service Name</label>
              <input type="text" className="input-field text-sm" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Passport Application" />
            </div>
            <div className="space-y-2">
              <label className="block font-bold text-navy text-sm sm:text-base">Icon</label>
              <div className="flex gap-2 mb-2 flex-wrap">
                <button 
                  onClick={() => setIconType('class')}
                  className={`text-xs font-bold px-3 py-2 sm:py-1 rounded-lg transition-all ${iconType === 'class' ? 'bg-primary text-white shadow-md' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                >
                  Icon Class
                </button>
                <button 
                  onClick={() => setIconType('url')}
                  className={`text-xs font-bold px-3 py-2 sm:py-1 rounded-lg transition-all ${iconType === 'url' ? 'bg-primary text-white shadow-md' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                >
                  Image/GIF/MP4 URL
                </button>
              </div>
              {iconType === 'class' ? (
                <input 
                  type="text" 
                  className="input-field text-sm" 
                  value={icon} 
                  onChange={e => setIcon(e.target.value)} 
                  placeholder="e.g., fingerprint, file-text, shield" 
                />
              ) : (
                <div className="space-y-3">
                  <input 
                    type="text" 
                    className="input-field text-sm" 
                    value={icon} 
                    onChange={e => setIcon(e.target.value)} 
                    placeholder="e.g., https://example.com/icon.png or https://example.com/animation.gif" 
                  />
                  {icon && !mediaErrors['service-icon'] && (
                    <div className="bg-slate-100 rounded-xl p-3 sm:p-4 flex items-center justify-center min-h-24 sm:min-h-32 border-2 border-slate-200 overflow-hidden">
                      {icon.toLowerCase().endsWith('.mp4') ? (
                        <video 
                          src={icon} 
                          className="max-w-full max-h-24 sm:max-h-32 rounded-lg" 
                          muted 
                          autoPlay 
                          loop 
                          onError={() => handleMediaError('service-icon')}
                          onLoadStart={() => handleMediaLoad('service-icon')}
                        />
                      ) : (
                        <img 
                          src={icon} 
                          alt="Preview" 
                          className="max-w-full max-h-24 sm:max-h-32 rounded object-contain" 
                          onError={() => handleMediaError('service-icon')}
                          onLoad={() => handleMediaLoad('service-icon')}
                        />
                      )}
                    </div>
                  )}
                  {mediaErrors['service-icon'] && (
                    <div className="bg-red-50 border-2 border-red-200 rounded-xl p-3 text-center">
                      <p className="text-sm text-red-600">⚠️ Failed to load image. Check the URL.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-bold text-navy text-sm sm:text-base">Description</label>
            <textarea className="input-field text-sm min-h-20 sm:min-h-24" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of the service" />
          </div>

          {/* Sub-Services */}
          <div className="space-y-4">
            <div className="flex justify-between items-center gap-2 flex-wrap">
              <h4 className="font-bold text-navy text-sm sm:text-base">Sub-Services & Charges ({subservices.length})</h4>
              <button onClick={handleAddSubService} className="btn-outline py-2 px-3 sm:px-4 text-xs sm:text-sm flex items-center gap-2 inline-flex"><IconRenderer name="plus" className="w-4 h-4" /> <span className="hidden sm:inline">Add</span> Sub-Service</button>
            </div>
            <div className="space-y-4 max-h-96 overflow-y-auto border border-slate-200 rounded-xl p-3 sm:p-4 bg-slate-50">
              {subservices.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-sm">No sub-services added yet</p>
                </div>
              ) : (
                subservices.map((ss, i) => (
                  <div key={i} className="bg-white rounded-lg sm:rounded-xl border-2 border-slate-200 hover:border-primary/40 transition-all">
                    {/* Sub-service header - clickable to expand/collapse */}
                    <div 
                      onClick={() => toggleSubServiceExpanded(i)}
                      className="p-3 sm:p-4 cursor-pointer flex items-center justify-between gap-2 hover:bg-slate-50 transition-all"
                    >
                      <div className="flex-1 min-w-0">
                        <h5 className="font-bold text-navy text-sm sm:text-base truncate">{ss.name || `Sub-Service ${i + 1}`}</h5>
                        <p className="text-xs text-slate-500">₹{ss.charge}</p>
                      </div>
                      <button 
                        className="text-slate-400 hover:text-navy transition-colors flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSubServiceExpanded(i);
                        }}
                      >
                        {expandedSubServices[i] ? '▼' : '▶'}
                      </button>
                    </div>

                    {/* Expanded content */}
                    {expandedSubServices[i] && (
                      <div className="border-t border-slate-200 p-3 sm:p-4 space-y-4">
                        <div className="flex gap-2 sm:gap-3 items-center flex-col sm:flex-row">
                          <input type="text" className="input-field py-2 text-sm flex-1" placeholder="Sub-service name" value={ss.name} onChange={e => {
                            const newSS = [...subservices];
                            newSS[i].name = e.target.value;
                            setSubservices(newSS);
                          }} />
                          <input type="number" className="input-field py-2 text-sm w-full sm:w-32" placeholder="Charge" value={ss.charge} onChange={e => {
                            const newSS = [...subservices];
                            newSS[i].charge = parseFloat(e.target.value);
                            setSubservices(newSS);
                          }} />
                          <input type="number" className="input-field py-2 text-sm w-full sm:w-32" placeholder="Orig. Price" value={ss.originalCharge || ''} onChange={e => {
                            const newSS = [...subservices];
                            newSS[i].originalCharge = parseFloat(e.target.value);
                            setSubservices(newSS);
                          }} />
                          <button onClick={() => setSubservices(subservices.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 hover:scale-110 transition-all p-2 rounded-lg hover:bg-red-50 w-full sm:w-auto">
                            <IconRenderer name="trash" className="w-5 h-5 mx-auto sm:mx-0" />
                          </button>
                        </div>

                        {/* Sub-service image/background */}
                        <div className="space-y-3 bg-slate-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border-2 border-slate-100">
                          <div className="flex justify-between items-center gap-2 flex-wrap">
                            <h5 className="text-xs font-bold text-navy/70 uppercase tracking-wider">Display Image</h5>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => {
                                  const newSS = [...subservices];
                                  newSS[i].imageType = newSS[i].imageType === 'url' ? 'class' : 'url';
                                  setSubservices(newSS);
                                }}
                                className={`text-xs font-bold px-2 py-1.5 rounded-lg transition-all ${ss.imageType === 'url' ? 'bg-primary text-white shadow-md' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                              >
                                {ss.imageType === 'url' ? '🖼️ Image/Video' : '🎨 Icon Class'}
                              </button>
                            </div>
                          </div>
                          
                          {ss.imageType === 'url' ? (
                            <div className="space-y-2">
                              <input 
                                type="text" 
                                className="input-field text-xs sm:text-sm" 
                                value={ss.image || ''} 
                                onChange={e => {
                                  const newSS = [...subservices];
                                  newSS[i].image = e.target.value;
                                  setSubservices(newSS);
                                }}
                                placeholder="https://example.com/image.jpg" 
                              />
                              {ss.image && !mediaErrors[`sub-${i}`] && (
                                <div className="bg-slate-100 rounded-lg p-2 sm:p-3 flex items-center justify-center min-h-20 sm:min-h-24 border-2 border-slate-200 overflow-hidden">
                                  {ss.image.toLowerCase().endsWith('.mp4') ? (
                                    <video 
                                      src={ss.image} 
                                      className="max-w-full max-h-20 sm:max-h-24 rounded" 
                                      muted 
                                      autoPlay 
                                      loop 
                                      onError={() => handleMediaError(`sub-${i}`)}
                                      onLoadStart={() => handleMediaLoad(`sub-${i}`)}
                                    />
                                  ) : (
                                    <img 
                                      src={ss.image} 
                                      alt="Preview" 
                                      className="max-w-full max-h-20 sm:max-h-24 rounded object-cover" 
                                      onError={() => handleMediaError(`sub-${i}`)}
                                      onLoad={() => handleMediaLoad(`sub-${i}`)}
                                    />
                                  )}
                                </div>
                              )}
                              {mediaErrors[`sub-${i}`] && (
                                <div className="bg-red-50 border-2 border-red-200 rounded-lg p-2 text-center">
                                  <p className="text-xs text-red-600">⚠️ Failed to load image</p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <input 
                              type="text" 
                              className="input-field text-xs sm:text-sm" 
                              value={ss.image || ''} 
                              onChange={e => {
                                const newSS = [...subservices];
                                newSS[i].image = e.target.value;
                                setSubservices(newSS);
                              }}
                              placeholder="e.g., file-text, shield" 
                            />
                          )}
                        </div>
                        
                        {/* Sub-service specific fields */}
                        <div className="pl-3 sm:pl-6 border-l-4 border-primary/30 space-y-3 bg-primary/5 p-3 sm:p-4 rounded-lg sm:rounded-xl">
                          <div className="flex justify-between items-center gap-2 flex-wrap">
                            <h5 className="text-xs font-bold text-navy/70 uppercase tracking-wider">Fields</h5>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => handleToggleJsonModeSub(i)}
                                className={`text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all ${jsonModeSubs[i] ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-300 text-slate-700 hover:bg-slate-400'}`}
                              >
                                {jsonModeSubs[i] ? '📝 JSON' : '📝 JSON'}
                              </button>
                              {!jsonModeSubs[i] && (
                                <button 
                                  onClick={() => {
                                    const newSS = [...subservices];
                                    if (!newSS[i].fields) newSS[i].fields = [];
                                    newSS[i].fields!.push({ label: '', type: 'text' });
                                    setSubservices(newSS);
                                  }}
                                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-white/60"
                                >
                                  <IconRenderer name="plus" className="w-3 h-3" /> Field
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Payment Methods */}
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-navy/50 uppercase">Payment Methods</label>
                            <div className="flex flex-wrap gap-2">
                              {['cash', 'razorpay', 'pay_after_work', 'free'].map(m => (
                                <label key={m} className="flex items-center gap-2 text-xs bg-white px-2.5 py-1.5 rounded-lg border-2 border-slate-200 hover:border-primary cursor-pointer transition-all hover:shadow-sm">
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
                                  <span className="capitalize text-xs">{m.replace(/_/g, ' ')}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* Fields rendering */}
                          {jsonModeSubs[i] ? (
                            <div className="space-y-2 bg-slate-900 p-2 sm:p-3 rounded-lg border-2 border-slate-700">
                              <textarea 
                                className="w-full h-32 sm:h-40 bg-slate-800 text-white font-mono text-xs p-2 rounded border border-slate-600 focus:border-primary focus:outline-none" 
                                value={subFieldsJson[i] || '[]'}
                                onChange={e => setSubFieldsJson({ ...subFieldsJson, [i]: e.target.value })}
                              />
                            </div>
                          ) : (
                            ss.fields && ss.fields.length > 0 ? (
                              <div className="space-y-2 max-h-40 overflow-y-auto">
                                {ss.fields.map((f, fi) => (
                                  <div key={fi} className="flex gap-2 items-center text-xs">
                                    <input 
                                      type="text" 
                                      className="input-field py-1 text-xs flex-1" 
                                      placeholder="Label" 
                                      value={f.label} 
                                      onChange={e => {
                                        const newSS = [...subservices];
                                        newSS[i].fields![fi].label = e.target.value;
                                        setSubservices(newSS);
                                      }} 
                                    />
                                    <select className="input-field py-1 text-xs w-24" value={f.type} onChange={e => {
                                      const newSS = [...subservices];
                                      newSS[i].fields![fi].type = e.target.value as any;
                                      setSubservices(newSS);
                                    }}>
                                      <option value="text">Text</option>
                                      <option value="email">Email</option>
                                      <option value="file">File</option>
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
                              <p className="text-xs text-slate-400 italic">No fields. Will use main service fields.</p>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Main Fields */}
          <div className="space-y-4">
            <div className="flex justify-between items-center gap-2 sm:gap-4 flex-wrap">
              <h4 className="font-bold text-navy text-sm sm:text-base">Main Form Fields (Default)</h4>
              <div className="flex gap-2 flex-wrap">
                <button 
                  onClick={handleToggleJsonModeMain}
                  className={`text-xs font-bold px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg transition-all ${jsonModeMain ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                >
                  {jsonModeMain ? '📝 JSON (ON)' : '📝 JSON'}
                </button>
                {!jsonModeMain && (
                  <button onClick={handleAddField} className="btn-outline py-1.5 sm:py-2 px-2.5 sm:px-4 text-xs sm:text-sm flex items-center gap-2"><IconRenderer name="plus" className="w-4 h-4" /> <span className="hidden sm:inline">Add</span> Field</button>
                )}
              </div>
            </div>

            {jsonModeMain ? (
              <div className="space-y-2 bg-slate-900 p-3 sm:p-4 rounded-lg sm:rounded-xl border-2 border-slate-700">
                <label className="block text-xs font-bold text-white uppercase tracking-wider">JSON Format</label>
                <textarea 
                  className="w-full h-40 sm:h-64 bg-slate-800 text-white font-mono text-xs p-2 sm:p-3 rounded border border-slate-600 focus:border-primary focus:outline-none" 
                  value={mainFieldsJson}
                  onChange={e => setMainFieldsJson(e.target.value)}
                  placeholder={`Example:\n[\n  {\n    "label": "Full Name",\n    "type": "text"\n  }\n]`}
                />
                <p className="text-xs text-slate-400 italic">Edit & toggle mode to apply</p>
              </div>
            ) : (
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div key={i} className="space-y-2 bg-slate-50 p-4 sm:p-5 rounded-xl sm:rounded-2xl border-2 border-slate-100 hover:border-primary/30 transition-all">
                    <div className="flex gap-2 sm:gap-3 items-center flex-col sm:flex-row">
                      <input type="text" className="input-field py-2 text-sm flex-1" placeholder="Field Label" value={f.label} onChange={e => {
                        const newFields = [...fields];
                        newFields[i].label = e.target.value;
                        setFields(newFields);
                      }} />
                      <select className="input-field py-2 text-sm w-full sm:w-48" value={f.type} onChange={e => {
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
                      <button onClick={() => setFields(fields.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 hover:scale-110 transition-all p-2 rounded-lg hover:bg-red-50 w-full sm:w-auto">
                        <IconRenderer name="trash" className="w-5 h-5 mx-auto sm:mx-0" />
                      </button>
                    </div>

                    {/* Dropdown Options Editor - Show when field type is 'select' */}
                    {f.type === 'select' && (
                      <div className="ml-3 sm:ml-4 pl-3 border-l-4 border-primary/30 space-y-2 bg-primary/5 p-2 sm:p-3 rounded-lg">
                        <label className="block text-xs font-bold text-navy/70 uppercase tracking-wider">Dropdown Options</label>
                        <div className="space-y-2">
                          {(f.options || []).map((opt, optIdx) => (
                            <div key={optIdx} className="flex gap-2 items-center">
                              <input 
                                type="text" 
                                className="input-field py-1 text-xs sm:text-sm flex-1" 
                                placeholder="Option value"
                                value={opt}
                                onChange={e => {
                                  const newFields = [...fields];
                                  if (!newFields[i].options) newFields[i].options = [];
                                  newFields[i].options![optIdx] = e.target.value;
                                  setFields(newFields);
                                }}
                              />
                              <button 
                                type="button"
                                onClick={() => {
                                  const newFields = [...fields];
                                  newFields[i].options = newFields[i].options?.filter((_, idx) => idx !== optIdx) || [];
                                  setFields(newFields);
                                }}
                                className="text-red-400 hover:text-red-600 transition-colors p-1 rounded hover:bg-red-50"
                              >
                                <IconRenderer name="x" className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newFields = [...fields];
                            if (!newFields[i].options) newFields[i].options = [];
                            newFields[i].options!.push('');
                            setFields(newFields);
                          }}
                          className="text-xs font-bold text-primary hover:underline flex items-center gap-1 mt-2 px-2 py-1 rounded hover:bg-white/60"
                        >
                          <IconRenderer name="plus" className="w-3 h-3" /> Add Option
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleSave} className="btn-primary w-full py-3 sm:py-4 text-base sm:text-lg font-bold sticky bottom-0 rounded-b-2xl sm:rounded-b-3xl">Save Service</button>
        </div>
      </motion.div>
    </div>
  );
}
