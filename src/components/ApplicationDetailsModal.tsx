import { useState, useRef } from 'react';
import { Application, UserProfile, ApplicationNote } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { rtdb } from '../firebase';
import { ref as dbRef, update } from 'firebase/database';
import { motion, AnimatePresence } from 'motion/react';
import { sendEmail, emailTemplates } from '../services/emailService';
import { uploadFile } from '../services/uploadService';

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

  const isAdmin = currentUser.role === 'admin';
  const isOperator = currentUser.role === 'operator';

  const handleUpdatePaymentStatus = async (status: 'pending' | 'completed') => {
    setLoading(true);
    try {
      await update(dbRef(rtdb, `applications/${app.id}`), { paymentStatus: status });
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

      sendEmail(app.email, `Status Update: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, status));
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
        attachmentUrl = await uploadFile(noteFile);
      }

      const newNote: ApplicationNote = {
        type: newStatus ? 'status' : 'note',
        by: currentUser.name,
        email: currentUser.email,
        text: noteText || (newStatus ? `Status updated to ${newStatus}` : ''),
        time: new Date().toLocaleString(),
        status: newStatus || undefined,
        attachment: attachmentUrl || undefined,
        attachmentName: noteFile?.name || undefined
      };

      const updatedNotes = [...(app.notes || []), newNote];
      const updates: any = { notes: updatedNotes };
      if (newStatus) updates.status = newStatus;

      await update(dbRef(rtdb, `applications/${app.id}`), updates);

      // Email logic
      if (newStatus) {
        sendEmail(app.email, `Status Update: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, newStatus));
      } else if (noteText) {
        sendEmail(app.email, `New Update: ${app.serviceName}`, emailTemplates.noteAdded(app.name, app.serviceName, noteText));
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
        sendEmail(operatorEmail, `New Assignment: ${app.serviceName}`, emailTemplates.operatorNewAssignment(operator?.name || 'Operator', app.name, app.serviceName, app.id));
        sendEmail(app.email, `Operator Assigned: ${app.serviceName}`, emailTemplates.operatorAssigned(app.name, app.serviceName));
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-2xl relative overflow-hidden shadow-2xl flex flex-col max-h-[95vh]"
      >
        <div className="p-6 bg-white border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-2xl font-bold text-navy">Application Details</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-all">
            <IconRenderer name="x" className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main Info Section */}
          <div className="space-y-3 pb-4 border-b border-slate-100">
            <div className="flex gap-2">
              <span className="text-navy font-bold min-w-[140px]">User:</span>
              <span className="text-slate-600">{app.name}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-navy font-bold min-w-[140px]">Sub-Service:</span>
              <span className="text-slate-600">{app.subserviceName || app.serviceName}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-navy font-bold min-w-[140px]">Charge:</span>
              <span className="text-slate-600">₹{app.charge}</span>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-navy font-bold min-w-[140px]">Application Status:</span>
              <span className={`px-3 py-1 rounded-lg text-[10px] font-bold text-white uppercase tracking-wider ${getStatusBadge(app.status)}`}>
                {app.status}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-navy font-bold min-w-[140px]">Payment Method:</span>
              <span className="text-slate-600 capitalize">{app.paymentMethod?.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-navy font-bold min-w-[140px]">Payment Status:</span>
              <span className={`px-3 py-1 rounded-lg text-[10px] font-bold text-white uppercase tracking-wider ${app.paymentStatus === 'completed' ? 'bg-green-500' : 'bg-orange-500'}`}>
                {app.paymentStatus || 'pending'}
              </span>
            </div>
            {Object.entries(app.details).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="text-navy font-bold min-w-[140px] capitalize">{key}:</span>
                <span className="text-slate-600">{String(value)}</span>
              </div>
            ))}
          </div>

          {/* Download Section */}
          <div className="pt-2">
            <button className="w-full py-3 px-6 border-2 border-navy text-navy font-bold rounded-xl hover:bg-navy hover:text-white transition-all flex items-center justify-center gap-2">
              <IconRenderer name="download" className="w-5 h-5" />
              Download File
            </button>
          </div>

          {/* Notes & History */}
          <div className="space-y-4">
            <h4 className="text-lg font-bold text-navy">Notes & History</h4>
            <div className="bg-slate-50 rounded-2xl p-6 min-h-[100px] border border-slate-100">
              {app.notes && app.notes.length > 0 ? (
                <div className="space-y-4">
                  {app.notes.map((note, i) => (
                    <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xs font-bold text-navy">{note.by}</span>
                        <span className="text-[10px] text-slate-400">{note.time}</span>
                      </div>
                      <p className="text-sm text-slate-600">{note.text}</p>
                      {note.attachment && (
                        <a href={note.attachment} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:underline">
                          <IconRenderer name="download" className="w-3 h-3" />
                          {note.attachmentName || 'Attachment'}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 text-sm italic">
                  No notes yet
                </div>
              )}
            </div>
          </div>

          {/* Add Note & Update Section */}
          <div className="space-y-4">
            <h4 className="text-lg font-bold text-navy">Add Note & Update Status</h4>
            <div className="space-y-4">
              <textarea 
                placeholder="Add a note or reason..."
                className="w-full p-4 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all min-h-[100px] text-sm"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
              />
              
              <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-2">
                <label className="text-xs font-bold text-navy">Update Status (Optional):</label>
                <select 
                  className="w-full p-3 rounded-lg border border-slate-200 bg-white text-sm outline-none"
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
                className="p-6 border-2 border-dashed border-orange-200 rounded-xl bg-orange-50/30 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-orange-50 transition-all"
              >
                <IconRenderer name="upload" className="w-6 h-6 text-navy" />
                <span className="text-xs font-medium text-slate-600">
                  {noteFile ? noteFile.name : 'Click to upload attachment or drag & drop'}
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
                className="w-full py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20"
              >
                {loading ? 'Processing...' : 'Add Note & Update'}
              </button>
            </div>
          </div>

          {/* Admin Specific Controls */}
          {isAdmin && (
            <div className="space-y-6 pt-4 border-t border-slate-100">
              <div className="space-y-2">
                <label className="text-sm font-bold text-navy">Assign to Operator:</label>
                <select 
                  className="w-full p-3 rounded-xl border border-slate-200 bg-white text-sm outline-none"
                  value={app.assignedTo || ''}
                  onChange={(e) => handleAssign(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {operators.map(op => (
                    <option key={op.uid} value={op.email}>{op.name} ({op.email})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-navy">Update Payment Status:</h4>
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => handleUpdatePaymentStatus('completed')}
                    className="py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <IconRenderer name="check" className="w-4 h-4" />
                    Mark as Paid
                  </button>
                  <button 
                    onClick={() => handleUpdatePaymentStatus('pending')}
                    className="py-3 border-2 border-navy text-navy font-bold rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <IconRenderer name="clock" className="w-4 h-4" />
                    Mark as Pending
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-navy">Update Status:</h4>
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => handleUpdateStatusDirect('processing')}
                    className="py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all text-sm"
                  >
                    Processing
                  </button>
                  <button 
                    onClick={() => handleUpdateStatusDirect('clarification')}
                    className="py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-all text-sm"
                  >
                    Clarification
                  </button>
                  <button 
                    onClick={() => handleUpdateStatusDirect('completed')}
                    className="py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-all text-sm"
                  >
                    Completed
                  </button>
                  <button 
                    onClick={() => handleUpdateStatusDirect('rejected')}
                    className="py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all text-sm"
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
