import crypto from 'crypto';

// AES-256-GCM requires a 32-byte key
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

// Get or derive a deterministic 32-byte encryption key
function getEncryptionKey(): Buffer {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (envKey && envKey.trim().length >= 32) {
    return crypto.createHash('sha256').update(envKey.trim()).digest();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CRITICAL SECURITY ERROR: TOKEN_ENCRYPTION_KEY environment variable is required in production and must be at least 32 characters long. Insecure fallback keys are disabled in production.'
    );
  }

  // Development fallback only
  return crypto.createHash('sha256').update('icc-local-dev-fallback-key-strictly-non-production').digest();
}

/**
 * Encrypt a plain text string (e.g. OAuth refresh token) using AES-256-GCM.
 * Output format: iv:authTag:cipherText (all hex encoded)
 */
export function encryptToken(plainText: string): string {
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
export function decryptToken(encryptedPayload: string): string {
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
