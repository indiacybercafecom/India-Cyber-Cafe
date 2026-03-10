// Data prefetch utility for optimized loading
import { cacheManager } from './cacheManager';

export interface PrefetchOptions {
  skipCache?: boolean;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Prefetch specific data type from cache or skip
 * Useful for preloading data before user navigates to a tab
 */
export const prefetchData = {
  /**
   * Check if data is cached and fresh
   */
  isCached(key: string): boolean {
    const info = cacheManager['getInfo'](key);
    return info ? info.cached : false;
  },

  /**
   * Get cache age in seconds
   */
  getCacheAge(key: string): number | null {
    const info = cacheManager['getInfo'](key);
    return info ? Math.floor(info.age / 1000) : null;
  },

  /**
   * Check if cache needs refresh (older than 15 minutes)
   */
  needsRefresh(key: string): boolean {
    const age = this.getCacheAge(key);
    return age === null || age > 15 * 60; // 15 minutes
  },

  /**
   * Quick check before navigating to a tab
   * Returns true if data is ready, false if will load in background
   */
  isReady(keys: string[]): boolean {
    return keys.every(key => this.isCached(key) && !this.needsRefresh(key));
  }
};

/**
 * Hook for showing cache status (optional, for debug/admin)
 */
export const getCacheStatus = () => {
  const dataKeys = ['services', 'applications', 'users', 'gateways', 'products', 'productCategories', 'orders', 'productReviews'];
  
  return dataKeys.reduce((acc, key) => {
    const age = prefetchData.getCacheAge(key);
    acc[key] = {
      cached: prefetchData.isCached(key),
      ageSeconds: age,
      needsRefresh: prefetchData.needsRefresh(key)
    };
    return acc;
  }, {} as Record<string, { cached: boolean; ageSeconds: number | null; needsRefresh: boolean }>);
};
