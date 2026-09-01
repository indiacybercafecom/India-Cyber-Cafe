import { useState, useRef } from 'react';
import { Application, UserProfile, ApplicationNote } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { rtdb } from '../firebase';
import { ref as dbRef, update } from 'firebase/database';
import { motion, AnimatePresence } from 'motion/react';
import { sendEmail, sendEmailToAllAdmins, emailTemplates } from '../services/emailService';
import { uploadFile } from '../services/uploadService';
import { trimWhitespace } from '../utils/sanitizer';

interface ApplicationDetailsModalProps {
  app: Application | null;
  onClose: () => void;
  currentUser: UserProfile;
  operators: UserProfile[];
}

export function ApplicationDetailsModal({ app, onClose, currentUser, operators }: ApplicationDetailsModalProps) {
  const [noteText, setNoteText] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [noteFile, setNoteFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!app) return null;

  const isAdmin = currentUser?.role === 'admin';
  const isOperator = currentUser?.role === 'operator';
  const isStaff = isAdmin || isOperator;

  const handleUpdatePaymentStatus = async (status: 'pending' | 'completed') => {
    setLoading(true);
    try {
      await update(dbRef(rtdb, `applications/${app.id}`), { paymentStatus: status });
      
      // Notify user about payment status
      if (status === 'completed') {
        sendEmail(app.email, `Payment Confirmed: ${app.serviceName}`, emailTemplates.paymentReceived(app.name, app.charge?.toString() || '0', app.serviceName, `APP-${app.id}`));
        // Notify all admins
        sendEmailToAllAdmins(`[Admin Alert] Payment Received: ${app.serviceName}`, emailTemplates.adminPaymentReceived(app.name, app.charge?.toString() || '0', app.serviceName, `APP-${app.id}`));
      }
      
      showToast(`Payment status updated to ${status}`);
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatusDirect = async (status: string) => {
    setLoading(true);
    try {
      const newNote: ApplicationNote = {
        type: 'status',
        by: currentUser.name,
        email: currentUser.email,
        text: `Status updated to ${status}`,
        time: new Date().toLocaleString(),
        status: status
      };

      const updatedNotes = [...(app.notes || []), newNote];
      await update(dbRef(rtdb, `applications/${app.id}`), { 
        status: status,
        notes: updatedNotes 
      });

      // Notify user
      sendEmail(app.email, `Status Update: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, status));
      
      // Notify all admins
      sendEmailToAllAdmins(`[Admin Alert] Status Updated: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, status));
      
      // Notify assigned operator if exists
      if (app.assignedTo) {
        sendEmail(app.assignedTo, `[Update] Status Changed: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, status));
      }
      
      showToast(`Status updated to ${status}`);
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText && !newStatus && !noteFile) return;

    setLoading(true);
    try {
      let attachmentUrl = '';
      if (noteFile) {
        attachmentUrl = await uploadFile(noteFile, 'notes');
      }

      // Sanitize note text before saving
      const sanitizedNoteText = trimWhitespace(noteText);
      const sanitizedStatus = trimWhitespace(newStatus);

      const newNote: any = {
        type: sanitizedStatus ? 'status' : 'note',
        by: currentUser.name.trim(),
        email: currentUser.email,
        text: sanitizedNoteText || (sanitizedStatus ? `Status updated to ${sanitizedStatus}` : ''),
        time: new Date().toLocaleString(),
      };

      if (sanitizedStatus) newNote.status = sanitizedStatus;
      if (attachmentUrl) newNote.attachment = attachmentUrl;
      if (noteFile?.name) newNote.attachmentName = noteFile.name;

      const updatedNotes = [...(app.notes || []), newNote];
      const updates: any = { notes: updatedNotes };
      if (sanitizedStatus) updates.status = sanitizedStatus;

      await update(dbRef(rtdb, `applications/${app.id}`), updates);

      // Email logic
      if (sanitizedStatus) {
        sendEmail(app.email, `Status Update: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, sanitizedStatus));
        // Notify all admins about status update
        sendEmailToAllAdmins(`[Admin Alert] Status Updated: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, sanitizedStatus));
      } else if (sanitizedNoteText) {
        sendEmail(app.email, `New Update: ${app.serviceName}`, emailTemplates.noteAdded(app.name, app.serviceName, sanitizedNoteText));
        // Notify all admins about new note
        sendEmailToAllAdmins(`[Admin Alert] New Note Added: ${app.serviceName}`, emailTemplates.noteAdded(app.name, app.serviceName, `Note from ${currentUser.name}: ${sanitizedNoteText}`));
      }

      showToast('Update added successfully!');
      setNoteText('');
      setNewStatus('');
      setNoteFile(null);
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (operatorEmail: string) => {
    try {
      await update(dbRef(rtdb, `applications/${app.id}`), { assignedTo: operatorEmail });
      
      if (operatorEmail) {
        const operator = operators.find(op => op.email === operatorEmail);
        // Send email to operator
        sendEmail(operatorEmail, `New Assignment: ${app.serviceName}`, emailTemplates.operatorNewAssignment(operator?.name || 'Operator', app.name, app.email, app.serviceName, app.id));
        // Send email to user
        sendEmail(app.email, `Operator Assigned: ${app.serviceName}`, emailTemplates.operatorAssigned(app.name, app.serviceName, operator?.name));
        // Notify all admins
        sendEmailToAllAdmins(`[Admin Alert] Operator Assigned: ${app.serviceName}`, emailTemplates.operatorNewAssignment(operator?.name || 'Operator', app.name, app.email, app.serviceName, app.id));
      }
      
      showToast(`Assigned to ${operatorEmail}`);
    } catch (error: any) {
      showToast(error.message, 'error');
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
              {Object.entries(app.details).map(([key, value]) => (
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
              <a 
                href={app.fileUrl} 
                target="_blank" 
                rel="noreferrer"
                className="w-full py-2.5 sm:py-3 px-4 sm:px-6 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary hover:text-white transition-all flex items-center justify-center gap-2 shadow-sm text-sm sm:text-base"
              >
                <IconRenderer name="download" className="w-4 h-4 sm:w-5 sm:h-5" />
                Download Completed File
              </a>
            </div>
          )}

          {/* Notes & History */}
          <div className="space-y-2 sm:space-y-4">
            <h4 className="text-base sm:text-lg font-bold text-navy">Notes & History</h4>
            <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 min-h-[80px] sm:min-h-[100px] border border-slate-100">
              {app.notes && app.notes.length > 0 ? (
                <div className="space-y-3 sm:space-y-4">
                  {app.notes.map((note, i) => (
                    <div key={i} className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-slate-100">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] sm:text-xs font-bold text-navy">{note.by}</span>
                        <span className="text-[8px] sm:text-[10px] text-slate-400">{note.time}</span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-600">{note.text}</p>
                      {note.attachment && (
                        <a href={note.attachment} target="_blank" rel="noreferrer" className="mt-1.5 sm:mt-2 inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-primary hover:underline">
                          <IconRenderer name="download" className="w-3 h-3" />
                          {note.attachmentName || 'Attachment'}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 text-xs sm:text-sm italic">
                  No notes yet
                </div>
              )}
            </div>
          </div>

          {/* Add Note & Update Section - Restricted to Admin/Operator */}
          {isStaff && (
            <div className="space-y-3 sm:space-y-4 pt-4 border-t border-slate-100">
              <h4 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <IconRenderer name="user-pen" className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                Admin/Operator Controls
              </h4>
              <div className="space-y-3 sm:space-y-4">
                <textarea 
                  placeholder="Add a note or reason for the user..."
                  className="w-full p-3 sm:p-4 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all min-h-[80px] sm:min-h-[100px] text-xs sm:text-sm"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                />
                
                <div className="p-3 sm:p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-1.5 sm:space-y-2">
                  <label className="text-[10px] sm:text-xs font-bold text-navy">Update Status (Optional):</label>
                  <select 
                    className="w-full p-2 sm:p-3 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm outline-none"
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value)}
                  >
                    <option value="">No Status Change</option>
                    <option value="processing">Processing</option>
                    <option value="clarification">Clarification</option>
                    <option value="completed">Completed</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-4 sm:p-6 border-2 border-dashed border-orange-200 rounded-xl bg-orange-50/30 flex flex-col items-center justify-center gap-1.5 sm:gap-2 cursor-pointer hover:bg-orange-50 transition-all"
                >
                  <IconRenderer name="upload" className="w-5 h-5 sm:w-6 sm:h-6 text-navy" />
                  <span className="text-[10px] sm:text-xs font-medium text-slate-600 text-center">
                    {noteFile ? noteFile.name : 'Click to upload attachment'}
                  </span>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    className="hidden"
                    onChange={e => e.target.files && setNoteFile(e.target.files[0])}
                  />
                </div>

                <button 
                  onClick={handleAddNote}
                  disabled={loading}
                  className="w-full py-2.5 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 text-sm sm:text-base"
                >
                  {loading ? 'Processing...' : 'Add Note & Update'}
                </button>
              </div>
            </div>
          )}

          {/* Admin Specific Controls */}
          {isAdmin && (
            <div className="space-y-4 sm:space-y-6 pt-4 border-t border-slate-100">
              <div className="space-y-1.5 sm:space-y-2">
                <label className="text-xs sm:text-sm font-bold text-navy">Assign to Operator:</label>
                <select 
                  className="w-full p-2.5 sm:p-3 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm outline-none"
                  value={app.assignedTo || ''}
                  onChange={(e) => handleAssign(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {operators.map(op => (
                    <option key={op.uid} value={op.email}>{op.name} ({op.email})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 sm:space-y-3">
                <h4 className="text-xs sm:text-sm font-bold text-navy">Update Payment Status:</h4>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <button 
                    onClick={() => handleUpdatePaymentStatus('completed')}
                    className="py-2.5 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm"
                  >
                    <IconRenderer name="check" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Mark Paid
                  </button>
                  <button 
                    onClick={() => handleUpdatePaymentStatus('pending')}
                    className="py-2.5 sm:py-3 border-2 border-navy text-navy font-bold rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm"
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
                    className="py-2 sm:py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all text-[10px] sm:text-sm"
                  >
                    Processing
                  </button>
                  <button 
                    onClick={() => handleUpdateStatusDirect('clarification')}
                    className="py-2 sm:py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-all text-[10px] sm:text-sm"
                  >
                    Clarification
                  </button>
                  <button 
                    onClick={() => handleUpdateStatusDirect('completed')}
                    className="py-2 sm:py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-all text-[10px] sm:text-sm"
                  >
                    Completed
                  </button>
                  <button 
                    onClick={() => handleUpdateStatusDirect('rejected')}
                    className="py-2 sm:py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all text-[10px] sm:text-sm"
                  >
                    Rejected
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Debug Role Indicator - Subtle */}
        <div className="p-2 bg-slate-50 border-t border-slate-100 text-[8px] text-slate-300 text-right uppercase tracking-widest">
          View Mode: {currentUser.role}
        </div>
      </motion.div>
    </div>
  );
}
