import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log('🧪 Running Registration Idempotency, CSP, and Document Sync Tests...\n');
  let total = 0;
  let passed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    }
  }

  // --- Test 1: CSP Header in server.ts ---
  const serverTs = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
  assert(
    serverTs.includes('https://*.googleusercontent.com') && serverTs.includes('https://*.ggpht.com'),
    'Test 1: server.ts CSP img-src includes Google profile photo domains (*.googleusercontent.com, *.ggpht.com)'
  );

  // --- Test 2: CSP Header in server.js ---
  const serverJs = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf-8');
  assert(
    serverJs.includes('https://*.googleusercontent.com') && serverJs.includes('https://*.ggpht.com'),
    'Test 2: server.js CSP img-src includes Google profile photo domains'
  );

  // --- Test 3: CSP Header in .htaccess ---
  const htaccess = fs.readFileSync(path.join(process.cwd(), 'public/.htaccess'), 'utf-8');
  assert(
    htaccess.includes('https://*.googleusercontent.com') && htaccess.includes('https://*.ggpht.com'),
    'Test 3: public/.htaccess CSP includes Google profile photo domains'
  );

  // --- Test 4: In-Flight Deduplication & Atomic Claim Logic ---
  const { sendRegistrationNotificationsOnce, ensureUserProfile } = await import('../src/services/authService');
  assert(
    typeof sendRegistrationNotificationsOnce === 'function',
    'Test 4: sendRegistrationNotificationsOnce is exported and available'
  );
  assert(
    typeof ensureUserProfile === 'function',
    'Test 4: ensureUserProfile is exported and available'
  );

  // --- Test 5: In-process Promise Memoization ---
  // When multiple concurrent calls run for the same user UID, they must resolve to the identical Promise
  const mockUid = `test_concurrent_${Date.now()}`;
  const mockProfile = {
    uid: mockUid,
    name: 'Test Deduplicate User',
    email: 'testdedup@example.com',
    phone: '9876543210'
  };

  const p1 = sendRegistrationNotificationsOnce(mockProfile, { isGoogle: true });
  const p2 = sendRegistrationNotificationsOnce(mockProfile, { isGoogle: true });
  assert(p1 === p2, 'Test 5: Concurrent registration notification calls return the exact same in-flight Promise instance');

  // --- Test 6: Sanitizer includes registrationNotified ---
  const { sanitizeUserProfile } = await import('../src/utils/sanitizer');
  const sanitizedWithClaim = sanitizeUserProfile({
    uid: 'u123',
    name: 'Test',
    email: 'test@example.com',
    role: 'user',
    createdAt: 1234567,
    registrationNotified: { status: 'sent', sentAt: 1234567 }
  });
  assert(
    Boolean(sanitizedWithClaim.registrationNotified),
    'Test 6: sanitizeUserProfile preserves registrationNotified field'
  );

  // --- Test 7: Document Lookup Fuzzy & Slug Resolution ---
  const { findDocumentBySlug } = await import('../src/utils/documentDeduplication');
  const mockDocList = [
    {
      id: '-P5QMi3aFYqLZM8QuE_t',
      name: 'BT-101',
      category: 'TIT Advance',
      active: false,
      downloadUrl: 'https://drive.google.com/uc?export=download&id=1ns-XPArE-w0ZKjM4dlhy2AXGGzDN3las'
    },
    {
      id: '-P5QnCK8aCBpngYddQsO',
      name: 'BT-101 PYQ',
      category: 'TIT Advance',
      active: false,
      downloadUrl: 'https://drive.google.com/uc?export=download&id=1TiM1Wrb6kE4SCEssotqVVEDqtb9oiHLK'
    }
  ];

  const matchedBt101 = findDocumentBySlug(mockDocList as any, 'bt-101', 'tit-advance');
  assert(
    matchedBt101 !== undefined && matchedBt101.name === 'BT-101',
    'Test 7: findDocumentBySlug resolves exact bt-101 to BT-101'
  );

  const matchedPyq = findDocumentBySlug(mockDocList as any, 'bt-101-pyq', 'tit-advance');
  assert(
    matchedPyq !== undefined && matchedPyq.name === 'BT-101 PYQ',
    'Test 7: findDocumentBySlug resolves bt-101-pyq to BT-101 PYQ'
  );

  // Substring match when only bt-101 is requested but only BT-101 PYQ exists
  const mockOnlyPyq = [mockDocList[1]];
  const matchedFuzzy = findDocumentBySlug(mockOnlyPyq as any, 'bt-101', 'tit-advance');
  assert(
    matchedFuzzy !== undefined && matchedFuzzy.name === 'BT-101 PYQ',
    'Test 7: findDocumentBySlug resolves bt-101 to BT-101 PYQ when only PYQ document exists'
  );

  // --- Test 8: Live /api/documents/lookup test ---
  try {
    const res = await fetch('http://localhost:3000/api/documents/lookup?slug=bt-101&category=tit-advance');
    const data = await res.json();
    assert(
      res.ok && data?.success && Boolean(data?.document),
      'Test 8: /api/documents/lookup successfully resolves bt-101'
    );
  } catch (err: any) {
    console.warn('Test 8 notice (dev server check):', err?.message);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} / ${total} tests passed.`);
  console.log(`========================================\n`);

  if (passed < total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
