import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { Product, ProductReview, UserProfile } from '../types';
import { SEO } from '../components/SEO';
import { ReviewSection } from '../components/ReviewSection';

interface StoreProductProps {
  products: Product[];
  reviews: ProductReview[];
  user: UserProfile | null;
  onAddReview: (review: Omit<ProductReview, 'id'>) => Promise<void>;
}

export function StoreProduct({ products, reviews, user, onAddReview }: StoreProductProps) {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);

  const product = products.find(p => p.id === productId);

  if (!product) {
    return (
      <div className="text-center py-20">
        <IconRenderer name="alert-circle" className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-600 mb-2">Product Not Found</h2>
        <button
          onClick={() => navigate('/store')}
          className="btn-primary mt-4"
        >
          Back to Store
        </button>
      </div>
    );
  }

  const productReviews = reviews.filter(r => r.productId === productId);
  const allImages = product.images && product.images.length > 0 ? product.images : [];

  const seoDescription = `${product.shortDescription}. Price: ₹${product.discountedPrice || product.price}. ${productReviews.length} customer reviews.`;

  const handleBuyNow = () => {
    navigate(`/store/${productId}/checkout`, {
      state: { quantity }
    });
  };

  return (
    <div className="space-y-6 sm:space-y-10">
      <SEO
        title={`${product.name} - India Cyber Cafe Store`}
        description={seoDescription}
        url={`https://b.indiacybercafe.com/store/${productId}`}
        keywords={product.seoKeywords || product.name}
      />

      {/* Back Button */}
      <button
        onClick={() => navigate('/store')}
        className="flex items-center gap-2 text-primary font-semibold hover:gap-3 transition-all"
      >
        <IconRenderer name="arrow-left" className="w-4 h-4" />
        Back to Store
      </button>

      {/* Product Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10">
        {/* Image Section */}
        <div className="space-y-4">
          {/* Main Image */}
          <div className="aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-200">
            <img
              src={allImages[selectedImageIndex]}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Gallery Thumbnails */}
          {allImages.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {allImages.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedImageIndex(idx)}
                  className={`w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                    selectedImageIndex === idx ? 'border-primary' : 'border-slate-200 opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={img} alt={`Gallery ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product Info Section */}
        <div className="space-y-4 sm:space-y-6">
          {/* Category & Title */}
          <div>
            <p className="text-primary text-xs sm:text-sm font-semibold uppercase tracking-wider mb-2">
              {product.name.split(' ')[0]}
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-navy mb-2">
              {product.name}
            </h1>
            <p className="text-slate-600 text-sm sm:text-base">
              {product.shortDescription}
            </p>
          </div>

          {/* Rating & Reviews */}
          {product.ratings && (
            <div className="flex items-center gap-4 pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="flex text-yellow-400">
                  {[...Array(5)].map((_, i) => (
                    <span key={i} className="text-xl">
                      {i < Math.round(product.ratings!.average) ? '★' : '☆'}
                    </span>
                  ))}
                </div>
                <span className="text-sm font-semibold text-navy">
                  {product.ratings.average.toFixed(1)}/5.0
                </span>
              </div>
              <span className="text-slate-500 text-sm">
                ({productReviews.length} reviews)
              </span>
            </div>
          )}

          {/* Price */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-3xl sm:text-4xl font-bold text-navy">
                ₹{product.discountedPrice || product.price}
              </span>
              {product.discountedPrice && (
                <>
                  <span className="text-xl sm:text-2xl text-slate-400 line-through">
                    ₹{product.price}
                  </span>
                  <span className="bg-red-100 text-red-700 px-2 sm:px-3 py-1 rounded-lg text-xs sm:text-sm font-bold">
                    {Math.round(((product.price - product.discountedPrice) / product.price) * 100)}% OFF
                  </span>
                </>
              )}
            </div>
            {product.deliveryCharges !== undefined && (
              <p className="text-slate-600 text-xs sm:text-sm">
                Delivery charges: ₹{product.deliveryCharges}
              </p>
            )}
          </div>

          {/* Turnaround Time */}
          {product.turnaroundTime && (
            <div className="flex items-center gap-2 text-slate-600 text-sm">
              <IconRenderer name="clock" className="w-4 h-4 text-primary" />
              <span>Turnaround time: {product.turnaroundTime}</span>
            </div>
          )}

          {/* Stock Status */}
          <div className={`inline-block px-3 sm:px-4 py-2 rounded-lg font-semibold text-sm ${
            product.inStock
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {product.inStock ? '✓ In Stock' : '✗ Out of Stock'}
          </div>

          {/* Custom Image Info */}
          {product.requiresCustomImage && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-xs sm:text-sm font-semibold text-blue-900 mb-1">
                📸 Custom Image Required
              </p>
              <p className="text-xs sm:text-sm text-blue-800">
                {product.customImageInstructions || 'You can upload your custom image during checkout'}
              </p>
            </div>
          )}

          {/* Quantity & Buy */}
          <div className="space-y-3 sm:space-y-4 pt-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-slate-700">Quantity:</label>
              <div className="flex items-center border border-slate-300 rounded-lg">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-3 py-2 hover:bg-slate-100 transition-colors"
                >
                  −
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-12 text-center py-2 border-l border-r border-slate-300 focus:outline-none"
                  min="1"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-3 py-2 hover:bg-slate-100 transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            <button
              onClick={handleBuyNow}
              disabled={!product.inStock}
              className="w-full btn-primary py-3 sm:py-4 text-base sm:text-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🛒 Buy Now
            </button>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-200">
            <div className="flex items-center gap-2">
              <IconRenderer name="shield-check" className="w-4 h-4 text-primary" />
              <span className="text-xs sm:text-sm text-slate-600">Quality Assured</span>
            </div>
            <div className="flex items-center gap-2">
              <IconRenderer name="zap" className="w-4 h-4 text-primary" />
              <span className="text-xs sm:text-sm text-slate-600">Fast Delivery</span>
            </div>
            <div className="flex items-center gap-2">
              <IconRenderer name="headset" className="w-4 h-4 text-primary" />
              <span className="text-xs sm:text-sm text-slate-600">24/7 Support</span>
            </div>
            <div className="flex items-center gap-2">
              <IconRenderer name="check-circle" className="w-4 h-4 text-primary" />
              <span className="text-xs sm:text-sm text-slate-600">Satisfaction</span>
            </div>
          </div>
        </div>
      </div>

      {/* Description Tabs */}
      <div className="space-y-6 border-t-2 border-slate-200 pt-8 sm:pt-10">
        <div className="space-y-4">
          <h2 className="text-xl sm:text-2xl font-bold text-navy">Product Description</h2>
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
            {product.longDescription}
          </p>
        </div>
      </div>

      {/* Reviews Section */}
      <ReviewSection
        reviews={productReviews}
        productId={productId}
        user={user}
        onAddReview={onAddReview}
      />
    </div>
  );
}
