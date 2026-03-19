import { useState } from 'react';
import { ProductCategory } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { generateSlug } from '../utils/slugGenerator';

interface CategoryModalProps {
  category?: ProductCategory;
  onClose: () => void;
  onSave: (category: ProductCategory) => Promise<void>;
}

const AVAILABLE_ICONS = [
  'shirt',
  'shopping-bag',
  'image',
  'palette',
  'gift',
  'star',
  'heart',
  'zap',
  'layers',
  'package',
  'box',
  'square-rounded',
];

export function CategoryModal({ category, onClose, onSave }: CategoryModalProps) {
  const [formData, setFormData] = useState<ProductCategory>(
    category || {
      id: '',
      name: '',
      description: '',
      icon: 'shopping-bag',
      order: 0
    }
  );

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      showToast('Category name is required', 'error');
      return;
    }

    if (!formData.icon.trim()) {
      showToast('Please select an icon', 'error');
      return;
    }

    setLoading(true);
    try {
      if (!formData.id) {
        formData.id = generateSlug(formData.name);
      }
      await onSave(formData);
      showToast(category ? 'Category updated successfully!' : 'Category added successfully!', 'success');
      onClose();
    } catch (error: any) {
      showToast(error.message || 'Failed to save category', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-[2000] p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        <div className="sticky top-0 bg-gradient-to-r from-navy to-blue-700 text-white px-4 sm:px-6 py-4 sm:py-6 flex justify-between items-center z-10 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold pr-2">{category ? 'Edit Category' : 'Add New Category'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-all flex-shrink-0">
            <IconRenderer name="x" className="w-5 sm:w-6 h-5 sm:h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            {/* Name */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Category Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="e.g., T-Shirts, Hoodies, Custom Prints"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Description</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none"
                rows={2}
                placeholder="Brief description of this category"
              />
            </div>

            {/* Icon Selection */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3">Category Icon *</label>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 sm:gap-3">
                {AVAILABLE_ICONS.map(icon => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setFormData({ ...formData, icon })}
                    className={`p-3 sm:p-4 rounded-xl border-2 transition-all flex items-center justify-center ${
                      formData.icon === icon
                        ? 'border-navy bg-navy/10'
                        : 'border-slate-200 hover:border-navy/50'
                    }`}
                    title={icon}
                  >
                    <IconRenderer name={icon} className="w-5 sm:w-6 h-5 sm:h-6 text-navy" />
                  </button>
                ))}
              </div>
            </div>

            {/* Order */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Display Order</label>
              <input
                type="number"
                value={formData.order}
                onChange={e => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                placeholder="0"
                min="0"
              />
              <p className="text-xs text-slate-400 mt-1">Lower numbers appear first (0 = first)</p>
            </div>

            {/* Preview */}
            <div className="p-3 sm:p-4 bg-slate-50 rounded-2xl">
              <p className="text-xs text-slate-600 font-bold mb-3">Preview</p>
              <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200">
                <IconRenderer name={formData.icon || 'layers'} className="w-5 sm:w-6 h-5 sm:h-6 text-navy flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-navy text-sm line-clamp-1">{formData.name || 'Category Name'}</p>
                  <p className="text-xs text-slate-500 line-clamp-1">{formData.description || 'Category description'}</p>
                </div>
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
                disabled={loading}
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
                    <span>{category ? 'Update Category' : 'Add Category'}</span>
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
