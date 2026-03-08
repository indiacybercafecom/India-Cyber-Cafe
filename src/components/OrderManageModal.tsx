import { useState } from 'react';
import { Order, UserProfile } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { rtdb } from '../firebase';
import { ref as dbRef, update, remove } from 'firebase/database';
import { motion } from 'motion/react';
import { sendOrderStatusUpdateEmail, sendOrderCancellationEmail, sendAdminOrderNotification } from '../services/emailService';

interface OrderManageModalProps {
  order: Order | null;
  onClose: () => void;
  currentUser: UserProfile | null;
  onUpdateOrder?: (id: string, data: Partial<Order>) => Promise<void>;
  onDeleteOrder?: (id: string) => Promise<void>;
}

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
const PAYMENT_STATUSES = ['pending', 'completed', 'failed'] as const;

export function OrderManageModal({ 
  order, 
  onClose, 
  currentUser,
  onUpdateOrder,
  onDeleteOrder 
}: OrderManageModalProps) {
  const [newOrderStatus, setNewOrderStatus] = useState(order?.orderStatus || 'pending');
  const [newPaymentStatus, setNewPaymentStatus] = useState(order?.paymentStatus || 'pending');
  const [noteText, setNoteText] = useState('');
  const [loading, setLoading] = useState(false);

  if (!order) return null;

  const items = Array.isArray(order.items) ? order.items : [];
  const deliveryAddress = order.deliveryAddress || {};
  const total = order.total || 0;
  const subtotal = order.subtotal || 0;
  const deliveryCharges = order.deliveryCharges || 0;
  const discount = order.discount || 0;
  const notes = Array.isArray(order.notes) ? order.notes : [];

  const handleStatusUpdate = async () => {
    if (!order.id) return;
    
    setLoading(true);
    try {
      const updateData: Partial<Order> = {};
      let statusChanged = false;
      
      if (newOrderStatus !== order.orderStatus) {
        updateData.orderStatus = newOrderStatus as any;
        statusChanged = true;
      }
      if (newPaymentStatus !== order.paymentStatus) {
        updateData.paymentStatus = newPaymentStatus as any;
      }

      if (Object.keys(updateData).length > 0) {
        if (onUpdateOrder) {
          await onUpdateOrder(order.id, updateData);
        }

        // Send email notifications for status changes
        if (statusChanged && order.email) {
          // Send customer notification
          if (newOrderStatus === 'cancelled') {
            // For cancellation, send cancellation email
            const productName = items[0]?.productName || 'Your Product';
            await sendOrderCancellationEmail(
              order.email,
              order.deliveryAddress?.name || 'Valued Customer',
              order.id,
              productName,
              order.total || 0
            ).catch(err => console.error('Cancellation email error:', err));

            // Send admin notification about cancellation
            await sendAdminOrderNotification(
              order.id,
              order.deliveryAddress?.name || 'Guest',
              order.email,
              order.deliveryAddress?.phone || 'N/A',
              items.map(item => ({
                name: item.productName || 'Product',
                quantity: item.quantity,
                price: item.discountedPrice || item.price
              })),
              order.total || 0,
              'cod',
              {
                addressLine1: order.deliveryAddress?.addressLine1 || 'N/A',
                city: order.deliveryAddress?.city || 'N/A',
                state: order.deliveryAddress?.state || 'N/A',
                pincode: order.deliveryAddress?.pincode || 'N/A'
              }
            ).catch(err => console.error('Admin email error:', err));
          } else {
            // For other status changes, send status update email
            const productName = items[0]?.productName || 'Your Product';
            let estimatedDelivery = '';
            if (newOrderStatus === 'shipped') {
              const deliveryDate = new Date();
              deliveryDate.setDate(deliveryDate.getDate() + 3);
              estimatedDelivery = deliveryDate.toLocaleDateString();
            }

            await sendOrderStatusUpdateEmail(
              order.email,
              order.deliveryAddress?.name || 'Valued Customer',
              order.id,
              newOrderStatus,
              productName,
              estimatedDelivery
            ).catch(err => console.error('Status email error:', err));
          }
        }

        showToast('Order updated successfully!', 'success');
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to update order', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) {
      showToast('Please enter a note', 'error');
      return;
    }

    if (!currentUser) {
      showToast('You must be logged in', 'error');
      return;
    }

    if (!order.id) return;

    setLoading(true);
    try {
      const newNote = {
        type: 'note' as const,
        by: currentUser.name,
        email: currentUser.email,
        text: noteText,
        time: new Date().toLocaleString()
      };

      const updatedNotes = [...notes, newNote];
      if (onUpdateOrder) {
        await onUpdateOrder(order.id, { notes: updatedNotes as any });
      }
      setNoteText('');
      showToast('Note added successfully!', 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to add note', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (!window.confirm('Are you sure you want to delete this order? This action cannot be undone.')) {
      return;
    }

    if (!order.id) return;

    setLoading(true);
    try {
      if (onDeleteOrder) {
        await onDeleteOrder(order.id);
      }
      showToast('Order deleted successfully!', 'success');
      onClose();
    } catch (error: any) {
      showToast(error.message || 'Failed to delete order', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div 
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-navy via-navy-dark to-navy text-white p-6 flex justify-between items-center border-b border-white/10">
          <div>
            <p className="text-sm font-bold opacity-90">Order ID</p>
            <h2 className="text-2xl font-bold">{order.id}</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-all"
          >
            <IconRenderer name="x" className="w-6 h-6" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1">
          <div className="p-8 space-y-8">
            {/* Customer Details */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-navy flex items-center gap-3">
                <div className="p-2 bg-navy/10 rounded-lg">
                  <IconRenderer name="user" className="w-5 h-5 text-navy" />
                </div>
                Customer Details
              </h3>
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-6 rounded-2xl border border-slate-200 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Name</p>
                    <p className="text-navy font-semibold text-lg">{deliveryAddress.name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Email</p>
                    <p className="text-navy font-semibold break-all">{order.email || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Phone</p>
                    <p className="text-navy font-semibold">{deliveryAddress.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">City</p>
                    <p className="text-navy font-semibold">{deliveryAddress.city || 'N/A'}</p>
                  </div>
                </div>
                <div className="border-t border-slate-300 pt-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Full Address</p>
                  <p className="text-navy font-semibold text-sm leading-relaxed">
                    {deliveryAddress.addressLine1 || 'N/A'}
                    {deliveryAddress.addressLine2 && `, ${deliveryAddress.addressLine2}`}
                    {deliveryAddress.state && `, ${deliveryAddress.state}`}
                    {deliveryAddress.pincode && ` - ${deliveryAddress.pincode}`}
                  </p>
                </div>
              </div>
            </div>

            {/* Order Items */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-navy flex items-center gap-3">
                <div className="p-2 bg-navy/10 rounded-lg">
                  <IconRenderer name="shopping-cart" className="w-5 h-5 text-navy" />
                </div>
                Order Items ({items.length})
              </h3>
              <div className="space-y-3">
                {items.length > 0 ? (
                  items.map((item, idx) => (
                    <div key={idx} className="bg-gradient-to-r from-slate-50 to-slate-100 p-5 rounded-2xl border border-slate-200 flex justify-between items-start hover:border-navy/50 transition-all">
                      <div className="flex-1">
                        <p className="font-bold text-navy text-base">{item.productName}</p>
                        <p className="text-sm text-slate-600 mt-1">Qty: <span className="font-semibold">{item.quantity}</span></p>
                        {item.specialInstructions && (
                          <p className="text-sm text-slate-600 mt-2 bg-white/60 p-2 rounded-lg">📝 {item.specialInstructions}</p>
                        )}
                      </div>
                      <div className="text-right ml-4">
                        <p className="font-bold text-navy text-lg">₹{item.price}</p>
                        {item.discountedPrice && item.discountedPrice > 0 && (
                          <p className="text-sm text-slate-500 line-through">₹{item.discountedPrice}</p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center text-slate-400 italic">No items in this order</div>
                )}
              </div>
            </div>

            {/* Order Summary */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-navy flex items-center gap-3">
                <div className="p-2 bg-navy/10 rounded-lg">
                  <IconRenderer name="calculator" className="w-5 h-5 text-navy" />
                </div>
                Order Summary
              </h3>
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-6 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-700 font-medium">Subtotal</span>
                  <span className="font-semibold text-navy text-lg">₹{subtotal}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-700 font-medium">Delivery Charges</span>
                  <span className="font-semibold text-navy text-lg">₹{deliveryCharges}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between items-center bg-green-50 p-3 rounded-lg border border-green-200">
                    <span className="text-green-700 font-medium">Discount</span>
                    <span className="font-semibold text-green-700 text-lg">-₹{discount}</span>
                  </div>
                )}
                <div className="border-t-2 border-slate-300 pt-3 flex justify-between items-center bg-navy/5 p-3 rounded-lg">
                  <span className="font-bold text-navy text-lg">Total Amount</span>
                  <span className="font-bold text-xl bg-gradient-to-r from-navy to-navy-dark bg-clip-text text-transparent">₹{total}</span>
                </div>
              </div>
            </div>

            {/* Status Management */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-navy flex items-center gap-3">
                <div className="p-2 bg-navy/10 rounded-lg">
                  <IconRenderer name="sliders" className="w-5 h-5 text-navy" />
                </div>
                Manage Status
              </h3>
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-6 rounded-2xl border border-slate-200 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-3">Order Status</label>
                  <select 
                    value={newOrderStatus} 
                    onChange={(e) => setNewOrderStatus(e.target.value as any)}
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all bg-white font-medium"
                  >
                    {ORDER_STATUSES.map(status => (
                      <option key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-3">Payment Status</label>
                  <select 
                    value={newPaymentStatus} 
                    onChange={(e) => setNewPaymentStatus(e.target.value as any)}
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all bg-white font-medium"
                  >
                    {PAYMENT_STATUSES.map(status => (
                      <option key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <button 
                  onClick={handleStatusUpdate}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-navy to-navy-dark text-white py-3 px-4 rounded-xl font-bold hover:shadow-lg transition-all disabled:opacity-50 mt-2"
                >
                  {loading ? 'Updating...' : '✓ Update Status'}
                </button>
              </div>
            </div>

            {/* Add Notes */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-navy flex items-center gap-3">
                <div className="p-2 bg-navy/10 rounded-lg">
                  <IconRenderer name="message-square" className="w-5 h-5 text-navy" />
                </div>
                Internal Notes ({notes.length})
              </h3>

              {/* Notes List */}
              {notes.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {notes.map((note, idx) => (
                    <div key={idx} className="bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-xl border-l-4 border-blue-500">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-semibold text-blue-900 text-sm">{note.by}</p>
                          <p className="text-xs text-blue-700 opacity-75 mt-1">{note.time}</p>
                        </div>
                      </div>
                      <p className="text-sm text-blue-900 mt-2">{note.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Add New Note */}
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-6 rounded-2xl border border-slate-200 space-y-3">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note about this order..."
                  className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none bg-white"
                  rows={3}
                />
                <button 
                  onClick={handleAddNote}
                  disabled={loading || !noteText.trim()}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-4 rounded-xl font-bold hover:shadow-lg transition-all disabled:opacity-50"
                >
                  {loading ? 'Adding...' : '+ Add Note'}
                </button>
              </div>
            </div>

            {/* Order Info */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-navy flex items-center gap-3">
                <div className="p-2 bg-navy/10 rounded-lg">
                  <IconRenderer name="info" className="w-5 h-5 text-navy" />
                </div>
                Order Information
              </h3>
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-6 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex justify-between items-center pb-3 border-b border-slate-300">
                  <span className="text-slate-700 font-medium">Payment Method</span>
                  <span className="font-semibold text-navy capitalize bg-white px-3 py-1 rounded-lg">{(order.paymentMethod || 'N/A').replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-300">
                  <span className="text-slate-700 font-medium">Created On</span>
                  <span className="font-semibold text-navy text-sm">{order.createdAt ? new Date(order.createdAt).toLocaleString() : 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-700 font-medium">Last Updated</span>
                  <span className="font-semibold text-navy text-sm">{order.updatedAt ? new Date(order.updatedAt).toLocaleString() : 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Delete Button - Sticky at bottom */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 p-6">
          <button 
            onClick={handleDeleteOrder}
            disabled={loading}
            className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-3 px-4 rounded-xl font-bold hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <IconRenderer name="trash" className="w-5 h-5" />
            Delete Order
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
