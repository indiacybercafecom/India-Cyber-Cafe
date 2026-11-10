import { encryptToken, decryptToken } from '../src/server/crypto.js';
import {
  DEFAULT_CATEGORY_FOLDERS,
  DRIVE_FILE_SCOPE,
  USER_EMAIL_SCOPE,
  buildOAuthUrl,
  generateOAuthState,
  validateOAuthState,
} from '../src/server/driveService.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('--- Testing India Cyber Cafe: My Documents & Google Drive Integration ---\n');

  // Test 1: AES-256-GCM Token Encryption & Decryption
  try {
    const rawRefreshToken = '1//04_example_refresh_token_xyz123_456789_abcdef';
    const encrypted = encryptToken(rawRefreshToken);
    assert(typeof encrypted === 'string' && encrypted.split(':').length === 3, 'AES-256-GCM Encrypted format is iv:authTag:cipherText');
    assert(!encrypted.includes(rawRefreshToken), 'Plain refresh token never appears in encrypted output');

    const decrypted = decryptToken(encrypted);
    assert(decrypted === rawRefreshToken, 'AES-256-GCM Decrypted token matches original plain token exactly');
  } catch (err: any) {
    assert(false, `Token encryption test error: ${err.message}`);
  }

  // Test 2: Tamper Detection in Decryption
  try {
    const raw = 'test_token_secret';
    const encrypted = encryptToken(raw);
    const parts = encrypted.split(':');
    // Tamper with the cipher text
    const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}00`;
    let threw = false;
    try {
      decryptToken(tampered);
    } catch {
      threw = true;
    }
    assert(threw, 'AES-256-GCM throws error when ciphertext is tampered with');
  } catch (err: any) {
    assert(false, `Tamper test error: ${err.message}`);
  }

  // Test 3: OAuth State Generation & One-Time Validation
  try {
    const uid = 'test-uid-12345';
    const state = generateOAuthState(uid, '/my-documents/');
    assert(typeof state === 'string' && state.length > 10, 'OAuth state string generated');

    const validated = validateOAuthState(state);
    assert(validated !== null && validated.uid === uid && validated.redirectUrl === '/my-documents/', 'OAuth state validates authentic UID and return URL');

    const secondTry = validateOAuthState(state);
    assert(secondTry === null, 'OAuth state is consumed on first use (anti-replay)');
  } catch (err: any) {
    assert(false, `State test error: ${err.message}`);
  }

  // Test 4: OAuth URL and Preferred Scopes
  try {
    const state = 'dummy_state_token';
    const redirectUri = 'https://b.indiacybercafe.com/api/drive/callback';
    const authUrl = buildOAuthUrl(state, redirectUri);

    assert(authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'OAuth URL starts with Google Accounts endpoint');
    assert(authUrl.includes(encodeURIComponent(DRIVE_FILE_SCOPE)), 'OAuth URL requests https://www.googleapis.com/auth/drive.file scope');
    assert(authUrl.includes('access_type=offline'), 'OAuth URL includes access_type=offline for refresh token');
    assert(authUrl.includes('prompt=consent'), 'OAuth URL requests consent prompt');
  } catch (err: any) {
    assert(false, `OAuth URL test error: ${err.message}`);
  }

  // Test 5: Default Folder Structure Specification
  try {
    assert(DEFAULT_CATEGORY_FOLDERS.length === 7, 'Standard structure contains exactly 7 primary categories');
    assert(DEFAULT_CATEGORY_FOLDERS.includes('Identity Documents'), 'Includes Identity Documents');
    assert(DEFAULT_CATEGORY_FOLDERS.includes('Education Documents'), 'Includes Education Documents');
    assert(DEFAULT_CATEGORY_FOLDERS.includes('Banking Documents'), 'Includes Banking Documents');
    assert(DEFAULT_CATEGORY_FOLDERS.includes('Certificates'), 'Includes Certificates');
    assert(DEFAULT_CATEGORY_FOLDERS.includes('Government Documents'), 'Includes Government Documents');
    assert(DEFAULT_CATEGORY_FOLDERS.includes('Personal Documents'), 'Includes Personal Documents');
    assert(DEFAULT_CATEGORY_FOLDERS.includes('Other Documents'), 'Includes Other Documents');
  } catch (err: any) {
    assert(false, `Default folder test error: ${err.message}`);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
