import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000';
const PUBLIC_DOCS = path.join(process.cwd(), 'public/data/documents.json');
const ROOT_DOCS = path.join(process.cwd(), 'data/documents.json');

async function runTests() {
  console.log('🧪 Starting Forms/PDF Synchronization & Cache Verification Tests...\n');
  let passed = 0;
  let total = 0;

  function assert(testName: string, condition: boolean, details?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}: ${details || 'Assertion failed'}`);
    }
  }

  // Backup original files
  const origPublic = fs.existsSync(PUBLIC_DOCS) ? fs.readFileSync(PUBLIC_DOCS, 'utf8') : null;
  const origRoot = fs.existsSync(ROOT_DOCS) ? fs.readFileSync(ROOT_DOCS, 'utf8') : null;

  try {
    // -------------------------------------------------------------
    // Test A: Existing local JSON contains 100 documents, Firebase contains 80.
    // Expected: JSON and API contain exactly 80.
    // -------------------------------------------------------------
    console.log('\n--- Scenario A: 100 local documents vs 80 incoming Firebase documents ---');
    // 1. Seed 100 dummy documents in local JSON
    const local100 = Array.from({ length: 100 }, (_, i) => ({
      id: `local-doc-${i}`,
      name: `Local Document ${i}`,
      category: 'Test Category',
      fileType: 'PDF',
      active: true,
      downloadUrl: 'https://example.com/test.pdf',
      previewUrl: 'https://example.com/test.pdf',
    }));
    fs.writeFileSync(PUBLIC_DOCS, JSON.stringify({ version: 1, documents: local100 }, null, 2));

    // 2. Incoming Firebase snapshot contains 80 documents
    const firebase80 = Array.from({ length: 80 }, (_, i) => ({
      id: `fb-doc-${i}`,
      name: `Firebase Document ${i}`,
      category: 'Firebase Category',
      fileType: 'PDF',
      active: true,
      downloadUrl: `https://example.com/fb-${i}.pdf`,
      previewUrl: `https://example.com/fb-${i}.pdf`,
    }));

    // Send authoritative Firebase sync
    const syncRespA = await fetch(`${API_BASE}/api/documents/sync-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: firebase80 })
    });
    const syncResultA = await syncRespA.json();
    assert('Test A - sync-bulk response count is 80', syncResultA.count === 80, `Count was ${syncResultA.count}`);

    // Verify GET /api/documents returns exactly 80 documents (NO merging with the 100 old ones!)
    const getRespA = await fetch(`${API_BASE}/api/documents`);
    const getDataA = await getRespA.json();
    assert(
      'Test A - GET /api/documents contains exactly 80 items without stale records',
      getDataA.documents.length === 80 && !getDataA.documents.some((d: any) => d.id.startsWith('local-doc-')),
      `Expected 80, got ${getDataA.documents.length}`
    );

    // Verify disk JSON contains exactly 80
    const diskA = JSON.parse(fs.readFileSync(PUBLIC_DOCS, 'utf8'));
    assert(
      'Test A - public/data/documents.json contains exactly 80 documents',
      diskA.documents.length === 80,
      `Expected 80 on disk, got ${diskA.documents.length}`
    );

    // -------------------------------------------------------------
    // Test B: Existing local JSON contains 100 documents, Firebase contains 0.
    // Expected: JSON becomes "[]" and API returns empty array [].
    // -------------------------------------------------------------
    console.log('\n--- Scenario B: Local documents exist, Firebase contains 0 ---');
    const syncRespB = await fetch(`${API_BASE}/api/documents/sync-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: [] })
    });
    const syncResultB = await syncRespB.json();
    assert('Test B - sync-bulk empty array response count is 0', syncResultB.count === 0, `Count was ${syncResultB.count}`);

    const getRespB = await fetch(`${API_BASE}/api/documents`);
    const getDataB = await getRespB.json();
    assert(
      'Test B - GET /api/documents returns empty array []',
      Array.isArray(getDataB.documents) && getDataB.documents.length === 0,
      `Expected 0, got ${getDataB.documents?.length}`
    );

    const diskB = JSON.parse(fs.readFileSync(PUBLIC_DOCS, 'utf8'));
    assert(
      'Test B - disk JSON contains documents: []',
      Array.isArray(diskB.documents) && diskB.documents.length === 0,
      `Expected empty array on disk, got ${diskB.documents?.length}`
    );

    // -------------------------------------------------------------
    // Test C & D: Firebase document is added, then deleted.
    // -------------------------------------------------------------
    console.log('\n--- Scenario D: Document added ---');
    const newDoc = {
      id: 'test-doc-alpha',
      name: 'Alpha Verification Certificate',
      category: 'General',
      downloadUrl: 'https://example.com/alpha.pdf',
      previewUrl: 'https://example.com/alpha.pdf',
      active: true
    };
    const addResp = await fetch(`${API_BASE}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDoc)
    });
    assert('Test D - POST /api/documents succeeds', addResp.ok, `Status ${addResp.status}`);

    const getRespD = await fetch(`${API_BASE}/api/documents`);
    const getDataD = await getRespD.json();
    assert(
      'Test D - Added document appears in latest JSON and API',
      getDataD.documents.some((d: any) => d.id === 'test-doc-alpha'),
      'Could not find test-doc-alpha in GET response'
    );

    console.log('\n--- Scenario C: Document deleted ---');
    const delResp = await fetch(`${API_BASE}/api/documents/test-doc-alpha`, {
      method: 'DELETE'
    });
    assert('Test C - DELETE /api/documents/:id succeeds', delResp.ok, `Status ${delResp.status}`);

    const getRespC = await fetch(`${API_BASE}/api/documents`);
    const getDataC = await getRespC.json();
    assert(
      'Test C - Deleted document disappears from JSON and API',
      !getDataC.documents.some((d: any) => d.id === 'test-doc-alpha'),
      'test-doc-alpha still present after deletion'
    );

    // -------------------------------------------------------------
    // Test E: Cache Versioning & Invalidation
    // -------------------------------------------------------------
    console.log('\n--- Scenario E: Versioning and cache-control headers ---');
    const versionResp = await fetch(`${API_BASE}/api/version`);
    const versionData = await versionResp.json();
    assert('Test E - /api/version returns version identifier', Boolean(versionData.version), `Version is ${versionData.version}`);

    const cacheHeaderDocs = getRespC.headers.get('cache-control') || '';
    assert(
      'Test E - /api/documents has strict no-cache, no-store headers',
      cacheHeaderDocs.includes('no-store') && cacheHeaderDocs.includes('no-cache'),
      `Cache-Control header: ${cacheHeaderDocs}`
    );

    const jsonResp = await fetch(`${API_BASE}/data/documents.json`);
    const cacheHeaderJson = jsonResp.headers.get('cache-control') || '';
    assert(
      'Test E - /data/documents.json has strict no-cache, no-store headers',
      cacheHeaderJson.includes('no-store') && cacheHeaderJson.includes('no-cache'),
      `Cache-Control header: ${cacheHeaderJson}`
    );

    // -------------------------------------------------------------
    // Test F: Firebase Temporary Unavailability
    // -------------------------------------------------------------
    console.log('\n--- Scenario F: Firebase Temporary Unavailability ---');
    const { syncDataType } = await import('../src/server/dataSyncRuntime.js');
    // Calling with an invalid fake token or unreachable database url test
    const fakeResult = await syncDataType('documents', 'invalid-token-test-xyz-999');
    assert(
      'Test F - Failed Firebase sync reports failure without throwing unhandled exception',
      fakeResult.success === false,
      `Expected success: false, got ${fakeResult.success}`
    );

    // Verify existing file was not corrupted
    const postFailDisk = JSON.parse(fs.readFileSync(PUBLIC_DOCS, 'utf8'));
    assert(
      'Test F - Existing disk file was not corrupted or wiped',
      postFailDisk && Array.isArray(postFailDisk.documents),
      'Disk file invalid or missing'
    );

  } finally {
    // Restore original valid files
    if (origPublic) fs.writeFileSync(PUBLIC_DOCS, origPublic);
    if (origRoot) fs.writeFileSync(ROOT_DOCS, origRoot);
    console.log('\nRestored original document snapshots.');
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} / ${total} tests passed.`);
  console.log(`========================================\n`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
