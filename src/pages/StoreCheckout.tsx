import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { Product, UserProfile, Order, OrderAddress } from '../types';
import { SEO } from '../components/SEO';
import { showToast } from '../components/Toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { generateOrderId } from '../utils/orderIdGenerator';

interface StoreCheckoutProps {
  products: Product[];
  user: UserProfile | null;
  onAddOrder: (order: Omit<Order, 'id'>) => Promise<void>;
}

export function StoreCheckout({ products, user, onAddOrder }: StoreCheckoutProps) {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const quantity = location.state?.quantity || 1;

  const product = products.find(p => p.id === productId);

  const [customImageFile, setCustomImageFile] = useState<File | null>(null);
  const [customImageUrl, setCustomImageUrl] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [specialInstructions, setSpecialInstructions] = useState('');

  // Address Form
  const [address, setAddress] = useState<OrderAddress>({
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

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

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

    // Check if user is authenticated
    if (!user || !user.uid) {
      showToast('Please log in to place an order', 'error');
      navigate('/login', { state: { from: '/store' } });
      return;
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
      const newOrder: Omit<Order, 'id'> = {
        id: orderId,
        uid: user?.uid,
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
        paymentMethod: 'razorpay',
        paymentStatus: 'pending',
        orderStatus: 'pending',
        notes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await onAddOrder(newOrder);
      showToast('Order placed successfully!', 'success');

      // Redirect to confirmation
      navigate('/store/order-confirmation', {
        state: { order: newOrder, productName: product.name }
      });
    } catch (error) {
      console.error('Order submission error:', error);
      showToast('Failed to place order', 'error');
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
          onClick={() => navigate(`/store/${productId}`)}
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

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting || uploading}
              className="w-full btn-primary py-2.5 sm:py-3 text-sm sm:text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : submitting ? 'Processing...' : 'Proceed to Payment'}
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
