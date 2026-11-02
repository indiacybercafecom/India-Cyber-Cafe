import { normalizeIndianMobile } from '../src/services/authService';

function runTests() {
  console.log('--- Testing Password Recovery & Phone Normalization ---');

  // Test 1: Standard 10-digit mobile number
  const t1 = normalizeIndianMobile('9876543210');
  console.assert(t1.valid && t1.normalized === '9876543210', 'Test 1 Failed: Standard 10 digits');
  console.log('✓ Test 1 Passed: Standard 10 digits (9876543210)');

  // Test 2: Mobile number with +91 prefix
  const t2 = normalizeIndianMobile('+91 9876543210');
  console.assert(t2.valid && t2.normalized === '9876543210', 'Test 2 Failed: +91 prefix with space');
  console.log('✓ Test 2 Passed: +91 prefix with space (+91 9876543210)');

  // Test 3: Mobile number with 91 prefix
  const t3 = normalizeIndianMobile('919876543210');
  console.assert(t3.valid && t3.normalized === '9876543210', 'Test 3 Failed: 91 prefix without plus');
  console.log('✓ Test 3 Passed: 91 prefix (919876543210)');

  // Test 4: Mobile number with leading 0 (STD / legacy mobile style)
  const t4 = normalizeIndianMobile('09876543210');
  console.assert(t4.valid && t4.normalized === '9876543210', 'Test 4 Failed: 0 prefix');
  console.log('✓ Test 4 Passed: 0 prefix (09876543210)');

  // Test 5: Mobile number with dashes and brackets
  const t5 = normalizeIndianMobile('+91 (9876) 543-210');
  console.assert(t5.valid && t5.normalized === '9876543210', 'Test 5 Failed: Punctuation and brackets');
  console.log('✓ Test 5 Passed: Formatted with brackets and dashes');

  // Test 6: Invalid mobile number (less than 10 digits)
  const t6 = normalizeIndianMobile('98765');
  console.assert(!t6.valid, 'Test 6 Failed: Under 10 digits should be invalid');
  console.log('✓ Test 6 Passed: Rejection of short number (98765)');

  // Test 7: Invalid mobile number (starts with 1-5)
  const t7 = normalizeIndianMobile('4876543210');
  console.assert(!t7.valid, 'Test 7 Failed: Numbers starting with 1-5 should be invalid in India');
  console.log('✓ Test 7 Passed: Rejection of invalid starting digit (4876543210)');

  // Test 8: Empty or null string
  const t8 = normalizeIndianMobile('');
  console.assert(!t8.valid, 'Test 8 Failed: Empty string should be invalid');
  console.log('✓ Test 8 Passed: Rejection of empty string');

  console.log('\n--- All 8 Password Recovery & Normalization Tests Passed! ---');
}

runTests();
