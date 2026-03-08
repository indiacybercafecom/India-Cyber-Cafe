import { useState } from 'react';
import { Product, ProductCategory } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

interface ProductModalProps {
  product?: Product;
  categories: ProductCategory[];
  onClose: () => void;
  onSave: (product: Product) => Promise<void>;
}

export function ProductModal({ product, categories, onClose, onSave }: ProductModalProps) {
  const [formData, setFormData] = useState<Product>(
    product || {
      id: '',
      name: '',
      shortDescription: '',
      longDescription: '',
      price: 0,
      discountedPrice: 0,
      category: '',
      images: [],
      customImageInstructions: '',
      requiresCustomImage: false,
      turnaroundTime: '3-5 days',
      deliveryCharges: 0,
      inStock: true,
      ratings: { average: 5, count: 0, breakdown: {} },
      seoTitle: '',
      seoDescription: '',
      seoKeywords: ''
    }
  );

  const [uploadingImages, setUploadingImages] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setUploadingImages(true);
    try {
      const storage = getStorage();
      const uploadedUrls: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
          showToast('Please select valid image files', 'error');
          continue;
        }

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
          showToast(`Image ${file.name} is too large (max 5MB)`, 'error');
          continue;
        }

        const timestamp = Date.now();
        const storageRef = ref(storage, `products/${timestamp}-${file.name}`);
        
        const snapshot = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snapshot.ref);
        uploadedUrls.push(url);
      }

      setFormData(prev => ({
        ...prev,
        images: [...(prev.images || []), ...uploadedUrls]
      }));
      showToast(`${uploadedUrls.length} images uploaded successfully!`, 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to upload images', 'error');
    } finally {
      setUploadingImages(false);
      e.target.value = '';
    }
  };

  const removeImage = (index: number) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images?.filter((_, i) => i !== index) || []
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      showToast('Product name is required', 'error');
      return;
    }

    if (formData.price <= 0) {
      showToast('Price must be greater than 0', 'error');
      return;
    }

    if (formData.discountedPrice < 0) {
      showToast('Discounted price cannot be negative', 'error');
      return;
    }

    if (formData.category.trim() === '') {
      showToast('Please select a category', 'error');
      return;
    }

    if (!formData.images || formData.images.length === 0) {
      showToast('Please upload at least one product image', 'error');
      return;
    }

    setLoading(true);
    try {
      if (!formData.id) {
        formData.id = `product-${Date.now()}`;
      }
      await onSave(formData);
      showToast(product ? 'Product updated successfully!' : 'Product added successfully!', 'success');
      onClose();
    } catch (error: any) {
      showToast(error.message || 'Failed to save product', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        <div className="sticky top-0 bg-gradient-to-r from-navy to-blue-700 text-white px-4 sm:px-6 py-4 sm:py-6 flex justify-between items-center z-10 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold pr-2">{product ? 'Edit Product' : 'Add New Product'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-all flex-shrink-0">
            <IconRenderer name="x" className="w-5 sm:w-6 h-5 sm:h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Product Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="e.g., Custom T-Shirt Design"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Category *</label>
              <select
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
              >
                <option value="">Select a category</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.name}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Short Description *</label>
              <textarea
                value={formData.shortDescription}
                onChange={e => setFormData({ ...formData, shortDescription: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none"
                rows={2}
                placeholder="Brief product description (appears in listings)"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Long Description</label>
              <textarea
                value={formData.longDescription}
                onChange={e => setFormData({ ...formData, longDescription: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none"
                rows={3}
                placeholder="Detailed product description (appears on product page)"
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="space-y-4 p-4 bg-slate-50 rounded-2xl">
            <h3 className="font-bold text-navy text-lg">Pricing & Stock</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Base Price (₹) *</label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                  placeholder="0"
                  min="0"
                  step="0.01"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Discounted Price (₹)</label>
                <input
                  type="number"
                  value={formData.discountedPrice}
                  onChange={e => setFormData({ ...formData, discountedPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                  placeholder="0"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Delivery Charges (₹)</label>
                <input
                  type="number"
                  value={formData.deliveryCharges}
                  onChange={e => setFormData({ ...formData, deliveryCharges: parseFloat(e.target.value) || 0 })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                  placeholder="0"
                  min="0"
                  step="0.01"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Stock Status</label>
                <select
                  value={formData.inStock ? 'in' : 'out'}
                  onChange={e => setFormData({ ...formData, inStock: e.target.value === 'in' })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                >
                  <option value="in">In Stock</option>
                  <option value="out">Out of Stock</option>
                </select>
              </div>
            </div>
          </div>

          {/* Turnaround */}
          <div className="space-y-4">
            <h3 className="font-bold text-navy text-lg">Delivery</h3>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Turnaround Time</label>
              <input
                type="text"
                value={formData.turnaroundTime}
                onChange={e => setFormData({ ...formData, turnaroundTime: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="e.g., 3-5 days"
              />
            </div>
          </div>

          {/* Custom Image */}
          <div className="space-y-4 p-4 bg-orange-50 rounded-2xl border-2 border-orange-200">
            <div className="flex items-center gap-4">
              <input
                type="checkbox"
                checked={formData.requiresCustomImage}
                onChange={e => setFormData({ ...formData, requiresCustomImage: e.target.checked })}
                className="w-5 h-5 rounded border-slate-300"
              />
              <label className="font-bold text-slate-700">Requires Custom Image Upload from Customer</label>
            </div>

            {formData.requiresCustomImage && (
              <textarea
                value={formData.customImageInstructions}
                onChange={e => setFormData({ ...formData, customImageInstructions: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none"
                rows={2}
                placeholder="Instructions for customer on what image to upload..."
              />
            )}
          </div>

          {/* Product Images */}
          <div className="space-y-4">
            <h3 className="font-bold text-navy text-lg">Product Images *</h3>
            
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-navy transition-colors">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                disabled={uploadingImages}
                className="hidden"
                id="product-images"
              />
              <label htmlFor="product-images" className={`cursor-pointer block ${uploadingImages ? 'opacity-50' : ''}`}>
                <div className="flex justify-center mb-2">
                  <IconRenderer name="image" className="w-8 h-8 text-slate-400" />
                </div>
                <p className="font-bold text-navy">{uploadingImages ? 'Uploading...' : 'Click to upload images'}</p>
                <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 5MB each</p>
              </label>
            </div>

            {formData.images && formData.images.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {formData.images.map((img, idx) => (
                  <div key={idx} className="relative group">
                    <img src={img} alt={`Product ${idx}`} className="w-full h-24 object-cover rounded-lg" />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <IconRenderer name="x" className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SEO */}
          <div className="space-y-4 p-4 bg-slate-50 rounded-2xl">
            <h3 className="font-bold text-navy text-lg">SEO</h3>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">SEO Title</label>
              <input
                type="text"
                value={formData.seoTitle}
                onChange={e => setFormData({ ...formData, seoTitle: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="Page title for search engines"
                maxLength={60}
              />
              <p className="text-xs text-slate-400 mt-1">{formData.seoTitle.length}/60</p>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">SEO Description</label>
              <textarea
                value={formData.seoDescription}
                onChange={e => setFormData({ ...formData, seoDescription: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none"
                rows={2}
                placeholder="Page description for search engines"
                maxLength={160}
              />
              <p className="text-xs text-slate-400 mt-1">{formData.seoDescription.length}/160</p>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Keywords (comma separated)</label>
              <input
                type="text"
                value={formData.seoKeywords}
                onChange={e => setFormData({ ...formData, seoKeywords: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="keyword1, keyword2, keyword3"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-4 sm:pt-6 border-t border-slate-200 mt-4 sm:mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 sm:px-6 py-3 rounded-xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 transition-all text-sm sm:text-base"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || uploadingImages}
              className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-navy text-white font-bold hover:bg-navy-light transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <IconRenderer name="save" className="w-4 sm:w-5 h-4 sm:h-5" />
                  <span>{product ? 'Update Product' : 'Add Product'}</span>
                </>
              )}
            </button>
          </div>
          </div>
        </form>
      </div>
    </div>
  );
}
