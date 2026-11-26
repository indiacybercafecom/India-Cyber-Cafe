import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, rtdb } from '../firebase';
import { IconRenderer } from '../components/Icons';
import { Product, UserProfile, Order, OrderAddress } from '../types';
import { SEO } from '../components/SEO';
import { showToast } from '../components/Toast';
import { get, update, ref as dbRef } from 'firebase/database';
import { getRazorpayKeyId, loadRazorpayScript } from '../services/razorpayService';
import { uploadFileWithRetry, MAX_SERVICE_FILE_SIZE } from '../services/uploadService';
import {
  findUserByEmail,
  findUserByPhone,
  createGuestAccount as createGuestAccountInDB,
  saveGuestOrderRef,
  linkGuestOrdersToAuthenticatedUser
} from '../services/guestCheckoutService';
import { notifyRegistrationApi } from '../services/emailService';
import { sanitizeAddress, trimWhitespace } from '../utils/sanitizer';
import { CheckoutSkeleton } from '../components/Skeleton';
import { useLoadingState } from '../hooks/useLoadingState';
import { getFriendlyErrorMessage } from '../utils/errorHandler';
import { fetchWithTimeout, withClientTimeout } from '../utils/fetchWithTimeout';
import { loadCheckoutDraft, saveCheckoutDraft, clearCheckoutDraft } from '../utils/digitalDownload';

const PENDING_VERIFICATION_STORAGE_KEY = 'icc_pending_store_payment';
const PENDING_ATTEMPT_STORAGE_KEY = 'icc_pending_store_attempt';

interface StoreCheckoutProps {
  products: Product[];
  user: UserProfile | null;
  authLoading?: boolean;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onOrderSuccess?: () => void;
}

