import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAMTND9rIAw-76Oey3c7c43-TW2t6mxEfw",
  authDomain: "india-cyber-cafe.firebaseapp.com",
  projectId: "india-cyber-cafe",
  storageBucket: "india-cyber-cafe.firebasestorage.app",
  messagingSenderId: "927739510475",
  appId: "1:927739510475:web:c73e8f269c80c1f892254e",
  measurementId: "G-HKXGED0EB0",
  databaseURL: "https://india-cyber-cafe-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;
