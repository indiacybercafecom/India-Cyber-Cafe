import assert from 'node:assert';
import { getFriendlyErrorMessage } from '../src/utils/errorHandler';
import { mapAuthError } from '../src/services/authService';

console.log('🧪 Starting Global Error Handler & Toast Verification Tests...\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✅ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// 1. Firebase Auth Errors & Account Enumeration Prevention
runTest('Auth: auth/wrong-password maps to "Incorrect email or password."', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/wrong-password', message: 'Firebase: Error (auth/wrong-password).' });
  assert.strictEqual(result, 'Incorrect email or password.');
});

runTest('Auth: auth/user-not-found maps to "Incorrect email or password." (Anti-enumeration)', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/user-not-found', message: 'There is no user record corresponding to this identifier.' });
  assert.strictEqual(result, 'Incorrect email or password.');
});

runTest('Auth: auth/invalid-credential maps to "Incorrect email or password."', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/invalid-credential', message: 'Invalid credentials provided.' });
  assert.strictEqual(result, 'Incorrect email or password.');
});

runTest('Auth: "No account found with this phone number." maps to "Incorrect email or password."', () => {
  const result = getFriendlyErrorMessage(new Error('No account found with this phone number.'));
  assert.strictEqual(result, 'Incorrect email or password.');
});

runTest('Auth: auth/email-already-in-use maps to "Email already registered."', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/email-already-in-use', message: 'The email address is already in use by another account.' });
  assert.strictEqual(result, 'Email already registered.');
});

runTest('Auth: auth/network-request-failed maps to "Please check your internet connection."', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/network-request-failed', message: 'A network error has occurred.' });
  assert.strictEqual(result, 'Please check your internet connection.');
});

runTest('Auth: auth/too-many-requests maps to "Too many attempts. Please try again later."', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/too-many-requests', message: 'Access to this account has been temporarily disabled due to many failed login attempts.' });
  assert.strictEqual(result, 'Too many attempts. Please try again later.');
});

runTest('Auth: auth/user-disabled maps to "This account has been disabled. Please contact support."', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/user-disabled', message: 'The user account has been disabled by an administrator.' });
  assert.strictEqual(result, 'This account has been disabled. Please contact support.');
});

runTest('Auth: auth/popup-closed-by-user maps to "Sign-in was cancelled. Please try again."', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/popup-closed-by-user', message: 'The popup has been closed by the user before finalizing the operation.' });
  assert.strictEqual(result, 'Sign-in was cancelled. Please try again.');
});

runTest('Auth: auth/popup-blocked maps to "Popup was blocked by your browser. Please allow popups and try again."', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/popup-blocked', message: 'Unable to open popup window.' });
  assert.strictEqual(result, 'Popup was blocked by your browser. Please allow popups and try again.');
});

runTest('Auth: auth/unauthorized-domain does NOT leak Firebase Console details', () => {
  const result = getFriendlyErrorMessage({ code: 'auth/unauthorized-domain', message: 'This domain is not authorized in Firebase Console.' });
  assert.strictEqual(result, 'Google sign-in is temporarily unavailable. Please try another method.');
  assert.ok(!result.includes('Firebase'), 'Message must not contain Firebase');
  assert.ok(!result.includes('Console'), 'Message must not contain Console');
});

runTest('Auth: mapAuthError delegates correctly to centralized error handler', () => {
  const result = mapAuthError({ code: 'auth/wrong-password' });
  assert.strictEqual(result, 'Incorrect email or password.');
});

// 2. Firebase Storage Errors
runTest('Storage: storage/unauthorized maps to "Unable to upload file. Please try again."', () => {
  const result = getFriendlyErrorMessage({ code: 'storage/unauthorized', message: 'User does not have permission to access storage.' });
  assert.strictEqual(result, 'Unable to upload file. Please try again.');
});

