/**
 * Generate a URL-friendly permalink/slug from a product name
 * Examples:
 * "Premium T-Shirt" -> "premium-t-shirt"
 * "Nike Air Max 90" -> "nike-air-max-90"
 * "MacBook Pro (16 inch)" -> "macbook-pro-16-inch"
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase() // Convert to lowercase
    .trim() // Remove leading/trailing whitespace
    .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens and spaces
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Generate a unique permalink by appending a timestamp if needed
 * This ensures even products with the same name get unique permalinks
 */
export function generateUniqueSlug(name: string, existingSlugs: string[] = []): string {
  let slug = generateSlug(name);
  
  // If slug already exists, append a short timestamp
  if (existingSlugs.includes(slug)) {
    const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
    slug = `${slug}-${timestamp}`;
  }
  
  return slug;
}
