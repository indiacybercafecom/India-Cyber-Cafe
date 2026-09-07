import { useState } from 'react';
import { DocumentCategory } from '../types';
import { IconRenderer } from './Icons';

interface Props { category?: DocumentCategory | null; onClose: () => void; onSave: (category: DocumentCategory) => Promise<void>; }
export function DocumentCategoryModal({ category, onClose, onSave }: Props) {
  const [name, setName] = useState(category?.name || '');
  const [description, setDescription] = useState(category?.description || '');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!name.trim()) return; setSaving(true); try { await onSave({ id: category?.id || '', name: name.trim(), description: description.trim(), icon: 'file-text', order: category?.order || 0 }); onClose(); } finally { setSaving(false); } };
  return <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="text-xl font-bold text-navy">{category ? 'Edit PDF Category' : 'Add PDF Category'}</h2><button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-slate-100"><IconRenderer name="x" className="h-5 w-5" /></button></div><div className="space-y-4 p-5"><label className="block text-sm font-bold text-slate-700">Category Name *<input className="input-field mt-2" value={name} onChange={e => setName(e.target.value)} /></label><label className="block text-sm font-bold text-slate-700">Description<textarea className="input-field mt-2 resize-none" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></label></div><div className="flex gap-3 border-t border-slate-100 p-5"><button type="button" onClick={onClose} className="btn-outline flex-1">Cancel</button><button disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save Category'}</button></div></form></div>;
}
