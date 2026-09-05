import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export const MAX_SERVICE_FILE_SIZE = 5 * 1024 * 1024;

export async function uploadFile(file: File, category: string = 'general', maxSizeBytes?: number): Promise<string> {
  try {
    if (maxSizeBytes !== undefined && file.size > maxSizeBytes) {
      throw new Error(`File "${file.name}" exceeds the ${Math.round(maxSizeBytes / (1024 * 1024))} MB limit.`);
    }

    // Generate a unique filename to prevent overwriting and maintain organization
    const randomString = Math.random().toString(36).substring(2, 14);
    const timestamp = Date.now();
    const extension = file.name.split('.').pop();
    const fileName = `${category}/${timestamp}_${randomString}.${extension}`;
    
    // Create a storage reference in Firebase
    const storageRef = ref(storage, fileName);
    
    // Upload the file with appropriate metadata
    const metadata = {
      contentType: file.type,
    };
    
    const snapshot = await uploadBytes(storageRef, file, metadata);
    
    // Get the permanent, public download URL from Firebase
    const downloadURL = await getDownloadURL(snapshot.ref);
    
    return downloadURL;
  } catch (error: any) {
    console.error('Firebase Upload Error:', error);
    // Provide clear error feedback
    let errorMessage = 'Upload failed';
    if (error.code === 'storage/unauthorized') {
      errorMessage = 'Permission denied. Please ensure Firebase Storage rules allow uploads.';
    } else if (error.code === 'storage/quota-exceeded') {
      errorMessage = 'Storage quota exceeded. Please contact support.';
    }
    throw new Error(errorMessage);
  }
}
