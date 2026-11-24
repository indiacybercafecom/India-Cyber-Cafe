import { useState, useRef, useEffect } from 'react';
import { auth } from '../firebase';
import { DigitalResource, Product, ProductCategory } from '../types';
import { IconRenderer } from './Icons';
import { SelectDropdown } from './SelectDropdown';
import { showToast } from './Toast';
import { generateSlug } from '../utils/slugGenerator';
import { trimWhitespace } from '../utils/sanitizer';
import { uploadFilesBounded, uploadFileWithRetry, MAX_SERVICE_FILE_SIZE } from '../services/uploadService';
import { useSubmissionLifecycle } from '../hooks/useSubmissionLifecycle';
import { withClientTimeout } from '../utils/fetchWithTimeout';

interface ProductModalProps {
  product?: Product;
  categories: ProductCategory[];
  onClose: () => void;
  onSave: (product: Product) => Promise<void>;
}

export function ProductModal({ product, categories, onClose, onSave }: ProductModalProps) {
  const [digitalResources, setDigitalResources] = useState<DigitalResource[]>(product?.digitalResources || []);
  const [formData, setFormData] = useState<Product>(
    product || {
      id: '',
      name: '',
      permalink: '',
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
  const isVirtual = formData.productType === 'virtual';

  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingResourceId, setUploadingResourceId] = useState<string | null>(null);
  const [resourcesLoaded, setResourcesLoaded] = useState(!product || product.productType !== 'virtual');
  const [resourcesLoadFailed, setResourcesLoadFailed] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const uploadingRef = useRef(false);
  const { isSubmitting: loading, submittingRef, runSubmission } = useSubmissionLifecycle();

  useEffect(() => {
    if (!product?.id || product.productType !== 'virtual') return;
    let active = true;
    const loadResources = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error('Admin authentication is required to edit digital resources.');
        const response = await fetch(`/api/admin/store/products/${encodeURIComponent(product.id)}/digital-resources`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) throw new Error(result?.error || 'Could not load digital resources.');
        if (active) {
          setDigitalResources(Array.isArray(result.resources) ? result.resources : []);
          setResourcesLoadFailed(false);
        }
      } catch (error: any) {
        if (active) {
          setResourcesLoadFailed(true);
          showToast(error, 'error', 'Unable to load private download resources.');
        }
      } finally {
        if (active) setResourcesLoaded(true);
      }
    };
    void loadResources();
    return () => { active = false; };
  }, [product?.id, product?.productType]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || uploadingRef.current) return;

    const validFiles: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) {
        showToast(`Skipped "${file.name}": please select valid image files`, 'error');
        continue;
      }
      if (file.size > MAX_SERVICE_FILE_SIZE) {
        showToast(`Image ${file.name} is too large (max 5MB)`, 'error');
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      e.target.value = '';
      return;
    }

    uploadingRef.current = true;
    setUploadingImages(true);
    setUploadPercent(0);
    try {
      const uploadedUrls = await uploadFilesBounded(
        validFiles,
        (file, _idx, onItemProgress) =>
          uploadFileWithRetry(file, {
            category: 'products',
            maxSizeBytes: MAX_SERVICE_FILE_SIZE,
            onProgress: onItemProgress,
          }),
        {
          concurrency: 3,
          onProgress: (_done, _total, pct) => setUploadPercent(pct),
        }
      );

      setFormData(prev => ({
        ...prev,
        images: [...(prev.images || []), ...uploadedUrls]
      }));
      showToast(`${uploadedUrls.length} image${uploadedUrls.length > 1 ? 's' : ''} uploaded successfully!`, 'success');
    } catch (error: any) {
      showToast(error, 'error', 'Unable to upload file. Please try again.');
    } finally {
      uploadingRef.current = false;
      setUploadingImages(false);
      setUploadPercent(0);
      e.target.value = '';
    }
  };

  const removeImage = (index: number) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images?.filter((_, i) => i !== index) || []
    }));
  };

  const handleDigitalFileUpload = async (resourceId: string, file?: File) => {
    if (!file) return;
    setUploadingResourceId(resourceId);
    try {
      const url = await uploadFileWithRetry(file, {
        category: 'digital-products',
        maxSizeBytes: MAX_SERVICE_FILE_SIZE,
      });
      setDigitalResources(items => items.map(item => item.id === resourceId
        ? { ...item, fileName: file.name, url, label: item.label || `Download ${file.name}` }
        : item));
      showToast('Digital file uploaded successfully.', 'success');
    } catch (error: any) {
      showToast(error, 'error', 'Unable to upload digital file.');
    } finally {
      setUploadingResourceId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || uploadingRef.current || uploadingResourceId || !resourcesLoaded) return;

    if (isVirtual && resourcesLoadFailed) {
      showToast('Private download resources could not be loaded. Close and reopen this product before saving.', 'error');
      return;
    }

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

    if (isVirtual && digitalResources.some(resource => !resource.fileName.trim() || !resource.label.trim() || !resource.url.trim())) {
      showToast('Complete the file name, button label and URL for every download resource', 'error');
      return;
    }
    if (isVirtual && digitalResources.some(resource => {
      try { return new URL(resource.url).protocol !== 'https:'; } catch { return true; }
    })) {
      showToast('Download URLs must use HTTPS', 'error');
      return;
    }
    if (isVirtual && digitalResources.length === 0) {
      showToast('Add at least one digital download resource', 'error');
      return;
    }

    if (!formData.images || formData.images.length === 0) {
      showToast('Please upload at least one product image', 'error');
      return;
    }

    try {
      await runSubmission(async () => {
        const sanitizedData = {
          ...formData,
          digitalResources: isVirtual ? digitalResources.map(resource => ({
            ...resource,
            fileName: trimWhitespace(resource.fileName),
            label: trimWhitespace(resource.label),
            url: trimWhitespace(resource.url),
          })) : [],
          paymentMethods: isVirtual ? ['online'] as ('online' | 'cod' | 'both')[] : formData.paymentMethods,
          deliveryCharges: isVirtual ? 0 : formData.deliveryCharges,
          requiresCustomImage: isVirtual ? false : formData.requiresCustomImage,
          name: trimWhitespace(formData.name),
          shortDescription: trimWhitespace(formData.shortDescription),
          longDescription: trimWhitespace(formData.longDescription),
          customImageInstructions: trimWhitespace(formData.customImageInstructions),
          turnaroundTime: isVirtual ? '' : trimWhitespace(formData.turnaroundTime),
          seoTitle: trimWhitespace(formData.seoTitle),
          seoDescription: trimWhitespace(formData.seoDescription),
          seoKeywords: trimWhitespace(formData.seoKeywords)
        };

        if (!product) {
          sanitizedData.id = generateSlug(sanitizedData.name);
        }

        sanitizedData.permalink = generateSlug(sanitizedData.name);

        await withClientTimeout(onSave(sanitizedData), 15000, 'Saving product timed out. Please try again.');
        showToast(product ? 'Product updated successfully!' : 'Product added successfully!', 'success');
        onClose();
      });
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showToast(error, 'error', 'Failed to save product. Please try again.');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-2xl relative overflow-hidden max-h-[98vh] sm:max-h-[95vh] flex flex-col">
        <div className="p-4 sm:p-6 bg-white border-b border-slate-100 flex justify-between items-center z-10 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold text-navy pr-2">{product ? 'Edit Product' : 'Add New Product'}</h2>
          <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-all flex-shrink-0">
            <IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Product Type</label>
              <SelectDropdown
                value={formData.productType || 'physical'}
                onChange={value => setFormData({
                  ...formData,
                  productType: value as 'physical' | 'virtual',
                  ...(value === 'virtual' ? { paymentMethods: ['online'], deliveryCharges: 0, requiresCustomImage: false, turnaroundTime: '' } : {})
                })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                options={[
                  { value: 'physical', label: 'Physical Product' },
                  { value: 'virtual', label: 'Virtual Product' },
                ]}
              />
            </div>

            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Product Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="e.g., Custom T-Shirt Design"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Category *</label>
              <SelectDropdown
                value={formData.category}
                onChange={value => setFormData({ ...formData, category: value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="Select a category"
                options={[
                  { value: '', label: 'Select a category' },
                  ...categories.map(cat => ({ value: cat.id, label: cat.name })),
                ]}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Short Description *</label>
              <textarea
                value={formData.shortDescription}
                onChange={e => setFormData({ ...formData, shortDescription: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none"
                rows={2}
                placeholder="Brief product description (appears in listings)"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Long Description</label>
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
          <div className="space-y-2 sm:space-y-3 p-3 sm:p-4 bg-slate-50 rounded-2xl">
            <h3 className="font-bold text-navy text-lg">Pricing & Stock</h3>
            
            {!isVirtual && <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Base Price (₹) *</label>
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
                <label className="block text-sm font-bold text-slate-700 mb-1">Discounted Price (₹)</label>
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
            </div>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Delivery Charges (₹)</label>
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
                <label className="block text-sm font-bold text-slate-700 mb-1">Stock Status</label>
                <SelectDropdown
                  value={formData.inStock ? 'in' : 'out'}
                  onChange={value => setFormData({ ...formData, inStock: value === 'in' })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                  options={[
                    { value: 'in', label: 'In Stock' },
                    { value: 'out', label: 'Out of Stock' },
                  ]}
                />
              </div>
            </div>
          </div>

          {isVirtual ? (
            <div className="space-y-3 px-3 sm:px-4">
              <h3 className="font-bold text-navy text-lg">Digital Downloads</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-bold text-slate-700">Expiry (days, optional)
                  <input type="number" min="1" value={formData.downloadExpiryDays || ''} onChange={e => setFormData({ ...formData, downloadExpiryDays: Number(e.target.value) || undefined })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200" />
                </label>
                <label className="text-sm font-bold text-slate-700">Download limit per resource
                  <input type="number" min="1" value={formData.downloadLimit || 5} onChange={e => setFormData({ ...formData, downloadLimit: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200" />
                </label>
              </div>
              <div className="space-y-3">
                {digitalResources.map((resource, index) => (
                  <div key={resource.id} className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-col gap-1">
                      <button type="button" title="Move up" aria-label="Move resource up" disabled={index === 0} onClick={() => setDigitalResources(items => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} className="disabled:opacity-30">↑</button>
                      <button type="button" title="Move down" aria-label="Move resource down" disabled={index === digitalResources.length - 1} onClick={() => setDigitalResources(items => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })} className="disabled:opacity-30">↓</button>
                    </div>
                    <input aria-label="Download file name" placeholder="File name (e.g. guide.pdf)" value={resource.fileName} onChange={e => setDigitalResources(items => items.map(item => item.id === resource.id ? { ...item, fileName: e.target.value } : item))} className="min-w-0 px-3 py-2 rounded-lg border border-slate-200" />
                    <div className="space-y-2">
                      <input aria-label="Download button label" placeholder="Button label" value={resource.label} onChange={e => setDigitalResources(items => items.map(item => item.id === resource.id ? { ...item, label: e.target.value } : item))} className="w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200" />
                      <input aria-label="Download URL" type="url" placeholder="https://..." value={resource.url} onChange={e => setDigitalResources(items => items.map(item => item.id === resource.id ? { ...item, url: e.target.value } : item))} className="w-full min-w-0 px-3 py-2 rounded-lg border border-slate-200" />
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-navy">
                        <IconRenderer name="upload" className="h-4 w-4" />
                        {uploadingResourceId === resource.id ? 'Uploading...' : 'Upload file'}
                        <input type="file" accept=".pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" disabled={Boolean(uploadingResourceId)} onChange={e => { void handleDigitalFileUpload(resource.id, e.target.files?.[0]); e.target.value = ''; }} className="sr-only" />
                      </label>
                    </div>
                    <button type="button" title="Remove resource" aria-label="Remove resource" onClick={() => setDigitalResources(items => items.filter(item => item.id !== resource.id))} className="p-2 text-red-600"><IconRenderer name="trash-2" className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setDigitalResources(items => [...items, { id: crypto.randomUUID(), fileName: '', label: 'Download Now', url: '' }])} className="px-3 py-2 border border-slate-300 rounded-lg font-semibold text-sm">Add download resource</button>
              <p className="text-xs text-slate-500">Only secure order-specific download links are shown to customers. Resource URLs are stored privately.</p>
            </div>
          ) : (
          <div className="space-y-2 sm:space-y-3 px-3 sm:px-4">
            <h3 className="font-bold text-navy text-lg">Delivery</h3>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Turnaround Time</label>
              <input
                type="text"
                value={formData.turnaroundTime}
                onChange={e => setFormData({ ...formData, turnaroundTime: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="e.g., 3-5 days"
              />
            </div>
          </div>
          )}

          {/* Custom Image */}
          {!isVirtual && <div className="space-y-2 sm:space-y-3 p-3 sm:p-4 mx-3 sm:mx-4 bg-orange-50 rounded-2xl border-2 border-orange-200">
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
          </div>}

          {/* Product Images */}
          <div className="space-y-2 sm:space-y-3 px-3 sm:px-4">
            <h3 className="font-bold text-navy text-lg">Product Images *</h3>
            
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 text-center hover:border-navy transition-colors">
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
                <p className="font-bold text-navy">{uploadingImages ? `Uploading (${uploadPercent}%)...` : 'Click to upload images'}</p>
                <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 5MB each</p>
              </label>
            </div>

            {formData.images && formData.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
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
          <div className="space-y-2 sm:space-y-3 p-3 sm:p-4 mx-3 sm:mx-4 bg-slate-50 rounded-2xl">
            <h3 className="font-bold text-navy text-lg">SEO</h3>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">SEO Title</label>
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
              <label className="block text-sm font-bold text-slate-700 mb-1">SEO Description</label>
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
              <label className="block text-sm font-bold text-slate-700 mb-1">Keywords (comma separated)</label>
              <input
                type="text"
                value={formData.seoKeywords}
                onChange={e => setFormData({ ...formData, seoKeywords: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="keyword1, keyword2, keyword3"
              />
            </div>

            {/* Payment Methods */}
            {!isVirtual && <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-4 rounded-2xl border-2 border-slate-200 space-y-3">
              <h3 className="font-bold text-navy text-lg flex items-center gap-2">
                <span className="text-xl">💳</span>
                Payment Methods
              </h3>
              <p className="text-sm text-slate-600">Select which payment methods customers can use for this product</p>
              
              <div className="space-y-2">
                <label className="flex items-center gap-2 p-2 sm:p-3 bg-white rounded-lg border-2 border-slate-200 cursor-pointer hover:border-navy transition-all">
                  <input
                    type="radio"
                    name="paymentMethods"
                    value="both"
                    checked={!formData.paymentMethods || formData.paymentMethods.includes('both') || (formData.paymentMethods?.includes('online') && formData.paymentMethods?.includes('cod'))}
                    onChange={() => setFormData({ ...formData, paymentMethods: ['both'] })}
                    className="w-4 h-4 accent-navy cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className="font-bold text-navy text-sm">Both (Recommended)</p>
                    <p className="text-xs text-slate-600">Allow customers to choose Online (Razorpay) or Cash on Delivery</p>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-2 sm:p-3 bg-white rounded-lg border-2 border-slate-200 cursor-pointer hover:border-navy transition-all">
                  <input
                    type="radio"
                    name="paymentMethods"
                    value="online"
                    checked={formData.paymentMethods?.length === 1 && formData.paymentMethods[0] === 'online'}
                    onChange={() => setFormData({ ...formData, paymentMethods: ['online'] })}
                    className="w-4 h-4 accent-navy cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className="font-bold text-navy text-sm">Online Only</p>
                    <p className="text-xs text-slate-600">Accept only Razorpay online payments</p>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-2 sm:p-3 bg-white rounded-lg border-2 border-slate-200 cursor-pointer hover:border-navy transition-all">
                  <input
                    type="radio"
                    name="paymentMethods"
                    value="cod"
                    checked={formData.paymentMethods?.length === 1 && formData.paymentMethods[0] === 'cod'}
                    onChange={() => setFormData({ ...formData, paymentMethods: ['cod'] })}
                    className="w-4 h-4 accent-navy cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className="font-bold text-navy text-sm">Cash on Delivery Only</p>
                    <p className="text-xs text-slate-600">Accept only cash on delivery payments</p>
                  </div>
                </label>
              </div>
            </div>}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-200 mt-3 sm:mt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 sm:px-6 py-3 rounded-xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 transition-all text-sm sm:text-base"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || uploadingImages || Boolean(uploadingResourceId) || !resourcesLoaded}
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
