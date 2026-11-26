import { useState } from 'react';
import { Order, UserProfile } from '../types';
import { IconRenderer } from './Icons';
import { SelectDropdown } from './SelectDropdown';
import { showToast } from './Toast';
import { motion } from 'motion/react';
import { isAdminUser, normalizeApplicationNotes } from '../utils/permissions';
import { addOrderNoteApi, updateAdminOrderStatusApi } from '../services/emailService';
import { useSubmissionLifecycle } from '../hooks/useSubmissionLifecycle';
import { downloadProtectedDigitalFile } from '../utils/digitalDownload';
import { getDigitalFileTypeHint } from '../server/digitalFilePolicy';

interface OrderDetailModalProps {
  order: Order | null;
  onClose: () => void;
  currentUser: UserProfile | null;
}

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
const PAYMENT_STATUSES = ['pending', 'completed', 'failed'] as const;

export function OrderDetailModal({ order, onClose, currentUser }: OrderDetailModalProps) {
  const [noteText, setNoteText] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newPaymentStatus, setNewPaymentStatus] = useState('');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const { isSubmitting: loading, submittingRef, runSubmission } = useSubmissionLifecycle();

  if (!order) return null;

  const isAdmin = isAdminUser(currentUser);

  const handleDigitalDownload = async (downloadUrl: string, fileName: string, key: string) => {
    if (downloadingKey) return;
    setDownloadingKey(key);
    try {
      const result = await downloadProtectedDigitalFile(downloadUrl, fileName);
      if (result.ok) {
        showToast('Download started!', 'success');
      } else {
        showToast(result.error || 'Could not download this file.', 'error');
      }
    } catch {
      showToast('Network error while downloading. Please try again.', 'error');
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleAddNote = async () => {
    if (submittingRef.current) return;
    if (!noteText.trim()) {
      showToast('Please enter a note', 'error');
      return;
    }

    if (!currentUser) {
      showToast('You must be logged in', 'error');
      return;
    }

    try {
      await runSubmission(async ({ idempotencyKey, signal }) => {
        await addOrderNoteApi(
          order.id,
          { text: noteText.trim(), clientRequestId: idempotencyKey },
          { signal }
        );
        showToast('Note added successfully');
        setNoteText('');
      });
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showToast(error, 'error', 'Failed to add note. Please try again.');
      }
    }
  };

  const handleUpdateStatus = async () => {
    if (submittingRef.current) return;
    if (!newStatus) {
      showToast('Please select a status', 'error');
      return;
    }

    try {
      await runSubmission(async () => {
        await updateAdminOrderStatusApi(order.id, { orderStatus: newStatus });
        showToast(`Order status updated to ${newStatus}`);
        setNewStatus('');
      });
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showToast(error, 'error', 'Failed to update order status. Please try again.');
      }
    }
  };

  const handleUpdatePaymentStatus = async () => {
    if (submittingRef.current) return;
    if (!newPaymentStatus) {
      showToast('Please select a payment status', 'error');
      return;
    }

    try {
      await runSubmission(async () => {
        await updateAdminOrderStatusApi(order.id, { paymentStatus: newPaymentStatus });
        showToast(`Payment status updated to ${newPaymentStatus}`);
        setNewPaymentStatus('');
      });
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showToast(error, 'error', 'Failed to update payment status. Please try again.');
      }
    }
  };

  const getStatusBadgeColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      shipped: 'bg-purple-100 text-purple-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    };
    return colors[status] || 'bg-slate-100 text-slate-800';
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-navy to-blue-700 text-white px-4 sm:px-6 py-4 sm:py-6 flex justify-between items-center z-10 flex-shrink-0">
          <div>
            <h2 className="text-lg sm:text-2xl font-bold">Order Details</h2>
            <p className="text-sm text-blue-100 mt-1">{order.id}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-all flex-shrink-0">
            <IconRenderer name="x" className="w-5 sm:w-6 h-5 sm:h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-6">
            {/* Order Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl">
                <p className="text-xs text-slate-500 font-bold mb-1">Customer</p>
                <p className="font-bold text-slate-900">{order.deliveryAddress?.name || 'Customer'}</p>
                <p className="text-sm text-slate-600">{order.email}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl">
                <p className="text-xs text-slate-500 font-bold mb-1">Total Amount</p>
                <p className="font-bold text-xl text-navy">₹{order.total}</p>
              </div>
            </div>

            {/* Order Status */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-slate-700 mb-2">Order Status</p>
                <div className={`inline-block px-4 py-2 rounded-full text-sm font-bold ${getStatusBadgeColor(order.orderStatus)}`}>
                  {order.orderStatus?.toUpperCase()}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700 mb-2">Payment Status</p>
                <div className={`inline-block px-4 py-2 rounded-full text-sm font-bold ${getStatusBadgeColor(order.paymentStatus)}`}>
                  {order.paymentStatus?.toUpperCase()}
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="font-bold text-slate-900 mb-4">Items</p>
              <div className="space-y-3">
                {(Array.isArray(order.items) ? order.items : Object.values(order.items || {})).map((item: any, idx: number) => (
                  <div key={idx} className="bg-white p-3 rounded-lg border border-slate-200">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 text-sm">{item.productName}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          Qty: {item.quantity} × ₹{item.discountedPrice || item.price}
                        </p>
                        {item.specialInstructions && (
                          <p className="text-xs text-slate-600 mt-2 italic">"{item.specialInstructions}"</p>
                        )}
                        {item.customImageUrl && (
                          <img src={item.customImageUrl} alt="Custom" className="w-20 h-20 rounded-lg mt-2 object-cover" />
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-slate-900">₹{(item.discountedPrice || item.price) * item.quantity}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {order.paymentStatus === 'completed' && order.digitalDownloads?.length ? (
              <div className="space-y-3 rounded-xl border border-green-200 bg-green-50 p-4">
                <div>
                  <p className="font-bold text-green-900">Digital downloads</p>
                  <p className="text-xs text-green-800">Secure buyer-only downloads for this paid order</p>
                </div>
                {order.digitalDownloads.map((group, groupIndex) => (
                  <div key={`${group.productName}-${groupIndex}`} className="space-y-2">
                    <p className="text-sm font-semibold text-navy">{group.productName}</p>
                    {group.resources.map((resource, resourceIndex) => {
                      const key = `${groupIndex}-${resourceIndex}`;
                      const isDownloading = downloadingKey === key;
                      const fileHint = getDigitalFileTypeHint(resource.fileName);
                      return (
                        <div key={`${resource.fileName}-${resourceIndex}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider shrink-0 ${fileHint.badgeClass}`}>
                              {fileHint.badge}
                            </span>
                            <span className="min-w-0 break-all text-sm text-slate-700">{resource.fileName}</span>
                          </div>
                          <button
                            type="button"
                            disabled={Boolean(downloadingKey)}
                            onClick={() => handleDigitalDownload(resource.downloadUrl, resource.fileName, key)}
                            className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-60 shrink-0"
                          >
                            {isDownloading ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            ) : (
                              <IconRenderer name="download" className="h-4 w-4" />
                            )}
                            {isDownloading ? 'Starting...' : resource.label || 'Download Now'}
                          </button>
                          {resource.expiresAt && <span className="w-full text-xs text-slate-500">Expires {new Date(resource.expiresAt).toLocaleString('en-IN')}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}

            {/* Delivery Address / Contact Details */}
            {order.deliveryAddress && (
              <div className="bg-slate-50 rounded-xl p-4">
                {order.deliveryAddress.addressLine1 || order.deliveryAddress.city || order.deliveryAddress.state || order.deliveryAddress.pincode ? (
                  <>
                    <p className="font-bold text-slate-900 mb-3">Delivery Address</p>
                    <div className="text-sm text-slate-700 space-y-1">
                      {order.deliveryAddress.addressLine1 && <p>{order.deliveryAddress.addressLine1}</p>}
                      {order.deliveryAddress.addressLine2 && <p>{order.deliveryAddress.addressLine2}</p>}
                      <p>
                        {[order.deliveryAddress.city, order.deliveryAddress.state].filter(Boolean).join(', ')}
                        {order.deliveryAddress.pincode ? ` ${order.deliveryAddress.pincode}` : ''}
                      </p>
                      {order.deliveryAddress.country && <p>{order.deliveryAddress.country}</p>}
                      {order.deliveryAddress.phone && <p className="mt-2 text-xs">Phone: {order.deliveryAddress.phone}</p>}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-slate-900 mb-2">Digital Delivery</p>
                    <div className="text-sm text-slate-700 space-y-1">
                      {order.deliveryAddress.name && <p className="font-semibold text-navy">{order.deliveryAddress.name}</p>}
                      {order.deliveryAddress.email && <p>Email: {order.deliveryAddress.email}</p>}
                      {order.deliveryAddress.phone && <p className="text-xs">Phone: {order.deliveryAddress.phone}</p>}
                      <p className="text-xs text-green-700 pt-1">Instant digital download — no shipping address required</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Admin Controls */}
            {isAdmin && (
              <div className="space-y-4 border-t pt-4">
                <p className="font-bold text-slate-900">Admin Controls</p>

                {/* Update Order Status */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Update Order Status</label>
                  <div className="flex gap-2">
                    <SelectDropdown
                      value={newStatus}
                      onChange={setNewStatus}
                      containerClassName="flex-1"
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none"
                      options={[
                        { value: '', label: 'Select Status' },
                        ...ORDER_STATUSES.map(status => ({ value: status, label: status.toUpperCase() })),
                      ]}
                    />
                    <button
                      onClick={handleUpdateStatus}
                      disabled={loading || !newStatus}
                      className="px-4 py-2 rounded-lg bg-navy text-white font-bold hover:bg-navy-dark disabled:opacity-50 transition-all text-sm"
                    >
                      Update
                    </button>
                  </div>
                </div>

                {/* Update Payment Status */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Update Payment Status</label>
                  <div className="flex gap-2">
                    <SelectDropdown
                      value={newPaymentStatus}
                      onChange={setNewPaymentStatus}
                      containerClassName="flex-1"
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none"
                      options={[
                        { value: '', label: 'Select Status' },
                        ...PAYMENT_STATUSES.map(status => ({ value: status, label: status.toUpperCase() })),
                      ]}
                    />
                    <button
                      onClick={handleUpdatePaymentStatus}
                      disabled={loading || !newPaymentStatus}
                      className="px-4 py-2 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 transition-all text-sm"
                    >
                      Update
                    </button>
                  </div>
                </div>

                {/* Add Note */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Add Note</label>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a note..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none resize-none text-sm"
                    rows={3}
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={loading || !noteText.trim()}
                    className="mt-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50 transition-all text-sm"
                  >
                    Add Note
                  </button>
                </div>
              </div>
            )}

            {/* Notes Timeline */}
            {normalizeApplicationNotes(order.notes).length > 0 && (
              <div className="border-t pt-4">
                <p className="font-bold text-slate-900 mb-4">Notes & Updates</p>
                <div className="space-y-3">
                  {normalizeApplicationNotes(order.notes).map((note: any, idx: number) => (
                    <div key={idx} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <p className="font-bold text-sm text-slate-900">{note.by}</p>
                        <p className="text-xs text-slate-500">{note.time}</p>
                      </div>
                      <p className="text-slate-700 text-sm">{note.text}</p>
                      {(note as any).attachment && (
                        <a 
                          href={(note as any).attachment} 
                          target="_blank" 
                          rel="noreferrer" 
                          download={(note as any).attachmentName || 'download'}
                          className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-2 rounded-lg hover:underline transition-all border border-blue-200"
                        >
                          <IconRenderer name="download" className="w-4 h-4" />
                          📎 {(note as any).attachmentName || 'Download Attachment'}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
