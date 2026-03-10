// Cache Manager for Firebase data with TTL support
const CACHE_PREFIX = 'icc_cache_';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

export const cacheManager = {
  /**
   * Get cached data if it exists and is not expired
   */
  get(key: string): any | null {
    try {
      const cached = localStorage.getItem(CACHE_PREFIX + key);
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);
      const now = Date.now();

      // Check if cache has expired
      if (now - entry.timestamp > entry.ttl) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.error(`Error reading cache for ${key}:`, error);
      return null;
    }
  },

  /**
   * Set cache data with TTL
   */
  set(key: string, data: any, ttl: number = CACHE_TTL): void {
    try {
      const entry: CacheEntry = {
        data,
        timestamp: Date.now(),
        ttl
      };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (error) {
      console.error(`Error writing cache for ${key}:`, error);
    }
  },

  /**
   * Clear specific cache
   */
  clear(key: string): void {
    try {
      localStorage.removeItem(CACHE_PREFIX + key);
    } catch (error) {
      console.error(`Error clearing cache for ${key}:`, error);
    }
  },

  /**
   * Clear all cache
   */
  clearAll(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Error clearing all cache:', error);
    }
  },

  /**
   * Get cache info (for debugging)
   */
  getInfo(key: string): { cached: boolean; age: number; ttl: number } | null {
    try {
      const cached = localStorage.getItem(CACHE_PREFIX + key);
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);
      const now = Date.now();
      const age = now - entry.timestamp;

      return {
        cached: age < entry.ttl,
        age,
        ttl: entry.ttl
      };
    } catch (error) {
      return null;
    }
  }
};
