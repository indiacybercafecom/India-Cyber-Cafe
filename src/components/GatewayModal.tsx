import { useState } from 'react';
import { PaymentGateway } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { motion } from 'motion/react';

interface GatewayModalProps {
  gateway: PaymentGateway | null;
  onClose: () => void;
  onSave: (gateway: PaymentGateway) => void;
}

export function GatewayModal({ gateway, onClose, onSave }: GatewayModalProps) {
  const [name, setName] = useState(gateway?.name || '');
  const [type, setType] = useState<PaymentGateway['type']>(gateway?.type || 'razorpay');
  const [description, setDescription] = useState(gateway?.description || '');
  const [active, setActive] = useState(gateway?.active ?? true);
  const [credentials, setCredentials] = useState<Record<string, string>>(gateway?.credentials || {});

  const handleSave = () => {
    if (!name) return showToast('Name is required', 'error');
    
    const newGateway: PaymentGateway = {
      id: gateway?.id || '',
      name,
      type,
      description,
      active,
      credentials
    };
    onSave(newGateway);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-md relative overflow-hidden shadow-2xl flex flex-col"
      >
        <div className="p-6 bg-navy text-white flex justify-between items-center">
          <h3 className="text-xl font-bold">{gateway ? 'Edit Gateway' : 'Add Gateway'}</h3>
          <button onClick={onClose} className="hover:rotate-90 transition-all">
            <IconRenderer name="x" className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="block font-bold text-navy">Gateway Name</label>
            <input type="text" className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Razorpay Live" />
          </div>

          <div className="space-y-2">
            <label className="block font-bold text-navy">Type</label>
            <select className="input-field" value={type} onChange={e => setType(e.target.value as any)}>
              <option value="razorpay">Razorpay</option>
              <option value="stripe">Stripe</option>
              <option value="paypal">PayPal</option>
              <option value="cashfree">Cashfree</option>
              <option value="custom">Custom/Other</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="block font-bold text-navy">Description</label>
            <textarea className="input-field min-h-[60px]" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" />
          </div>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="active" checked={active} onChange={e => setActive(e.target.checked)} className="w-5 h-5 accent-primary" />
            <label htmlFor="active" className="font-bold text-navy">Active</label>
          </div>

          <div className="space-y-4 border-t pt-4">
            <h4 className="font-bold text-navy text-sm uppercase tracking-wider">Credentials</h4>
            {type === 'razorpay' && (
              <div className="space-y-3">
                <input type="text" className="input-field py-2 text-sm" placeholder="Key ID" value={credentials.keyId || ''} onChange={e => setCredentials({...credentials, keyId: e.target.value})} />
                <input type="text" className="input-field py-2 text-sm" placeholder="Key Secret" value={credentials.keySecret || ''} onChange={e => setCredentials({...credentials, keySecret: e.target.value})} />
              </div>
            )}
            {type !== 'razorpay' && (
              <p className="text-xs text-slate-400 italic">Configuration for this type is coming soon. Use Razorpay for now.</p>
            )}
          </div>

          <button onClick={handleSave} className="btn-primary w-full py-4 text-lg">Save Gateway</button>
        </div>
      </motion.div>
    </div>
  );
}
