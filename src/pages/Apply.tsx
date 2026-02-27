import React, { useState } from 'react';
import { Service, UserProfile, SubService, Application, PaymentGateway } from '../types';
import { IconRenderer } from '../components/Icons';
import { showToast } from '../components/Toast';
import { rtdb, storage } from '../firebase';
import { ref as dbRef, set, push } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { sendEmail, emailTemplates } from '../services/emailService';

interface ApplyProps {
  service: Service;
  user: UserProfile;
  gateways: PaymentGateway[];
  onBack: () => void;
  onSuccess: () => void;
}

export function Apply({ service, user, gateways, onBack, onSuccess }: ApplyProps) {
  const [selectedSubService, setSelectedSubService] = useState<SubService | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [loading, setLoading] = useState(false);

  const handleInputChange = (label: string, value: any) => {
    setFormData(prev => ({ ...prev, [label]: value }));
  };

  const handleFileChange = (label: string, file: File) => {
    setFiles(prev => ({ ...prev, [label]: file }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (service.subservices.length > 0 && !selectedSubService) {
      showToast('Please select a sub-service', 'error');
      return;
    }

    setLoading(true);
    try {
      const uploadedFiles: Record<string, string> = {};
      
      // Upload files to Firebase Storage
      const fileEntries = Object.entries(files) as [string, File][];
      for (const [label, file] of fileEntries) {
        const sRef = storageRef(storage, `applications/${user.uid}/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(sRef, file);
        const url = await getDownloadURL(snapshot.ref);
        uploadedFiles[label] = url;
      }

      // Generate ID
      const now = new Date();
      const appId = `ICC-${now.getTime()}`;

      const application: Omit<Application, 'id'> = {
        uid: user.uid,
        email: user.email,
        name: user.name,
        serviceName: service.name,
        serviceId: service.id,
        subserviceName: selectedSubService?.name || undefined,
        charge: selectedSubService?.charge || 0,
        details: { ...formData, ...uploadedFiles },
        status: 'processing',
        date: now.toISOString(),
        notes: [],
        paymentStatus: (selectedSubService?.paymentMethods.includes('free') || selectedSubService?.paymentMethods.includes('cash')) ? 'completed' : 'pending'
      };

      const submitApp = async (appData: any) => {
        const newAppRef = push(dbRef(rtdb, 'applications'));
        await set(newAppRef, appData);
        
        // Send Confirmation Email
        sendEmail(user.email, 'Application Received - India Cyber Cafe', emailTemplates.applicationSubmitted(user.name, service.name, newAppRef.key || ''));

        showToast('Application Submitted Successfully!');
        onSuccess();
      };

      if (selectedSubService) {
        const methods = selectedSubService.paymentMethods;
        
        if (methods.includes('razorpay')) {
          // Handle Razorpay
          const activeRazorpay = gateways.find(g => g.type === 'razorpay' && g.active);
          const key = activeRazorpay?.credentials?.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_live_Rploo35wP3GfXd';

          const options = {
            key,
            amount: (selectedSubService.charge || 0) * 100,
            currency: 'INR',
            name: 'India Cyber Cafe',
            description: `Payment for ${service.name}`,
            handler: async (response: any) => {
              application.paymentMethod = 'razorpay';
              application.paymentStatus = 'completed';
              application.razorpayPaymentId = response.razorpay_payment_id;
              await submitApp(application);
            },
            prefill: {
              name: user.name,
              email: user.email,
              contact: user.phone || ''
            },
            theme: { color: '#FF9933' }
          };
          const rzp = new (window as any).Razorpay(options);
          rzp.open();
        } else if (methods.includes('pay_after_work')) {
          application.paymentMethod = 'pay_after_work';
          application.paymentStatus = 'pending';
          await submitApp(application);
        } else if (methods.includes('cash')) {
          application.paymentMethod = 'cash';
          application.paymentStatus = 'completed';
          await submitApp(application);
        } else if (methods.includes('free')) {
          application.paymentMethod = 'free';
          application.paymentStatus = 'completed';
          application.charge = 0;
          await submitApp(application);
        } else {
          // Default to simple submission
          await submitApp(application);
        }
      } else {
        await submitApp(application);
      }
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-6 sm:p-12 rounded-3xl shadow-xl space-y-6 sm:space-y-8">
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-navy font-bold hover:text-primary transition-all text-sm sm:text-base"
      >
        <IconRenderer name="arrow-left" className="w-4 h-4 sm:w-5 sm:h-5" />
        Back to Services
      </button>

      <div className="text-center space-y-1 sm:space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold text-navy">{service.name}</h2>
        <p className="text-sm sm:text-base text-slate-500">Please fill in the required details</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        {service.subservices.length > 0 && (
          <div className="space-y-1 sm:space-y-2">
            <label className="block font-bold text-navy text-sm sm:text-base">Select Sub-Service *</label>
            <select 
              required
              className="input-field"
              onChange={(e) => {
                const sub = service.subservices[parseInt(e.target.value)];
                setSelectedSubService(sub);
                // Reset form data when sub-service changes
                setFormData({});
                setFiles({});
              }}
            >
              <option value="">-- Choose a sub-service --</option>
              {service.subservices.map((ss, i) => (
                <option key={i} value={i}>{ss.name} (₹{ss.charge})</option>
              ))}
            </select>
            {selectedSubService && (
              <p className="text-primary font-bold text-sm">Charge: ₹{selectedSubService.charge}</p>
            )}
          </div>
        )}

        {(selectedSubService?.fields && selectedSubService.fields.length > 0 
          ? selectedSubService.fields 
          : service.fields).map((field, i) => (
          <div key={i} className="space-y-1 sm:space-y-2">
            <label className="block font-bold text-navy text-sm sm:text-base">{field.label} *</label>
            {field.type === 'file' ? (
              <div className="relative">
                <input 
                  type="file" 
                  required
                  className="hidden" 
                  id={`file-${i}`}
                  onChange={e => e.target.files && handleFileChange(field.label, e.target.files[0])}
                />
                <label 
                  htmlFor={`file-${i}`}
                  className="w-full flex flex-col items-center justify-center p-6 sm:p-8 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-primary hover:bg-primary/5 transition-all"
                >
                  <IconRenderer name="upload" className="w-6 h-6 sm:w-8 sm:h-8 text-slate-400 mb-2" />
                  <span className="text-xs sm:text-sm text-slate-500 font-medium text-center">
                    {files[field.label] ? files[field.label].name : 'Click to upload or drag & drop'}
                  </span>
                </label>
              </div>
            ) : field.type === 'textarea' ? (
              <textarea 
                required
                placeholder={`Enter ${field.label.toLowerCase()}`}
                className="input-field min-h-[80px] sm:min-h-[100px]"
                onChange={e => handleInputChange(field.label, e.target.value)}
              />
            ) : field.type === 'select' ? (
              <select 
                required
                className="input-field"
                onChange={e => handleInputChange(field.label, e.target.value)}
              >
                <option value="">Select {field.label}</option>
                {field.options?.map((opt, idx) => (
                  <option key={idx} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input 
                type={field.type} 
                required
                placeholder={`Enter ${field.label.toLowerCase()}`}
                className="input-field"
                onChange={e => handleInputChange(field.label, e.target.value)}
              />
            )}
          </div>
        ))}

        <button 
          type="submit" 
          disabled={loading}
          className="btn-primary w-full py-3 sm:py-4 text-base sm:text-lg mt-4"
        >
          {loading ? 'Submitting...' : selectedSubService ? 'Proceed to Payment' : 'Submit Application'}
        </button>
      </form>
    </div>
  );
}
