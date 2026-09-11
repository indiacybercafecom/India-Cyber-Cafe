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

export function ServiceDetailSkeleton() {
  return (
    <div className="space-y-8 sm:space-y-12 animate-pulse">
      <div className="flex flex-col sm:flex-row items-center gap-6 bg-white p-6 sm:p-10 rounded-3xl shadow-xl border border-slate-100">
        <Skeleton className="w-20 h-20 sm:w-24 sm:h-24 rounded-full shrink-0" />
        <div className="w-full space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-full max-w-2xl" />
        </div>
      </div>
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="bg-white rounded-2xl shadow-md border border-slate-100 p-6 space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ))}
      </div>
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

export function ApplySkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8 animate-pulse">
      <div className="space-y-3">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-4 w-full max-w-2xl rounded-lg" />
      </div>

      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-4 sm:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
          <div className="space-y-5">
            <Skeleton className="h-5 w-24 rounded-lg" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-5 w-28 rounded-lg" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-5 w-32 rounded-lg" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <div className="space-y-5">
            <Skeleton className="h-5 w-28 rounded-lg" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-12 w-40 rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function CheckoutSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8 animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-md">
            <Skeleton className="h-8 w-44 rounded-lg" />
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
            <div className="mt-4 space-y-3">
              <Skeleton className="h-4 w-1/3 rounded" />
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-3/4 rounded" />
            </div>
          </div>
          <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-md">
            <Skeleton className="h-8 w-40 rounded-lg" />
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
              <div className="space-y-3">
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
              <div className="space-y-3">
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
              <div className="space-y-3">
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            </div>
          </div>
        </div>

        <aside className="bg-white rounded-3xl border border-slate-100 p-6 shadow-md h-fit">
          <Skeleton className="h-8 w-32 rounded-lg" />
          <div className="mt-5 space-y-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ServicesSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-10 animate-pulse">
      <div className="text-center space-y-3">
        <Skeleton className="h-8 w-48 mx-auto rounded-lg" />
        <Skeleton className="h-4 w-64 mx-auto rounded-lg" />
      </div>

      <div className="max-w-xl mx-auto">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <Skeleton className="mx-auto h-16 w-16 rounded-full" />
            <div className="space-y-3 mt-4">
              <Skeleton className="h-5 w-3/4 mx-auto rounded" />
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-3/4 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="max-w-xl mx-auto bg-white p-6 sm:p-10 rounded-3xl shadow-xl space-y-6 sm:space-y-10 animate-pulse">
      <div className="text-center space-y-4">
        <Skeleton className="mx-auto w-24 h-24 sm:w-32 sm:h-32 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-40 mx-auto rounded-lg" />
          <Skeleton className="h-4 w-56 mx-auto rounded-lg" />
        </div>
      </div>

      <div className="space-y-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="p-4 sm:p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
          <Skeleton className="h-4 w-28 rounded-lg" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function TrackSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8 animate-pulse">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-4 w-80 rounded-lg" />
        </div>
        <Skeleton className="h-11 w-40 rounded-xl" />
      </div>

      <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <Skeleton className="h-12 flex-1 rounded-xl" />
          <Skeleton className="h-12 w-40 rounded-xl" />
          <Skeleton className="h-12 w-40 rounded-xl" />
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
        <div className="hidden sm:block">
          <div className="grid grid-cols-5 gap-4 bg-slate-100 p-4">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-4 w-20 rounded" />)}
          </div>
          {[1, 2, 3].map(i => (
            <div key={i} className="grid grid-cols-5 gap-4 border-t border-slate-100 p-4">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-10 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PriceListSkeleton() {
  return (
    <div className="space-y-8 sm:space-y-12 animate-pulse">
      <div className="rounded-3xl bg-slate-800 px-5 py-10 text-white shadow-xl">
        <Skeleton className="h-5 w-40 rounded-lg" />
        <Skeleton className="mt-3 h-12 w-80 rounded-lg" />
        <Skeleton className="mt-3 h-4 w-96 rounded-lg" />
      </div>

      <div className="mx-auto max-w-2xl">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>

      <section className="space-y-4">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
              <Skeleton className="h-5 w-32 rounded-lg" />
              <div className="mt-4 space-y-4">
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function OperatorSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8 animate-pulse">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-xl" />
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <div className="flex gap-3">
          <Skeleton className="h-12 w-32 rounded-xl" />
          <Skeleton className="h-12 w-32 rounded-xl" />
          <Skeleton className="h-12 w-32 rounded-xl" />
        </div>
      </div>
      <div className="rounded-3xl border border-slate-100 bg-white p-4">
        <div className="space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="grid grid-cols-5 gap-4">
              <Skeleton className="h-5 w-24 rounded" />
              <Skeleton className="h-5 w-28 rounded" />
              <Skeleton className="h-5 w-24 rounded" />
              <Skeleton className="h-5 w-20 rounded" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdminSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8 animate-pulse">
      <div className="flex flex-wrap gap-2">
        {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-10 w-28 rounded-xl" />)}
      </div>
      <div className="bg-white rounded-3xl border border-slate-100 shadow-md p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
        <div className="mt-4 space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="grid grid-cols-6 gap-4 border-t border-slate-100 pt-3">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-8 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
