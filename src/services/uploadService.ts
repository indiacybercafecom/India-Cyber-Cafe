export async function uploadFile(file: File, category: string = 'general'): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);

  // Use the PHP uploader endpoint
  const response = await fetch('/uploader/upload.php', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Upload failed: Server error');
  }

  const data = await response.json();
  
  if (data.status === 'success') {
    return data.file_url;
  } else {
    throw new Error(data.message || 'Upload failed');
  }
}
