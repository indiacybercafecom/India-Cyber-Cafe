import { useState, useRef } from 'react';
import { Application, UserProfile, ApplicationNote } from '../types';
import { IconRenderer } from './Icons';
import { SelectDropdown } from './SelectDropdown';
import { showToast } from './Toast';
import { auth, rtdb } from '../firebase';
import { ref as dbRef, update } from 'firebase/database';
import { motion } from 'motion/react';
import { sendEmail, sendEmailToAllAdmins, emailTemplates } from '../services/emailService';
import { trimWhitespace } from '../utils/sanitizer';
import {
  ALLOWED_OPERATOR_STATUSES,
  MAX_NOTE_LENGTH,
  getApplicationPermissions,
  normalizeApplicationNotes,
} from '../utils/permissions';

interface ApplicationDetailsModalProps {
  app: Application | null;
  onClose: () => void;
  currentUser: UserProfile;
  operators: UserProfile[];
}

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const ALLOWED_ATTACHMENT_EXTENSIONS = /\.(pdf|jpe?g|png|webp)$/i;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function ApplicationDetailsModal({ app, onClose, currentUser, operators }: ApplicationDetailsModalProps) {
  const [noteText, setNoteText] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [noteFile, setNoteFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!app) return null;

  const perms = getApplicationPermissions(app, currentUser);

  if (!perms.canViewApplication) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
          <h3 className="text-xl font-bold text-navy">Access Denied</h3>
          <p className="text-sm text-slate-600">
            You do not have permission to view this application.
          </p>
          <button onClick={onClose} className="btn-primary px-6 py-2.5 text-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  const normalizedNotes = normalizeApplicationNotes(app.notes);

  const handleOpenAttachment = async (url: string, filename?: string) => {
    if (!url) return;
    if (!url.startsWith('/api/operator/attachments/')) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      if (filename) link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    setDownloadingAttachment(url);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Please sign in again to download this attachment.');
      }
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Unable to download attachment.');
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename || 'attachment';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err: any) {
      showToast(err?.message || 'Unable to download attachment.', 'error');
    } finally {
      setDownloadingAttachment(null);
    }
  };

  const handleFileChange = (file: File | null) => {
    if (!file) {
      setNoteFile(null);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showToast('Attachment size must be 5MB or smaller.', 'error');
      return;
    }
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type) && !ALLOWED_ATTACHMENT_EXTENSIONS.test(file.name)) {
      showToast('Only PDF, JPG, PNG, and WEBP attachments are allowed.', 'error');
      return;
    }
    setNoteFile(file);
  };

  const handleUpdatePaymentStatus = async (status: 'pending' | 'completed') => {
    if (!perms.canUpdatePayment) {
      showToast('Only Admins can update payment status.', 'error');
      return;
    }
    setLoading(true);
    try {
      await update(dbRef(rtdb, `applications/${app.id}`), {
        paymentStatus: status,
        updatedAt: new Date().toISOString(),
      });

      if (status === 'completed') {
        sendEmail(
          app.email,
          `Payment Confirmed: ${app.serviceName}`,
          emailTemplates.paymentReceived(app.name, app.charge?.toString() || '0', app.serviceName, `APP-${app.id}`)
        );
        sendEmailToAllAdmins(
          `[Admin Alert] Payment Received: ${app.serviceName}`,
          emailTemplates.adminPaymentReceived(app.name, app.charge?.toString() || '0', app.serviceName, `APP-${app.id}`)
        );
      }

      showToast(`Payment status updated to ${status}`);
    } catch (error: any) {
      showToast(error.message || 'Failed to update payment status', 'error');
    } finally {
      setLoading(false);
    }
  };

  const submitStatusOrNote = async (opts: {
    status?: string;
    note?: string;
    file?: File | null;
  }) => {
    const sanitizedNote = trimWhitespace(opts.note || '');
    const sanitizedStatus = trimWhitespace(opts.status || '');

    if (sanitizedNote.length > MAX_NOTE_LENGTH) {
      throw new Error(`Note must be ${MAX_NOTE_LENGTH} characters or less.`);
    }
    if (sanitizedStatus && !(ALLOWED_OPERATOR_STATUSES as readonly string[]).includes(sanitizedStatus)) {
      throw new Error('Invalid status selected.');
    }

    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      throw new Error('Authentication session expired. Please sign in again.');
    }

    let attachmentUrl = '';
    let attachmentName = '';

    if (opts.file) {
      if (!perms.canUploadNoteAttachment) {
        throw new Error('You do not have permission to upload attachments.');
      }
      const formData = new FormData();
      formData.append('file', opts.file);
      const uploadResp = await fetch(
        `/api/operator/applications/${encodeURIComponent(app.id)}/upload-attachment`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          body: formData,
        }
      );
      const uploadData = await uploadResp.json().catch(() => ({}));
      const uploadedUrl = uploadData.url || uploadData.attachmentUrl;
      if (uploadResp.ok && uploadData.success && uploadedUrl) {
        attachmentUrl = uploadedUrl;
        attachmentName = uploadData.attachmentName || opts.file.name;
      } else if (uploadResp.status === 503 && uploadData.code === 'FIREBASE_ADMIN_UNCONFIGURED') {
        throw new Error(
          'Attachment upload service is unavailable on the server. Note and attachment were not saved.'
        );
      } else {
        throw new Error(uploadData.error || 'Failed to upload attachment. Note and attachment were not saved.');
      }
    }

    // Attempt server-authoritative update
    const resp = await fetch(`/api/operator/applications/${encodeURIComponent(app.id)}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        status: sanitizedStatus || undefined,
        note: sanitizedNote || undefined,
        attachmentUrl: attachmentUrl || undefined,
        attachmentName: attachmentName || undefined,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.success) {
      return; // Server already persisted update and dispatched deduplicated emails
    }
    if (opts.file || !(resp.status === 503 && data.code === 'FIREBASE_ADMIN_UNCONFIGURED')) {
      throw new Error(data.error || 'Failed to update application.');
    }

    // Granular RTDB fallback only when server Admin SDK is unconfigured (local dev without service account)
    const nowIso = new Date().toISOString();
    const noteId = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newNote: ApplicationNote = {
      id: noteId,
      type: sanitizedStatus ? 'status' : 'note',
      by: (currentUser.name || 'Staff').trim(),
      email: currentUser.email,
      authorUid: currentUser.uid,
      authorRole: perms.isAdmin ? 'admin' : 'operator',
      text: sanitizedNote || (sanitizedStatus ? `Status updated to ${sanitizedStatus}` : `Uploaded attachment: ${attachmentName}`),
      time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      createdAt: Date.now(),
      ...(sanitizedStatus ? { status: sanitizedStatus } : {}),
      ...(attachmentUrl ? { attachment: attachmentUrl } : {}),
      ...(attachmentName ? { attachmentName } : {}),
    };

    const childUpdates: Record<string, any> = {
      updatedAt: nowIso,
      [`notes/${noteId}`]: newNote,
    };
    if (sanitizedStatus) {
      childUpdates.status = sanitizedStatus;
    }

    await update(dbRef(rtdb, `applications/${app.id}`), childUpdates);

    if (sanitizedStatus) {
      sendEmail(app.email, `Status Update: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, sanitizedStatus));
      sendEmailToAllAdmins(`[Admin Alert] Status Updated: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, sanitizedStatus));
      if (app.assignedTo && app.assignedTo.toLowerCase() !== currentUser.email.toLowerCase()) {
        sendEmail(app.assignedTo, `[Update] Status Changed: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, sanitizedStatus));
      }
    } else if (sanitizedNote) {
      sendEmail(app.email, `New Update: ${app.serviceName}`, emailTemplates.noteAdded(app.name, app.serviceName, sanitizedNote));
      sendEmailToAllAdmins(`[Admin Alert] New Note Added: ${app.serviceName}`, emailTemplates.noteAdded(app.name, app.serviceName, `Note from ${currentUser.name}: ${sanitizedNote}`));
    }
  };

  const handleUpdateStatusDirect = async (status: string) => {
    if (!perms.isAdmin) {
      showToast('Only Admins can use quick status controls.', 'error');
      return;
    }
    setLoading(true);
    try {
      await submitStatusOrNote({ status });
      showToast(`Status updated to ${status}`);
    } catch (error: any) {
      showToast(error.message || 'Failed to update status', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!perms.canAddNote && !perms.canUpdateStatus) {
      showToast('You do not have permission to update this application.', 'error');
      return;
    }
    if (!noteText.trim() && !newStatus && !noteFile) return;

    setLoading(true);
    try {
      await submitStatusOrNote({
        status: newStatus,
        note: noteText,
        file: noteFile,
      });
      showToast('Update added successfully!');
      setNoteText('');
      setNewStatus('');
      setNoteFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to add update', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (operatorEmail: string) => {
    if (!perms.canAssignOperator) {
      showToast('Only Admins can assign operators.', 'error');
      return;
    }
    try {
      const operator = operatorEmail
        ? operators.find(op => op.email.toLowerCase() === operatorEmail.toLowerCase())
        : undefined;

      if (operatorEmail && !operator?.uid) {
        showToast('Unable to resolve canonical Operator UID for this account.', 'error');
        return;
      }

      await update(dbRef(rtdb, `applications/${app.id}`), {
        assignedTo: operatorEmail || null,
        assignedToUid: operator?.uid || null,
        updatedAt: new Date().toISOString(),
      });

      if (operatorEmail) {
        sendEmail(
          operatorEmail,
          `New Assignment: ${app.serviceName}`,
          emailTemplates.operatorNewAssignment(operator?.name || 'Operator', app.name, app.email, app.serviceName, app.id)
        );
        sendEmail(
          app.email,
          `Operator Assigned: ${app.serviceName}`,
          emailTemplates.operatorAssigned(app.name, app.serviceName, operator?.name)
        );
        sendEmailToAllAdmins(
          `[Admin Alert] Operator Assigned: ${app.serviceName}`,
          emailTemplates.operatorNewAssignment(operator?.name || 'Operator', app.name, app.email, app.serviceName, app.id)
        );
      }

      showToast(operatorEmail ? `Assigned to ${operatorEmail}` : 'Application unassigned');
    } catch (error: any) {
      showToast(error.message || 'Failed to update assignment', 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processing': return 'bg-orange-500';
      case 'clarification': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'rejected': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  const getRoleBadge = (role?: string) => {
    if (role === 'admin') return { label: 'Admin', classes: 'bg-red-100 text-red-700' };
    if (role === 'operator') return { label: 'Operator', classes: 'bg-blue-100 text-blue-700' };
    if (role === 'user') return { label: 'Customer', classes: 'bg-slate-100 text-slate-700' };
    return null;
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-2 sm:p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-2xl relative overflow-hidden shadow-2xl flex flex-col max-h-[98vh] sm:max-h-[95vh]"
      >
        <div className="p-4 sm:p-6 bg-white border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-xl sm:text-2xl font-bold text-navy">Application Details</h3>
          <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-all">
            <IconRenderer name="x" className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Main Info Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 sm:gap-y-3 pb-4 border-b border-slate-100">
            <div className="flex justify-between sm:justify-start gap-2">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">User:</span>
              <span className="text-slate-600 text-xs sm:text-sm">{app.name}</span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Sub-Service:</span>
              <span className="text-slate-600 text-xs sm:text-sm">{app.subserviceName || app.serviceName}</span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Charge:</span>
              <span className="text-slate-600 text-xs sm:text-sm">₹{app.charge}</span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2 items-center">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Status:</span>
              <span className={`px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold text-white uppercase tracking-wider ${getStatusBadge(app.status)}`}>
                {app.status}
              </span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Payment:</span>
              <span className="text-slate-600 text-xs sm:text-sm capitalize">{app.paymentMethod?.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex justify-between sm:justify-start gap-2 items-center">
              <span className="text-navy font-bold text-xs sm:text-sm min-w-[100px] sm:min-w-[140px]">Pay Status:</span>
              <span className={`px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold text-white uppercase tracking-wider ${app.paymentStatus === 'completed' ? 'bg-green-500' : 'bg-orange-500'}`}>
                {app.paymentStatus || 'pending'}
              </span>
            </div>
          </div>

          {/* Form Information Section */}
          <div className="space-y-2 sm:space-y-4 pb-4 border-b border-slate-100">
            <h4 className="text-base sm:text-lg font-bold text-navy">Form Information</h4>
            <div className="grid grid-cols-1 gap-1.5 sm:gap-3 bg-slate-50 p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-100">
              {Object.entries(app.details || {}).map(([key, value]) => (
                <div key={key} className="flex flex-col sm:flex-row sm:gap-2 border-b border-slate-200 pb-1 sm:pb-2 last:border-0 last:pb-0">
                  <span className="text-navy font-bold min-w-[120px] sm:min-w-[160px] capitalize text-[10px] sm:text-sm">{key.replace(/_/g, ' ')}:</span>
                  <span className="text-slate-600 text-[10px] sm:text-sm break-words">
                    {typeof value === 'string' && (value.startsWith('http') || value.includes('/uploads/')) ? (
                      <a href={value} target="_blank" rel="noreferrer" className="text-primary hover:underline font-bold flex items-center gap-1">
                        <IconRenderer name="external-link" className="w-3 h-3" />
                        View
                      </a>
                    ) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Download Section - Only for completed files */}
          {app.fileUrl && (
            <div className="pt-1 sm:pt-2">
              <button
                type="button"
                onClick={() => handleOpenAttachment(app.fileUrl!, 'completed-file')}
                className="w-full py-2.5 sm:py-3 px-4 sm:px-6 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary hover:text-white transition-all flex items-center justify-center gap-2 shadow-sm text-sm sm:text-base"
              >
                <IconRenderer name="download" className="w-4 h-4 sm:w-5 sm:h-5" />
                Download Completed File
              </button>
            </div>
          )}

          {/* Notes & History */}
          <div className="space-y-2 sm:space-y-4">
            <h4 className="text-base sm:text-lg font-bold text-navy">Notes & History</h4>
            <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 min-h-[80px] sm:min-h-[100px] border border-slate-100">
              {normalizedNotes.length > 0 ? (
                <div className="space-y-3 sm:space-y-4">
                  {normalizedNotes.map((note, i) => {
                    const roleBadge = getRoleBadge(note.authorRole);
                    return (
                      <div key={note.id || i} className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-slate-100">
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] sm:text-xs font-bold text-navy">{note.by}</span>
                            {roleBadge && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${roleBadge.classes}`}>
                                {roleBadge.label}
                              </span>
                            )}
                          </div>
                          <span className="text-[8px] sm:text-[10px] text-slate-400 shrink-0">{note.time}</span>
                        </div>
                        <p className="text-xs sm:text-sm text-slate-600">{note.text}</p>
                        {note.attachment && (
                          <button
                            type="button"
                            disabled={downloadingAttachment === note.attachment}
                            onClick={() => handleOpenAttachment(note.attachment!, note.attachmentName)}
                            className="mt-1.5 sm:mt-2 inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-primary hover:underline disabled:opacity-50"
                          >
                            <IconRenderer name="download" className="w-3 h-3" />
                            {downloadingAttachment === note.attachment ? 'Downloading...' : (note.attachmentName || 'Attachment')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 text-xs sm:text-sm italic">
                  No notes yet
                </div>
              )}
            </div>
          </div>

          {/* Add Note & Update Section - Restricted to Admin or Assigned Operator */}
          {(perms.canAddNote || perms.canUpdateStatus) && (
            <div className="space-y-3 sm:space-y-4 pt-4 border-t border-slate-100">
              <h4 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <IconRenderer name="user-pen" className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                {perms.isAdmin ? 'Admin Controls' : 'Operator Controls'}
              </h4>
              <div className="space-y-3 sm:space-y-4">
                <div>
                  <textarea
                    placeholder="Add a note or reason for the user..."
                    maxLength={MAX_NOTE_LENGTH}
                    className="w-full p-3 sm:p-4 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all min-h-[80px] sm:min-h-[100px] text-xs sm:text-sm"
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                  />
                  <div className="text-[10px] text-slate-400 text-right mt-1">
                    {noteText.length}/{MAX_NOTE_LENGTH}
                  </div>
                </div>

                <div className="p-3 sm:p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-1.5 sm:space-y-2">
                  <label className="text-[10px] sm:text-xs font-bold text-navy">Update Status (Optional):</label>
                  <SelectDropdown
                    className="w-full p-2 sm:p-3 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm outline-none"
                    value={newStatus}
                    onChange={setNewStatus}
                    options={[
                      { value: '', label: 'No Status Change' },
                      { value: 'processing', label: 'Processing' },
                      { value: 'clarification', label: 'Clarification' },
                      { value: 'completed', label: 'Completed' },
                      { value: 'rejected', label: 'Rejected' },
                    ]}
                  />
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="p-4 sm:p-6 border-2 border-dashed border-orange-200 rounded-xl bg-orange-50/30 flex flex-col items-center justify-center gap-1.5 sm:gap-2 cursor-pointer hover:bg-orange-50 transition-all"
                >
                  <IconRenderer name="upload" className="w-5 h-5 sm:w-6 sm:h-6 text-navy" />
                  <span className="text-[10px] sm:text-xs font-medium text-slate-600 text-center">
                    {noteFile ? noteFile.name : 'Click to upload attachment (PDF, JPG, PNG, WEBP · max 5MB)'}
                  </span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={e => handleFileChange(e.target.files ? e.target.files[0] : null)}
                  />
                </div>

                <button
                  onClick={handleAddNote}
                  disabled={loading}
                  className="w-full py-2.5 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 text-sm sm:text-base disabled:opacity-60"
                >
                  {loading ? 'Processing...' : 'Add Note & Update'}
                </button>
              </div>
            </div>
          )}

          {/* Admin Specific Controls */}
          {perms.isAdmin && (
            <div className="space-y-4 sm:space-y-6 pt-4 border-t border-slate-100">
              <div className="space-y-1.5 sm:space-y-2">
                <label className="text-xs sm:text-sm font-bold text-navy">Assign to Operator:</label>
                <SelectDropdown
                  className="w-full p-2.5 sm:p-3 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm outline-none"
                  value={app.assignedTo || ''}
                  onChange={handleAssign}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...operators.map(op => ({ value: op.email, label: `${op.name} (${op.email})` })),
                  ]}
                />
                {app.assignedTo && !app.assignedToUid && (
                  <p className="text-[11px] text-amber-700 font-medium bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    Legacy assignment ({app.assignedTo}) has no canonical Operator UID. Re-select an Operator to restore access.
                  </p>
                )}
              </div>

              <div className="space-y-2 sm:space-y-3">
                <h4 className="text-xs sm:text-sm font-bold text-navy">Update Payment Status:</h4>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <button
                    onClick={() => handleUpdatePaymentStatus('completed')}
                    disabled={loading}
                    className="py-2.5 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm disabled:opacity-60"
                  >
                    <IconRenderer name="check" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Mark Paid
                  </button>
                  <button
                    onClick={() => handleUpdatePaymentStatus('pending')}
                    disabled={loading}
                    className="py-2.5 sm:py-3 border-2 border-navy text-navy font-bold rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm disabled:opacity-60"
                  >
                    <IconRenderer name="clock" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Mark Pending
                  </button>
                </div>
              </div>

              <div className="space-y-2 sm:space-y-3">
                <h4 className="text-xs sm:text-sm font-bold text-navy">Quick Status Update:</h4>
                <div className="grid grid-cols-2 gap-2 sm:gap-4">
                  <button
                    onClick={() => handleUpdateStatusDirect('processing')}
                    disabled={loading}
                    className="py-2 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all text-[10px] sm:text-sm disabled:opacity-60"
                  >
                    Processing
                  </button>
                  <button
                    onClick={() => handleUpdateStatusDirect('clarification')}
                    disabled={loading}
                    className="py-2 sm:py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-all text-[10px] sm:text-sm disabled:opacity-60"
                  >
                    Clarification
                  </button>
                  <button
                    onClick={() => handleUpdateStatusDirect('completed')}
                    disabled={loading}
                    className="py-2 sm:py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-all text-[10px] sm:text-sm disabled:opacity-60"
                  >
                    Completed
                  </button>
                  <button
                    onClick={() => handleUpdateStatusDirect('rejected')}
                    disabled={loading}
                    className="py-2 sm:py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all text-[10px] sm:text-sm disabled:opacity-60"
                  >
                    Rejected
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
