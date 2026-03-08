import { useState } from 'react';
import { Order, UserProfile, ApplicationNote } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { rtdb } from '../firebase';
import { ref as dbRef, update } from 'firebase/database';
import { motion } from 'motion/react';

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
  const [loading, setLoading] = useState(false);

  if (!order) return null;

  const isAdmin = currentUser?.role === 'admin';

  const handleAddNote = async () => {
    if (!noteText.trim()) {
      showToast('Please enter a note', 'error');
      return;
    }

    if (!currentUser) {
      showToast('You must be logged in', 'error');
      return;
    }

    setLoading(true);
    try {
      const newNote: ApplicationNote = {
        type: 'note',
        by: currentUser.name,
        email: currentUser.email,
        text: noteText,
        time: new Date().toLocaleString()
      };

      const updatedNotes = [...(order.notes || []), newNote];
      await update(dbRef(rtdb, `orders/${order.id}`), {
        notes: updatedNotes,
        updatedAt: new Date().toISOString()
      });

      showToast('Note added successfully');
      setNoteText('');
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!newStatus) {
      showToast('Please select a status', 'error');
      return;
    }

    setLoading(true);
    try {
      await update(dbRef(rtdb, `orders/${order.id}`), {
        orderStatus: newStatus,
        updatedAt: new Date().toISOString()
      });

      showToast(`Order status updated to ${newStatus}`);
      setNewStatus('');
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePaymentStatus = async () => {
    if (!newPaymentStatus) {
      showToast('Please select a payment status', 'error');
      return;
    }

    setLoading(true);
    try {
      await update(dbRef(rtdb, `orders/${order.id}`), {
        paymentStatus: newPaymentStatus,
        updatedAt: new Date().toISOString()
      });

      showToast(`Payment status updated to ${newPaymentStatus}`);
      setNewPaymentStatus('');
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
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
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
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
                <p className="font-bold text-slate-900">{order.deliveryAddress.name}</p>
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
                {order.items.map((item, idx) => (
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

            {/* Delivery Address */}
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="font-bold text-slate-900 mb-3">Delivery Address</p>
              <div className="text-sm text-slate-700 space-y-1">
                <p>{order.deliveryAddress.addressLine1}</p>
                {order.deliveryAddress.addressLine2 && <p>{order.deliveryAddress.addressLine2}</p>}
                <p>{order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.pincode}</p>
                <p>{order.deliveryAddress.country}</p>
                <p className="mt-2 text-xs">Phone: {order.deliveryAddress.phone}</p>
              </div>
            </div>

            {/* Admin Controls */}
            {isAdmin && (
              <div className="space-y-4 border-t pt-4">
                <p className="font-bold text-slate-900">Admin Controls</p>

                {/* Update Order Status */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Update Order Status</label>
                  <div className="flex gap-2">
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none"
                    >
                      <option value="">Select Status</option>
                      {ORDER_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status.toUpperCase()}
                        </option>
                      ))}
                    </select>
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
                    <select
                      value={newPaymentStatus}
                      onChange={(e) => setNewPaymentStatus(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none"
                    >
                      <option value="">Select Status</option>
                      {PAYMENT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status.toUpperCase()}
                        </option>
                      ))}
                    </select>
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
            {order.notes && order.notes.length > 0 && (
              <div className="border-t pt-4">
                <p className="font-bold text-slate-900 mb-4">Notes & Updates</p>
                <div className="space-y-3">
                  {order.notes.map((note, idx) => (
                    <div key={idx} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <p className="font-bold text-sm text-slate-900">{note.by}</p>
                        <p className="text-xs text-slate-500">{note.time}</p>
                      </div>
                      <p className="text-slate-700 text-sm">{note.text}</p>
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
