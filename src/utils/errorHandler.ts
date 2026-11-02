/**
 * Centralized Global User-Friendly Error & Toast Handler
 * 
 * Maps Firebase Auth, Realtime Database, Storage, Razorpay, Network, HTTP,
 * and Server errors into clear, short, professional user-facing messages.
 * 
 * Rules:
 * 1. Never expose internal technical details, Firebase/Razorpay names, stack traces,
 *    or database paths to the end user.
 * 2. Log full technical details exclusively in developer console for debugging.
 * 3. Preserve human-friendly validation messages (e.g. required fields, valid phone numbers).
 * 4. Prevent account enumeration by returning generic authentication failure messages.
 * 5. Unknown errors always resolve to a safe generic message.
 */

// Patterns indicating raw, unformatted technical details or stack traces
const TECHNICAL_PATTERNS = [
  /firebase/i,
  /auth\//i,
  /storage\//i,
  /rtdb/i,
  /firestore/i,
  /razorpay/i,
  /rzp_/i,
  /signature/i,
  /typeerror/i,
  /referenceerror/i,
  /syntaxerror/i,
  /rangeerror/i,
  /cannot read propert/i,
  /is not a function/i,
  /null is not an object/i,
  /undefined/i,
  /stack trace/i,
  /at object\./i,
  /at function\./i,
  /json\.parse/i,
  /unexpected token/i,
  /\[object object\]/i,
  /http:\/\//i,
  /https:\/\//i,
  /\/api\//i,
  /failed with status \d{3}/i,
  /internal server error/i,
  /database error/i,
  /permission_denied/i,
  /econnrefused/i,
  /etimedout/i,
];

// Patterns representing valid, human-crafted client validation messages
const SAFE_VALIDATION_PATTERNS = [
  /^please enter/i,
  /^please select/i,
  /^please provide/i,
  /^please choose/i,
  /^please check/i,
  /^please fix/i,
  /is required$/i,
  /are required$/i,
  /required\./i,
  /file size/i,
  /too large/i,
  /valid 10-digit/i,
  /valid mobile/i,
  /valid email/i,
  /valid image/i,
  /valid pdf/i,
  /already registered/i,
  /must be greater than/i,
  /cannot be negative/i,
  /password must be/i,
  /passwords do not match/i,
];

/**
 * Normalizes any error object, string, or code into a user-friendly message.
 *
 * @param error Any thrown error, error code, response object, or string
 * @param fallback Optional friendly fallback if no specific rule matches
 * @returns Short, human-friendly, professional message
 */
