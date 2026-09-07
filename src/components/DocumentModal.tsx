import { useState } from 'react';
import { DocumentCategory, FormDocument } from '../types';
import { IconRenderer } from './Icons';
import { SelectDropdown } from './SelectDropdown';
import { normalizePdfUrl } from '../utils/driveUrl';
import { showToast } from './Toast';

interface DocumentModalProps {
  document?: FormDocument | null;
  categories: DocumentCategory[];
  onClose: () => void;
  onSave: (data: Omit<FormDocument, 'id'>, id?: string) => Promise<void>;
}

export function DocumentModal({ document, categories, onClose, onSave }: DocumentModalProps) {
  const [formData, setFormData] = useState({ name: document?.name || '', description: document?.description || '', category: document?.category || '', url: document?.previewUrl || document?.downloadUrl || '', thumbnailUrl: document?.thumbnailUrl || '', active: document?.active !== false });
  const [saving, setSaving] = useState(false);
  const categoryOptions = categories.map(category => ({ value: category.name, label: category.name }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const urls = normalizePdfUrl(formData.url);
    if (!formData.name.trim() || !formData.category || !urls) {
      showToast('Name, category and a valid PDF URL are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: formData.name.trim(), description: formData.description.trim(), category: formData.category, ...urls, thumbnailUrl: formData.thumbnailUrl.trim() || undefined, fileType: 'PDF', active: formData.active }, document?.id);
      showToast(document ? 'PDF updated successfully!' : 'PDF added successfully!', 'success');
      onClose();
    } catch (error: any) {
      showToast(error.message || 'Failed to save PDF.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[2000] p-2 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[98vh] sm:max-h-[95vh] flex flex-col overflow-hidden">
        <div className="p-4 sm:p-6 bg-white border-b border-slate-100 flex justify-between items-center z-10 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold text-navy pr-2">{document ? 'Edit PDF' : 'Add PDF'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-all flex-shrink-0"><IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            <div><label className="block text-sm font-bold text-slate-700 mb-2">PDF / Document Name *</label><input type="text" value={formData.name} onChange={event => setFormData({ ...formData, name: event.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all" /></div>
            <div><label className="block text-sm font-bold text-slate-700 mb-2">Short Description</label><textarea value={formData.description} onChange={event => setFormData({ ...formData, description: event.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none" rows={3} /></div>
            <div><label className="block text-sm font-bold text-slate-700 mb-2">Category *</label><SelectDropdown options={categoryOptions} value={formData.category} onChange={category => setFormData({ ...formData, category })} containerClassName="w-full" className="input-field" ariaLabel="PDF category" placeholder="Select category" /></div>
            <div><label className="block text-sm font-bold text-slate-700 mb-2">Google Drive or PDF URL *</label><input type="url" value={formData.url} onChange={event => setFormData({ ...formData, url: event.target.value })} placeholder="https://drive.google.com/file/d/.../view" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all" /><p className="text-xs text-slate-400 mt-1">The Drive file must be publicly viewable.</p></div>
            <div><label className="block text-sm font-bold text-slate-700 mb-2">Thumbnail URL (optional)</label><input type="url" value={formData.thumbnailUrl} onChange={event => setFormData({ ...formData, thumbnailUrl: event.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all" /></div>
            <label className="flex items-center gap-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={formData.active} onChange={event => setFormData({ ...formData, active: event.target.checked })} className="h-4 w-4 accent-primary" />Visible on public page</label>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 p-4 sm:p-6 border-t border-slate-200">
            <button type="button" onClick={onClose} className="flex-1 px-4 sm:px-6 py-3 rounded-xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 transition-all text-sm sm:text-base">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-navy text-white font-bold hover:bg-navy-light transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base">{saving ? 'Saving...' : document ? 'Update PDF' : 'Save PDF'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
