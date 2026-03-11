import { deleteObject, ref } from 'firebase/storage';
import { storage } from '../firebase';

export type UploadCategory = 
  | 'applications' 
  | 'products' 
  | 'reviews' 
  | 'avatars' 
  | 'notes' 
  | 'order-notes' 
  | 'categories' 
  | 'services' 
  | 'general';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Upload a file to Firebase Storage via backend API
 * Works for both authenticated and unauthenticated users
 * @param file - File to upload
 * @param category - The category/folder for the file
 * @param customName - Optional custom filename (without extension)
 * @returns Download URL of the uploaded file
 */
export async function uploadFile(
  file: File,
  category: UploadCategory = 'general',
  customName?: string
): Promise<string> {
  try {
    // Validate file
    if (!file) {
      throw new Error('No file provided');
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File is too large. Maximum size is 5MB (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    }

    // Validate file type for specific image uploads (skip for general/notes/order-notes)
    const imageOnlyCategories = ['products', 'reviews', 'avatars', 'categories', 'services'];
    const requiresImageValidation = imageOnlyCategories.includes(category);
    
    if (requiresImageValidation) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        throw new Error(`Invalid file type. Allowed: JPEG, PNG, WebP, GIF. Got: ${file.type}`);
      }
    }

    console.log(`[Upload] Starting upload via backend: ${category}/${file.name}, size: ${(file.size / 1024).toFixed(2)}KB, type: ${file.type}`);

    // Create FormData for backend upload
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);

    // Upload via backend API (works for guest users too)
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || errorData.error || `Upload failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    if (!data.url) {
      throw new Error('No download URL returned from server');
    }

    console.log(`[Upload] ✅ File uploaded successfully: ${data.url}`);
    return data.url;
  } catch (error: any) {
    console.error('[Upload Error]', error);
    console.error('[Upload Error Message]', error.message);
    
    // Provide clear error messages
    let errorMessage = 'Upload failed';
    
    if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * Upload multiple files at once
 * @param files - Array of files to upload
 * @param category - The category/folder for the files
 * @returns Array of download URLs
 */
export async function uploadMultipleFiles(
  files: File[],
  category: UploadCategory = 'general'
): Promise<string[]> {
  try {
    const uploadPromises = files.map(file => uploadFile(file, category));
    const downloadURLs = await Promise.all(uploadPromises);
    return downloadURLs;
  } catch (error: any) {
    console.error('[Batch Upload Error]:', error);
    throw new Error(`Failed to upload some files: ${error.message}`);
  }
}

/**
 * Delete a file from Firebase Storage
 * @param downloadUrl - The download URL of the file to delete
 */
export async function deleteFile(downloadUrl: string): Promise<void> {
  try {
    // Extract the path from the download URL
    const decodedUrl = decodeURIComponent(downloadUrl);
    const pathMatch = decodedUrl.match(/\/o\/(.+?)\?/);
    
    if (!pathMatch) {
      throw new Error('Invalid download URL format');
    }

    const filePath = pathMatch[1];
    const fileRef = ref(storage, filePath);

    console.log(`[Delete] Removing file: ${filePath}`);
    await deleteObject(fileRef);
    console.log(`[Delete] File removed successfully: ${filePath}`);
  } catch (error: any) {
    console.error('[Delete Error]:', error);
    
    let errorMessage = 'Delete failed';
    if (error.code === 'storage/object-not-found') {
      errorMessage = 'File not found. It may have been deleted already.';
    } else if (error.code === 'storage/unauthorized') {
      errorMessage = 'Permission denied. Cannot delete this file.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
}
