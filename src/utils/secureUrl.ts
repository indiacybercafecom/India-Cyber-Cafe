export function secureUrl(url?: string): string | undefined {
  if (!url) {
    return url;
  }

  return url.replace(/^http:\/\//i, 'https://');
}
