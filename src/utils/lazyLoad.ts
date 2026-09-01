// Lazy loading utility for on-demand data fetching
// Use this to load specific data only when user navigates to that section

import { ref, onValue } from 'firebase/database';
import { rtdb } from '../firebase';
import { cacheManager } from './cacheManager';

interface LoadOptions {
  useCache?: boolean;
  limit?: number;
}

interface SearchOptions {
  skip?: number;
  limit?: number;
  useCache?: boolean;
}

export const lazyLoad = {
  /**
   * Load specific collection on demand
   * Useful for admin tabs or large datasets
   */
  async loadCollection(collectionName: string, options: LoadOptions = { useCache: true }): Promise<any[]> {
    // Check cache first
    if (options.useCache) {
      const cached = cacheManager.get(collectionName);
      if (cached && cached.length > 0) {
        return cached;
      }
    }

    return new Promise((resolve) => {
      let unsubscribe: (() => void) | null = null;
      try {
        unsubscribe = onValue(ref(rtdb, collectionName), (snapshot) => {
          const data = snapshot.val();

          if (!data) {
            resolve([]);
            unsubscribe();
            return;
          }

          let items = Object.entries(data).map(([id, val]: [string, any]) => ({
            id,
            ...val
          }));

          // Apply limit if specified
          if (options.limit) {
            items = items.slice(0, options.limit);
          }

          // Cache the result
          cacheManager.set(collectionName, items);

          resolve(items);
          unsubscribe();
        }, (error) => {
          console.error(`Error loading ${collectionName}:`, error);
          if (unsubscribe) unsubscribe();
          resolve([]);
        });
      } catch (error) {
        console.error(`Error loading ${collectionName}:`, error);
        if (unsubscribe) unsubscribe();
        resolve([]);
      }
    });
  },

  /**
   * Load single item by ID
   */
  async loadItem(collectionName: string, itemId: string): Promise<any | null> {
    return new Promise((resolve) => {
      let unsubscribe: (() => void) | null = null;
      try {
        unsubscribe = onValue(ref(rtdb, `${collectionName}/${itemId}`), (snapshot) => {
          resolve(snapshot.val());
          if (unsubscribe) unsubscribe();
        }, (error) => {
          console.error(`Error loading ${collectionName}/${itemId}:`, error);
          if (unsubscribe) unsubscribe();
          resolve(null);
        });
      } catch (error) {
        console.error(`Error loading ${collectionName}/${itemId}:`, error);
        if (unsubscribe) unsubscribe();
        resolve(null);
      }
    });
  },

  /**
   * Search with pagination
   */
  async search(
    collectionName: string,
    searchFn: (item: any) => boolean,
    options: SearchOptions = { skip: 0, limit: 20, useCache: true }
  ): Promise<any[]> {
    let items = [];

    if (options.useCache) {
      const cached = cacheManager.get(collectionName);
      if (cached && cached.length > 0) {
        items = cached;
      }
    }

    // If not cached, load from Firebase
    if (items.length === 0) {
      items = await this.loadCollection(collectionName, { useCache: false });
    }

    // Filter and paginate
    const results = items.filter(searchFn);
    const skip = options.skip || 0;
    const limit = options.limit || 20;
    return results.slice(skip, skip + limit);
  }
};

/**
 * Hook usage example:
 * 
 * // In a component, load data when tab is clicked
 * const handleReviewsTabClick = async () => {
 *   setLoading(true);
 *   const reviews = await lazyLoad.loadCollection('productReviews');
 *   setProductReviews(reviews);
 *   setLoading(false);
 * };
 * 
 * // Or search function
 * const handleSearch = async (query: string) => {
 *   const results = await lazyLoad.search(
 *     'applications',
 *     (app: any) => app.email?.includes(query),
 *     { skip: 0, limit: 50 }
 *   );
 *   setFilteredApps(results);
 * };
 */
