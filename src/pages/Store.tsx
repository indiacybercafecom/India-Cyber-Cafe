import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconRenderer } from '../components/Icons';
import { Product, ProductCategory } from '../types';
import { SEO } from '../components/SEO';

interface StoreProps {
  products: Product[];
  categories: ProductCategory[];
  onSelectProduct?: (product: Product) => void;
}

export function Store({ products, categories, onSelectProduct }: StoreProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'price-low' | 'price-high' | 'newest'>('name');

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let filtered = products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.shortDescription.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
      return matchesSearch && matchesCategory && p.inStock;
    });

    // Sort
    switch (sortBy) {
      case 'price-low':
        return filtered.sort((a, b) => (a.discountedPrice || a.price) - (b.discountedPrice || b.price));
      case 'price-high':
        return filtered.sort((a, b) => (b.discountedPrice || b.price) - (a.discountedPrice || a.price));
      case 'newest':
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
      case 'name':
      default:
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [products, searchTerm, selectedCategory, sortBy]);

  const seoDescription = `Browse our collection of premium products. ${filteredProducts.length} products available. Fast delivery, custom printing support.`;

  return (
    <div className="space-y-6 sm:space-y-10">
      <SEO
        title="Store - India Cyber Cafe"
        description={seoDescription}
        url="https://b.indiacybercafe.com/store"
        keywords="custom prints, products, store, india cyber cafe"
      />

      {/* Header */}
      <div className="text-center space-y-3 sm:space-y-4">
        <h1 className="text-3xl sm:text-4xl font-bold text-navy">Our Store</h1>
        <p className="text-sm sm:text-base text-slate-500">Quality products with fast delivery & custom printing support</p>
      </div>

      {/* Search Bar */}
      <div className="max-w-2xl mx-auto relative">
        <IconRenderer name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 sm:w-5 sm:h-5" />
        <input
          type="text"
          placeholder="Search products..."
          className="input-field pl-10 sm:pl-12 py-2.5 sm:py-3 w-full"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Filters & Sort */}
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
        {/* Categories */}
        <div className="flex-1 overflow-x-auto pb-2">
          <div className="flex gap-2 sm:gap-3 min-w-auto">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full whitespace-nowrap text-xs sm:text-sm font-medium transition-all ${
                selectedCategory === 'all'
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Products
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full whitespace-nowrap text-xs sm:text-sm font-medium transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Sort Dropdown */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
          className="px-3 sm:px-4 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-medium text-slate-700 focus:outline-none focus:border-primary"
        >
          <option value="name">Sort: Name</option>
          <option value="price-low">Price: Low to High</option>
          <option value="price-high">Price: High to Low</option>
          <option value="newest">Newest First</option>
        </select>
      </div>

      {/* Results Count */}
      <div className="text-sm text-slate-500">
        Showing {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''}
      </div>

      {/* Products Grid */}
      {filteredProducts.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5 lg:gap-6">
          {filteredProducts.map(product => (
            <div
              key={product.id}
              className="group cursor-pointer bg-white rounded-xl sm:rounded-2xl overflow-hidden border border-slate-200 hover:border-primary hover:shadow-lg transition-all"
              onClick={() => navigate(`/store/${product.id}`)}
            >
              {/* Image Container */}
              <div className="relative aspect-square overflow-hidden bg-slate-100">
                <img
                  src={product.images[0]}
                  alt={product.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {product.discountedPrice && (
                  <div className="absolute top-2 right-2 bg-red-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-bold">
                    {Math.round(((product.price - product.discountedPrice) / product.price) * 100)}% OFF
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="p-3 sm:p-4">
                {/* Category */}
                <p className="text-[10px] sm:text-xs text-primary font-semibold uppercase tracking-wider mb-1 sm:mb-2">
                  {product.category}
                </p>

                {/* Name */}
                <h3 className="text-xs sm:text-sm font-bold text-navy mb-1 sm:mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                  {product.name}
                </h3>

                {/* Description */}
                <p className="text-[9px] sm:text-xs text-slate-500 mb-2 sm:mb-3 line-clamp-2">
                  {product.shortDescription}
                </p>

                {/* Rating */}
                {product.ratings && product.ratings.count > 0 && (
                  <div className="flex items-center gap-1 mb-2 sm:mb-3">
                    <div className="flex text-yellow-400">
                      {[...Array(5)].map((_, i) => (
                        <span key={i} className="text-[11px] sm:text-sm">
                          {i < Math.round(product.ratings!.average) ? '★' : '☆'}
                        </span>
                      ))}
                    </div>
                    <span className="text-[9px] sm:text-xs text-slate-500">
                      ({product.ratings.count})
                    </span>
                  </div>
                )}

                {/* Price */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs sm:text-sm font-bold text-navy">
                    ₹{product.discountedPrice || product.price}
                  </span>
                  {product.discountedPrice && (
                    <span className="text-[9px] sm:text-xs text-slate-400 line-through">
                      ₹{product.price}
                    </span>
                  )}
                </div>

                {/* CTA */}
                <button className="w-full btn-primary text-[10px] sm:text-xs py-1.5 sm:py-2 rounded-lg">
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <IconRenderer name="search" className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-600 mb-2">No products found</h3>
          <p className="text-slate-500 text-sm">Try adjusting your search or category filters</p>
        </div>
      )}
    </div>
  );
}
