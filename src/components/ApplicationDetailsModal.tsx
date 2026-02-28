import { useState } from 'react';
import { Application, UserProfile, ApplicationNote } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { rtdb, storage } from '../firebase';
import { ref as dbRef, update } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { motion, AnimatePresence } from 'motion/react';
import { sendEmail, emailTemplates } from '../services/emailService';

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

  if (!app) return null;

  const isAdmin = currentUser.role === 'admin';
  const isOperator = currentUser.role === 'operator';
  const isOwner = currentUser.uid === app.uid;

  const handleAddNote = async () => {
    if (!noteText && !newStatus && !noteFile) return;

    setLoading(true);
    try {
      let attachmentUrl = '';
      if (noteFile) {
        const sRef = storageRef(storage, `notes/${app.id}/${Date.now()}_${noteFile.name}`);
        const snapshot = await uploadBytes(sRef, noteFile);
        attachmentUrl = await getDownloadURL(snapshot.ref);
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

      // Send Status Update or Note Email to User
      if (newStatus) {
        sendEmail(app.email, `Status Update: ${app.serviceName}`, emailTemplates.statusUpdate(app.name, app.serviceName, newStatus));
        
        // Notify Admin and Operator
        const adminEmail = 'icc@indiacybercafe.com';
        const operatorEmail = app.assignedTo;
        
        if (isOperator) {
          sendEmail(adminEmail, `Operator Status Update: ${app.serviceName}`, `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #FF9933;">Operator Status Update</h2>
              <p>Admin,</p>
              <p>Operator <strong>${currentUser.name}</strong> updated the status of application <strong>${app.id}</strong> to: <strong>${newStatus}</strong>.</p>
              <br/>
              <p>Best Regards,<br/>India Cyber Cafe System</p>
            </div>
          `);
        } else if (isAdmin && operatorEmail) {
          sendEmail(operatorEmail, `Admin Status Update: ${app.serviceName}`, `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #FF9933;">Admin Status Update</h2>
              <p>Hello,</p>
              <p>Admin updated the status of application <strong>${app.id}</strong> assigned to you to: <strong>${newStatus}</strong>.</p>
              <br/>
              <p>Best Regards,<br/>India Cyber Cafe System</p>
            </div>
          `);
        }

        // Special case: Pay After Work
        if (newStatus === 'completed' && app.paymentMethod === 'pay_after_work' && app.paymentStatus === 'pending') {
          sendEmail(app.email, `Payment Required: ${app.serviceName}`, `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #FF9933;">Application Completed - Payment Required</h2>
              <p>Hello <strong>${app.name}</strong>,</p>
              <p>Your application for <strong>${app.serviceName}</strong> has been completed successfully.</p>
              <p>Please log in to your dashboard to make the payment of <strong>₹${app.charge}</strong> to download your documents.</p>
              <br/>
              <p>Best Regards,<br/>India Cyber Cafe Team</p>
            </div>
          `);
        }
      } else if (noteText) {
        sendEmail(app.email, `New Update: ${app.serviceName}`, emailTemplates.noteAdded(app.name, app.serviceName, noteText));
        
        // Notify Admin and Operator
        const adminEmail = 'icc@indiacybercafe.com';
        const operatorEmail = app.assignedTo;
        
        if (isOperator) {
          sendEmail(adminEmail, `Operator Note Added: ${app.serviceName}`, `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #FF9933;">Operator Note Added</h2>
              <p>Admin,</p>
              <p>Operator <strong>${currentUser.name}</strong> added a note to application <strong>${app.id}</strong>:</p>
              <p><em>${noteText}</em></p>
              <br/>
              <p>Best Regards,<br/>India Cyber Cafe System</p>
            </div>
          `);
        } else if (isAdmin && operatorEmail) {
          sendEmail(operatorEmail, `Admin Note Added: ${app.serviceName}`, `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #FF9933;">Admin Note Added</h2>
              <p>Hello,</p>
              <p>Admin added a note to application <strong>${app.id}</strong> assigned to you:</p>
              <p><em>${noteText}</em></p>
              <br/>
              <p>Best Regards,<br/>India Cyber Cafe System</p>
            </div>
          `);
        }
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
      
      // Send Assignment Email
      if (operatorEmail) {
        const operator = operators.find(op => op.email === operatorEmail);
        // Notify Operator
        sendEmail(operatorEmail, `New Assignment: ${app.serviceName}`, emailTemplates.operatorNewAssignment(operator?.name || 'Operator', app.name, app.serviceName, app.id));
        // Notify User
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
        className="bg-white rounded-3xl w-full max-w-3xl relative overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="p-6 bg-linear-to-r from-navy to-navy-light text-white flex justify-between items-center">
          <h3 className="text-xl font-bold">Application Details</h3>
          <button onClick={onClose} className="hover:rotate-90 transition-all">
            <IconRenderer name="x" className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Application ID</label>
              <p className="font-bold text-navy">{app.id}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Service</label>
              <p className="font-bold text-navy">{app.serviceName}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Status</label>
              <div><span className={`badge ${getStatusBadge(app.status)}`}>{app.status}</span></div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Date Submitted</label>
              <p className="font-bold text-navy">{new Date(app.date).toLocaleString()}</p>
            </div>
          </div>

          {/* Form Details */}
          <div className="space-y-4">
            <h4 className="font-bold text-navy border-b-2 border-primary w-fit pb-1">Submitted Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(app.details).map(([key, value]) => (
                <div key={key} className="p-4 bg-white border border-slate-100 rounded-xl shadow-sm">
                  <label className="text-xs font-bold text-slate-400 uppercase">{key}</label>
                  {typeof value === 'string' && value.startsWith('http') ? (
                    <a href={value} target="_blank" rel="noreferrer" className="block mt-1 text-primary font-bold hover:underline flex items-center gap-2">
                      <IconRenderer name="download" className="w-4 h-4" />
                      View Attachment
                    </a>
                  ) : (
                    <p className="font-medium text-slate-700 mt-1">{String(value)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Admin Controls */}
          {isAdmin && (
            <div className="p-6 bg-primary/5 rounded-2xl border border-primary/20 space-y-4">
              <h4 className="font-bold text-navy">Admin Controls</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-500">Assign Operator</label>
                  <select 
                    className="input-field py-2"
                    value={app.assignedTo || ''}
                    onChange={(e) => handleAssign(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {operators.map(op => (
                      <option key={op.uid} value={op.email}>{op.name} ({op.email})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Notes & History */}
          <div className="space-y-6">
            <h4 className="font-bold text-navy border-b-2 border-primary w-fit pb-1">History & Notes</h4>
            <div className="space-y-4">
              {app.notes?.map((note, i) => (
                <div key={i} className={`p-4 rounded-2xl border-l-4 shadow-sm ${
                  note.type === 'status' ? 'bg-blue-50 border-l-blue-500' : 'bg-white border-l-primary'
                }`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-bold text-navy text-sm">{note.by}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase">{note.time}</span>
                  </div>
                  <p className="text-slate-600 text-sm leading-relaxed">{note.text}</p>
                  {note.attachment && (
                    <a href={note.attachment} download={note.attachmentName} className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline">
                      <IconRenderer name="download" className="w-3 h-3" />
                      {note.attachmentName}
                    </a>
                  )}
                </div>
              ))}
              {(!app.notes || app.notes.length === 0) && (
                <p className="text-center text-slate-400 text-sm italic">No history available yet.</p>
              )}
            </div>
          </div>

          {/* Add Note Section */}
          {(isAdmin || isOperator) && (
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
              <h4 className="font-bold text-navy">Add Update</h4>
              <textarea 
                placeholder="Add a note or reason..."
                className="input-field min-h-[80px]"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Update Status</label>
                  <select 
                    className="input-field py-2"
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value)}
                  >
                    <option value="">No Status Change</option>
                    <option value="processing">↻ Processing</option>
                    <option value="clarification">ℹ Clarification Needed</option>
                    <option value="completed">✓ Completed</option>
                    <option value="rejected">✕ Rejected</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Attachment</label>
                  <input 
                    type="file" 
                    className="text-xs"
                    onChange={e => e.target.files && setNoteFile(e.target.files[0])}
                  />
                </div>
              </div>
              <button 
                onClick={handleAddNote}
                disabled={loading}
                className="btn-primary w-full py-3"
              >
                {loading ? 'Adding...' : 'Add Note & Update'}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
