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
  const [iconType, setIconType] = useState<'class' | 'url'>('class');
  const [description, setDescription] = useState(service?.description || '');
  const [fields, setFields] = useState<ServiceField[]>(service?.fields || []);
  const [subservices, setSubservices] = useState<SubService[]>(service?.subservices || []);
  const [css, setCss] = useState(service?.css || '');
  
  // JSON Mode states
  const [jsonModeMain, setJsonModeMain] = useState(false);
  const [mainFieldsJson, setMainFieldsJson] = useState(JSON.stringify(fields, null, 2));
  const [jsonModeSubs, setJsonModeSubs] = useState<Record<number, boolean>>({});
  const [subFieldsJson, setSubFieldsJson] = useState<Record<number, string>>({});

  const handleAddField = () => {
    setFields([...fields, { label: '', type: 'text' }]);
  };

  const handleAddSubService = () => {
    setSubservices([...subservices, { name: '', charge: 0, paymentMethods: ['razorpay', 'cash'] }]);
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
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
              <label className="block font-bold text-navy">Icon</label>
              <div className="flex gap-2 mb-2">
                <button 
                  onClick={() => setIconType('class')}
                  className={`text-xs font-bold px-3 py-1 rounded ${iconType === 'class' ? 'bg-primary text-white' : 'bg-slate-200 text-slate-700'}`}
                >
                  Icon Class
                </button>
                <button 
                  onClick={() => setIconType('url')}
                  className={`text-xs font-bold px-3 py-1 rounded ${iconType === 'url' ? 'bg-primary text-white' : 'bg-slate-200 text-slate-700'}`}
                >
                  Image/GIF/MP4 URL
                </button>
              </div>
              {iconType === 'class' ? (
                <input 
                  type="text" 
                  className="input-field" 
                  value={icon} 
                  onChange={e => setIcon(e.target.value)} 
                  placeholder="e.g., fingerprint, file-text, shield" 
                />
              ) : (
                <div className="space-y-2">
                  <input 
                    type="text" 
                    className="input-field" 
                    value={icon} 
                    onChange={e => setIcon(e.target.value)} 
                    placeholder="e.g., https://example.com/icon.png or https://example.com/animation.gif" 
                  />
                  {icon && (
                    <div className="bg-slate-100 rounded-lg p-3 flex items-center justify-center min-h-20 border border-slate-200">
                      {icon.toLowerCase().endsWith('.mp4') ? (
                        <video src={icon} className="max-w-full max-h-20 rounded" muted autoPlay loop />
                      ) : (
                        <img src={icon} alt="Preview" className="max-w-full max-h-20 rounded object-contain" />
                      )}
                    </div>
                  )}
                </div>
              )}
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
                    <div className="flex justify-between items-center gap-2">
                      <h5 className="text-sm font-bold text-navy/70 uppercase tracking-wider">Sub-Service Fields</h5>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleToggleJsonModeSub(i)}
                          className={`text-xs font-bold px-2 py-1 rounded transition-all ${jsonModeSubs[i] ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-700 hover:bg-slate-400'}`}
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
                            className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                          >
                            <IconRenderer name="plus" className="w-3 h-3" /> Add Field
                          </button>
                        )}
                      </div>
                    </div>

                    {/* JSON Mode for Sub-Service Fields */}
                    {jsonModeSubs[i] ? (
                      <div className="space-y-2 bg-slate-900 p-3 rounded-lg border border-slate-700">
                        <textarea 
                          className="w-full h-48 bg-slate-800 text-white font-mono text-xs p-2 rounded border border-slate-600 focus:border-primary focus:outline-none" 
                          value={subFieldsJson[i] || '[]'}
                          onChange={e => setSubFieldsJson({ ...subFieldsJson, [i]: e.target.value })}
                          placeholder={`Example:\n[\n  {"label": "Document", "type": "file"}\n]`}
                        />
                        <p className="text-xs text-slate-400">Edit JSON and toggle mode again to apply</p>
                      </div>
                    ) : (
                      <>
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
                        
                        {ss.fields && ss.fields.length > 0 ? (
                          <div className="space-y-2">
                            {ss.fields.map((f, fi) => (
                              <div key={fi} className="space-y-2 bg-white rounded-lg p-3 border border-slate-100">
                                <div className="flex gap-2 items-center">
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

                                {/* Dropdown Options for Sub-Service Fields */}
                                {f.type === 'select' && (
                                  <div className="ml-4 pl-3 border-l-2 border-primary/30 space-y-2">
                                    <label className="block text-xs font-bold text-navy/70 uppercase tracking-wider">Options</label>
                                    <div className="space-y-1">
                                      {(f.options || []).map((opt, optIdx) => (
                                        <div key={optIdx} className="flex gap-2 items-center">
                                          <input 
                                            type="text" 
                                            className="input-field py-1 text-xs flex-1" 
                                            placeholder="Option value"
                                            value={opt}
                                            onChange={e => {
                                              const newSS = [...subservices];
                                              if (!newSS[i].fields![fi].options) newSS[i].fields![fi].options = [];
                                              newSS[i].fields![fi].options![optIdx] = e.target.value;
                                              setSubservices(newSS);
                                            }}
                                          />
                                          <button 
                                            type="button"
                                            onClick={() => {
                                              const newSS = [...subservices];
                                              newSS[i].fields![fi].options = newSS[i].fields![fi].options?.filter((_, idx) => idx !== optIdx) || [];
                                              setSubservices(newSS);
                                            }}
                                            className="text-red-400 hover:text-red-600"
                                          >
                                            <IconRenderer name="x" className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newSS = [...subservices];
                                        if (!newSS[i].fields![fi].options) newSS[i].fields![fi].options = [];
                                        newSS[i].fields![fi].options!.push('');
                                        setSubservices(newSS);
                                      }}
                                      className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                                    >
                                      <IconRenderer name="plus" className="w-3 h-3" /> Add Option
                                    </button>
                                  </div>
                                )}
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
            <div className="flex justify-between items-center gap-4">
              <h4 className="font-bold text-navy">Main Form Fields (Default)</h4>
              <div className="flex gap-2">
                <button 
                  onClick={handleToggleJsonModeMain}
                  className={`text-xs font-bold px-3 py-2 rounded transition-all ${jsonModeMain ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                >
                  {jsonModeMain ? '📝 JSON Mode (ON)' : '📝 JSON Mode'}
                </button>
                {!jsonModeMain && (
                  <button onClick={handleAddField} className="btn-outline py-2 px-4 text-sm flex items-center gap-2"><IconRenderer name="plus" className="w-4 h-4" /> Add Field</button>
                )}
              </div>
            </div>

            {jsonModeMain ? (
              <div className="space-y-2 bg-slate-900 p-4 rounded-xl border border-slate-700">
                <label className="block text-xs font-bold text-white uppercase tracking-wider">JSON Format</label>
                <textarea 
                  className="w-full h-64 bg-slate-800 text-white font-mono text-xs p-3 rounded border border-slate-600 focus:border-primary focus:outline-none" 
                  value={mainFieldsJson}
                  onChange={e => setMainFieldsJson(e.target.value)}
                  placeholder={`Example:\n[\n  {\n    "label": "Full Name",\n    "type": "text"\n  },\n  {\n    "label": "Email",\n    "type": "email"\n  }\n]`}
                />
                <p className="text-xs text-slate-400">Edit JSON and toggle mode again to apply changes</p>
              </div>
            ) : (
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div key={i} className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="flex gap-3 items-center">
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

                    {/* Dropdown Options Editor - Show when field type is 'select' */}
                    {f.type === 'select' && (
                      <div className="ml-4 pl-4 border-l-2 border-primary/30 space-y-2">
                        <label className="block text-xs font-bold text-navy/70 uppercase tracking-wider">Dropdown Options</label>
                        <div className="space-y-2">
                          {(f.options || []).map((opt, optIdx) => (
                            <div key={optIdx} className="flex gap-2 items-center">
                              <input 
                                type="text" 
                                className="input-field py-1 text-sm flex-1" 
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
                                className="text-red-400 hover:text-red-600 transition-colors"
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
                          className="text-xs font-bold text-primary hover:underline flex items-center gap-1 mt-2"
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

          <button onClick={handleSave} className="btn-primary w-full py-4 text-lg">Save Service</button>
        </div>
      </motion.div>
    </div>
  );
}