interface PendingPaymentVerification {
  orderId: string;
  productName: string;
  email: string;
  phone: string;
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  guestTrackingToken?: string;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function StoreCheckout({
  products,
  user,
  authLoading = false,
  isLoading = false,
  error = null,
  onRetry,
  onOrderSuccess
}: StoreCheckoutProps) {
  const { productId, categoryId } = useParams<{ productId: string; categoryId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialDraft = loadCheckoutDraft(productId);
  const qtyFromQuery = Number(new URLSearchParams(location.search).get('qty'));
  const quantity = Math.max(
    1,
    Number(location.state?.quantity) ||
      (Number.isFinite(qtyFromQuery) && qtyFromQuery >= 1 ? Math.floor(qtyFromQuery) : 0) ||
      (initialDraft?.quantity && initialDraft.quantity >= 1 ? Math.floor(initialDraft.quantity) : 1)
  );

  const product = products.find(p => p.id === productId);
  const displayLoading = useLoadingState(isLoading, 600);

  const [customImageFile, setCustomImageFile] = useState<File | null>(null);
  const [customImageUrl, setCustomImageUrl] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [specialInstructions, setSpecialInstructions] = useState(initialDraft?.specialInstructions || '');
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cod'>('online');

  const [address, setAddress] = useState<OrderAddress>(() => {
    const base: OrderAddress = user?.address
      ? { ...user.address }
      : {
          name: user?.name || '',
          email: user?.email || '',
          phone: user?.phone || '',
          addressLine1: '',
          addressLine2: '',
          city: '',
          state: '',
          pincode: '',
          country: 'India'
        };
    if (!initialDraft) return base;
    return {
      ...base,
      name: initialDraft.name || base.name,
      email: initialDraft.email || base.email,
      phone: initialDraft.phone || base.phone,
      addressLine1: initialDraft.addressLine1 || base.addressLine1,
      addressLine2: initialDraft.addressLine2 || base.addressLine2,
      city: initialDraft.city || base.city,
      state: initialDraft.state || base.state,
      pincode: initialDraft.pincode || base.pincode,
      country: initialDraft.country || base.country || 'India',
    };
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const paymentProcessingRef = useRef(false);
  const razorpayOpenRef = useRef(false);
  const isMountedRef = useRef(true);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const [pendingVerification, setPendingVerification] = useState<PendingPaymentVerification | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = window.localStorage.getItem(PENDING_VERIFICATION_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [verificationError, setVerificationError] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      submittingRef.current = false;
      paymentProcessingRef.current = false;
      razorpayOpenRef.current = false;
    };
  }, []);

  // Passive recovery check if browser closed after Razorpay modal opened without running callback
  useEffect(() => {
    if (typeof window === 'undefined' || pendingVerification) return;
    let cancelled = false;
    try {
      const rawAttempt = window.localStorage.getItem(PENDING_ATTEMPT_STORAGE_KEY);
      if (!rawAttempt) return;
      const parsed = JSON.parse(rawAttempt);
      if (!parsed?.orderId || Date.now() - Number(parsed.createdAt || 0) > 60 * 60 * 1000) {
        window.localStorage.removeItem(PENDING_ATTEMPT_STORAGE_KEY);
        return;
      }

      void (async () => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
        if (idToken) headers.Authorization = `Bearer ${idToken}`;
        const resp = await fetchWithTimeout('/api/store/orders/recover-payment', {
          method: 'POST',
          headers,
          body: JSON.stringify({ orderId: parsed.orderId, guestTrackingToken: parsed.guestTrackingToken }),
          timeoutMs: 10000
        });
        const data = await resp.json().catch(() => ({}));
        if (!cancelled && isMountedRef.current && resp.ok && data.verified && data.order) {
          window.localStorage.removeItem(PENDING_ATTEMPT_STORAGE_KEY);
          window.localStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
          onOrderSuccess?.();
          navigate('/store/order-confirmation', {
            state: {
              order: data.order,
              productName: parsed.productName || product?.name || 'Order',
              guestTrackingToken: parsed.guestTrackingToken
            }
          });
        }
      })().catch(() => {});
    } catch {}

    return () => {
      cancelled = true;
    };
  }, [pendingVerification]);

  // Guest checkout / existing account verification states
  const [emailChecked, setEmailChecked] = useState(false);
  const [createGuestAccount, setCreateGuestAccount] = useState(false);
  const [existingUserFound, setExistingUserFound] = useState(false);
  const [existingUserEmail, setExistingUserEmail] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Sync allowed payment method whenever product loads
  useEffect(() => {
    if (!product) return;
    if (product.productType === 'virtual') {
      setPaymentMethod('online');
      return;
    }
    if (!product.paymentMethods || product.paymentMethods.length === 0) return;
    const methods = product.paymentMethods;
    const allowsBoth = methods.includes('both') || (methods.includes('online') && methods.includes('cod'));
    if (allowsBoth) return;
    if (methods.includes('cod') && !methods.includes('online')) {
      setPaymentMethod('cod');
    } else if (methods.includes('online')) {
      setPaymentMethod('online');
    }
  }, [product?.id, product?.productType]);

  // Reset idempotency key when checkout payload changes meaningfully
  useEffect(() => {
    idempotencyKeyRef.current = generateIdempotencyKey();
  }, [productId, quantity, paymentMethod]);

  // Preload Razorpay script when online payment is selected
  useEffect(() => {
    if (paymentMethod === 'online' && product) {
      void loadRazorpayScript(12000).catch(() => {});
    }
  }, [paymentMethod, product?.id]);

  // Warn before accidental navigation during payment verification
  useEffect(() => {
    if (!paymentProcessing) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [paymentProcessing]);

  // Auto-fill empty fields from user profile when authenticated user loads (never clobber preserved draft edits)
  useEffect(() => {
    if (user?.address) {
      setAddress(prev => ({
        ...user.address!,
        name: prev.name || user.address!.name || user.name || '',
        email: prev.email || user.address!.email || user.email || '',
        phone: prev.phone || user.address!.phone || user.phone || '',
        addressLine1: prev.addressLine1 || user.address!.addressLine1 || '',
        addressLine2: prev.addressLine2 || user.address!.addressLine2 || '',
        city: prev.city || user.address!.city || '',
        state: prev.state || user.address!.state || '',
        pincode: prev.pincode || user.address!.pincode || '',
        country: prev.country || user.address!.country || 'India',
      }));
    } else if (user) {
      setAddress(prev => ({
        ...prev,
        name: prev.name || user.name || '',
        email: prev.email || user.email || '',
        phone: prev.phone || user.phone || ''
      }));
    }
  }, [user?.uid]);

  // Preserve checkout draft across login redirects so zero data is missed
  useEffect(() => {
    if (!productId) return;
    saveCheckoutDraft(productId, {
      quantity,
      name: address.name,
      email: address.email,
      phone: address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: address.country,
      specialInstructions,
    });
  }, [productId, quantity, address, specialInstructions]);

  if (displayLoading) {
    return <CheckoutSkeleton />;
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-slate-600 mb-2">Failed to Load Product</h2>
        <p className="text-slate-500 text-sm mb-6">{getFriendlyErrorMessage(error, 'An error occurred while loading the product.')}</p>
        <button onClick={onRetry} className="btn-primary">Retry</button>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-slate-600">Product not found</h2>
        <button onClick={() => navigate('/store')} className="btn-primary mt-4">
          Back to Store
        </button>
      </div>
    );
  }

  const isVirtual = product.productType === 'virtual';
  const isVirtualLoginLocked = isVirtual && !user;

  const handleRedirectToLogin = () => {
    saveCheckoutDraft(productId, {
      quantity,
      name: address.name,
      email: address.email,
      phone: address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: address.country,
      specialInstructions,
    });
    const redirectTarget = `${location.pathname}?qty=${quantity}`;
    navigate(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        showToast('File size must be less than 5MB', 'error');
        return;
      }
      if (!file.type.startsWith('image/')) {
        showToast('Please select an image file (JPG, PNG, or WEBP)', 'error');
        return;
      }

      setCustomImageFile(file);
      setCustomImageUrl('');

      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEmailBlur = async () => {
    if (user?.uid || isVirtual) return;
    if (!address.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) {
      if (!requiresPassword || !passwordInput) {
        setExistingUserFound(false);
        setRequiresPassword(false);
        setPasswordVerified(false);
        setEmailChecked(false);
      }
      return;
    }

    try {
      const existingUser = await findUserByEmail(address.email);
      setEmailChecked(true);
      if (existingUser) {
        setExistingUserFound(true);
        setExistingUserEmail(existingUser.email);
        setRequiresPassword(!existingUser.isGoogleOnly);
        setPasswordVerified(false);
        setPasswordInput('');
        setCreateGuestAccount(false);
      } else {
        setExistingUserFound(false);
        setRequiresPassword(false);
        setPasswordVerified(false);
      }
    } catch {
      setEmailChecked(true);
    }
  };

  const handlePhoneBlur = async () => {
    if (user?.uid || isVirtual) return;
    const digits = address.phone.replace(/\D/g, '');
    if (!digits || !/^[0-9]{10}$/.test(digits)) {
      if (!existingUserFound) setRequiresPassword(false);
      return;
    }

    try {
      const existingUser = await findUserByPhone(digits);
      setEmailChecked(true);
      if (existingUser) {
        if (!address.email && existingUser.email) {
          setAddress(prev => ({ ...prev, email: existingUser.email }));
        }
        setExistingUserFound(true);
        setExistingUserEmail(existingUser.email);
        setRequiresPassword(!existingUser.isGoogleOnly);
        setPasswordVerified(false);
        setPasswordInput('');
        setCreateGuestAccount(false);
      } else if (!requiresPassword) {
        setExistingUserFound(false);
        setRequiresPassword(false);
        setPasswordVerified(false);
      }
    } catch {
      setEmailChecked(true);
    }
  };

  const handlePasswordVerify = async () => {
    if (!passwordInput.trim()) {
      showToast('Please enter password', 'error');
      return;
    }

    const emailToLogin = existingUserEmail || address.email.trim();
    setVerifyingPassword(true);
    try {
      const cred = await withClientTimeout(
        signInWithEmailAndPassword(auth, emailToLogin, passwordInput),
        10000,
        'Sign in timed out. Please try again.'
      );
      setPasswordVerified(true);
      setPasswordInput('');
      setRequiresPassword(false);

      // Now authenticated: safely read user's own profile address
      try {
        const snap = await withClientTimeout(
          get(dbRef(rtdb, `users/${cred.user.uid}`)),
          6000,
          'Profile fetch timed out.'
        );
        if (snap.exists()) {
          const profile = snap.val();
          if (profile?.address) {
            setAddress(prev => ({
              ...prev,
              name: profile.address.name || profile.name || prev.name,
              email: profile.address.email || profile.email || prev.email,
              phone: profile.address.phone || profile.phone || prev.phone,
              addressLine1: profile.address.addressLine1 || prev.addressLine1,
              addressLine2: profile.address.addressLine2 || prev.addressLine2,
              city: profile.address.city || prev.city,
              state: profile.address.state || prev.state,
              pincode: profile.address.pincode || prev.pincode
            }));
          } else {
            setAddress(prev => ({
              ...prev,
              name: profile?.name || prev.name,
              email: profile?.email || prev.email,
              phone: profile?.phone || prev.phone
            }));
          }
        }
      } catch {}

      showToast('Account verified! Your saved details have been auto-filled.', 'success');
    } catch (error: any) {
      showToast(error, 'error', 'Incorrect password. Please try again.');
      setPasswordInput('');
    } finally {
      if (isMountedRef.current) setVerifyingPassword(false);
    }
  };

  const uploadCustomImage = async (): Promise<string | null> => {
    if (!customImageFile) return null;

    const uploadViaBackend = async (): Promise<string | null> => {
      const formData = new FormData();
      formData.append('customImage', customImageFile);
      const resp = await fetchWithTimeout('/api/store/upload-custom-image', {
        method: 'POST',
        body: formData,
        timeoutMs: 20000,
        timeoutMessage: 'Image upload timed out. Please try a smaller image or check your connection.'
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.url) {
        throw new Error(data.error || 'Image upload failed on server.');
      }
      return data.url;
    };

    try {
      setUploading(true);
      // Guests go directly to backend upload endpoint so Firebase Storage rules never delay checkout
      if (!auth.currentUser) {
        return await uploadViaBackend();
      }

      try {
        return await uploadFileWithRetry(customImageFile, {
          category: 'custom-images',
          maxSizeBytes: MAX_SERVICE_FILE_SIZE,
          timeoutMs: 12000,
          maxRetries: 2,
        });
      } catch {
        return await uploadViaBackend();
      }
    } catch (error) {
      console.error('Image upload error:', error);
      showToast(error, 'error', 'Failed to upload image. Please check file format & size.');
      return null;
    } finally {
      if (isMountedRef.current) setUploading(false);
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!address.name.trim()) errors.name = 'Name is required';
    if (!address.email.trim()) errors.email = 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email.trim())) errors.email = 'Valid email is required';
    if (!address.phone.trim()) errors.phone = 'Phone is required';
    const cleanPhone = address.phone.replace(/\D/g, '');
    if (!/^[0-9]{10}$/.test(cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone)) {
      errors.phone = 'Valid 10-digit phone is required';
    }
    if (!isVirtual) {
      if (!address.addressLine1.trim()) errors.addressLine1 = 'Address is required';
      if (!address.city.trim()) errors.city = 'City is required';
      if (!address.state.trim()) errors.state = 'State is required';
      if (!address.pincode.trim()) errors.pincode = 'Pincode is required';
      if (!/^[0-9]{6}$/.test(address.pincode.trim())) errors.pincode = 'Valid 6-digit pincode is required';
    }

    if (!isVirtual && product.requiresCustomImage && !customImageFile && !customImageUrl) {
      errors.customImage = 'Custom image is required for this product';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.currentUser) {
      try {
        const token = await withClientTimeout(
          auth.currentUser.getIdToken(),
          5000,
          'Auth token lookup timed out.'
        );
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {}
    }
    return headers;
  };

  const handlePostOrderSuccess = async (
    confirmedOrder: Order,
    sanitizedAddress: OrderAddress,
    guestTrackingToken?: string
  ) => {
    try {
      window.localStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
      window.localStorage.removeItem(PENDING_ATTEMPT_STORAGE_KEY);
    } catch {}
    clearCheckoutDraft(productId);

    // Store guest tracking info locally so guest can easily view status or link on login
    if (confirmedOrder.isGuest || !auth.currentUser) {
      saveGuestOrderRef({
        orderId: confirmedOrder.id,
        email: sanitizedAddress.email,
        phone: sanitizedAddress.phone,
        token: guestTrackingToken,
        createdAt: confirmedOrder.createdAt || new Date().toISOString()
      });
    }

    // Save address to profile non-blockingly if logged in and profile has no address yet (physical orders only)
    if (!isVirtual && auth.currentUser && user && !user.address && sanitizedAddress.addressLine1) {
      void withClientTimeout(
        update(dbRef(rtdb, `users/${auth.currentUser.uid}`), { address: sanitizedAddress }),
        5000,
        'Address save timed out.'
      ).catch(() => {});
    }

    // Optional guest account creation in background AFTER critical order is confirmed & persisted
    if (!auth.currentUser && createGuestAccount) {
      void withClientTimeout(
        createGuestAccountInDB(
          sanitizedAddress.email,
          sanitizedAddress.name,
          sanitizedAddress.phone
        ),
        10000,
        'Account setup timed out.'
      )
        .then(async (accountRes) => {
          if (accountRes?.success) {
            notifyRegistrationApi({ isGuestCheckout: true }).catch(() => {});
            await linkGuestOrdersToAuthenticatedUser().catch(() => {});
          }
        })
        .catch(() => {});
    }

    idempotencyKeyRef.current = generateIdempotencyKey();
    onOrderSuccess?.();

    navigate('/store/order-confirmation', {
      state: {
        order: confirmedOrder,
        productName: product.name,
        guestTrackingToken
      }
    });
  };

  const recoverOrderFromServer = async (orderId: string, guestTrackingToken?: string): Promise<Order | null> => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
      const recResp = await fetchWithTimeout('/api/store/orders/recover-payment', {
        method: 'POST',
        headers,
        body: JSON.stringify({ orderId, guestTrackingToken }),
        timeoutMs: 12000,
        timeoutMessage: 'Order status recovery timed out.'
      });
      const recData = await recResp.json().catch(() => ({}));
      if (recResp.ok && recData.verified && recData.order) {
        try {
          window.localStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
          window.localStorage.removeItem(PENDING_ATTEMPT_STORAGE_KEY);
        } catch {}
        if (isMountedRef.current) {
          setPendingVerification(null);
          setVerificationError(null);
        }
        return recData.order as Order;
      }
    } catch {}
    return null;
  };

