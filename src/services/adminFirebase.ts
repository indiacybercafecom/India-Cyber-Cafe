import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;

if (serviceAccountVar) {
  try {
    let cleanVar = serviceAccountVar.trim();
    // Remove accidental wrapping quotes if present
    if ((cleanVar.startsWith("'") && cleanVar.endsWith("'")) || 
        (cleanVar.startsWith('"') && cleanVar.endsWith('"'))) {
      cleanVar = cleanVar.substring(1, cleanVar.length - 1);
    }

    if (!cleanVar.startsWith('{')) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT must be a JSON string starting with '{'. It looks like you might have pasted the client email or a filename instead of the full JSON content.");
    }
    const serviceAccount = JSON.parse(cleanVar);
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
