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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-xl sm:rounded-3xl w-full max-w-2xl relative overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 p-3 sm:p-6 bg-gradient-to-r from-navy to-blue-700 text-white flex justify-between items-center flex-shrink-0">
          <h3 className="text-lg sm:text-xl font-bold">{gateway ? 'Edit Gateway' : 'Add Gateway'}</h3>
          <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-white/20 rounded-lg transition-all flex-shrink-0">
            <IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            
            {/* Basic Info */}
            <div className="space-y-4 p-4 sm:p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border-2 border-blue-200">
              <h4 className="font-bold text-navy text-sm sm:text-base flex items-center gap-2">
                <IconRenderer name="credit-card" className="w-5 h-5" />
                Gateway Information
              </h4>

              <div>
                <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-2">Gateway Name *</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all text-sm" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="e.g., Razorpay Live, Razorpay Sandbox" 
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-2">Gateway Type *</label>
                <select 
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all text-sm" 
                  value={type} 
                  onChange={e => setType(e.target.value as any)}
                >
                  <option value="razorpay">Razorpay</option>
                  <option value="stripe">Stripe</option>
                  <option value="paypal">PayPal</option>
                  <option value="cashfree">Cashfree</option>
                  <option value="custom">Custom/Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-2">Description</label>
                <textarea 
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none text-sm" 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  placeholder="Brief description (e.g., Production/Testing environment)" 
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-3 p-3 bg-white rounded-xl border-2 border-slate-200">
                <input 
                  type="checkbox" 
                  id="active" 
                  checked={active} 
                  onChange={e => setActive(e.target.checked)} 
                  className="w-5 h-5 accent-navy cursor-pointer"
                />
                <label htmlFor="active" className="font-bold text-navy cursor-pointer flex-1 text-sm sm:text-base">
                  Active
                </label>
              </div>
            </div>

            {/* Credentials */}
            <div className="space-y-4 p-4 sm:p-6 bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl border-2 border-orange-200">
              <h4 className="font-bold text-navy text-sm sm:text-base flex items-center gap-2">
                <IconRenderer name="lock" className="w-5 h-5" />
                Gateway Credentials
              </h4>
              
              {type === 'razorpay' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-2">Razorpay Key ID *</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all font-mono text-xs sm:text-sm" 
                      placeholder="rzp_live_xxxxxxxxxxxxx" 
                      value={credentials.keyId || ''} 
                      onChange={e => setCredentials({...credentials, keyId: e.target.value})} 
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-2">Razorpay Key Secret *</label>
                    <input 
                      type="password" 
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all font-mono text-xs sm:text-sm" 
                      placeholder="••••••••••••••••" 
                      value={credentials.keySecret || ''} 
                      onChange={e => setCredentials({...credentials, keySecret: e.target.value})} 
                    />
                  </div>
                </div>
              )}
              
              {type !== 'razorpay' && (
                <div className="p-3 sm:p-4 bg-yellow-100 border-2 border-yellow-300 rounded-xl">
                  <p className="text-xs sm:text-sm text-yellow-800 font-semibold">
                    ⚠️ Configuration for {type} is coming soon. Use Razorpay for now.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 p-4 sm:p-6 bg-white border-t border-slate-200 flex gap-3 flex-shrink-0">
          <button 
            onClick={onClose} 
            className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-300 font-bold text-navy hover:bg-slate-50 transition-all text-sm sm:text-base"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave} 
            className="flex-1 px-4 py-3 rounded-xl bg-navy text-white font-bold hover:bg-navy-light transition-all flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            <IconRenderer name="save" className="w-4 h-4" />
            <span>{gateway ? 'Update' : 'Add'} Gateway</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
