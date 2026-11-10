import crypto from 'crypto';

// AES-256-GCM requires a 32-byte key
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

function getEncryptionKey() {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (envKey && envKey.trim().length > 0) {
    return crypto.createHash('sha256').update(envKey.trim()).digest();
  }

  // Deterministic fallback derived from server secrets or project config
  const fallbackSource =
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.FIREBASE_PROJECT_ID ||
    'india-cyber-cafe-drive-token-encryption-fallback-key-2026';
  return crypto.createHash('sha256').update(fallbackSource).digest();
}


/**
 * Encrypt a plain text string (e.g. OAuth refresh token) using AES-256-GCM.
 * Output format: iv:authTag:cipherText (all hex encoded)
 */
export function encryptToken(plainText) {
  if (!plainText) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Input format: iv:authTag:cipherText (all hex encoded)
 */
export function decryptToken(encryptedPayload) {
  if (!encryptedPayload) return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token payload format');
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
