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
  const [form, setForm] = useState({
    name: document?.name || '', description: document?.description || '', category: document?.category || categories[0]?.name || '',
    previewUrl: document?.previewUrl || document?.downloadUrl || '', downloadUrl: document?.downloadUrl || '', thumbnailUrl: document?.thumbnailUrl || '', active: document?.active !== false,
  });
  const [saving, setSaving] = useState(false);
  const categoryOptions = categories.map(category => ({ value: category.name, label: category.name }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const urls = normalizePdfUrl(form.previewUrl || form.downloadUrl);
    if (!form.name.trim() || !form.category || !urls) { showToast('Name, category and a valid PDF URL are required.', 'error'); return; }
    setSaving(true);
    try { await onSave({ ...form, ...urls, fileType: 'PDF' }, document?.id); onClose(); showToast(document ? 'PDF updated successfully!' : 'PDF added successfully!'); }
    catch (error: any) { showToast(error.message || 'Could not save PDF.', 'error'); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm">
    <form onSubmit={submit} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="text-xl font-bold text-navy">{document ? 'Edit PDF' : 'Add PDF'}</h2><button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-slate-100"><IconRenderer name="x" className="h-5 w-5" /></button></div>
      <div className="space-y-4 p-5">
        <label className="block text-sm font-bold text-slate-700">PDF / Document Name *<input className="input-field mt-2" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label className="block text-sm font-bold text-slate-700">Short Description<textarea className="input-field mt-2 resize-none" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        <label className="block text-sm font-bold text-slate-700">Category *<SelectDropdown options={categoryOptions} value={form.category} onChange={category => setForm({ ...form, category })} containerClassName="mt-2" className="input-field" ariaLabel="PDF category" placeholder="Select category" /></label>
        <label className="block text-sm font-bold text-slate-700">Google Drive or PDF URL *<input className="input-field mt-2" placeholder="https://drive.google.com/file/d/.../view" value={form.previewUrl} onChange={e => setForm({ ...form, previewUrl: e.target.value, downloadUrl: e.target.value })} /><span className="mt-1 block text-xs font-normal text-slate-400">Google Drive sharing links are converted automatically. The file must be publicly viewable.</span></label>
        <label className="block text-sm font-bold text-slate-700">Thumbnail URL (optional)<input className="input-field mt-2" value={form.thumbnailUrl} onChange={e => setForm({ ...form, thumbnailUrl: e.target.value })} /></label>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-primary" /> Visible on public page</label>
      </div>
      <div className="flex gap-3 border-t border-slate-100 p-5"><button type="button" onClick={onClose} className="btn-outline flex-1">Cancel</button><button disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : document ? 'Update PDF' : 'Add PDF'}</button></div>
    </form>
  </div>;
}
