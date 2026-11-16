import { useState } from 'react';
import { DocumentCategory } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { useSubmissionLifecycle } from '../hooks/useSubmissionLifecycle';
import { withClientTimeout } from '../utils/fetchWithTimeout';

interface DocumentCategoryModalProps {
  category?: DocumentCategory | null;
  onClose: () => void;
  onSave: (category: DocumentCategory) => Promise<void>;
}

export function DocumentCategoryModal({ category, onClose, onSave }: DocumentCategoryModalProps) {
  const [formData, setFormData] = useState<DocumentCategory>(category || { id: '', name: '', description: '', icon: 'file-text', order: 0 });
  const { isSubmitting: saving, submittingRef, runSubmission } = useSubmissionLifecycle();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!formData.name.trim()) {
      showToast('Category name is required.', 'error');
      return;
    }
    try {
      await runSubmission(async () => {
        await withClientTimeout(
          onSave({ ...formData, name: formData.name.trim(), description: formData.description?.trim() || '' }),
          15000,
          'Saving category timed out.'
        );
        showToast(category ? 'Category updated successfully!' : 'Category added successfully!', 'success');
        onClose();
      });
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showToast(error.message || 'Failed to save category.', 'error');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[2000] p-2 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[98vh] sm:max-h-[95vh] flex flex-col overflow-hidden">
        <div className="p-4 sm:p-6 bg-white border-b border-slate-100 flex justify-between items-center z-10 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold text-navy pr-2">{category ? 'Edit PDF Category' : 'Add PDF Category'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-all flex-shrink-0"><IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            <div><label className="block text-sm font-bold text-slate-700 mb-2">Category Name *</label><input type="text" value={formData.name} onChange={event => setFormData({ ...formData, name: event.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all" /></div>
            <div><label className="block text-sm font-bold text-slate-700 mb-2">Description</label><textarea value={formData.description || ''} onChange={event => setFormData({ ...formData, description: event.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none" rows={2} /></div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 p-4 sm:p-6 border-t border-slate-200">
            <button type="button" onClick={onClose} className="flex-1 px-4 sm:px-6 py-3 rounded-xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 transition-all text-sm sm:text-base">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-navy text-white font-bold hover:bg-navy-light transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base">{saving ? 'Saving...' : category ? 'Update Category' : 'Save Category'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
