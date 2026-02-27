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
  const [description, setDescription] = useState(service?.description || '');
  const [fields, setFields] = useState<ServiceField[]>(service?.fields || []);
  const [subservices, setSubservices] = useState<SubService[]>(service?.subservices || []);
  const [css, setCss] = useState(service?.css || '');

  const handleAddField = () => {
    setFields([...fields, { label: '', type: 'text' }]);
  };

  const handleAddSubService = () => {
    setSubservices([...subservices, { name: '', charge: 0, paymentMethods: ['razorpay', 'cash'] }]);
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
              <label className="block font-bold text-navy">Icon Class</label>
              <input type="text" className="input-field" value={icon} onChange={e => setIcon(e.target.value)} placeholder="e.g., fingerprint" />
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
            <div className="space-y-3">
              {subservices.map((ss, i) => (
                <div key={i} className="flex gap-3 items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
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
                  <button onClick={() => setSubservices(subservices.filter((_, idx) => idx !== i))} className="text-red-500 hover:scale-110 transition-all"><IconRenderer name="trash" className="w-5 h-5" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-navy">Form Fields</h4>
              <button onClick={handleAddField} className="btn-outline py-2 px-4 text-sm flex items-center gap-2"><IconRenderer name="plus" className="w-4 h-4" /> Add Field</button>
            </div>
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
          </div>

          <button onClick={handleSave} className="btn-primary w-full py-4 text-lg">Save Service</button>
        </div>
      </motion.div>
    </div>
  );
}
