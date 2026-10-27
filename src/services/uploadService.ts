import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export const MAX_SERVICE_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

export async function uploadFile(file: File, category: string = 'general', maxSizeBytes?: number): Promise<string> {
  try {
    if (maxSizeBytes !== undefined && file.size > maxSizeBytes) {
      throw new Error(`File "${file.name}" exceeds the ${Math.round(maxSizeBytes / (1024 * 1024))} MB limit.`);
    }

    // MIME type & extension validation (defense-in-depth)
    const cleanExt = (file.name.split('.').pop() || '').toLowerCase().trim();
    if (!ALLOWED_EXTENSIONS.has(cleanExt) || (file.type && !ALLOWED_MIME_TYPES.has(file.type.toLowerCase()))) {
      throw new Error(`Invalid file type "${file.name}". Only PDF and standard image formats (JPG, PNG, WEBP) are allowed.`);
    }

    // Generate a unique filename to prevent overwriting and maintain organization
    const randomString = Math.random().toString(36).substring(2, 14);
    const timestamp = Date.now();
    const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${safeCategory}/${timestamp}_${randomString}.${cleanExt}`;
    
    // Create a storage reference in Firebase
    const storageRef = ref(storage, fileName);
    
    // Upload the file with appropriate metadata
    const metadata = {
      contentType: file.type || 'application/octet-stream',
    };
    
    const snapshot = await uploadBytes(storageRef, file, metadata);
    
    // Get the permanent download URL from Firebase
    const downloadURL = await getDownloadURL(snapshot.ref);
    
    return downloadURL;
  } catch (error: any) {
    console.error('Firebase Upload Error:', error);
    // Provide clear error feedback
    let errorMessage = error.message || 'Upload failed';
    if (error.code === 'storage/unauthorized') {
      errorMessage = 'Permission denied. Please ensure Firebase Storage rules allow uploads.';
    } else if (error.code === 'storage/quota-exceeded') {
      errorMessage = 'Storage quota exceeded. Please contact support.';
    }
    throw new Error(errorMessage);
  }
}

