import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDigitalResources, validateSafeDownloadUrl } from './storeOrderService';

const FIREBASE_PDF_URL =
  'https://firebasestorage.googleapis.com/v0/b/india-cyber-cafe-free/o/digital-products%2F0b0f6c1e-227a-4483-b02a-6baebb8d3589.pdf?alt=media&token=test-token-123';

const FIREBASE_APPSPOT_PDF_URL =
  'https://firebasestorage.googleapis.com/v0/b/india-cyber-cafe-free.appspot.com/o/digital-products%2Fsample-notes.pdf?alt=media&token=test-token-456';

const FIREBASE_STORAGE_APP_PDF_URL =
  'https://firebasestorage.googleapis.com/v0/b/india-cyber-cafe-free.firebasestorage.app/o/digital-products%2Fsample-notes.pdf?alt=media&token=test-token-789';

async function withProductionValidation<T>(fn: () => Promise<T>): Promise<T> {
  const prevTestMode = process.env.STORE_TEST_MODE;
  const prevNodeEnv = process.env.NODE_ENV;
  delete process.env.STORE_TEST_MODE;
  process.env.NODE_ENV = 'production';
  try {
    return await fn();
  } finally {
    if (prevTestMode === undefined) delete process.env.STORE_TEST_MODE;
    else process.env.STORE_TEST_MODE = prevTestMode;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
}

test('accepts Firebase Storage digital PDF upload with long label (>80 and <=160 chars)', async () => {
  await withProductionValidation(async () => {
    const longFileName =
      'BT-105_AutoCAD_Complete_Solved_Notes_RGPV_Engineering_Graphics_2022_2026_English_Hindi.pdf';
    const longLabel = `Download ${longFileName}`; // 99 chars (previously rejected at 80)
    assert.ok(longLabel.length > 80 && longLabel.length <= 160);

    const result = await normalizeDigitalResources([
      {
        id: 'res-1',
        fileName: longFileName,
        label: longLabel,
        url: FIREBASE_PDF_URL,
      },
    ]);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resources.length, 1);
      assert.equal(result.resources[0].fileName, longFileName);
      assert.equal(result.resources[0].label, longLabel);
    }
  });
});

test('auto-appends .pdf extension when omitted from fileName on verified Firebase Storage URL', async () => {
  await withProductionValidation(async () => {
    const result = await normalizeDigitalResources([
      {
        id: 'res-2',
        fileName: 'BT-105 AutoCAD Complete Solved Notes',
        label: 'Download Notes PDF',
        url: FIREBASE_PDF_URL,
      },
    ]);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resources[0].fileName, 'BT-105 AutoCAD Complete Solved Notes.pdf');
    }
  });
});

test('accepts appspot.com and firebasestorage.app bucket URL formats', async () => {
  await withProductionValidation(async () => {
    const result = await normalizeDigitalResources([
      {
        id: 'res-appspot',
        fileName: 'notes-a.pdf',
        label: 'Download A',
        url: FIREBASE_APPSPOT_PDF_URL,
      },
      {
        id: 'res-app',
        fileName: 'notes-b.pdf',
        label: 'Download B',
        url: FIREBASE_STORAGE_APP_PDF_URL,
      },
    ]);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resources.length, 2);
    }
  });
});

test('rejects wrong Firebase Storage bucket, non-digital-products prefix, and mismatched extensions with specific errors', async () => {
  await withProductionValidation(async () => {
    const wrongBucket = await normalizeDigitalResources([
      {
        id: 'r1',
        fileName: 'notes.pdf',
        label: 'Download',
        url: 'https://firebasestorage.googleapis.com/v0/b/other-bucket/o/digital-products%2Fnotes.pdf?alt=media&token=abc',
      },
    ]);
    assert.equal(wrongBucket.ok, false);
    if (!wrongBucket.ok) {
      assert.match(wrongBucket.error, /Firebase Storage files must be uploaded/);
    }

    const wrongPrefix = await normalizeDigitalResources([
      {
        id: 'r2',
        fileName: 'notes.pdf',
        label: 'Download',
        url: 'https://firebasestorage.googleapis.com/v0/b/india-cyber-cafe-free/o/general%2Fnotes.pdf?alt=media&token=abc',
      },
    ]);
    assert.equal(wrongPrefix.ok, false);

    const mismatchedExt = await normalizeDigitalResources([
      {
        id: 'r3',
        fileName: 'notes.zip',
        label: 'Download',
        url: FIREBASE_PDF_URL,
      },
    ]);
    assert.equal(mismatchedExt.ok, false);
    if (!mismatchedExt.ok) {
      assert.match(mismatchedExt.error, /must match the uploaded file/);
    }
  });
});

test('rejects non-HTTPS URLs, private IP URLs, and disallowed file extensions', async () => {
  await withProductionValidation(async () => {
    const httpUrl = await normalizeDigitalResources([
      {
        id: 'r-http',
        fileName: 'notes.pdf',
        label: 'Download',
        url: 'http://example.com/notes.pdf',
      },
    ]);
    assert.equal(httpUrl.ok, false);
    if (!httpUrl.ok) {
      assert.match(httpUrl.error, /HTTPS/);
    }

    const disallowedExt = await normalizeDigitalResources([
      {
        id: 'r-exe',
        fileName: 'installer.exe',
        label: 'Download',
        url: 'https://example.com/installer.exe',
      },
    ]);
    assert.equal(disallowedExt.ok, false);
    if (!disallowedExt.ok) {
      assert.match(disallowedExt.error, /\.pdf/);
    }

    await assert.rejects(
      () => validateSafeDownloadUrl('https://127.0.0.1/secret.pdf'),
      /Private IP download hosts are not allowed/
    );
  });
});