export function getFriendlyErrorMessage(error: unknown, fallback: string = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;

  // Log full technical error details for developers
  try {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[ICC App Error Debug]', error);
    }
  } catch {}

  // Extract code and message from error
  let code = '';
  let rawMessage = '';

  if (typeof error === 'string') {
    rawMessage = error.trim();
  } else if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, any>;
    code = String(errObj.code || errObj.errorCode || errObj.status || '').trim();
    rawMessage = String(errObj.message || errObj.error || errObj.description || '').trim();
  }

  const lowerCode = code.toLowerCase();
  const lowerMsg = rawMessage.toLowerCase();

  // 1. Account Enumeration Protection & Credential Verification
  if (
    lowerCode === 'auth/wrong-password' ||
    lowerCode === 'auth/user-not-found' ||
    lowerCode === 'auth/invalid-credential' ||
    lowerCode === 'auth/invalid-login-credentials' ||
    lowerMsg.includes('wrong-password') ||
    lowerMsg.includes('user-not-found') ||
    lowerMsg.includes('invalid-credential') ||
    lowerMsg.includes('no account found with this') ||
    lowerMsg.includes('user account not found') ||
    lowerMsg.includes('incorrect password') ||
    lowerMsg.includes('invalid email/mobile or password')
  ) {
    return 'Incorrect email or password.';
  }

  // 2. Firebase Auth - Known Codes
  if (lowerCode === 'auth/email-already-in-use' || lowerMsg.includes('email-already-in-use') || lowerMsg.includes('email already registered')) {
    return 'Email already registered.';
  }

  if (lowerCode === 'auth/account-exists-with-different-credential' || lowerMsg.includes('account-exists-with-different-credential')) {
    return 'An account already exists with this email using a different sign-in method.';
  }

  if (lowerCode === 'auth/too-many-requests' || lowerMsg.includes('too-many-requests')) {
    return 'Too many attempts. Please try again later.';
  }

  if (lowerCode === 'auth/user-disabled' || lowerMsg.includes('user-disabled')) {
    return 'This account has been disabled. Please contact support.';
  }

  if (
    lowerCode === 'auth/popup-closed-by-user' ||
    lowerCode === 'auth/cancelled-popup-request' ||
    lowerMsg.includes('popup-closed-by-user') ||
    lowerMsg.includes('cancelled-popup-request')
  ) {
    return 'Sign-in was cancelled. Please try again.';
  }

  if (lowerCode === 'auth/popup-blocked' || lowerMsg.includes('popup-blocked')) {
    return 'Popup was blocked by your browser. Please allow popups and try again.';
  }

  if (
    lowerCode === 'auth/unauthorized-domain' ||
    lowerCode === 'auth/operation-not-allowed' ||
    lowerMsg.includes('unauthorized-domain') ||
    lowerMsg.includes('operation-not-allowed')
  ) {
    return 'Google sign-in is temporarily unavailable. Please try another method.';
  }

  if (lowerCode === 'auth/requires-recent-login' || lowerMsg.includes('requires-recent-login')) {
    return 'Please log in again to complete this action.';
  }

  if (lowerCode === 'auth/weak-password' || lowerMsg.includes('weak-password')) {
    return 'Password must be at least 6 characters.';
  }

  if (lowerCode === 'auth/invalid-email' || lowerMsg.includes('invalid-email')) {
    return 'Please enter a valid email address.';
  }

  if (lowerCode === 'auth/user-token-expired' || lowerMsg.includes('token-expired')) {
    return 'Your session has expired. Please log in again.';
  }

  // 3. Network & Connectivity Errors
  if (
    lowerCode === 'auth/network-request-failed' ||
    lowerMsg.includes('network-request-failed') ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('network error') ||
    lowerMsg.includes('net::err_') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('abort') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('internet connection') ||
    lowerMsg.includes('offline') ||
    lowerMsg.includes('load failed')
  ) {
    return 'Please check your internet connection.';
  }

  // 4. File Storage & Upload Errors
  if (
    lowerCode.startsWith('storage/') ||
    lowerMsg.includes('storage/') ||
    lowerMsg.includes('failed to upload image') ||
    lowerMsg.includes('upload failed') ||
    lowerMsg.includes('unable to upload')
  ) {
    // If it's a size/validation error, let the validation section catch it below
    if (lowerMsg.includes('size') || lowerMsg.includes('limit') || lowerMsg.includes('image file')) {
      // Handled by validation
    } else {
      return 'Unable to upload file. Please try again.';
    }
  }

  // 5. Razorpay & Payment Errors
  if (
    lowerMsg.includes('payment verification failed') ||
    lowerMsg.includes('verification failed') ||
    lowerMsg.includes('payment could not be verified') ||
    lowerMsg.includes('signature verification') ||
    lowerMsg.includes('signature mismatch')
  ) {
    return 'Payment could not be verified.';
  }

  if (
    lowerMsg.includes('payment cancelled') ||
    lowerMsg.includes('payment modal closed') ||
    lowerMsg.includes('cancelled by user')
  ) {
    return 'Payment was cancelled. You can try again whenever you\'re ready.';
  }

  if (
    lowerMsg.includes('failed to initiate payment') ||
    lowerMsg.includes('checkout is not available') ||
    lowerMsg.includes('payment system not available') ||
    lowerMsg.includes('razorpay script')
  ) {
    return 'Unable to start payment. Please try again.';
  }

  // 6. Database / Permission Errors
  if (
    lowerCode === 'permission_denied' ||
    lowerMsg.includes('permission_denied') ||
    lowerMsg.includes('permission denied')
  ) {
    return 'You do not have permission to perform this action.';
  }

  // 7. Human Validation Messages Preservation
  // If the rawMessage is already a clear, non-technical validation message, preserve it.
  const containsTechnicalDetails = TECHNICAL_PATTERNS.some(pat => pat.test(rawMessage));
  const isSafeValidation = SAFE_VALIDATION_PATTERNS.some(pat => pat.test(rawMessage));

  if (!containsTechnicalDetails && isSafeValidation) {
    return rawMessage;
  }

  // If rawMessage is clean, short (under 80 characters), has no technical details, and looks like human text
  if (
    !containsTechnicalDetails &&
    rawMessage.length > 5 &&
    rawMessage.length < 80 &&
    !rawMessage.includes('{') &&
    !rawMessage.includes('}') &&
    !rawMessage.includes('null') &&
    !rawMessage.includes('undefined') &&
    !/^[a-z0-9_-]+$/i.test(rawMessage) // not a raw code like "ERR_UNKNOWN"
  ) {
    return rawMessage;
  }

  // 8. Safe Fallback for any unknown / technical error
  return fallback;
}
