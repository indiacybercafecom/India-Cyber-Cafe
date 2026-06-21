import React from 'react';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-slate-200 rounded-xl ${className}`} />
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <Skeleton className="h-10 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-12 w-32" />
          <Skeleton className="h-12 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <div key={i}>
            <Skeleton className="h-48 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

export function ServiceSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {[1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} className="bg-white p-6 rounded-2xl shadow-md border border-slate-100 space-y-4">
          <Skeleton className="w-12 h-12 rounded-lg" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// Store Product Card Skeleton
export function StoreProductCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden hover:shadow-lg transition-shadow duration-300 space-y-4 p-0">
      {/* Product Image */}
      <Skeleton className="h-48 w-full rounded-none" />
      
      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Category */}
        <Skeleton className="h-4 w-24 rounded-full" />
        
        {/* Product Name */}
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
        
        {/* Price */}
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
        
        {/* Buy Button */}
        <Skeleton className="h-10 w-full rounded-lg mt-4" />
      </div>
    </div>
  );
}

// Store Page Skeleton with Search and Filters
export function StoreSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-10">
      {/* Header */}
      <div className="text-center space-y-3 sm:space-y-4">
        <Skeleton className="h-10 w-48 mx-auto" />
        <Skeleton className="h-5 w-72 mx-auto" />
      </div>

      {/* Search Bar */}
      <div className="max-w-2xl mx-auto">
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>

      {/* Filters & Categories */}
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
        <div className="flex-1 overflow-x-auto pb-2">
          <div className="flex gap-2 sm:gap-3 min-w-auto">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-9 w-24 rounded-full flex-shrink-0" />
            ))}
          </div>
        </div>
        <Skeleton className="h-9 w-32 sm:w-40 rounded-lg" />
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <StoreProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// Store Product Detail Skeleton
export function StoreProductDetailSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-10">
      {/* Back Button */}
      <Skeleton className="h-6 w-32 rounded-lg" />

      {/* Product Detail Container */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10">
        {/* Image Section */}
        <div className="space-y-4">
          {/* Main Image */}
          <Skeleton className="h-96 w-full rounded-2xl" />
          
          {/* Thumbnail Images */}
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-20 w-20 rounded-lg flex-shrink-0" />
            ))}
          </div>
        </div>

        {/* Details Section */}
        <div className="space-y-6">
          {/* Rating */}
          <div className="flex gap-2 items-center">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>

          {/* Product Name */}
          <div className="space-y-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-4/5" />
          </div>

          {/* Price Section */}
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-24" />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>

          {/* Quantity Selector */}
          <div className="space-y-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>

          {/* Buy Button */}
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>

      {/* Reviews Section Skeleton */}
      <div className="space-y-4 pt-6 sm:pt-10 border-t border-slate-200">
        <Skeleton className="h-6 w-32" />
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="border border-slate-100 rounded-lg p-4 space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
