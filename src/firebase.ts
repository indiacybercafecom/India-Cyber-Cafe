import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getAnalytics, setAnalyticsCollectionEnabled, Analytics } from "firebase/analytics";
import { getDatabase } from "firebase/database";
import { consentService } from "./services/consentService";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAMTND9rIAw-76Oey3c7c43-TW2t6mxEfw",
  authDomain: "india-cyber-cafe.firebaseapp.com",
  projectId: "india-cyber-cafe",
  storageBucket: "india-cyber-cafe-free",
  messagingSenderId: "927739510475",
  appId: "1:927739510475:web:c73e8f269c80c1f892254e",
  measurementId: "G-HKXGED0EB0",
  databaseURL: "https://india-cyber-cafe-default-rtdb.firebaseio.com"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);

let analyticsInstance: Analytics | null = null;

export function getAppAnalytics(): Analytics | null {
  if (typeof window === 'undefined') return null;

  const isConsented = consentService.isAnalyticsConsented();

  if (isConsented) {
    if (!analyticsInstance) {
      try {
        analyticsInstance = getAnalytics(app);
        setAnalyticsCollectionEnabled(analyticsInstance, true);
      } catch (err) {
        console.warn('[Analytics] Failed to initialize Firebase Analytics:', err);
      }
    } else {
      try {
        setAnalyticsCollectionEnabled(analyticsInstance, true);
      } catch {
        // Ignore
      }
    }
    return analyticsInstance;
  } else {
    if (analyticsInstance) {
      try {
        setAnalyticsCollectionEnabled(analyticsInstance, false);
      } catch {
        // Ignore
      }
    }
    return null;
  }
}

// React to consent changes dynamically
if (typeof window !== 'undefined') {
  consentService.subscribe((prefs) => {
    if (prefs.analytics) {
      getAppAnalytics();
    } else if (analyticsInstance) {
      try {
        setAnalyticsCollectionEnabled(analyticsInstance, false);
      } catch {
        // Ignore
      }
    }
  });

  // Initialize on load only if already consented
  if (consentService.isAnalyticsConsented()) {
    getAppAnalytics();
  }
}

export const analytics = typeof window !== 'undefined' && consentService.isAnalyticsConsented()
  ? getAppAnalytics()
  : null;
