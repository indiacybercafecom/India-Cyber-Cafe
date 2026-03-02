import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;

if (serviceAccountVar) {
  try {
    const serviceAccount = JSON.parse(serviceAccountVar);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://india-cyber-cafe-default-rtdb.firebaseio.com"
      });
    }
  } catch (error) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT:", error);
  }
} else {
  console.warn("FIREBASE_SERVICE_ACCOUNT not found in environment variables. Firebase Admin features will be disabled.");
}

export const adminAuth = admin.apps.length ? admin.auth() : null;
export const adminDb = admin.apps.length ? admin.database() : null;
export default admin;
