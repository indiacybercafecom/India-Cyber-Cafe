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
import { verifyRazorpayPayment } from '../services/razorpayService';

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
          // Handle Razorpay - Create order on backend first
          try {
            const charge = selectedSubService.charge || 0;
            const chargeInPaisa = charge * 100;

            console.log('📋 Creating order on backend for service... Amount:', chargeInPaisa, 'Paisa');
            const orderResponse = await fetch('/api/create-razorpay-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount: chargeInPaisa,
                currency: 'INR',
                receipt: appId,
                notes: {
                  serviceId: service.id,
                  serviceName: service.name,
                  subServiceName: selectedSubService.name
                }
              })
            });

            console.log('📡 Order response status:', orderResponse.status, orderResponse.statusText);

            if (!orderResponse.ok) {
              const errorData = await orderResponse.json().catch(() => ({ error: 'Unknown error' }));
              console.error('❌ Order creation failed:', errorData);
              throw new Error(errorData.error || `Server error: ${orderResponse.status}`);
            }

            const orderData = await orderResponse.json();
            console.log('✅ Order created on backend:', orderData);

            if (!orderData.orderId) {
              throw new Error('No order ID returned from server');
            }

            const razorpayOrderId = orderData.orderId;

            // Check if Razorpay is available
            if (!window.Razorpay) {
              console.error('❌ Razorpay window object not found');
              showToast('❌ Payment system not available. Please refresh the page.', 'error');
              setLoading(false);
              return;
            }

            const activeRazorpay = gateways.find(g => g.type === 'razorpay' && g.active);
            const key = activeRazorpay?.credentials?.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_live_Rploo35wP3GfXd';

            const options = {
              key,
              amount: chargeInPaisa,
              currency: 'INR',
              order_id: razorpayOrderId,
              name: 'India Cyber Cafe',
              description: `Payment for ${service.name}`,
              handler: async (response: any) => {
                try {
                  // Verify payment with backend using Razorpay signature
                  const verificationResult = await verifyRazorpayPayment(
                    response.razorpay_payment_id,
                  response.razorpay_order_id,
                  response.razorpay_signature
                );

                if (!verificationResult.verified) {
                  throw new Error(verificationResult.error || 'Payment verification failed');
                }

                // Payment verified, save application
                application.paymentMethod = 'razorpay';
                application.paymentStatus = 'completed';
                application.razorpayPaymentId = response.razorpay_payment_id;
                application.razorpayOrderId = response.razorpay_order_id;
                await submitApp(application);
              } catch (error: any) {
                console.error('Payment verification error:', error);
                showToast(`Payment verification failed: ${error.message}`, 'error');
              }
            },
              prefill: {
                name: user.name,
                email: user.email,
                contact: user.phone || ''
              },
              modal: {
                ondismiss: () => {
                  console.log('⚠️ Payment modal closed by user');
                  setLoading(false);
                  showToast('💳 Payment cancelled. You can try again whenever you\'re ready.', 'error');
                }
              },
              theme: { color: '#FF9933' }
            };

            console.log('🚀 Opening Razorpay checkout for service...');
            const rzp = new (window as any).Razorpay(options);
            rzp.open();
          } catch (error: any) {
            console.error('❌ Razorpay payment error:', error);
            showToast(`❌ Failed to initiate payment: ${error.message}`, 'error');
            setLoading(false);
          }
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
    <div className="w-full min-h-screen px-2 sm:px-4 py-4 sm:py-8 flex flex-col">
      <div className="flex-1 max-w-2xl mx-auto w-full bg-white rounded-2xl sm:rounded-3xl shadow-xl overflow-hidden">
        <div className="p-3 sm:p-6 md:p-10 space-y-4 sm:space-y-6 md:space-y-8 max-h-screen overflow-y-auto">
          <SEO 
            title={selectedSubService ? `${selectedSubService.name} - ${service.name}` : service.name}
            description={`Apply for ${selectedSubService?.name || service.name} online at India Cyber Cafe. Fast and secure digital services.`}
            keywords={`${selectedSubService?.name || ''}, ${service.name}, online application, India Cyber Cafe`}
            url={`https://b.indiacybercafe.com/services/${service.id}/${subserviceName || ''}`}
          />
          <button 
            onClick={() => navigate(`/services/${service.id}`)}
            className="flex items-center gap-1 sm:gap-2 text-navy font-bold hover:text-primary transition-all text-xs sm:text-sm md:text-base"
          >
            <IconRenderer name="arrow-left" className="w-3 h-3 sm:w-4 sm:h-4 md:w-5 md:h-5 shrink-0" />
            <span>Back</span>
          </button>

          <div className="text-center space-y-0.5 sm:space-y-1 md:space-y-2 mx-auto">
            <h2 className="text-lg sm:text-2xl md:text-3xl font-bold text-navy line-clamp-2 break-words">{service.name}</h2>
            <p className="text-[11px] sm:text-xs md:text-sm text-slate-500">Fill in the required details</p>
          </div>

          {subServiceNotFound && (
            <div className="p-2 sm:p-3 md:p-4 bg-amber-50 border border-amber-200 rounded-lg sm:rounded-xl flex items-start gap-2 sm:gap-3 overflow-hidden">
              <IconRenderer name="circle-exclamation" className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[10px] sm:text-xs md:text-sm text-amber-800 min-w-0">
                <p className="font-bold truncate">Sub-service not found</p>
                <p className="line-clamp-2">The requested link might be outdated. Select from below.</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            {service.subservices.length > 0 && (
              <div className="space-y-1 sm:space-y-2">
                <label className="block font-bold text-navy text-sm sm:text-base truncate">Select Sub-Service *</label>
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
              <div className="flex items-center gap-2 sm:gap-3 mt-2 flex-wrap">
                <span className="text-primary font-bold text-lg sm:text-xl">₹{selectedSubService.charge}</span>
                {selectedSubService.originalCharge && selectedSubService.originalCharge > selectedSubService.charge && (
                  <>
                    <span className="text-xs sm:text-sm text-slate-400 line-through">₹{selectedSubService.originalCharge}</span>
                    <span className="bg-green-100 text-green-600 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                      {Math.round(((selectedSubService.originalCharge - selectedSubService.charge) / selectedSubService.originalCharge) * 100)}% OFF
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sub-Service Image Display */}
        {selectedSubService && selectedSubService.image && (
          <div className="rounded-xl sm:rounded-2xl overflow-hidden border border-slate-200 shadow-md w-full">
            <div className={`flex items-center justify-center w-full bg-slate-100 ${
              selectedSubService.imageType === 'url' && selectedSubService.image
                ? 'aspect-video'
                : 'aspect-square'
            }`}>
              {selectedSubService.imageType === 'url' && selectedSubService.image ? (
                selectedSubService.image.toLowerCase().endsWith('.mp4') ? (
                  <video src={selectedSubService.image} className="w-full h-full object-contain" muted autoPlay loop />
                ) : (
                  <img src={selectedSubService.image} alt={selectedSubService.name} className="w-full h-full object-contain" />
                )
              ) : (
                <IconRenderer name={selectedSubService.image || 'file-text'} className="w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 text-primary" />
              )}
            </div>
          </div>
        )}

        {(selectedSubService?.fields && selectedSubService.fields.length > 0 
          ? selectedSubService.fields 
          : service.fields).length > 0 ? (
          (selectedSubService?.fields && selectedSubService.fields.length > 0 
            ? selectedSubService.fields 
            : service.fields).map((field, i) => (
            <div key={i} className="space-y-1 sm:space-y-2 w-full">
              <label className="block font-bold text-navy text-xs sm:text-sm md:text-base truncate">{field.label} *</label>
              {field.type === 'file' ? (
                <div className="relative w-full">
                  <input 
                    type="file" 
                    required
                    className="hidden" 
                    id={`file-${i}`}
                    onChange={e => e.target.files && handleFileChange(field.label, e.target.files[0])}
                  />
                  <label 
                    htmlFor={`file-${i}`}
                    className="w-full flex flex-col items-center justify-center gap-1 p-3 sm:p-4 md:p-5 border-2 border-dashed border-slate-200 rounded-lg sm:rounded-xl cursor-pointer hover:border-primary hover:bg-primary/5 transition-all overflow-hidden"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ff841b" className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 shrink-0">
                      <path d="M15.26 22.2503H8.73998C3.82998 22.2503 1.72998 20.1503 1.72998 15.2403V15.1103C1.72998 10.6703 3.47998 8.53027 7.39998 8.16027C7.79998 8.13027 8.17998 8.43027 8.21998 8.84027C8.25998 9.25027 7.95998 9.62027 7.53998 9.66027C4.39998 9.95027 3.22998 11.4303 3.22998 15.1203V15.2503C3.22998 19.3203 4.66998 20.7603 8.73998 20.7603H15.26C19.33 20.7603 20.77 19.3203 20.77 15.2503V15.1203C20.77 11.4103 19.58 9.93027 16.38 9.66027C15.97 9.62027 15.66 9.26027 15.7 8.85027C15.74 8.44027 16.09 8.13027 16.51 8.17027C20.49 8.51027 22.27 10.6603 22.27 15.1303V15.2603C22.27 20.1503 20.17 22.2503 15.26 22.2503Z" fill="#ff841b"/>
                      <path d="M12 15.7501C11.59 15.7501 11.25 15.4101 11.25 15.0001V3.62012C11.25 3.21012 11.59 2.87012 12 2.87012C12.41 2.87012 12.75 3.21012 12.75 3.62012V15.0001C12.75 15.4101 12.41 15.7501 12 15.7501Z" fill="#ff841b"/>
                      <path d="M15.3501 6.60043C15.1601 6.60043 14.9701 6.53043 14.8201 6.38043L12.0001 3.56043L9.18009 6.38043C8.89009 6.67043 8.41009 6.67043 8.12009 6.38043C7.83009 6.09043 7.83009 5.61043 8.12009 5.32043L11.4701 1.97043C11.7601 1.68043 12.2401 1.68043 12.5301 1.97043L15.8801 5.32043C16.1701 5.61043 16.1701 6.09043 15.8801 6.38043C15.7401 6.53043 15.5401 6.60043 15.3501 6.60043Z" fill="#ff841b"/>
                    </svg>
                    <span className="text-[10px] sm:text-xs md:text-sm text-slate-500 font-medium text-center line-clamp-2 px-1 max-w-full">
                      {files[field.label] ? files[field.label].name.substring(0, 20) + (files[field.label].name.length > 20 ? '...' : '') : 'Click to upload'}
                    </span>
                  </label>
                </div>
              ) : field.type === 'textarea' ? (
                <textarea 
                  required
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                  className="input-field min-h-[70px] sm:min-h-[80px] md:min-h-[100px] text-[11px] sm:text-xs md:text-sm resize-vertical w-full"
                  onChange={e => handleInputChange(field.label, e.target.value)}
                />
              ) : field.type === 'select' ? (
                <select 
                  required
                  className="input-field text-xs sm:text-sm w-full"
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
                  className="input-field text-xs sm:text-sm w-full"
                  onChange={e => handleInputChange(field.label, e.target.value)}
                />
              )}
            </div>
          ))
        ) : (
          <div className="p-4 sm:p-6 md:p-8 bg-slate-50 rounded-lg sm:rounded-xl md:rounded-2xl border border-dashed border-slate-200 text-center w-full overflow-hidden">
            <p className="text-[10px] sm:text-xs md:text-sm text-slate-500">No additional details required.</p>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading}
          className="btn-primary w-full py-2.5 sm:py-3 md:py-4 text-xs sm:text-sm md:text-base mt-4 relative overflow-hidden"
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center">
              <span className="flex items-center gap-2">
                <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span className="text-xs sm:text-sm">
                  {uploadProgress.total > 0 ? `Uploading (${uploadProgress.current}/${uploadProgress.total})...` : 'Submitting...'}
                </span>
              </span>
              {uploadProgress.total > 0 && (
                <div className="absolute bottom-0 left-0 h-1 bg-white/30 transition-all duration-300" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
              )}
            </div>
          ) : selectedSubService ? 'Proceed to Payment' : 'Submit Application'}
        </button>
        </form>
        </div>
      </div>
    </div>
  );
}
