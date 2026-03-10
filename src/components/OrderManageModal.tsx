import { useState, useRef } from 'react';
import { Order, UserProfile, OrderItem, OrderAddress } from '../types';
import { IconRenderer } from './Icons';
import { showToast } from './Toast';
import { rtdb } from '../firebase';
import { ref as dbRef, update, remove } from 'firebase/database';
import { motion } from 'motion/react';
import { sendOrderStatusUpdateEmail, sendOrderCancellationEmail, sendAdminOrderNotification } from '../services/emailService';
import { uploadFile } from '../services/uploadService';

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
  const [noteFile, setNoteFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!order) return null;

  // Handle items - Firebase converts arrays to objects with numeric keys
  let items: OrderItem[] = Array.isArray(order.items) ? order.items : [];
  if (!Array.isArray(order.items) && typeof order.items === 'object' && order.items !== null) {
    items = Object.values(order.items as any).filter(item => item && typeof item === 'object') as OrderItem[];
  }
  
  // Debug logging to check image URLs
  console.log('Order items with images:', items.map(item => ({ 
    productName: (item as any).productName, 
    customImageUrl: (item as any).customImageUrl 
  })));
  const deliveryAddress: Partial<OrderAddress> = order.deliveryAddress || {};
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
            const productName = (items[0] as any)?.productName || 'Your Product';
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
              items.map((item: any) => ({
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
            const productName = (items[0] as any)?.productName || 'Your Product';
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showToast('File size must be less than 5MB', 'error');
      return;
    }

    setNoteFile(file);
    showToast(`File selected: ${file.name}`, 'success');
  };

  const handleAddNote = async () => {
    if (!noteText.trim() && !noteFile) {
      showToast('Please enter a note or select a file', 'error');
      return;
    }

    if (!currentUser) {
      showToast('You must be logged in', 'error');
      return;
    }

    if (!order.id) return;

    setLoading(true);
    try {
      let attachmentUrl = '';
      let attachmentName = '';

      // Upload file if selected
      if (noteFile) {
        setUploadingFile(true);
        attachmentUrl = await uploadFile(noteFile, 'order-notes');
        attachmentName = noteFile.name;
        setUploadingFile(false);
      }

      const newNote: any = {
        type: 'note',
        by: currentUser.name,
        email: currentUser.email,
        text: noteText,
        time: new Date().toLocaleString()
      };

      if (attachmentUrl) {
        newNote.attachment = attachmentUrl;
        newNote.attachmentName = attachmentName;
      }

      const updatedNotes = [...notes, newNote];
      if (onUpdateOrder) {
        await onUpdateOrder(order.id, { notes: updatedNotes as any });
      }
      setNoteText('');
      setNoteFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      showToast('Note added successfully!', 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to add note', 'error');
    } finally {
      setLoading(false);
      setUploadingFile(false);
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
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div 
        className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-navy via-navy-dark to-navy text-white px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center border-b border-white/10 flex-shrink-0">
          <div>
            <p className="text-xs sm:text-sm font-bold opacity-90">Order ID</p>
            <h2 className="text-lg sm:text-2xl font-bold">{order.id}</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-all"
          >
            <IconRenderer name="x" className="w-6 h-6" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div 
          className="overflow-y-auto flex-1"
          onWheel={(e) => {
            const target = e.currentTarget;
            const isAtTop = target.scrollTop === 0;
            const isAtBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
            
            if ((isAtTop && e.deltaY < 0) || (isAtBottom && e.deltaY > 0)) {
              e.preventDefault();
            }
          }}
        >
          <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
            {/* Customer Details */}
            <div className="space-y-3">
              <h3 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <div className="p-1.5 bg-navy/10 rounded-lg">
                  <IconRenderer name="user" className="w-4 h-4 sm:w-5 sm:h-5 text-navy" />
                </div>
                Customer Details
              </h3>
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200 space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Name</p>
                    <p className="text-sm sm:text-base text-navy font-semibold">{deliveryAddress.name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Email</p>
                    <p className="text-xs sm:text-sm text-navy font-semibold break-all">{order.email || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Phone</p>
                    <p className="text-sm sm:text-base text-navy font-semibold">{deliveryAddress.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">City</p>
                    <p className="text-navy font-semibold">{deliveryAddress.city || 'N/A'}</p>
                  </div>
                </div>
                <div className="border-t border-slate-300 pt-3">
                  <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Full Address</p>
                  <p className="text-xs sm:text-sm text-navy font-semibold leading-relaxed">
                    {deliveryAddress.addressLine1 || 'N/A'}
                    {deliveryAddress.addressLine2 && `, ${deliveryAddress.addressLine2}`}
                    {deliveryAddress.state && `, ${deliveryAddress.state}`}
                    {deliveryAddress.pincode && ` - ${deliveryAddress.pincode}`}
                  </p>
                </div>
              </div>
            </div>

            {/* Order Items */}
            <div className="space-y-3">
              <h3 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <div className="p-1.5 bg-navy/10 rounded-lg">
                  <IconRenderer name="shopping-cart" className="w-4 h-4 sm:w-5 sm:h-5 text-navy" />
                </div>
                Order Items ({items.length})
              </h3>
              <div className="space-y-2">
                {items.length > 0 ? (
                  items.map((item, idx) => (
                    <div key={idx} className="bg-gradient-to-r from-slate-50 to-slate-100 p-3 sm:p-4 rounded-lg sm:rounded-xl border border-slate-200 hover:border-navy/50 transition-all">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-bold text-navy text-sm sm:text-base">{(item as any).productName}</p>
                          <p className="text-xs sm:text-sm text-slate-600 mt-0.5">Qty: <span className="font-semibold">{(item as any).quantity}</span></p>
                          {(item as any).specialInstructions && (
                            <p className="text-sm text-slate-600 mt-2 bg-white/60 p-2 rounded-lg">📝 {(item as any).specialInstructions}</p>
                          )}
                        </div>
                        <div className="text-right ml-3">
                          <p className="font-bold text-navy text-sm sm:text-lg">₹{(item as any).price}</p>
                          {(item as any).discountedPrice && (item as any).discountedPrice > 0 && (
                            <p className="text-xs sm:text-sm text-slate-500 line-through">₹{(item as any).discountedPrice}</p>
                          )}
                        </div>
                      </div>
                      
                      {/* Custom Image Upload Display */}
                      {(item as any).customImageUrl && (
                        <div className="mt-3 pt-3 border-t border-slate-300">
                          <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                            🖼️ Custom Image
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <img 
                              src={(item as any).customImageUrl} 
                              alt={`Custom image for ${(item as any).productName}`}
                              className="w-32 h-32 sm:w-40 sm:h-40 rounded-xl object-cover border-2 border-slate-300 shadow-md hover:shadow-lg hover:border-navy/70 transition-all cursor-pointer"
                              onError={(e) => {
                                console.error('Failed to load image:', (item as any).customImageUrl);
                                (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"%3E%3Crect fill="%23f3f4f6" width="160" height="160"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="%239ca3af"%3EImage Load Error%3C/text%3E%3C/svg%3E';
                              }}
                            />
                            <div className="flex-1 bg-white p-3 rounded-lg border border-slate-200">
                              <p className="text-xs text-slate-600 font-semibold mb-1">Image URL (for reference):</p>
                              <p className="text-xs text-blue-600 break-all font-mono bg-slate-50 p-2 rounded max-h-20 overflow-y-auto">{(item as any).customImageUrl}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center text-slate-400 italic">No items in this order</div>
                )}
              </div>
            </div>

            {/* Order Summary */}
            <div className="space-y-3">
              <h3 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <div className="p-1.5 bg-navy/10 rounded-lg">
                  <IconRenderer name="calculator" className="w-4 h-4 sm:w-5 sm:h-5 text-navy" />
                </div>
                Order Summary
              </h3>
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-5 rounded-lg sm:rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-700 font-medium">Subtotal</span>
                  <span className="font-semibold text-navy">₹{subtotal}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-700 font-medium">Delivery</span>
                  <span className="font-semibold text-navy">₹{deliveryCharges}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between items-center bg-green-50 p-2 rounded-lg border border-green-200 text-sm">
                    <span className="text-green-700 font-medium">Discount</span>
                    <span className="font-semibold text-green-700">-₹{discount}</span>
                  </div>
                )}
                <div className="border-t-2 border-slate-300 pt-2 flex justify-between items-center bg-navy/5 p-2 rounded-lg">
                  <span className="font-bold text-navy text-sm">Total</span>
                  <span className="font-bold text-base sm:text-lg bg-gradient-to-r from-navy to-navy-dark bg-clip-text text-transparent">₹{total}</span>
                </div>
              </div>
            </div>

            {/* Status Management */}
            <div className="space-y-3">
              <h3 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <div className="p-1.5 bg-navy/10 rounded-lg">
                  <IconRenderer name="sliders" className="w-4 h-4 sm:w-5 sm:h-5 text-navy" />
                </div>
                Manage Status
              </h3>
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-5 rounded-lg sm:rounded-xl border border-slate-200 space-y-3">
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-2">Order Status</label>
                  <select 
                    value={newOrderStatus} 
                    onChange={(e) => setNewOrderStatus(e.target.value as any)}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-slate-300 rounded-lg sm:rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all bg-white font-medium text-sm"
                  >
                    {ORDER_STATUSES.map(status => (
                      <option key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-2">Payment Status</label>
                  <select 
                    value={newPaymentStatus} 
                    onChange={(e) => setNewPaymentStatus(e.target.value as any)}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-slate-300 rounded-lg sm:rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all bg-white font-medium text-sm"
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
                  className="w-full bg-gradient-to-r from-navy to-navy-dark text-white py-2 sm:py-3 px-4 rounded-lg sm:rounded-xl font-bold text-sm sm:text-base hover:shadow-lg transition-all disabled:opacity-50 mt-1"
                >
                  {loading ? 'Updating...' : '✓ Update Status'}
                </button>
              </div>
            </div>

            {/* Add Notes */}
            <div className="space-y-3">
              <h3 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <div className="p-1.5 bg-navy/10 rounded-lg">
                  <IconRenderer name="message-square" className="w-4 h-4 sm:w-5 sm:h-5 text-navy" />
                </div>
                Internal Notes ({notes.length})
              </h3>

              {/* Notes List */}
              {notes.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {notes.map((note, idx) => (
                    <div key={idx} className="bg-gradient-to-r from-blue-50 to-blue-100 p-3 sm:p-4 rounded-lg border-l-4 border-blue-500">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-semibold text-blue-900 text-xs sm:text-sm">{note.by}</p>
                          <p className="text-xs text-blue-700 opacity-75 mt-0.5">{note.time}</p>
                        </div>
                      </div>
                      <p className="text-xs sm:text-sm text-blue-900 mt-1">{note.text}</p>
                      {(note as any).attachment && (
                        <a 
                          href={(note as any).attachment} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-blue-600 hover:text-blue-800 bg-white px-2 py-1 rounded-lg hover:underline transition-all"
                        >
                          <IconRenderer name="download" className="w-3 h-3" />
                          {(note as any).attachmentName || 'Download'}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add New Note */}
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-5 rounded-lg sm:rounded-xl border border-slate-200 space-y-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note about this order..."
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-slate-300 rounded-lg sm:rounded-xl focus:border-navy focus:ring-2 focus:ring-navy/20 outline-none transition-all resize-none bg-white text-sm"
                  rows={2}
                />

                {/* File Input Section */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFile || loading}
                      className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border-2 border-slate-400 font-semibold text-slate-700 hover:border-navy hover:bg-slate-50 transition-all disabled:opacity-50 text-xs sm:text-sm"
                    >
                      <IconRenderer name="paperclip" className="w-3 h-3 sm:w-4 sm:h-4" />
                      {uploadingFile ? 'Uploading...' : 'Attach'}
                    </button>
                    <input 
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      disabled={uploadingFile || loading}
                      className="hidden"
                    />
                    {noteFile && (
                      <span className="flex items-center gap-1.5 px-2 py-1 bg-green-100 border border-green-300 rounded-lg text-xs font-semibold text-green-700">
                        <IconRenderer name="check" className="w-3 h-3" />
                        {noteFile.name.length > 15 ? noteFile.name.substring(0, 15) + '...' : noteFile.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">Max 5MB</p>
                </div>

                <button 
                  onClick={handleAddNote}
                  disabled={loading || uploadingFile || (!noteText.trim() && !noteFile)}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2 sm:py-3 px-4 rounded-lg sm:rounded-xl font-bold text-sm sm:text-base hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {loading || uploadingFile ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      {uploadingFile ? 'Uploading...' : 'Adding...'}
                    </>
                  ) : (
                    <>
                      <IconRenderer name="plus" className="w-4 h-4 sm:w-5 sm:h-5" />
                      Add Note
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Order Info */}
            <div className="space-y-3">
              <h3 className="text-base sm:text-lg font-bold text-navy flex items-center gap-2">
                <div className="p-1.5 bg-navy/10 rounded-lg">
                  <IconRenderer name="info" className="w-4 h-4 sm:w-5 sm:h-5 text-navy" />
                </div>
                Order Information
              </h3>
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-5 rounded-lg sm:rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between items-center pb-2 border-b border-slate-300 text-sm">
                  <span className="text-slate-700 font-medium">Payment Method</span>
                  <span className="font-semibold text-navy capitalize text-xs sm:text-sm">{(order.paymentMethod || 'N/A').replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-300 text-sm">
                  <span className="text-slate-700 font-medium">Created On</span>
                  <span className="font-semibold text-navy text-xs sm:text-sm">{order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-700 font-medium">Last Updated</span>
                  <span className="font-semibold text-navy text-xs sm:text-sm">{order.updatedAt ? new Date(order.updatedAt).toLocaleDateString() : 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Delete Button - Sticky at bottom */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 sm:p-5 flex-shrink-0">
          <button 
            onClick={handleDeleteOrder}
            disabled={loading}
            className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-2 sm:py-3 px-4 rounded-lg sm:rounded-xl font-bold text-sm sm:text-base hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <IconRenderer name="trash" className="w-5 h-5" />
            Delete Order
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