  const executeVerifyPaymentWithRetry = async (payload: PendingPaymentVerification) => {
    const maxAttempts = 2;
    let lastError = 'Payment confirmation is pending. Please click Retry Payment Verification — do NOT pay again.';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const headers = await getAuthHeaders();
        const verifyResp = await fetchWithTimeout('/api/store/orders/verify-payment', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            orderId: payload.orderId,
            razorpay_payment_id: payload.razorpay_payment_id,
            razorpay_order_id: payload.razorpay_order_id,
            razorpay_signature: payload.razorpay_signature
          }),
          timeoutMs: 15000,
          timeoutMessage: 'Order confirmation timed out. Checking payment recovery — please do NOT pay again.'
        });

        const verifyData = await verifyResp.json().catch(() => ({}));
        if (verifyResp.ok && verifyData.verified && verifyData.order) {
          try {
            window.localStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
            window.localStorage.removeItem(PENDING_ATTEMPT_STORAGE_KEY);
          } catch {}
          if (isMountedRef.current) {
            setPendingVerification(null);
            setVerificationError(null);
          }
          return verifyData.order as Order;
        }

        // Do not retry 4xx cryptographic mismatch / fraud rejections
        if (verifyResp.status >= 400 && verifyResp.status < 500) {
          throw new Error(verifyData.error || 'Invalid payment verification.');
        }

        lastError = verifyData.error || `Server status ${verifyResp.status} while confirming order. Do NOT pay again.`;
      } catch (err: any) {
        if (err?.message && (err.message.includes('Invalid') || err.message.includes('mismatch'))) {
          throw err;
        }
        lastError = err?.message || 'Confirmation request did not finish in time. Do NOT pay again.';
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }

    // Immediate automatic server-side recovery check before alerting user
    const recoveredOrder = await recoverOrderFromServer(payload.orderId, payload.guestTrackingToken);
    if (recoveredOrder) {
      return recoveredOrder;
    }

    throw new Error(lastError);
  };

  const handleRetryPendingVerification = async () => {
    if (!pendingVerification || paymentProcessingRef.current) return;
    paymentProcessingRef.current = true;
    setPaymentProcessing(true);
    setVerificationError(null);

    try {
      const confirmedOrder = await executeVerifyPaymentWithRetry(pendingVerification);
      const sanitizedAddress = sanitizeAddress({
        ...address,
        email: pendingVerification.email || address.email,
        phone: pendingVerification.phone || address.phone
      });
      await handlePostOrderSuccess(confirmedOrder, sanitizedAddress, pendingVerification.guestTrackingToken);
    } catch (err: any) {
      const msg = err?.message || 'Payment confirmation is still pending. Please do NOT pay again — retry verification in a moment.';
      if (isMountedRef.current) {
        setVerificationError(msg);
      }
      showToast(msg, 'error');
    } finally {
      paymentProcessingRef.current = false;
      if (isMountedRef.current) {
        setPaymentProcessing(false);
        setSubmitting(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submittingRef.current || submitting || uploading || paymentProcessingRef.current || razorpayOpenRef.current) return;

    if (isVirtualLoginLocked) {
      showToast('Please login to your account to purchase virtual/digital products.', 'info');
      handleRedirectToLogin();
      return;
    }

    if (!validateForm()) {
      showToast(
        isVirtual ? 'Please fix the highlighted contact details' : 'Please fix the highlighted address fields',
        'error'
      );
      return;
    }

    try {
      submittingRef.current = true;
      setSubmitting(true);

      let uploadedImageUrl = customImageUrl;
      if (!isVirtual && customImageFile && !customImageUrl) {
        uploadedImageUrl = (await uploadCustomImage()) || '';
        if (uploadedImageUrl) {
          setCustomImageUrl(uploadedImageUrl);
        } else if (product.requiresCustomImage) {
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
      }

      const sanitizedAddress = sanitizeAddress(
        isVirtual
          ? {
              ...address,
              addressLine1: '',
              addressLine2: '',
              city: '',
              state: '',
              pincode: '',
              country: address.country || 'India'
            }
          : address
      );
      const orderItems = [
        {
          productId: product.id,
          quantity,
          customImageUrl: uploadedImageUrl || undefined,
          specialInstructions: trimWhitespace(specialInstructions) || undefined
        }
      ];

      const headers = await getAuthHeaders();

      if (paymentMethod === 'cod') {
        const resp = await fetchWithTimeout('/api/store/orders/cod', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            items: orderItems,
            deliveryAddress: sanitizedAddress,
            idempotencyKey: idempotencyKeyRef.current
          }),
          timeoutMs: 20000,
          timeoutMessage: 'Order submission timed out. Please wait a moment and check My Orders before retrying.'
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success || !data.order) {
          throw new Error(data.error || 'Failed to place COD order.');
        }

        showToast('Order placed with Cash on Delivery!', 'success');
        await handlePostOrderSuccess(data.order, sanitizedAddress, data.guestTrackingToken);
      } else {
        // Server-authoritative Razorpay pending order creation + concurrent SDK script preload
        const [createResp, scriptLoaded] = await Promise.all([
          fetchWithTimeout('/api/store/orders/create-payment', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              items: orderItems,
              deliveryAddress: sanitizedAddress,
              idempotencyKey: idempotencyKeyRef.current
            }),
            timeoutMs: 20000,
            timeoutMessage: 'Could not reach payment gateway in time. Please try again.'
          }),
          loadRazorpayScript(12000),
        ]);

        const createData = await createResp.json().catch(() => ({}));
        if (!createResp.ok || !createData.success || !createData.razorpayOrderId) {
          throw new Error(createData.error || 'Unable to initiate online payment.');
        }

        if (!scriptLoaded || !window.Razorpay) {
          throw new Error('Payment gateway script could not load. Please check your connection and try again.');
        }

        const pendingPayloadBase = {
          orderId: createData.orderId as string,
          productName: product.name,
          email: sanitizedAddress.email,
          phone: sanitizedAddress.phone,
          guestTrackingToken: createData.guestTrackingToken as string | undefined
        };

        try {
          window.localStorage.setItem(
            PENDING_ATTEMPT_STORAGE_KEY,
            JSON.stringify({
              ...pendingPayloadBase,
              createdAt: Date.now()
            })
          );
        } catch {}

        const options = {
          key: createData.keyId || getRazorpayKeyId(),
          amount: createData.amount,
          currency: createData.currency || 'INR',
          order_id: createData.razorpayOrderId,
          name: 'India Cyber Cafe',
          description: `Order ${createData.orderId} - ${product.name}`,
          prefill: {
            name: sanitizedAddress.name,
            email: sanitizedAddress.email,
            contact: sanitizedAddress.phone
          },
          handler: async (response: any) => {
            razorpayOpenRef.current = false;
            if (paymentProcessingRef.current) return;
            paymentProcessingRef.current = true;
            if (isMountedRef.current) {
              setPaymentProcessing(true);
              setVerificationError(null);
            }

            const verifyPayload: PendingPaymentVerification = {
              ...pendingPayloadBase,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            };

            try {
              try {
                window.localStorage.setItem(PENDING_VERIFICATION_STORAGE_KEY, JSON.stringify(verifyPayload));
              } catch {}
              if (isMountedRef.current) {
                setPendingVerification(verifyPayload);
              }

              const confirmedOrder = await executeVerifyPaymentWithRetry(verifyPayload);
              showToast('Payment successful! Order confirmed.', 'success');
              await handlePostOrderSuccess(confirmedOrder, sanitizedAddress, pendingPayloadBase.guestTrackingToken);
            } catch (err: any) {
              const msg = err?.message || 'Payment confirmation timed out. Please click Retry Payment Verification — do NOT pay again.';
              if (isMountedRef.current) {
                setVerificationError(msg);
              }
              showToast(msg, 'error');
            } finally {
              paymentProcessingRef.current = false;
              submittingRef.current = false;
              if (isMountedRef.current) {
                setPaymentProcessing(false);
                setSubmitting(false);
              }
            }
          },
          modal: {
            ondismiss: async () => {
              razorpayOpenRef.current = false;
              paymentProcessingRef.current = false;
              submittingRef.current = false;
              if (isMountedRef.current) {
                setPaymentProcessing(false);
                setSubmitting(false);
              }
              // Check quietly if Razorpay completed right as modal closed
              const recovered = await recoverOrderFromServer(pendingPayloadBase.orderId, pendingPayloadBase.guestTrackingToken);
              if (recovered && isMountedRef.current) {
                showToast('Payment detected! Confirming your order.', 'success');
                await handlePostOrderSuccess(recovered, sanitizedAddress, pendingPayloadBase.guestTrackingToken);
                return;
              }
              showToast('Payment was cancelled. You can retry whenever ready.', 'info');
            }
          },
          theme: { color: '#001A57' }
        };

        const rzp = new (window as any).Razorpay(options);
        if (typeof rzp?.on === 'function') {
          rzp.on('payment.failed', (failureResp: any) => {
            razorpayOpenRef.current = false;
            paymentProcessingRef.current = false;
            submittingRef.current = false;
            if (isMountedRef.current) {
              setPaymentProcessing(false);
              setSubmitting(false);
            }
            const reason =
              failureResp?.error?.description ||
              failureResp?.error?.reason ||
              'Payment could not be completed. Please try again.';
            showToast(reason, 'error');
          });
        }

        razorpayOpenRef.current = true;
        rzp.open();
        // Modal is now open and manages handler/ondismiss/payment.failed; never leave button stuck
        submittingRef.current = false;
        if (isMountedRef.current) {
          setSubmitting(false);
        }
        return;
      }
    } catch (error: any) {
      console.error('Order submission error:', error);
      showToast(error, 'error', 'Failed to place order. Please try again.');
    } finally {
      submittingRef.current = false;
      if (!paymentProcessingRef.current && isMountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  const unitPrice = product.discountedPrice && product.discountedPrice > 0 ? product.discountedPrice : product.price;
  const subtotal = unitPrice * quantity;
  const deliveryCharges = isVirtual ? 0 : (product.deliveryCharges || 0);
  const total = subtotal + deliveryCharges;

  const methods = isVirtual ? ['online'] : (product.paymentMethods || ['online', 'cod']);
  const supportsBoth = !isVirtual && (methods.includes('both') || (methods.includes('online') && methods.includes('cod')));
  const supportsOnlineOnly = isVirtual || (!supportsBoth && methods.includes('online'));
  const supportsCodOnly = !isVirtual && !supportsBoth && methods.includes('cod');

  return (
    <div className="space-y-6 sm:space-y-10 pb-12">
      {paymentProcessing && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm" role="alert" aria-live="assertive">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl sm:p-8">
            <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
            <p className="text-base font-semibold leading-relaxed text-navy">
              Payment received. Please wait while we confirm your payment and place your order. Do not refresh or go back.
            </p>
          </div>
        </div>
      )}

      <SEO
        title={`Checkout - ${product.name} | Secure Payment - India Cyber Cafe`}
        description={`Secure checkout for ${product.name}. Total: ₹${total}. Fast delivery, custom printing, multiple payment options.`}
        url={`https://b.indiacybercafe.com/store/${categoryId}/${product.id}/checkout`}
        keywords="checkout, secure payment, online purchase, razorpay, cash on delivery"
        ogType="website"
      />

      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate(`/store/${categoryId}/${productId}`)}
          className="flex items-center gap-2 text-primary font-semibold hover:gap-3 transition-all mb-4"
        >
          <IconRenderer name="arrow-left" className="w-4 h-4" />
          Back
        </button>
        <h1 className="text-3xl sm:text-4xl font-bold text-navy">Checkout</h1>
      </div>

      {/* Virtual Product Login Required Banner (matches Services Apply flow) */}
      {isVirtualLoginLocked && (
        <div
          data-testid="virtual-checkout-login-banner"
          className="p-4 sm:p-5 bg-linear-to-r from-navy/5 via-primary/5 to-navy/5 border border-primary/25 rounded-xl sm:rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <IconRenderer name="lock" className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-navy">Login Required to Buy Digital Product</h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                You can review all product details and fill your contact info below. Login is required to complete payment so only your account can download the digital files — all your entered details will be preserved.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRedirectToLogin}
            data-testid="virtual-checkout-banner-login-btn"
            className="btn-primary px-5 py-2.5 text-xs sm:text-sm whitespace-nowrap shrink-0 flex items-center justify-center gap-2"
          >
            <IconRenderer name="user" className="w-4 h-4 shrink-0" />
            <span>Login to Buy</span>
          </button>
        </div>
      )}

      {/* Payment Verification Recovery Banner (prevents charging twice) */}
      {pendingVerification && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 sm:p-6 space-y-3" role="alert">
          <div className="flex items-start gap-3">
            <IconRenderer name="alert-circle" className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <h2 className="text-base sm:text-lg font-bold text-amber-950">
                Payment Received — Confirming Order ({pendingVerification.orderId})
              </h2>
              <p className="text-xs sm:text-sm text-amber-900">
                {verificationError ||
                  'Your Razorpay payment was completed, but the confirmation step was interrupted. Please click below to verify and finalize your order — do NOT pay again.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRetryPendingVerification}
              disabled={paymentProcessing}
              className="btn-primary py-2.5 px-5 text-sm"
            >
              {paymentProcessing ? 'Verifying Payment...' : 'Retry Payment Verification'}
            </button>
            <button
              type="button"
              onClick={() => {
                window.localStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
                setPendingVerification(null);
                setVerificationError(null);
              }}
              className="px-4 py-2 rounded-xl border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Custom Image Upload */}
          {!isVirtual && product.requiresCustomImage && (
            <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
              <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                <IconRenderer name="camera" className="w-5 h-5 text-primary" />
                Upload Custom Image
              </h2>

              {product.customImageInstructions && (
                <div className="bg-blue-50 p-3 sm:p-4 rounded-lg border border-blue-200">
                  <p className="text-xs sm:text-sm text-blue-900">{product.customImageInstructions}</p>
                </div>
              )}

              {imagePreview ? (
                <div className="space-y-3">
                  <div className="aspect-square max-w-xs rounded-lg overflow-hidden bg-slate-100 border-2 border-primary">
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomImageFile(null);
                      setCustomImageUrl('');
                      setImagePreview('');
                    }}
                    className="text-red-600 font-semibold text-sm hover:text-red-700"
                  >
                    Remove Image
                  </button>
                </div>
              ) : (
                <label className="block">
                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 sm:p-8 text-center cursor-pointer hover:border-primary hover:bg-slate-50 transition-all">
                    <IconRenderer name="upload" className="w-8 h-8 sm:w-10 sm:h-10 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-700 mb-1">Click to upload your image</p>
                    <p className="text-xs sm:text-sm text-slate-500">Max 5MB • JPG, PNG, WEBP</p>
                  </div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                </label>
              )}

              {formErrors.customImage && (
                <p className="text-red-600 text-xs sm:text-sm font-semibold">{formErrors.customImage}</p>
              )}

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Special Instructions (Optional)
                </label>
                <textarea
                  value={specialInstructions}
                  onChange={e => setSpecialInstructions(e.target.value)}
                  placeholder="E.g., specific colors, text placement, etc."
                  className="input-field w-full h-24 resize-none text-xs sm:text-sm"
                />
              </div>
            </div>
          )}

          {/* Delivery Address / Contact Details */}
          <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
            <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
              <IconRenderer name={isVirtual ? 'user' : 'map-pin'} className="w-5 h-5 text-primary" />
              {isVirtual ? 'Contact Details' : 'Delivery Address'}
            </h2>

            {isVirtual && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 sm:p-3.5 text-xs sm:text-sm text-blue-900 flex items-start gap-2.5">
                <IconRenderer name="download" className="w-4 h-4 text-navy shrink-0 mt-0.5" />
                <p>
                  <span className="font-semibold text-navy">Instant Digital Delivery:</span> No shipping address needed. Your secure digital download unlocks immediately for your signed-in buyer account after payment and is also sent to your email.
                </p>
              </div>
            )}

            {existingUserFound && passwordVerified && (
              <div className="bg-green-50 border-2 border-green-400 rounded-lg p-3 flex items-center gap-2 mb-4">
                <span className="text-lg">✅</span>
                <div>
                  <p className="font-semibold text-green-900 text-sm">Account Verified!</p>
                  <p className="text-xs text-green-800">Your saved profile details have been loaded.</p>
                </div>
              </div>
            )}

            {requiresPassword && !passwordVerified && !user?.uid && (
              <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-300 rounded-lg p-4 space-y-3 mb-4">
                <div className="flex items-start gap-2">
                  <span className="text-xl">🔐</span>
                  <div>
                    <p className="font-bold text-slate-900 text-base">Existing Account Found</p>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                      {isVirtual
                        ? 'Enter your password to sign in and auto-fill your saved contact details, or skip to continue as guest.'
                        : 'Enter your password to sign in and auto-fill your saved address, or skip to continue as guest.'}
                    </p>
                  </div>
                </div>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handlePasswordVerify();
                      }
                    }}
                    disabled={verifyingPassword}
                    className="input-field w-full text-xs sm:text-sm pr-10"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePasswordVerify}
                    disabled={verifyingPassword || !passwordInput.trim()}
                    className="flex-1 bg-primary hover:bg-primary-dark text-white font-semibold py-2 px-3 rounded-lg text-xs sm:text-sm disabled:opacity-50"
                  >
                    {verifyingPassword ? 'Verifying...' : '✓ Sign In & Auto-Fill'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRequiresPassword(false);
                      setPasswordInput('');
                    }}
                    className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-3 rounded-lg text-xs sm:text-sm"
                  >
                    Skip (Guest Checkout)
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={address.name}
                  onChange={e => setAddress({ ...address, name: e.target.value })}
                  className={`input-field w-full text-xs sm:text-sm ${formErrors.name ? 'border-red-500' : ''}`}
                  placeholder="John Doe"
                />
                {formErrors.name && <p className="text-red-600 text-xs mt-1">{formErrors.name}</p>}
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={address.email}
                  onChange={e => {
                    setAddress({ ...address, email: e.target.value });
                    setEmailChecked(false);
                  }}
                  onBlur={handleEmailBlur}
                  className={`input-field w-full text-xs sm:text-sm ${formErrors.email ? 'border-red-500' : ''}`}
                  placeholder="john@example.com"
                />
                {formErrors.email && <p className="text-red-600 text-xs mt-1">{formErrors.email}</p>}
              </div>

              <div className={isVirtual ? 'sm:col-span-2' : ''}>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Phone *</label>
                <input
                  type="tel"
                  value={address.phone}
                  onChange={e => {
                    setAddress({ ...address, phone: e.target.value });
                    setEmailChecked(false);
                  }}
                  onBlur={handlePhoneBlur}
                  className={`input-field w-full text-xs sm:text-sm ${formErrors.phone ? 'border-red-500' : ''}`}
                  placeholder="9876543210"
                />
                {formErrors.phone && <p className="text-red-600 text-xs mt-1">{formErrors.phone}</p>}
              </div>

              {!isVirtual && (
                <>
                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">State *</label>
                    <input
                      type="text"
                      value={address.state}
                      onChange={e => setAddress({ ...address, state: e.target.value })}
                      className={`input-field w-full text-xs sm:text-sm ${formErrors.state ? 'border-red-500' : ''}`}
                      placeholder="Madhya Pradesh"
                    />
                    {formErrors.state && <p className="text-red-600 text-xs mt-1">{formErrors.state}</p>}
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">City *</label>
                    <input
                      type="text"
                      value={address.city}
                      onChange={e => setAddress({ ...address, city: e.target.value })}
                      className={`input-field w-full text-xs sm:text-sm ${formErrors.city ? 'border-red-500' : ''}`}
                      placeholder="Singrauli"
                    />
                    {formErrors.city && <p className="text-red-600 text-xs mt-1">{formErrors.city}</p>}
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Pincode *</label>
                    <input
                      type="text"
                      value={address.pincode}
                      onChange={e => setAddress({ ...address, pincode: e.target.value })}
                      className={`input-field w-full text-xs sm:text-sm ${formErrors.pincode ? 'border-red-500' : ''}`}
                      placeholder="486886"
                    />
                    {formErrors.pincode && <p className="text-red-600 text-xs mt-1">{formErrors.pincode}</p>}
                  </div>
                </>
              )}
            </div>

            {!isVirtual && (
              <>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Address *</label>
                  <input
                    type="text"
                    value={address.addressLine1}
                    onChange={e => setAddress({ ...address, addressLine1: e.target.value })}
                    className={`input-field w-full text-xs sm:text-sm ${formErrors.addressLine1 ? 'border-red-500' : ''}`}
                    placeholder="House No, Street, Locality"
                  />
                  {formErrors.addressLine1 && <p className="text-red-600 text-xs mt-1">{formErrors.addressLine1}</p>}
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Address Line 2 (Optional)</label>
                  <input
                    type="text"
                    value={address.addressLine2 || ''}
                    onChange={e => setAddress({ ...address, addressLine2: e.target.value })}
                    className="input-field w-full text-xs sm:text-sm"
                    placeholder="Landmark, Apartment, Suite"
                  />
                </div>
              </>
            )}
          </div>

          {/* Guest Checkout Account Option */}
          {!user?.uid && emailChecked && !existingUserFound && (
            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                <IconRenderer name="user-plus" className="w-5 h-5 text-primary" />
                Save Your Order History (Optional)
              </h2>

              <label className="flex items-start gap-3 cursor-pointer p-3 bg-white rounded-lg border-2 border-slate-200 hover:border-navy transition-all">
                <input
                  type="checkbox"
                  checked={createGuestAccount}
                  onChange={e => setCreateGuestAccount(e.target.checked)}
                  className="w-5 h-5 accent-navy cursor-pointer mt-0.5 flex-shrink-0"
                />
                <div className="flex-1">
                  <p className="text-sm font-bold text-navy">Create an account after this order</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Automatically link this order to a new account. Guests can also track orders anytime using Order ID + Email/Phone.
                  </p>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* Order Summary Sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
            <h3 className="text-lg font-bold text-navy">Order Summary</h3>

            <div className="border-b border-slate-200 pb-4">
              <div className="flex gap-3 mb-3">
                <img
                  src={product.images?.[0] || ''}
                  alt={product.name}
                  className="w-16 h-16 object-cover rounded-lg bg-slate-100"
                />
                <div className="flex-1">
                  <p className="text-xs sm:text-sm font-semibold text-navy line-clamp-2">{product.name}</p>
                  <p className="text-xs text-slate-500 mt-1">Qty: {quantity}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-semibold">₹{subtotal}</span>
              </div>
              {deliveryCharges > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Delivery</span>
                  <span className="font-semibold">₹{deliveryCharges}</span>
                </div>
              )}
              <div className="flex justify-between text-navy font-bold text-sm border-t border-slate-200 pt-2">
                <span>Total</span>
                <span>₹{total}</span>
              </div>
            </div>

            {/* Payment Method Selection */}
            <div className="space-y-3 pt-4 border-t border-slate-200">
              <h4 className="font-bold text-navy text-sm">Payment Method</h4>

              {supportsBoth ? (
                <>
                  <label className="flex items-center gap-3 p-3 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-navy transition-all">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="online"
                      checked={paymentMethod === 'online'}
                      onChange={() => setPaymentMethod('online')}
                      className="w-4 h-4 accent-navy cursor-pointer"
                    />
                    <div className="flex-1">
                      <p className="text-xs sm:text-sm font-bold text-navy">💳 Online Payment (Razorpay)</p>
                      <p className="text-xs text-slate-600">Pay instantly with card/UPI</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-navy transition-all">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="cod"
                      checked={paymentMethod === 'cod'}
                      onChange={() => setPaymentMethod('cod')}
                      className="w-4 h-4 accent-navy cursor-pointer"
                    />
                    <div className="flex-1">
                      <p className="text-xs sm:text-sm font-bold text-navy">🚚 Cash on Delivery</p>
                      <p className="text-xs text-slate-600">Pay when order arrives</p>
                    </div>
                  </label>
                </>
              ) : supportsOnlineOnly ? (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-sm font-bold text-navy">💳 Online Payment (Razorpay)</p>
                  <p className="text-xs text-slate-600 mt-1">Only online payment available for this product</p>
                </div>
              ) : supportsCodOnly ? (
                <div className="p-3 bg-green-50 rounded-xl border border-green-200">
                  <p className="text-sm font-bold text-navy">🚚 Cash on Delivery</p>
                  <p className="text-xs text-slate-600 mt-1">Only cash on delivery available for this product</p>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <button
                type="submit"
                disabled={isVirtualLoginLocked || submitting || uploading || paymentProcessing}
                aria-disabled={isVirtualLoginLocked || submitting || uploading || paymentProcessing}
                data-testid={isVirtualLoginLocked ? 'virtual-checkout-pay-locked-btn' : 'checkout-pay-btn'}
                className={`w-full btn-primary py-2.5 sm:py-3 text-sm sm:text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed ${
                  isVirtualLoginLocked ? 'opacity-60' : ''
                }`}
              >
                {isVirtualLoginLocked ? (
                  <span className="flex items-center justify-center gap-2">
                    <IconRenderer name="lock" className="w-4 h-4 shrink-0" />
                    <span>{authLoading ? 'Checking Login...' : 'Login Required to Pay'}</span>
                  </span>
                ) : uploading
                  ? 'Uploading Image...'
                  : submitting
                    ? 'Processing Order...'
                    : paymentMethod === 'cod'
                      ? '🚚 Place COD Order'
                      : '💳 Pay Now'}
              </button>

              {isVirtualLoginLocked && !authLoading && (
                <p className="text-center text-[11px] sm:text-xs text-slate-500">
                  Please{' '}
                  <button
                    type="button"
                    onClick={handleRedirectToLogin}
                    className="text-primary font-bold underline hover:text-primary-dark"
                  >
                    login to your account
                  </button>{' '}
                  to unlock payment &amp; instant digital download. Your details remain saved.
                </p>
              )}
            </div>

            <p className="text-[11px] text-slate-500 text-center leading-normal">
              By placing this order, you agree to our{' '}
              <Link to="/legal/terms" target="_blank" className="text-primary underline">Terms</Link>,{' '}
              <Link to="/legal/privacy" target="_blank" className="text-primary underline">Privacy Policy</Link>, and{' '}
              <Link to="/legal/refund" target="_blank" className="text-primary underline">Refund & Cancellation Policy</Link>.
            </p>

            <div className="space-y-2 pt-3 border-t border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <IconRenderer name="shield-check" className="w-4 h-4 text-primary shrink-0" />
                <span>PCI-DSS Compliant 256-bit Secure Payment</span>
              </div>
              <div className="pt-2 text-[10px] text-slate-400 border-t border-slate-100">
                <p className="font-semibold text-slate-500">Seller / Service Provider:</p>
                <p>India Cyber Cafe, Village Jobgarh, Bargawan, Singrauli, MP - 486886</p>
                <p>Grievance Officer: icc@indiacybercafe.com</p>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
