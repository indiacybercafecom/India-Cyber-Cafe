// Incremental sync system - tracks changes and fetches only new/updated data
// Instead of reloading entire database on refresh, only fetches what changed since last sync

interface SyncTimestamp {
  [key: string]: number; // Collection name -> last sync timestamp
}

const SYNC_TIMESTAMPS_KEY = 'icc_sync_timestamps';
const SYNC_INTERVAL = 5 * 60 * 1000; // Auto-sync every 5 minutes

/**
 * Manages incremental sync timestamps
 * Tracks when each collection was last synced
 */
export const syncManager = {
  /**
   * Get last sync timestamp for a collection
   * Returns 0 if never synced (will do full load first time)
   */
  getLastSync(collectionName: string): number {
    try {
      const timestamps: SyncTimestamp = JSON.parse(
        localStorage.getItem(SYNC_TIMESTAMPS_KEY) || '{}'
      );
      return timestamps[collectionName] || 0;
    } catch (error) {
      console.error('Error reading sync timestamp:', error);
      return 0;
    }
  },

  /**
   * Update sync timestamp for a collection
   * Called after successful sync
   */
  updateSync(collectionName: string, timestamp: number = Date.now()): void {
    try {
      const timestamps: SyncTimestamp = JSON.parse(
        localStorage.getItem(SYNC_TIMESTAMPS_KEY) || '{}'
      );
      timestamps[collectionName] = timestamp;
      localStorage.setItem(SYNC_TIMESTAMPS_KEY, JSON.stringify(timestamps));
    } catch (error) {
      console.error('Error updating sync timestamp:', error);
    }
  },

  /**
   * Get all sync timestamps (for debugging)
   */
  getAllTimestamps(): SyncTimestamp {
    try {
      return JSON.parse(localStorage.getItem(SYNC_TIMESTAMPS_KEY) || '{}');
    } catch (error) {
      console.error('Error reading sync timestamps:', error);
      return {};
    }
  },

  /**
   * Clear all sync timestamps (forces full reload on next page)
   */
  clearAllTimestamps(): void {
    try {
      localStorage.removeItem(SYNC_TIMESTAMPS_KEY);
    } catch (error) {
      console.error('Error clearing sync timestamps:', error);
    }
  },

  /**
   * Clear specific collection's sync timestamp
   */
  clearTimestamp(collectionName: string): void {
    try {
      const timestamps: SyncTimestamp = JSON.parse(
        localStorage.getItem(SYNC_TIMESTAMPS_KEY) || '{}'
      );
      delete timestamps[collectionName];
      localStorage.setItem(SYNC_TIMESTAMPS_KEY, JSON.stringify(timestamps));
    } catch (error) {
      console.error('Error clearing sync timestamp:', error);
    }
  },

  /**
   * Get sync info for debugging
   */
  getSyncInfo(collectionName: string): {
    lastSyncTime: number;
    lastSyncMinutesAgo: number;
    needsSync: boolean;
  } {
    const lastSync = this.getLastSync(collectionName);
    const now = Date.now();
    const ageMs = now - lastSync;
    const ageMinutes = Math.floor(ageMs / (60 * 1000));

    return {
      lastSyncTime: lastSync,
      lastSyncMinutesAgo: ageMinutes,
      needsSync: ageMs > SYNC_INTERVAL
    };
  }
};

/**
 * Helper to merge incremental updates with existing data
 * Useful for combining old cached data with new updates
 */
export const mergeIncrementalData = {
  /**
   * Merge new items with existing items, handling updates
   * New items will overwrite old ones with same ID
   */
  mergeItems(existingItems: any[], newItems: any[]): any[] {
    const itemMap = new Map();

    // Add existing items
    existingItems.forEach(item => {
      itemMap.set(item.id || item.uid, item);
    });

    // Merge/overwrite with new items
    newItems.forEach(item => {
      itemMap.set(item.id || item.uid, item);
    });

    // Return merged as array
    return Array.from(itemMap.values());
  },

  /**
   * Find items modified after timestamp (client-side filter)
   * Note: This filters client-side; for full power use server-side timestamps
   */
  filterByTimestamp(items: any[], afterTimestamp: number): any[] {
    return items.filter(item => {
      const itemTimestamp = item.timestamp || item.updatedAt || item.createdAt || 0;
      return itemTimestamp >= afterTimestamp;
    });
  },

  /**
   * Get only new items (not in existing array)
   */
  getNewItems(existingItems: any[], allItems: any[]): any[] {
    const existingIds = new Set(existingItems.map(item => item.id || item.uid));
    return allItems.filter(item => !existingIds.has(item.id || item.uid));
  }
};
