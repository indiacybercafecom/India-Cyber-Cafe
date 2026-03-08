/**
 * Generate Order ID in format: ICC/STORE-DDMMYYYY-HHMMSS-XXXXX
 * Example: ICC/STORE-08032026-064420-02047
 */
export function generateOrderId(): string {
  const now = new Date();
  
  // Format: DDMMYYYY
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const dateStr = `${day}${month}${year}`;
  
  // Format: HHMMSS
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timeStr = `${hours}${minutes}${seconds}`;
  
  // Generate 5-digit random number
  const randomNum = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  
  return `ICC/STORE-${dateStr}-${timeStr}-${randomNum}`;
}
