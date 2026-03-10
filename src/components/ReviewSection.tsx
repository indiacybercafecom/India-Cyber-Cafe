import { useState } from 'react';
import { uploadBytes, getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { IconRenderer } from './Icons';
import { ProductReview, UserProfile } from '../types';
import { showToast } from './Toast';
import { sendReviewConfirmationEmail, sendAdminReviewNotification } from '../services/emailService';

interface ReviewSectionProps {
  reviews: ProductReview[];
  productId: string;
  productName?: string;
  user: UserProfile | null;
  onAddReview: (review: Omit<ProductReview, 'id'>) => Promise<void>;
}

export function ReviewSection({ reviews, productId, productName = 'Product', user, onAddReview }: ReviewSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    // Max 3 images
    if (imageFiles.length + files.length > 3) {
      showToast('Maximum 3 images allowed', 'error');
      return;
    }

    files.forEach((file: File) => {
      // Validate file size (max 2MB)
      if (file.size > 2 * 1024 * 1024) {
        showToast('Image size must be less than 2MB', 'error');
        return;
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        showToast('Please select image files only', 'error');
        return;
      }

      setImageFiles(prev => [...prev, file]);

      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviews(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      showToast('Please login to leave a review', 'error');
      return;
    }

    if (!text.trim()) {
      showToast('Please write a review', 'error');
      return;
    }

    try {
      setSubmitting(true);

      // Upload images to Firebase Storage and get download URLs
      const imageUrls: string[] = [];
      
      if (imageFiles.length > 0) {
        for (let i = 0; i < imageFiles.length; i++) {
          try {
            const file = imageFiles[i];
            const timestamp = Date.now();
            const fileExt = file.name.split('.').pop();
            const fileName = `review_${user.uid}_${timestamp}_${i}.${fileExt}`;
            
            // Create storage reference for the review image
            const storageRef = ref(storage, `reviews/${productId}/${fileName}`);
            
            // Upload file to Firebase Storage
            await uploadBytes(storageRef, file);
            
            // Get download URL
            const downloadUrl = await getDownloadURL(storageRef);
            imageUrls.push(downloadUrl);
            
            console.log(`✅ Image ${i + 1} uploaded successfully`);
          } catch (error) {
            console.error(`Error uploading image ${i + 1}:`, error);
            showToast(`Failed to upload image ${i + 1}`, 'error');
            setSubmitting(false);
            return;
          }
        }
      }

      const review: Omit<ProductReview, 'id'> = {
        productId,
        uid: user.uid,
        userName: user.name,
        rating,
        text: text.trim(),
        images: imageUrls, // Upload to Firebase Storage
        date: new Date().toISOString(),
        helpful: 0
      };

      await onAddReview(review);

      // Send confirmation email to customer
      await sendReviewConfirmationEmail(user.email, user.name, productName)
        .catch(err => console.error('Review confirmation email error:', err));

      // Send admin notification about new review
      await sendAdminReviewNotification(productName, user.name, rating, text.trim())
        .catch(err => console.error('Admin review notification error:', err));

      showToast('Review submitted successfully!', 'success');

      // Reset form
      setRating(5);
      setText('');
      setImageFiles([]);
      setImagePreviews([]);
      setShowForm(false);
    } catch (error) {
      console.error('Review submission error:', error);
      showToast('Failed to submit review', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const averageRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : 0;

  const ratingCounts = {
    5: reviews.filter(r => r.rating === 5).length,
    4: reviews.filter(r => r.rating === 4).length,
    3: reviews.filter(r => r.rating === 3).length,
    2: reviews.filter(r => r.rating === 2).length,
    1: reviews.filter(r => r.rating === 1).length,
  };

  return (
    <div className="space-y-8 border-t-2 border-slate-200 pt-8 sm:pt-10">
      <h2 className="text-2xl sm:text-3xl font-bold text-navy">Customer Reviews</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Rating Summary */}
        <div className="space-y-6">
          {/* Overall Rating */}
          <div className="bg-gradient-to-br from-primary/10 to-navy/10 p-6 rounded-xl">
            <div className="text-center space-y-2">
              <div className="text-4xl font-bold text-navy">{averageRating}</div>
              <div className="flex justify-center text-yellow-400 text-2xl">
                {[...Array(5)].map((_, i) => (
                  <span key={i}>{i < Math.round(parseFloat(averageRating as any)) ? '★' : '☆'}</span>
                ))}
              </div>
              <p className="text-sm text-slate-600">Based on {reviews.length} reviews</p>
            </div>
          </div>

          {/* Rating Breakdown */}
          <div className="space-y-3">
            {[5, 4, 3, 2, 1].map(stars => {
              const count = ratingCounts[stars as keyof typeof ratingCounts];
              const percentage = reviews.length > 0 ? (count / reviews.length) * 100 : 0;

              return (
                <div key={stars} className="flex items-center gap-3">
                  <div className="flex gap-1 w-12">
                    {[...Array(stars)].map((_, i) => (
                      <span key={i} className="text-yellow-400 text-sm">★</span>
                    ))}
                    {[...Array(5 - stars)].map((_, i) => (
                      <span key={i} className="text-slate-300 text-sm">★</span>
                    ))}
                  </div>
                  <div className="flex-1 bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-yellow-400 h-full transition-all"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-slate-500 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>

          {/* Write Review Button */}
          <button
            onClick={() => setShowForm(!showForm)}
            className="w-full btn-primary py-2 text-sm font-semibold"
          >
            {showForm ? 'Cancel' : '✍️ Write a Review'}
          </button>
        </div>

        {/* Reviews List & Form */}
        <div className="md:col-span-2 space-y-6">
          {/* Review Form */}
          {showForm && (
            <form onSubmit={handleSubmitReview} className="bg-slate-50 p-6 rounded-xl border-2 border-primary space-y-4">
              {/* Rating Selector */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Rating *</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className="text-3xl transition-all hover:scale-110"
                    >
                      {star <= rating ? '★' : '☆'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Review Text */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Your Review *</label>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Share your experience with this product..."
                  className="input-field w-full h-24 resize-none text-sm"
                  maxLength={500}
                />
                <p className="text-xs text-slate-500 mt-1">{text.length}/500</p>
              </div>

              {/* Image Upload */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Photos (Optional - Max 3)
                </label>
                <label className="block">
                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors">
                    <IconRenderer name="camera" className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-slate-700">Click to add photos</p>
                  </div>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                </label>

                {/* Image Previews */}
                {imagePreviews.length > 0 && (
                  <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
                    {imagePreviews.map((preview, idx) => (
                      <div key={idx} className="relative flex-shrink-0">
                        <img src={preview} alt={`Preview ${idx + 1}`} className="w-16 h-16 object-cover rounded-lg" />
                        <button
                          type="button"
                          onClick={() => {
                            setImageFiles(prev => prev.filter((_, i) => i !== idx));
                            setImagePreviews(prev => prev.filter((_, i) => i !== idx));
                          }}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full btn-primary py-2 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting...' : 'Post Review'}
              </button>
            </form>
          )}

          {/* Reviews List */}
          <div className="space-y-4">
            {reviews.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <p className="text-sm">No reviews yet. Be the first to review!</p>
              </div>
            ) : (
              reviews.map(review => (
                <div key={review.id} className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-slate-700">{review.userName}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(review.date).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-yellow-400 flex">
                      {[...Array(5)].map((_, i) => (
                        <span key={i} className="text-sm">
                          {i < review.rating ? '★' : '☆'}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Review Text */}
                  <p className="text-sm text-slate-600">{review.text}</p>

                  {/* Images */}
                  {review.images && review.images.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {review.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt={`Review ${idx + 1}`}
                          className="h-12 w-12 object-cover rounded-lg"
                        />
                      ))}
                    </div>
                  )}

                  {/* Helpful */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                    <button className="text-xs text-slate-500 hover:text-primary font-semibold flex items-center gap-1">
                      👍 Helpful ({review.helpful || 0})
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
