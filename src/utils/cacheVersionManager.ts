/**
 * Forms & Documents Cache Versioning & Invalidation Manager
 *
 * Requirements:
 * - Detects new application / data deployment versions.
 * - Invalidates only relevant Forms/PDF caches (documents, categories, sync timestamps).
 * - Leaves unrelated caches (user auth, user profile, orders, consent) completely untouched.
 * - Purges browser CacheStorage entries matching Forms & Documents endpoints.
 */

export const FORMS_CACHE_VERSION = '2026.10.31-v1';
const CACHE_VERSION_KEY = 'icc_forms_cache_version';

const FORMS_CACHE_KEYS = [
  'icc_cache_documents',
  'icc_cache_documents_all',
  'icc_cache_documentCategories',
  'icc_sync_timestamps_documents',
  'icc_sync_timestamps_documentCategories',
];

export function checkAndInvalidateFormsCache(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const storedVersion = localStorage.getItem(CACHE_VERSION_KEY);

    if (storedVersion !== FORMS_CACHE_VERSION) {
      console.log(
        `[CacheVersionManager] App version change detected: "${storedVersion}" -> "${FORMS_CACHE_VERSION}". Invalidating stale Forms/PDF cache.`
      );

      // 1. Purge only relevant localStorage entries
      for (const key of FORMS_CACHE_KEYS) {
        localStorage.removeItem(key);
      }

      // 2. Clear collection timestamps for documents from syncManager if present
      try {
        const syncTimestampsKey = 'icc_sync_timestamps';
        const raw = localStorage.getItem(syncTimestampsKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.documents) delete parsed.documents;
          if (parsed.documentCategories) delete parsed.documentCategories;
          localStorage.setItem(syncTimestampsKey, JSON.stringify(parsed));
        }
      } catch {}

      // 3. Clear Service Worker / CacheStorage matching documents JSON endpoints
      if ('caches' in window) {
        caches
          .keys()
          .then(cacheNames => {
            cacheNames.forEach(cacheName => {
              caches.open(cacheName).then(cache => {
                cache.keys().then(requests => {
                  requests.forEach(request => {
                    const url = request.url;
                    if (
                      url.includes('/data/documents.json') ||
                      url.includes('/data/document-categories.json') ||
                      url.includes('/api/documents') ||
                      url.includes('/api/document-categories')
                    ) {
                      cache.delete(request);
                    }
                  });
                });
              });
            });
          })
          .catch(() => {});
      }

      // 4. Update stored version to current version
      localStorage.setItem(CACHE_VERSION_KEY, FORMS_CACHE_VERSION);
      return true;
    }
  } catch (err) {
    console.warn('[CacheVersionManager] Cache check notice:', err);
  }

  return false;
}
