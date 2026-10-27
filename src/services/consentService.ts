import { ConsentPreferences } from '../types';

export const CURRENT_CONSENT_VERSION = '2026.1';
const CONSENT_STORAGE_KEY = 'icc_consent_preferences';
const CONSENT_AUDIT_LOG_KEY = 'icc_consent_audit_log';

type ConsentListener = (preferences: ConsentPreferences) => void;
const listeners: Set<ConsentListener> = new Set();

export const consentService = {
  getPreferences(): ConsentPreferences | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.essential === true) {
        return parsed as ConsentPreferences;
      }
      return null;
    } catch {
      return null;
    }
  },

  hasResponded(): boolean {
    return this.getPreferences() !== null;
  },

  isAnalyticsConsented(): boolean {
    const prefs = this.getPreferences();
    return Boolean(prefs?.analytics);
  },

  isMarketingConsented(): boolean {
    const prefs = this.getPreferences();
    return Boolean(prefs?.marketing);
  },

  savePreferences(prefs: { analytics: boolean; marketing: boolean }, sourcePage = '/'): ConsentPreferences {
    const record: ConsentPreferences = {
      essential: true,
      analytics: Boolean(prefs.analytics),
      marketing: Boolean(prefs.marketing),
      timestamp: new Date().toISOString(),
      version: CURRENT_CONSENT_VERSION,
    };

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));

        // Append to audit log
        const rawLog = localStorage.getItem(CONSENT_AUDIT_LOG_KEY);
        const auditLog = rawLog ? JSON.parse(rawLog) : [];
        auditLog.push({
          ...record,
          sourcePage,
          userAgent: navigator.userAgent,
          action: 'update_preferences'
        });
        // Keep last 20 audit entries
        localStorage.setItem(CONSENT_AUDIT_LOG_KEY, JSON.stringify(auditLog.slice(-20)));
      } catch (err) {
        console.warn('[ConsentService] Failed to persist consent:', err);
      }
    }

    listeners.forEach((listener) => {
      try {
        listener(record);
      } catch (err) {
        console.error('[ConsentService] Error in listener:', err);
      }
    });

    return record;
  },

  acceptAll(sourcePage = '/'): ConsentPreferences {
    return this.savePreferences({ analytics: true, marketing: true }, sourcePage);
  },

  rejectNonEssential(sourcePage = '/'): ConsentPreferences {
    return this.savePreferences({ analytics: false, marketing: false }, sourcePage);
  },

  subscribe(listener: ConsentListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
