import { normalizeIndianMobile, mapAuthError } from '../src/services/authService';
import { sanitizeUserProfile, sanitizeEmail } from '../src/utils/sanitizer';

console.log('🧪 Starting Authentication & Validation Tests...\n');

let passed = 0;
let total = 0;

function assert(name: string, condition: boolean, details?: string) {
  total++;
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${name}: ${details || 'Assertion failed'}`);
  }
}

// 1. Indian Mobile Number Validation & Normalization
console.log('--- Testing Mobile Number Normalization ---');

const testCases = [
  { input: '9876543210', expected: '9876543210', valid: true, desc: 'Standard 10-digit' },
  { input: '+919876543210', expected: '9876543210', valid: true, desc: '+91 prefixed' },
  { input: '+91 98765 43210', expected: '9876543210', valid: true, desc: '+91 with spaces' },
  { input: '09876543210', expected: '9876543210', valid: true, desc: 'Leading 0 (11-digit)' },
  { input: '919876543210', expected: '9876543210', valid: true, desc: 'Leading 91 without plus (12-digit)' },
  { input: '8123456789', expected: '8123456789', valid: true, desc: 'Starting with 8' },
  { input: '7123456789', expected: '7123456789', valid: true, desc: 'Starting with 7' },
  { input: '6123456789', expected: '6123456789', valid: true, desc: 'Starting with 6' },
  { input: '5123456789', valid: false, desc: 'Starting with 5 (Invalid Indian mobile prefix)' },
  { input: '12345', valid: false, desc: 'Too short (5 digits)' },
  { input: 'abcdefghij', valid: false, desc: 'Alphabetic input' },
  { input: '', valid: false, desc: 'Empty input' },
];

for (const tc of testCases) {
  const res = normalizeIndianMobile(tc.input);
  if (tc.valid) {
    assert(
      `Mobile Normalization: ${tc.desc} (${tc.input})`,
      res.valid === true && res.normalized === tc.expected,
      `Got valid=${res.valid}, normalized=${res.normalized}`
    );
  } else {
    assert(
      `Mobile Rejection: ${tc.desc} (${tc.input})`,
      res.valid === false && Boolean(res.error),
      `Expected invalid, got valid=${res.valid}`
    );
  }
}

// 2. Profile Sanitization & Field Preservation
console.log('\n--- Testing Profile Sanitization & Field Preservation ---');

const rawProfile = {
  uid: 'usr_test_123',
  name: '  Ramesh Kumar  ',
  email: 'RAMESH@EXAMPLE.COM ',
  phone: ' 9876543210 ',
  role: 'user',
  avatar: 'https://example.com/photo.jpg',
  authProvider: 'google',
  phoneVerified: true,
  profileCompleted: true,
  createdAt: 1793450000000,
  updatedAt: 1793450000000,
  randomDisallowedField: 'should_be_stripped',
};

const sanitized = sanitizeUserProfile(rawProfile);

assert('Sanitization: name is trimmed', sanitized.name === 'Ramesh Kumar');
assert('Sanitization: email is preserved and trimmed', sanitized.email === 'RAMESH@EXAMPLE.COM');
assert('Sanitization: authProvider "google" preserved', sanitized.authProvider === 'google');
assert('Sanitization: phoneVerified boolean preserved', sanitized.phoneVerified === true);
assert('Sanitization: profileCompleted boolean preserved', sanitized.profileCompleted === true);
assert('Sanitization: createdAt and updatedAt preserved', sanitized.createdAt === 1793450000000 && sanitized.updatedAt === 1793450000000);
assert('Sanitization: disallowed fields stripped', (sanitized as any).randomDisallowedField === undefined);

// 3. Email Sanitization
console.log('\n--- Testing Email Sanitization ---');
const emailResult = sanitizeEmail('  User.Name+Tag@GMAIL.com  ');
assert('Email lowercase and trim', emailResult === 'user.name+tag@gmail.com');

// 4. Auth Error Mapping
console.log('\n--- Testing Error Message Mapping ---');
const popupClosedErr = { code: 'auth/popup-closed-by-user' };
assert(
  'Error mapping: popup-closed-by-user',
  mapAuthError(popupClosedErr).includes('closed before completing')
);

const unauthDomainErr = { code: 'auth/unauthorized-domain' };
assert(
  'Error mapping: unauthorized-domain',
  mapAuthError(unauthDomainErr).includes('Authorized Domains')
);

const accountExistsErr = { code: 'auth/account-exists-with-different-credential' };
assert(
  'Error mapping: account-exists-with-different-credential',
  mapAuthError(accountExistsErr).includes('already exists')
);

console.log(`\n========================================`);
console.log(`Results: ${passed} / ${total} tests passed.`);
console.log(`========================================\n`);

if (passed === total) {
  process.exit(0);
} else {
  process.exit(1);
}
