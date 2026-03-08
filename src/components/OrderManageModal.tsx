import { useState } from 'react';
import { Order, UserProfile } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { rtdb } from '../firebase';
import { ref as dbRef, update, remove } from 'firebase/database';
import { motion } from 'motion/react';

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
      
      if (newOrderStatus !== order.orderStatus) {
        updateData.orderStatus = newOrderStatus as any;
      }
      if (newPaymentStatus !== order.paymentStatus) {
        updateData.paymentStatus = newPaymentStatus as any;
      }

      if (Object.keys(updateData).length > 0) {
        if (onUpdateOrder) {
          await onUpdateOrder(order.id, updateData);
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
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-navy to-navy-dark text-white p-6 flex justify-between items-center">
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

        {/* Content */}
        <div className="p-6 space-y-8">
          {/* Customer Details */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <IconRenderer name="user" className="w-5 h-5" />
              Customer Details
            </h3>
            <div className="bg-slate-50 p-4 rounded-xl space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase">Name</p>
                  <p className="text-navy font-semibold">{deliveryAddress.name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase">Email</p>
                  <p className="text-navy font-semibold">{order.email || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase">Phone</p>
                  <p className="text-navy font-semibold">{deliveryAddress.phone || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase">City</p>
                  <p className="text-navy font-semibold">{deliveryAddress.city || 'N/A'}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase">Address</p>
                <p className="text-navy font-semibold">
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
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <IconRenderer name="shopping-cart" className="w-5 h-5" />
              Order Items ({items.length})
            </h3>
            <div className="space-y-3">
              {items.length > 0 ? (
                items.map((item, idx) => (
                  <div key={idx} className="bg-slate-50 p-4 rounded-xl flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-bold text-navy">{item.productName}</p>
                      <p className="text-sm text-slate-500">Quantity: {item.quantity}</p>
                      {item.specialInstructions && (
                        <p className="text-sm text-slate-500 mt-1">📝 {item.specialInstructions}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-navy">₹{item.price}</p>
                      {item.discountedPrice && item.discountedPrice > 0 && (
                        <p className="text-sm text-slate-500 line-through">₹{item.discountedPrice}</p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-slate-400 italic p-4 bg-slate-50 rounded-xl">No items in this order</p>
              )}
            </div>
          </div>

          {/* Order Summary */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <IconRenderer name="calculator" className="w-5 h-5" />
              Order Summary
            </h3>
            <div className="bg-slate-50 p-4 rounded-xl space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-semibold text-navy">₹{subtotal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Delivery Charges</span>
                <span className="font-semibold text-navy">₹{deliveryCharges}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span className="font-semibold">-₹{discount}</span>
                </div>
              )}
              <div className="border-t border-slate-200 pt-2 flex justify-between">
                <span className="font-bold text-navy">Total</span>
                <span className="font-bold text-xl text-navy">₹{total}</span>
              </div>
            </div>
          </div>

          {/* Status Management */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <IconRenderer name="sliders" className="w-5 h-5" />
              Manage Status
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Order Status</label>
                <select 
                  value={newOrderStatus} 
                  onChange={(e) => setNewOrderStatus(e.target.value as any)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
                >
                  {ORDER_STATUSES.map(status => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Payment Status</label>
                <select 
                  value={newPaymentStatus} 
                  onChange={(e) => setNewPaymentStatus(e.target.value as any)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all"
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
                className="w-full bg-navy text-white py-3 px-4 rounded-xl font-bold hover:bg-navy-dark transition-all disabled:opacity-50"
              >
                {loading ? 'Updating...' : 'Update Status'}
              </button>
            </div>
          </div>

          {/* Add Notes */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <IconRenderer name="message-square" className="w-5 h-5" />
              Internal Notes ({notes.length})
            </h3>

            {/* Notes List */}
            {notes.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {notes.map((note, idx) => (
                  <div key={idx} className="bg-blue-50 p-3 rounded-lg border-l-4 border-blue-500">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-semibold text-blue-900 text-sm">{note.by}</p>
                        <p className="text-xs text-blue-700 opacity-75">{note.time}</p>
                      </div>
                    </div>
                    <p className="text-sm text-blue-900 mt-1">{note.text}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Add New Note */}
            <div className="space-y-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note about this order..."
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none"
                rows={3}
              />
              <button 
                onClick={handleAddNote}
                disabled={loading || !noteText.trim()}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
              >
                {loading ? 'Adding...' : 'Add Note'}
              </button>
            </div>
          </div>

          {/* Order Info */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-navy flex items-center gap-2">
              <IconRenderer name="info" className="w-5 h-5" />
              Order Information
            </h3>
            <div className="bg-slate-50 p-4 rounded-xl space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-600">Payment Method</span>
                <span className="font-semibold text-navy capitalize">{(order.paymentMethod || 'N/A').replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Created On</span>
                <span className="font-semibold text-navy">{order.createdAt ? new Date(order.createdAt).toLocaleString() : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Last Updated</span>
                <span className="font-semibold text-navy">{order.updatedAt ? new Date(order.updatedAt).toLocaleString() : 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Delete Button */}
          <button 
            onClick={handleDeleteOrder}
            disabled={loading}
            className="w-full bg-red-500 text-white py-3 px-4 rounded-xl font-bold hover:bg-red-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <IconRenderer name="trash" className="w-5 h-5" />
            Delete Order
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