runTest('Storage: storage/quota-exceeded maps to "Unable to upload file. Please try again."', () => {
  const result = getFriendlyErrorMessage({ code: 'storage/quota-exceeded', message: 'Quota on bucket exceeded.' });
  assert.strictEqual(result, 'Unable to upload file. Please try again.');
});

// 3. Realtime Database & Permission Errors
runTest('Database: PERMISSION_DENIED maps to "You do not have permission to perform this action."', () => {
  const result = getFriendlyErrorMessage({ code: 'PERMISSION_DENIED', message: 'Client doesn\'t have permission to access the desired data.' });
  assert.strictEqual(result, 'You do not have permission to perform this action.');
});

// 4. Razorpay & Payment Errors
runTest('Payment: Payment verification failure maps to "Payment could not be verified."', () => {
  const result = getFriendlyErrorMessage(new Error('Payment verification failed: signature mismatch for order_123'));
  assert.strictEqual(result, 'Payment could not be verified.');
  assert.ok(!result.includes('order_123'), 'Must not leak order ID in error');
  assert.ok(!result.includes('signature'), 'Must not leak cryptographic terms');
});

runTest('Payment: Payment cancelled maps to "Payment was cancelled. You can try again whenever you\'re ready."', () => {
  const result = getFriendlyErrorMessage(new Error('Payment modal closed by user'));
  assert.strictEqual(result, 'Payment was cancelled. You can try again whenever you\'re ready.');
});

runTest('Payment: Failed to initiate payment maps to "Unable to start payment. Please try again."', () => {
  const result = getFriendlyErrorMessage(new Error('Failed to initiate payment: script checkout error'));
  assert.strictEqual(result, 'Unable to start payment. Please try again.');
});

// 5. Network Errors
runTest('Network: "Failed to fetch" maps to "Please check your internet connection."', () => {
  const result = getFriendlyErrorMessage(new TypeError('Failed to fetch'));
  assert.strictEqual(result, 'Please check your internet connection.');
});

runTest('Network: "net::ERR_INTERNET_DISCONNECTED" maps to "Please check your internet connection."', () => {
  const result = getFriendlyErrorMessage(new Error('net::ERR_INTERNET_DISCONNECTED at /api/data'));
  assert.strictEqual(result, 'Please check your internet connection.');
});

// 6. Preservation of Meaningful Validation Messages
runTest('Validation: "Please enter password" is preserved', () => {
  const result = getFriendlyErrorMessage('Please enter password');
  assert.strictEqual(result, 'Please enter password');
});

runTest('Validation: "File size must be less than 5MB" is preserved', () => {
  const result = getFriendlyErrorMessage('File size must be less than 5MB');
  assert.strictEqual(result, 'File size must be less than 5MB');
});

runTest('Validation: "Please enter a valid 10-digit Indian mobile number." is preserved', () => {
  const result = getFriendlyErrorMessage('Please enter a valid 10-digit Indian mobile number.');
  assert.strictEqual(result, 'Please enter a valid 10-digit Indian mobile number.');
});

runTest('Validation: "Category name is required" is preserved', () => {
  const result = getFriendlyErrorMessage('Category name is required');
  assert.strictEqual(result, 'Category name is required');
});

// 7. Sanitization of Technical Errors & Safe Generic Fallbacks
runTest('Technical: TypeError stack trace is scrubbed to generic fallback', () => {
  const techError = new TypeError("Cannot read properties of undefined (reading 'uid') at Object.render (/src/App.tsx:42)");
  const result = getFriendlyErrorMessage(techError);
  assert.strictEqual(result, 'Something went wrong. Please try again.');
  assert.ok(!result.includes('Cannot read properties'));
  assert.ok(!result.includes('App.tsx'));
});

runTest('Technical: Unknown server error returns contextual fallback if provided', () => {
  const result = getFriendlyErrorMessage('DATABASE_CORRUPT_500_FAIL', 'Failed to save product. Please try again.');
  assert.strictEqual(result, 'Failed to save product. Please try again.');
});

console.log(`\n========================================`);
console.log(`Results: ${passedTests} / ${totalTests} tests passed.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
