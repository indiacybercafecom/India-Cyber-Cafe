export interface DriveUrls {
  previewUrl: string;
  downloadUrl: string;
}

export function normalizePdfUrl(value: string): DriveUrls | null {
  const input = value.trim();
  if (!input) return null;

  const fileIdMatch = input.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?.*id=)([a-zA-Z0-9_-]+)/);
  if (fileIdMatch?.[1]) {
    const fileId = fileIdMatch[1];
    return {
      previewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
    };
  }

  if (/^https:\/\//i.test(input)) {
    return { previewUrl: input, downloadUrl: input };
  }

  return null;
}
