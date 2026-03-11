import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, rtdb } from '../firebase';
import { IconRenderer } from '../components/Icons';
import { Product, UserProfile, Order, OrderAddress } from '../types';
import { SEO } from '../components/SEO';
import { showToast } from '../components/Toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { update, ref as dbRef } from 'firebase/database';
import { generateOrderId } from '../utils/orderIdGenerator';
import { getRazorpayKeyId, verifyRazorpayPayment } from '../services/razorpayService';
import { generateRandomPassword, findUserByEmail, findUserByPhone, createGuestAccount as createGuestAccountInDB } from '../services/guestCheckoutService';
import { sendWelcomeEmail, sendOrderConfirmationEmail, sendAdminOrderNotification } from '../services/emailService';

interface StoreCheckoutProps {
  products: Product[];
  user: UserProfile | null;
  onAddOrder: (order: Omit<Order, 'id'>) => Promise<void>;
}

export function StoreCheckout({ products, user, onAddOrder }: StoreCheckoutProps) {
  const { productId, categoryId } = useParams<{ productId: string; categoryId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const quantity = location.state?.quantity || 1;

  const product = products.find(p => p.id === productId);

  const [customImageFile, setCustomImageFile] = useState<File | null>(null);
  const [customImageUrl, setCustomImageUrl] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cod'>('online');

  // Address Form - Initialize with user address if available, otherwise empty
  const [address, setAddress] = useState<OrderAddress>(
    user?.address ? { ...user.address } : {
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      pincode: '',
      country: 'India'
    }
  );

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  
  // Guest checkout states
  const [createGuestAccount, setCreateGuestAccount] = useState(false);
  const [existingUserFound, setExistingUserFound] = useState(false);
  const [existingUserData, setExistingUserData] = useState<any>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Update address when user changes (auto-fill from profile)
  useEffect(() => {
    if (user && user.address) {
      setAddress({ ...user.address });
    }
  }, [user?.uid]);

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

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        showToast('File size must be less than 5MB', 'error');
        return;
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error');
        return;
      }

      setCustomImageFile(file);

      // Show preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Check if user exists by email and request password verification
  const handleEmailBlur = async () => {
    if (!address.email || !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email))) {
      // Don't reset if password verification is already in progress
      if (!requiresPassword || !passwordInput) {
        setExistingUserFound(false);
        setRequiresPassword(false);
        setPasswordVerified(false);
      }
      return;
    }

    try {
      console.log('🔍 Checking for existing user with email:', address.email);
      const existingUser = await findUserByEmail(address.email);
      console.log('📊 Found user:', existingUser);
      
      if (existingUser) {
        // Account exists in database
        console.log('✅ Account found with email:', address.email);
        setExistingUserFound(true);
        setExistingUserData(existingUser);
        setRequiresPassword(true);
        setPasswordVerified(false);
        setPasswordInput('');
        showToast('✅ Account found! Please verify with your password.', 'info');
      } else {
        // No account found
        console.log('❌ No account found with email:', address.email);
        setExistingUserFound(false);
        setRequiresPassword(false);
        setPasswordVerified(false);
      }
    } catch (error) {
      console.error('❌ Error checking user by email:', error);
    }
  };

  // Verify password and auto-fill data
  const handlePasswordVerify = async () => {
    if (!passwordInput.trim()) {
      showToast('Please enter password', 'error');
      return;
    }

    setVerifyingPassword(true);
    try {
      // Try to authenticate with the provided credentials
      await signInWithEmailAndPassword(auth, address.email, passwordInput);
      setPasswordVerified(true);
      setPasswordInput('');

      // Auto-fill address from existing user data
      if (existingUserData?.address) {
        setAddress(prev => ({
          ...prev,
          name: existingUserData.address.name || prev.name,
          phone: existingUserData.address.phone || prev.phone,
          addressLine1: existingUserData.address.addressLine1 || prev.addressLine1,
          addressLine2: existingUserData.address.addressLine2 || prev.addressLine2,
          city: existingUserData.address.city || prev.city,
          state: existingUserData.address.state || prev.state,
          pincode: existingUserData.address.pincode || prev.pincode
        }));
        showToast('✅ Password verified! Your saved address has been auto-filled.', 'success');
      } else {
        // If no address in profile, fill basic info (name, phone)
        setAddress(prev => ({
          ...prev,
          name: existingUserData.name || prev.name,
          phone: existingUserData.phone || prev.phone
        }));
        showToast('✅ Password verified! Your basic info has been auto-filled.', 'success');
      }

      // Keep user logged in for checkout - don't sign out
      setExistingUserFound(false);
      setRequiresPassword(false);
    } catch (error: any) {
      console.error('Password verification error:', error);
      if (error.code === 'auth/wrong-password') {
        showToast('❌ Incorrect password. Please try again.', 'error');
      } else if (error.code === 'auth/user-not-found') {
        showToast('❌ User account not found. Please check your email.', 'error');
      } else {
        showToast('❌ Verification failed. Please try again.', 'error');
      }
      setPasswordInput('');
    } finally {
      setVerifyingPassword(false);
    }
  };

  // Check if user exists by phone and request password verification
  const handlePhoneBlur = async () => {
    if (!address.phone || !/^[0-9]{10}$/.test(address.phone.replace(/\D/g, ''))) {
      // If phone is invalid and no user found, reset states
      if (!existingUserFound) {
        setRequiresPassword(false);
      }
      return;
    }

    try {
      console.log('🔍 Checking for existing user with phone:', address.phone);
      const existingUser = await findUserByPhone(address.phone);
      console.log('📊 Found user:', existingUser);
      
      if (existingUser) {
        // User account exists by phone
        console.log('✅ Account found with phone:', address.phone);
        // Update email if found and email is empty
        if (!address.email && existingUser.email) {
          console.log('📧 Auto-filling email:', existingUser.email);
          setAddress(prev => ({
            ...prev,
            email: existingUser.email
          }));
        }
        setExistingUserFound(true);
        setExistingUserData(existingUser);
        setRequiresPassword(true);
        setPasswordVerified(false);
        setPasswordInput('');
        showToast('✅ Account found! Please verify your password to auto-fill your saved details.', 'info');
      } else {
        // No user found by phone
        console.log('❌ No account found with phone:', address.phone);
        if (!requiresPassword) {
          setExistingUserFound(false);
          setRequiresPassword(false);
          setPasswordVerified(false);
        }
      }
    } catch (error) {
      console.error('❌ Error checking user by phone:', error);
    }
  };

  const uploadCustomImage = async () => {
    if (!customImageFile) return null;

    try {
      setUploading(true);
      const fileName = `custom-images/${Date.now()}-${customImageFile.name}`;
      const fileRef = ref(storage, fileName);
      await uploadBytes(fileRef, customImageFile);
      const downloadUrl = await getDownloadURL(fileRef);
      return downloadUrl;
    } catch (error) {
      console.error('Image upload error:', error);
      showToast('Failed to upload image', 'error');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!address.name.trim()) errors.name = 'Name is required';
    if (!address.email.trim()) errors.email = 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) errors.email = 'Valid email is required';
    if (!address.phone.trim()) errors.phone = 'Phone is required';
    if (!/^[0-9]{10}$/.test(address.phone.replace(/\D/g, ''))) errors.phone = 'Valid 10-digit phone is required';
    if (!address.addressLine1.trim()) errors.addressLine1 = 'Address is required';
    if (!address.city.trim()) errors.city = 'City is required';
    if (!address.state.trim()) errors.state = 'State is required';
    if (!address.pincode.trim()) errors.pincode = 'Pincode is required';
    if (!/^[0-9]{6}$/.test(address.pincode)) errors.pincode = 'Valid 6-digit pincode is required';

    if (product.requiresCustomImage && !customImageFile && !customImageUrl) {
      errors.customImage = 'Custom image is required for this product';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      showToast('Please fix the errors', 'error');
      return;
    }

    // For guest checkout (non-authenticated users), show warning if not creating account
    // AND if an existing account was NOT found
    if (!user || !user.uid) {
      if (!createGuestAccount && !existingUserFound) {
        showToast('⚠️ Without an account, you won\'t be able to track your order. We recommend creating one.', 'warning');
      }
    }

    try {
      setSubmitting(true);

      // Upload custom image if provided
      let uploadedImageUrl = customImageUrl;
      if (customImageFile && !customImageUrl) {
        uploadedImageUrl = await uploadCustomImage();
        if (!uploadedImageUrl && product.requiresCustomImage) {
          showToast('Failed to upload image', 'error');
          setSubmitting(false);
          return;
        }
      }

      // Calculate totals
      const itemPrice = product.discountedPrice || product.price;
      const subtotal = itemPrice * quantity;
      const deliveryCharges = product.deliveryCharges || 0;
      const total = subtotal + deliveryCharges;

      // Create order with generated ID
      const orderId = generateOrderId();
      
      // Use either authenticated user or guest user
      const userId = user?.uid || `guest-${address.email}-${Date.now()}`;
      
      const newOrder: Order = {
        id: orderId,
        uid: userId,
        email: address.email,
        items: [
          {
            productId: product.id,
            productName: product.name,
            price: product.price,
            discountedPrice: product.discountedPrice,
            quantity,
            customImageUrl: uploadedImageUrl,
            specialInstructions
          }
        ],
        deliveryAddress: address,
        subtotal,
        deliveryCharges,
        total,
        paymentMethod: paymentMethod === 'cod' ? 'cash' : 'razorpay',
        paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending',
        orderStatus: paymentMethod === 'cod' ? 'pending' : 'pending',
        notes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Handle different payment methods
      if (paymentMethod === 'cod') {
        // For COD, save order directly
        await onAddOrder(newOrder);
        
        // Auto-save address to user profile if user is logged in and doesn't have address yet
        if (user && user.uid && !user.address) {
          try {
            await update(dbRef(rtdb, `users/${user.uid}`), { address });
          } catch (error) {
            console.error('Error saving address to profile:', error);
          }
        }
        
        // Send order confirmation email to customer
        await sendOrderConfirmationEmail(
          address.email,
          address.name,
          orderId,
          newOrder.items.map(item => ({
            name: item.productName,
            quantity: item.quantity,
            price: item.discountedPrice || item.price
          })),
          total,
          'cod'
        ).catch(err => console.error('Email send error:', err));

        // Send admin notification about new order
        await sendAdminOrderNotification(
          orderId,
          address.name,
          address.email,
          address.phone,
          newOrder.items.map(item => ({
            name: item.productName,
            quantity: item.quantity,
            price: item.discountedPrice || item.price
          })),
          total,
          'cod',
          {
            addressLine1: address.addressLine1,
            city: address.city,
            state: address.state,
            pincode: address.pincode
          }
        ).catch(err => console.error('Admin email send error:', err));

        // If guest checkout with account creation, create account after order
        if (!user || !user.uid) {
          if (createGuestAccount) {
            try {
              const result = await createGuestAccountInDB(address.email, address.name, address.phone);
              
              if (result.success && result.password) {
                // Send welcome email with the generated password
                await sendWelcomeEmail(address.email, address.name, result.password)
                  .catch(err => console.error('Welcome email error:', err));
                
                // Auto-login with the generated password
                try {
                  await signInWithEmailAndPassword(auth, address.email, result.password);
                  showToast('✅ Order placed! Account created and logged in.', 'success');
                } catch (loginError) {
                  console.error('Auto-login error:', loginError);
                  showToast('✅ Order placed! Account created. Please log in.', 'info');
                }
              } else {
                throw new Error(result.error || 'Failed to create account');
              }
            } catch (error) {
              // If account creation fails, still allow order to proceed
              console.error('Account creation error:', error);
              showToast('✅ Order placed! (Account creation failed, but order was saved)', 'info');
            }
          } else {
            showToast('✅ Order placed! (Log in to track your order)', 'info');
          }
        } else {
          showToast('Order placed with Cash on Delivery!', 'success');
        }

        // Reset form state after successful submission
        setExistingUserFound(false);
        setRequiresPassword(false);
        setPasswordVerified(false);
        setPasswordInput('');
        setExistingUserData(null);
        setShowPassword(false);
        setAddress({
          name: user?.name || '',
          email: user?.email || '',
          phone: user?.phone || '',
          addressLine1: '',
          addressLine2: '',
          city: '',
          state: '',
          pincode: '',
          country: 'India'
        });
        setCreateGuestAccount(false);
        setCustomImageFile(null);
        setCustomImageUrl('');
        setImagePreview('');
        setSpecialInstructions('');
        
        navigate('/store/order-confirmation', {
          state: { order: newOrder, productName: product.name }
        });
      } else {
        // For Online, initiate Razorpay payment
        try {
          const totalInPaisa = Math.round(total * 100);
          
          // First, create order on backend to get valid order ID
          console.log('📋 Creating order on backend... Amount:', totalInPaisa, 'Paisa');
          const orderResponse = await fetch('/api/create-razorpay-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: totalInPaisa,
              currency: 'INR',
              receipt: orderId,
              notes: {
                productId: product.id,
                productName: product.name
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
            setSubmitting(false);
            return;
          }
          
          const options = {
            key: getRazorpayKeyId(),
            amount: totalInPaisa,
            currency: 'INR',
            order_id: razorpayOrderId,
            name: 'India Cyber Cafe',
            description: `Order ${orderId} - ${product.name}`,
            prefill: {
              name: address.name,
              email: address.email,
              contact: address.phone
            },
            handler: async (response: any) => {
              try {
                console.log('💳 Payment handler - received response:', response);
                
                // Verify payment with backend using Razorpay signature
                const verificationResult = await verifyRazorpayPayment(
                  response.razorpay_payment_id,
                  response.razorpay_order_id,
                  response.razorpay_signature
                );

                if (!verificationResult.verified) {
                  throw new Error(verificationResult.error || 'Payment verification failed');
                }

                console.log('✅ Payment verified - saving order');

                // Payment verified, save order
                const updatedOrder: Order = {
                  ...newOrder,
                  paymentStatus: 'completed',
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id
                };
                
                await onAddOrder(updatedOrder);

                // Auto-save address to user profile if user is logged in and doesn't have address yet
                if (user && user.uid && !user.address) {
                  try {
                    await update(dbRef(rtdb, `users/${user.uid}`), { address });
                  } catch (error) {
                    console.error('Error saving address to profile:', error);
                  }
                }

                // Send order confirmation email to customer
                await sendOrderConfirmationEmail(
                  address.email,
                  address.name,
                  orderId,
                  updatedOrder.items.map(item => ({
                    name: item.productName,
                    quantity: item.quantity,
                    price: item.discountedPrice || item.price
                  })),
                  total,
                  'online'
                ).catch(err => console.error('Email send error:', err));

                // Send admin notification about new order
                await sendAdminOrderNotification(
                  orderId,
                  address.name,
                  address.email,
                  address.phone,
                  updatedOrder.items.map(item => ({
                    name: item.productName,
                    quantity: item.quantity,
                    price: item.discountedPrice || item.price
                  })),
                  total,
                  'online',
                  {
                    addressLine1: address.addressLine1,
                    city: address.city,
                    state: address.state,
                    pincode: address.pincode
                  }
                ).catch(err => console.error('Admin email send error:', err));

                // If guest checkout with account creation, create account after successful payment
                if (!user || !user.uid) {
                  if (createGuestAccount) {
                    try {
                      const result = await createGuestAccountInDB(address.email, address.name, address.phone);
                      
                      if (result.success && result.password) {
                        // Send welcome email with the generated password
                        await sendWelcomeEmail(address.email, address.name, result.password)
                          .catch(err => console.error('Welcome email error:', err));
                        
                        // Auto-login with the generated password
                        try {
                          await signInWithEmailAndPassword(auth, address.email, result.password);
                          showToast('✅ Payment successful! Account created and logged in.', 'success');
                        } catch (loginError) {
                          console.error('Auto-login error:', loginError);
                          showToast('✅ Payment successful! Account created. Please log in.', 'info');
                        }
                      } else {
                        throw new Error(result.error || 'Failed to create account');
                      }
                    } catch (error) {
                      // If account creation fails, still allow order to proceed
                      console.error('Account creation error:', error);
                      showToast('✅ Payment successful! (Account creation failed, but order was saved)', 'info');
                    }
                  } else {
                    showToast('✅ Payment successful! (Log in to track your order)', 'info');
                  }
                } else {
                  showToast('Payment successful! Order placed.', 'success');
                }

                navigate('/store/order-confirmation', {
                  state: { order: updatedOrder, productName: product.name }
                });
              } catch (error: any) {
                console.error('❌ Payment verification error:', error);
                showToast(`❌ Payment verification failed: ${error.message}`, 'error');
                setSubmitting(false);
              }
            },
            modal: {
              ondismiss: () => {
                console.log('⚠️ Payment modal closed by user');
                setSubmitting(false);
                showToast('💳 Payment cancelled. You can try again whenever you\'re ready.', 'error');
              }
            },
            theme: { color: '#001A57' }
          };

          console.log('🚀 Opening Razorpay checkout...');
          const rzp = new (window as any).Razorpay(options);
          rzp.open();
        } catch (error: any) {
          console.error('❌ Razorpay payment error:', error);
          showToast('❌ Failed to initiate payment: ' + (error.message || 'Please check your connection and try again'), 'error');
          setSubmitting(false);
        }
      }
    } catch (error) {
      console.error('Order submission error:', error);
      const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
      showToast(`Failed to place order: ${errorMsg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const subtotal = (product.discountedPrice || product.price) * quantity;
  const deliveryCharges = product.deliveryCharges || 0;
  const total = subtotal + deliveryCharges;

  return (
    <div className="space-y-6 sm:space-y-10">
      <SEO
        title={`Checkout - ${product.name} - India Cyber Cafe`}
        description="Complete your purchase with secure payment"
      />

      {/* Header */}
      <div>
        <button
          onClick={() => navigate(`/store/${categoryId}/${productId}`)}
          className="flex items-center gap-2 text-primary font-semibold hover:gap-3 transition-all mb-4"
        >
          <IconRenderer name="arrow-left" className="w-4 h-4" />
          Back
        </button>
        <h1 className="text-3xl sm:text-4xl font-bold text-navy">Checkout</h1>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Main Form - 2 columns wide */}
        <div className="lg:col-span-2 space-y-6">
          {/* Custom Image Upload */}
          {product.requiresCustomImage && (
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
                  <div className="aspect-square rounded-lg overflow-hidden bg-slate-100 border-2 border-primary">
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomImageFile(null);
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
                    <p className="text-xs sm:text-sm text-slate-500">Max 5MB • JPG, PNG</p>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                </label>
              )}

              {formErrors.customImage && (
                <p className="text-red-600 text-xs sm:text-sm font-semibold">{formErrors.customImage}</p>
              )}

              {/* Special Instructions */}
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

          {/* Delivery Address */}
          <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
            <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
              <IconRenderer name="map-pin" className="w-5 h-5 text-primary" />
              Delivery Address
            </h2>

            {/* Display if account found/verified */}
            {existingUserFound && passwordVerified && (
              <div className="bg-green-50 border-2 border-green-400 rounded-lg p-3 flex items-center gap-2 mb-4">
                <span className="text-lg">✅</span>
                <div>
                  <p className="font-semibold text-green-900 text-sm">Account Verified!</p>
                  <p className="text-xs text-green-800">Your details have been auto-filled from your saved profile.</p>
                </div>
              </div>
            )}

            {/* Password Verification - Show when existing account found, placed ABOVE the grid */}
            {requiresPassword && !passwordVerified && (
              <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-300 rounded-lg p-4 space-y-3 mb-4">
                <div className="flex items-start gap-2">
                  <span className="text-xl">🔐</span>
                  <div>
                    <p className="font-bold text-slate-900 text-base">Welcome Back! 👋</p>
                    <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">We found your existing account registered with this email. Enter your password to verify and auto-fill your saved address details.</p>
                  </div>
                </div>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                    onKeyPress={e => e.key === 'Enter' && handlePasswordVerify()}
                    disabled={verifyingPassword}
                    className="input-field w-full text-xs sm:text-sm pr-10"
                    placeholder="Enter your password"
                    autoFocus
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
                    className="flex-1 bg-primary hover:bg-primary-dark text-white font-semibold py-2 px-3 rounded-lg text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {verifyingPassword ? '⏳ Verifying...' : '✓ Verify Password'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRequiresPassword(false);
                      setPasswordInput('');
                      setPasswordVerified(false);
                      setExistingUserData(null);
                    }}
                    className="flex-1 bg-slate-300 hover:bg-slate-400 text-slate-700 font-semibold py-2 px-3 rounded-lg text-xs sm:text-sm transition-colors"
                  >
                    ✗ Skip
                  </button>
                </div>

                <div className="flex gap-2 justify-between items-center pt-1">
                  <a 
                    href="/forgot-password"
                    className="text-primary hover:text-primary-dark text-xs font-semibold underline transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate('/forgot-password');
                    }}
                  >
                    🔑 Forgot Password?
                  </a>
                  <span className="text-xs text-slate-500">Or skip to checkout as guest</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Name */}
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

              {/* Email */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={address.email}
                  onChange={e => setAddress({ ...address, email: e.target.value })}
                  onBlur={handleEmailBlur}
                  className={`input-field w-full text-xs sm:text-sm ${formErrors.email ? 'border-red-500' : ''}`}
                  placeholder="john@example.com"
                />
                {formErrors.email && <p className="text-red-600 text-xs mt-1">{formErrors.email}</p>}
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Phone *</label>
                <input
                  type="tel"
                  value={address.phone}
                  onChange={e => setAddress({ ...address, phone: e.target.value })}
                  onBlur={handlePhoneBlur}
                  className={`input-field w-full text-xs sm:text-sm ${formErrors.phone ? 'border-red-500' : ''}`}
                  placeholder="9876543210"
                />
                {formErrors.phone && <p className="text-red-600 text-xs mt-1">{formErrors.phone}</p>}
              </div>

              {/* State */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">State *</label>
                <input
                  type="text"
                  value={address.state}
                  onChange={e => setAddress({ ...address, state: e.target.value })}
                  className={`input-field w-full text-xs sm:text-sm ${formErrors.state ? 'border-red-500' : ''}`}
                  placeholder="Maharashtra"
                />
                {formErrors.state && <p className="text-red-600 text-xs mt-1">{formErrors.state}</p>}
              </div>

              {/* City */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">City *</label>
                <input
                  type="text"
                  value={address.city}
                  onChange={e => setAddress({ ...address, city: e.target.value })}
                  className={`input-field w-full text-xs sm:text-sm ${formErrors.city ? 'border-red-500' : ''}`}
                  placeholder="Mumbai"
                />
                {formErrors.city && <p className="text-red-600 text-xs mt-1">{formErrors.city}</p>}
              </div>

              {/* Pincode */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Pincode *</label>
                <input
                  type="text"
                  value={address.pincode}
                  onChange={e => setAddress({ ...address, pincode: e.target.value })}
                  className={`input-field w-full text-xs sm:text-sm ${formErrors.pincode ? 'border-red-500' : ''}`}
                  placeholder="400001"
                />
                {formErrors.pincode && <p className="text-red-600 text-xs mt-1">{formErrors.pincode}</p>}
              </div>
            </div>

            {/* Address Line 1 */}
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Address *</label>
              <input
                type="text"
                value={address.addressLine1}
                onChange={e => setAddress({ ...address, addressLine1: e.target.value })}
                className={`input-field w-full text-xs sm:text-sm ${formErrors.addressLine1 ? 'border-red-500' : ''}`}
                placeholder="123 Main Street"
              />
              {formErrors.addressLine1 && <p className="text-red-600 text-xs mt-1">{formErrors.addressLine1}</p>}
            </div>

            {/* Address Line 2 */}
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1">Address Line 2 (Optional)</label>
              <input
                type="text"
                value={address.addressLine2 || ''}
                onChange={e => setAddress({ ...address, addressLine2: e.target.value })}
                className="input-field w-full text-xs sm:text-sm"
                placeholder="Apartment, suite, etc."
              />
            </div>
          </div>

          {/* Guest Checkout - Account Creation Option */}
          {(!user || !user.uid) && !existingUserFound && (
            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
              <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                <IconRenderer name="user-plus" className="w-5 h-5 text-primary" />
                Create Account for Faster Checkout
              </h2>

              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer p-3 bg-white rounded-lg border-2 border-slate-200 hover:border-navy transition-all">
                  <input
                    type="checkbox"
                    checked={createGuestAccount}
                    onChange={e => setCreateGuestAccount(e.target.checked)}
                    className="w-5 h-5 accent-navy cursor-pointer mt-0.5 flex-shrink-0"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-navy">Create an account with us</p>
                    <p className="text-xs text-slate-600 mt-1">
                      We'll send you a temporary password. You can log in and change it anytime.
                    </p>
                  </div>
                </label>

                {!createGuestAccount && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4">
                    <p className="text-xs sm:text-sm font-semibold text-yellow-900 mb-2">⚠️ Without an Account:</p>
                    <ul className="text-xs sm:text-sm text-yellow-800 space-y-1 list-disc list-inside">
                      <li>You won't be able to track your order</li>
                      <li>You won't have access to order history</li>
                      <li>You'll need to register if you order again</li>
                    </ul>
                  </div>
                )}

                {createGuestAccount && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 sm:p-4">
                    <p className="text-xs sm:text-sm font-semibold text-green-900">✅ Benefits of Creating Account:</p>
                    <ul className="text-xs sm:text-sm text-green-800 space-y-1 list-disc list-inside mt-2">
                      <li>Track all your orders in real-time</li>
                      <li>Faster checkout next time</li>
                      <li>Access to order history and receipts</li>
                      <li>Get exclusive offers and updates</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* If user was found, show message */}
          {(!user || !user.uid) && existingUserFound && (
            <div className="bg-green-50 border border-green-200 rounded-xl sm:rounded-2xl p-4 sm:p-6">
              <p className="text-sm sm:text-base font-bold text-green-900 flex items-center gap-2">
                <IconRenderer name="check-circle" className="w-5 h-5" />
                Account Found! Your details are already in our system.
              </p>
              <p className="text-xs sm:text-sm text-green-800 mt-2">
                Proceed with checkout. You'll receive an order confirmation email.
              </p>
            </div>
          )}
        </div>

        {/* Order Summary Sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
            <h3 className="text-lg font-bold text-navy">Order Summary</h3>

            {/* Product Info */}
            <div className="border-b border-slate-200 pb-4">
              <div className="flex gap-3 mb-3">
                <img
                  src={product.images[0]}
                  alt={product.name}
                  className="w-16 h-16 object-cover rounded-lg"
                />
                <div className="flex-1">
                  <p className="text-xs sm:text-sm font-semibold text-navy line-clamp-2">{product.name}</p>
                  <p className="text-xs text-slate-500 mt-1">Qty: {quantity}</p>
                </div>
              </div>
            </div>

            {/* Price Breakdown */}
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

            {/* Payment Methods Selection */}
            <div className="space-y-3 pt-4 border-t border-slate-200">
              <h4 className="font-bold text-navy text-sm">Payment Method</h4>
              
              {(!product.paymentMethods || product.paymentMethods.includes('both') || (product.paymentMethods.includes('online') && product.paymentMethods.includes('cod'))) ? (
                <>
                  {/* Both methods available */}
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
              ) : product.paymentMethods?.includes('online') ? (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-sm font-bold text-navy">💳 Online Payment (Razorpay)</p>
                  <p className="text-xs text-slate-600 mt-1">Only online payment available for this product</p>
                </div>
              ) : product.paymentMethods?.includes('cod') ? (
                <div className="p-3 bg-green-50 rounded-xl border border-green-200">
                  <p className="text-sm font-bold text-navy">🚚 Cash on Delivery</p>
                  <p className="text-xs text-slate-600 mt-1">Only cash on delivery available for this product</p>
                </div>
              ) : null}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting || uploading}
              className="w-full btn-primary py-2.5 sm:py-3 text-sm sm:text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : submitting ? 'Processing...' : paymentMethod === 'cod' ? '🚚 Place COD Order' : '💳 Pay Now'}
            </button>

            {/* Trust Badges */}
            <div className="space-y-2 pt-4 border-t border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <IconRenderer name="shield-check" className="w-4 h-4 text-primary" />
                <span>Secure Payment</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <IconRenderer name="zap" className="w-4 h-4 text-primary" />
                <span>Fast Delivery</span>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
