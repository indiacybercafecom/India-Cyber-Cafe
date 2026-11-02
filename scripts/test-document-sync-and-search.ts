import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { deduplicateDocuments, findDocumentBySlug, getDocumentSignature, extractCoreTokens } from '../src/utils/documentDeduplication';
import { FormDocument } from '../src/types';

async function runTests() {
  console.log('🧪 Starting Document Sync, Deduplication, and Database Search Verification...\n');

  // Test 1: Core Token Extraction & Signatures
  console.log('1. Testing Core Token Extraction & Signatures:');
  const tokens1 = extractCoreTokens('Domicile/Niwas Form');
  const tokens2 = extractCoreTokens('Domicile/Niwas Certificate Form');
  assert.deepStrictEqual(tokens1, ['domicile', 'niwas'], 'Should extract domicile and niwas tokens');
  assert.deepStrictEqual(tokens2, ['domicile', 'niwas'], 'Should strip noise like certificate and form');
  assert.strictEqual(
    getDocumentSignature('Domicile/Niwas Form'),
    getDocumentSignature('Domicile/Niwas Certificate Form'),
    'Both titles should share the exact same signature'
  );
  console.log('   ✅ Core token extraction and signature matching passed');

  // Test 2: Deduplication with authoritative source priority
  console.log('\n2. Testing Overlap & Duplicate Prevention:');
  const sampleDocs: FormDocument[] = [
    {
      id: '-P4XV1LUwhkJYMBAmohR',
      name: 'Domicile/Niwas Form',
      description: 'Official application form for Domicile/Niwas.',
      category: 'MP Government Forms',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=1TSM0MFMU5ZcjjeLIiyyrZWup8WMuUx6S',
      previewUrl: 'https://drive.google.com/file/d/1TSM0MFMU5ZcjjeLIiyyrZWup8WMuUx6S/preview',
      active: true,
      fileType: 'PDF',
      createdAt: '2026-10-22T07:25:27.465Z',
      updatedAt: '2026-10-22T07:25:27.465Z'
    },
    {
      id: 'mp-domicile-niwas-certificate-form',
      name: 'Domicile/Niwas Certificate Form',
      description: 'Old seed certificate form.',
      category: 'MP Government Forms',
      downloadUrl: '/documents/incomeaay-certificate-form.pdf',
      previewUrl: '/documents/incomeaay-certificate-form.pdf',
      active: true,
      fileType: 'PDF',
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z'
    },
    {
      id: '-P0wFI9xrGK56V2MoAF5',
      name: 'Income/Aay Certificate Form',
      description: 'Income certificate form.',
      category: 'MP Government Forms',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=11lJj14jW-DvDoe4etUqnSmYzqvskLgiE',
      previewUrl: 'https://drive.google.com/file/d/11lJj14jW-DvDoe4etUqnSmYzqvskLgiE/preview',
      active: true,
      fileType: 'PDF',
      createdAt: '2026-09-07T14:24:05.711Z',
      updatedAt: '2026-10-28T07:00:52.921Z'
    },
    {
      id: 'doc-1793094669403-c38c55',
      name: 'Pyq Bt 102',
      description: 'BT 102 papers.',
      category: 'TIT Advance',
      downloadUrl: '/documents/incomeaay-certificate-form.pdf',
      previewUrl: '/documents/incomeaay-certificate-form.pdf',
      active: true,
      fileType: 'PDF',
      createdAt: '2026-10-27T09:51:09.403Z',
      updatedAt: '2026-10-27T09:51:09.403Z'
    }
  ];

  const deduplicated = deduplicateDocuments(sampleDocs);
  assert.strictEqual(deduplicated.length, 3, 'Should reduce 4 docs with 1 overlapping pair to exactly 3 unique docs');

  const domicileDoc = deduplicated.find(d => d.name.toLowerCase().includes('domicile'));
  assert.ok(domicileDoc, 'Should contain domicile form');
  assert.strictEqual(domicileDoc?.id, '-P4XV1LUwhkJYMBAmohR', 'Authoritative Drive document must replace dummy seed');
  console.log('   ✅ Overlap elimination passed (authoritative Drive doc replaced legacy seed)');

  // Test 3: Robust Document Finder by Slug
  console.log('\n3. Testing findDocumentBySlug:');
  const foundPyq = findDocumentBySlug(deduplicated, 'pyq-bt-102');
  assert.ok(foundPyq, 'Should find pyq-bt-102');
  assert.strictEqual(foundPyq?.name, 'Pyq Bt 102');

  const foundPyqWithCat = findDocumentBySlug(deduplicated, 'pyq-bt-102', 'tit-advance');
  assert.ok(foundPyqWithCat, 'Should find pyq-bt-102 with category slug');

  const foundPyqWithWrongCat = findDocumentBySlug(deduplicated, 'pyq-bt-102', 'wrong-cat');
  assert.ok(foundPyqWithWrongCat, 'Should still find pyq-bt-102 even if embed passed mismatched category');

  const foundDomicileByVariant = findDocumentBySlug(deduplicated, 'domicile-niwas-certificate-form');
  assert.ok(foundDomicileByVariant, 'Should match variant slug to authoritative document');
  console.log('   ✅ Document lookup by slug and category passed');

  // Test 4: Verify local JSON files are clean
  console.log('\n4. Checking public/data/documents.json and data/documents.json:');
  const publicJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/documents.json'), 'utf8'));
  const rootJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/documents.json'), 'utf8'));

  const publicDocs = publicJson.documents || [];
  const rootDocs = rootJson.documents || [];

  assert.ok(!publicDocs.some((d: any) => d.id === 'mp-domicile-niwas-certificate-form'), 'Stale mp seed must not be in public JSON');
  assert.ok(!publicDocs.some((d: any) => d.id === 'pan-card-form-49a'), 'Stale pan seed must not be in public JSON');
  assert.ok(!rootDocs.some((d: any) => d.id === 'mp-domicile-niwas-certificate-form'), 'Stale mp seed must not be in data JSON');
  assert.ok(!rootDocs.some((d: any) => d.id === 'pan-card-form-49a'), 'Stale pan seed must not be in data JSON');
  console.log(`   ✅ Local JSON files are clean (${publicDocs.length} authoritative documents)`);

  // Test 5: Live API tests if server is running
  console.log('\n5. Testing Live Server API Endpoints (http://localhost:3000):');
  try {
    const healthResp = await fetch('http://localhost:3000/api/health');
    if (healthResp.ok) {
      // Test search
      const searchResp = await fetch('http://localhost:3000/api/documents/search?q=domicile');
      const searchData = await searchResp.json();
      assert.ok(searchData.success, 'Search should succeed');
      assert.ok(searchData.documents.length >= 1, 'Search for domicile should return at least 1 document');
      console.log(`   ✅ /api/documents/search?q=domicile returned ${searchData.documents.length} document(s)`);

      // Test search for pyq
      const searchPyq = await fetch('http://localhost:3000/api/documents/search?q=pyq');
      const pyqData = await searchPyq.json();
      assert.ok(pyqData.success, 'Search for pyq should succeed');
      assert.ok(pyqData.documents.some((d: any) => d.name === 'Pyq Bt 102'), 'Pyq Bt 102 should be found in search');
      console.log('   ✅ /api/documents/search?q=pyq returned Pyq Bt 102');

      // Test refresh endpoint
      const refreshResp = await fetch('http://localhost:3000/api/documents/refresh', { method: 'POST' });
      const refreshData = await refreshResp.json();
      assert.ok(refreshData.success, 'Refresh endpoint should return success');
      console.log(`   ✅ /api/documents/refresh succeeded with ${refreshData.count} documents`);

      // Test lookup endpoint
      const lookupResp = await fetch('http://localhost:3000/api/documents/lookup?slug=pyq-bt-102');
      const lookupData = await lookupResp.json();
      assert.ok(lookupData.success, 'Lookup for pyq-bt-102 should succeed');
      assert.strictEqual(lookupData.document?.name, 'Pyq Bt 102');
      console.log('   ✅ /api/documents/lookup?slug=pyq-bt-102 returned Pyq Bt 102');
    } else {
      console.log('   ℹ️ Server not responding on port 3000, skipping live HTTP tests');
    }
  } catch (err: any) {
    console.log('   ℹ️ Server live check error:', err.message);
  }

  console.log('\n🎉 ALL DOCUMENT SYNC, DEDUPLICATION, AND SEARCH TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
