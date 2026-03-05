import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Service, UserProfile, SubService, Application, PaymentGateway } from '../types';
import { IconRenderer } from '../components/Icons';
import { showToast } from '../components/Toast';
import { rtdb } from '../firebase';
import { ref as dbRef, set } from 'firebase/database';
import { sendEmail, sendEmailToAllAdmins, emailTemplates } from '../services/emailService';
import { uploadFile } from '../services/uploadService';
import { SEO } from '../components/SEO';

interface ApplyProps {
  services: Service[];
  user: UserProfile;
  gateways: PaymentGateway[];
  onSuccess: () => void;
}

export function Apply({ services, user, gateways, onSuccess }: ApplyProps) {
  const { serviceId, subserviceName } = useParams<{ serviceId: string; subserviceName: string }>();
  const navigate = useNavigate();
  
  const service = services.find(s => s.id === serviceId);
  const [selectedSubService, setSelectedSubService] = useState<SubService | null>(null);
  const [subServiceNotFound, setSubServiceNotFound] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  const slugify = (text: string) => text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

  useEffect(() => {
    if (service && subserviceName) {
      const sub = service.subservices.find(ss => 
        slugify(ss.name) === subserviceName
      );
      if (sub) {
        setSelectedSubService(sub);
        setSubServiceNotFound(false);
      } else {
        setSubServiceNotFound(true);
      }
    }
  }, [service, subserviceName]);

  if (!service) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-navy">Service Not Found</h2>
        <button onClick={() => navigate('/services')} className="btn-primary mt-4">Back to Services</button>
      </div>
    );
  }

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
      setUploadProgress({ current: 0, total: fileEntries.length });
      
      for (let i = 0; i < fileEntries.length; i++) {
        const [label, file] = fileEntries[i];
        const url = await uploadFile(file, 'applications');
        uploadedFiles[label] = url;
        setUploadProgress({ current: i + 1, total: fileEntries.length });
      }

      // Generate ID: ICC-DDMMYYYY-HHMMSS-RRRR
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB').replace(/\//g, ''); // DDMMYYYY
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS
      const randomStr = Math.floor(1000 + Math.random() * 9000).toString(); // 4 random digits
      const appId = `ICC-${dateStr}-${timeStr}-${randomStr}`;

      const application: any = {
        uid: user.uid,
        email: user.email,
        name: user.name,
        serviceName: service.name,
        serviceId: service.id,
        details: { ...formData, ...uploadedFiles },
        status: 'processing',
        date: now.toISOString(),
        notes: [],
        paymentStatus: (selectedSubService?.paymentMethods.includes('free') || selectedSubService?.paymentMethods.includes('cash')) ? 'completed' : 'pending'
      };

      if (selectedSubService) {
        application.subserviceName = selectedSubService.name;
        application.charge = selectedSubService.charge || 0;
      }

      const submitApp = async (appData: any) => {
        const appWithId = { ...appData, id: appId };
        await set(dbRef(rtdb, `applications/${appId}`), appWithId);
        
        // Send Confirmation Email to User
        sendEmail(user.email, 'Application Received - India Cyber Cafe', emailTemplates.applicationSubmitted(user.name, service.name, appId));
        
        // Notify All Admins
        sendEmailToAllAdmins('New Application Received - India Cyber Cafe', emailTemplates.adminNewApplication(user.name, user.email, service.name, appId));
        
        // If payment completed, send payment confirmation
        if (appData.paymentStatus === 'completed' && appData.charge) {
          sendEmail(user.email, 'Payment Confirmed - India Cyber Cafe', emailTemplates.paymentReceived(user.name, appData.charge.toString(), service.name, appId));
          sendEmailToAllAdmins('Payment Received - India Cyber Cafe', emailTemplates.adminPaymentReceived(user.name, appData.charge.toString(), service.name, appId));
        }

        showToast('Application Submitted Successfully!');
        onSuccess();
      };

      if (selectedSubService) {
        const methods = selectedSubService.paymentMethods;
        
        if (methods.includes('razorpay')) {
          // Handle Razorpay
          const activeRazorpay = gateways.find(g => g.type === 'razorpay' && g.active);
          const key = activeRazorpay?.credentials?.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_SMaFkoy1k9JEy3';

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
      <SEO 
        title={selectedSubService ? `${selectedSubService.name} - ${service.name}` : service.name}
        description={`Apply for ${selectedSubService?.name || service.name} online at India Cyber Cafe. Fast and secure digital services.`}
        keywords={`${selectedSubService?.name || ''}, ${service.name}, online application, India Cyber Cafe`}
        url={`https://book.indiacybercafe.com/services/${service.id}/${subserviceName || ''}`}
      />
      <button 
        onClick={() => navigate(`/services/${service.id}`)}
        className="flex items-center gap-2 text-navy font-bold hover:text-primary transition-all text-sm sm:text-base"
      >
        <IconRenderer name="arrow-left" className="w-4 h-4 sm:w-5 sm:h-5" />
        Back to Services
      </button>

      <div className="text-center space-y-1 sm:space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold text-navy">{service.name}</h2>
        <p className="text-sm sm:text-base text-slate-500">Please fill in the required details</p>
      </div>

      {subServiceNotFound && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <IconRenderer name="circle-exclamation" className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-bold">Sub-service not found</p>
            <p>The requested sub-service link might be outdated. Please select a service from the list below.</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        {service.subservices.length > 0 && (
          <div className="space-y-1 sm:space-y-2">
            <label className="block font-bold text-navy text-sm sm:text-base">Select Sub-Service *</label>
            <select 
              required
              className="input-field"
              value={service.subservices.findIndex(ss => ss.name === selectedSubService?.name)}
              onChange={(e) => {
                const sub = service.subservices[parseInt(e.target.value)];
                setSelectedSubService(sub);
                // Reset form data when sub-service changes
                setFormData({});
                setFiles({});
                if (sub) {
                  navigate(`/services/${service.id}/${sub.name.toLowerCase().replace(/\s+/g, '-')}`);
                }
              }}
            >
              <option value="-1">-- Choose a sub-service --</option>
              {service.subservices.map((ss, i) => (
                <option key={i} value={i}>{ss.name}</option>
              ))}
            </select>
            {selectedSubService && (
              <div className="flex items-center gap-3 mt-2">
                <span className="text-primary font-bold text-lg">₹{selectedSubService.charge}</span>
                {selectedSubService.originalCharge && selectedSubService.originalCharge > selectedSubService.charge && (
                  <>
                    <span className="text-sm text-slate-400 line-through">₹{selectedSubService.originalCharge}</span>
                    <span className="bg-green-100 text-green-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {Math.round(((selectedSubService.originalCharge - selectedSubService.charge) / selectedSubService.originalCharge) * 100)}% OFF
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {(selectedSubService?.fields && selectedSubService.fields.length > 0 
          ? selectedSubService.fields 
          : service.fields).length > 0 ? (
          (selectedSubService?.fields && selectedSubService.fields.length > 0 
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
          ))
        ) : (
          <div className="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center">
            <p className="text-slate-500">No additional details required for this service.</p>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading}
          className="btn-primary w-full py-3 sm:py-4 text-base sm:text-lg mt-4 relative overflow-hidden"
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center">
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {uploadProgress.total > 0 ? `Uploading Files (${uploadProgress.current}/${uploadProgress.total})...` : 'Submitting...'}
              </span>
              {uploadProgress.total > 0 && (
                <div className="absolute bottom-0 left-0 h-1 bg-white/30 transition-all duration-300" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
              )}
            </div>
          ) : selectedSubService ? 'Proceed to Payment' : 'Submit Application'}
        </button>
      </form>
    </div>
  );
}
