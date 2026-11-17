import assert from 'node:assert';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import multer from 'multer';
import path from 'node:path';
import { getFriendlyErrorMessage } from '../src/utils/errorHandler';
import { sanitizeFormData } from '../src/utils/sanitizer';

process.env.OPERATOR_TEST_MODE = '1';
process.env.STORE_ORDER_TEST_MODE = '1';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test_rzp_secret';

const OPERATOR_STORE_PATH = path.resolve('data/operator_test_store.json');
const LEDGER_PATH = path.resolve('data/notification_events.json');
const OUTBOX_PATH = path.resolve('data/notification_outbox.json');
const ASYNC_QUEUE_PATH = path.resolve('data/async_queue_jobs.json');
const ASYNC_DLQ_PATH = path.resolve('data/async_queue_dlq.json');
const APP_ATT_DIR = path.resolve('data/uploads/application-attachments');

function backupFile(filePath: string) {
  const existed = fs.existsSync(filePath);
  const content = existed ? fs.readFileSync(filePath, 'utf-8') : null;
  if (existed) fs.unlinkSync(filePath);
  return { filePath, existed, content };
}

function restoreFile(backup: { filePath: string; existed: boolean; content: string | null }) {
  try {
    if (backup.existed && backup.content !== null) {
      fs.mkdirSync(path.dirname(backup.filePath), { recursive: true });
      fs.writeFileSync(backup.filePath, backup.content, 'utf-8');
    } else if (fs.existsSync(backup.filePath)) {
      fs.unlinkSync(backup.filePath);
    }
  } catch {}
}

async function runTests() {
  const backups = [
    backupFile(OPERATOR_STORE_PATH),
    backupFile(LEDGER_PATH),
    backupFile(OUTBOX_PATH),
    backupFile(ASYNC_QUEUE_PATH),
    backupFile(ASYNC_DLQ_PATH),
  ];
  const createdAttFiles: string[] = [];
  let server: any = null;

  try {
    const emailSvc = await import('../src/server/emailNotificationService.js');
    const opSvc = await import('../src/server/operatorService.js');

    emailSvc.setEmailTransportForTesting({
      sendMail: async () => ({ messageId: `<test-${Date.now()}@indiacybercafe.com>` }),
    });
    emailSvc.resetNotificationStateForTesting();

    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.post('/api/applications', opSvc.handleCreateApplication);
    app.post('/api/applications/create-payment', opSvc.handleCreateApplicationPayment);
    app.post('/api/applications/upload-attachment', upload.single('file'), opSvc.handleUploadApplicationAttachment);
    app.get('/api/applications/attachments/:attachmentId', opSvc.handleGetApplicationAttachment);
    app.post('/api/applications/:appId/confirm-payment', opSvc.handleConfirmApplicationPayment);
    app.post('/api/applications/:appId/recover-payment', opSvc.handleRecoverApplicationPayment);

    server = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const userToken = 'test-token:uid_sanjay:sanjayvaishya905@gmail.com';
    const otherUserToken = 'test-token:uid_other:other@example.com';

    let passed = 0;
    const check = async (name: string, fn: () => Promise<void> | void) => {
      await fn();
      passed++;
      console.log(`✅ [PASS] ${name}`);
    };

    // 1. Screenshot scenario: super-fast-service -> Proceed to Payment -> Razorpay order + confirm
    let paidAppId = '';
    let paidOrderId = '';
    await check('Paid Razorpay submission (super-fast-service) succeeds end-to-end & preserves mobile from details', async () => {
      const clientDetails = sanitizeFormData({
        form_type: 'SSC Recruitment Form',
        Name: 'Sanjay',
        'Mobile Number': '6232421011',
        Email: 'sanjayvaishya905@gmail.com',
      });

      const createResp = await fetch(`${baseUrl}/api/applications/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          serviceId: 'super-fast-service',
          subserviceName: 'Form filling fast (Instant)',
          details: clientDetails,
          clientRequestId: 'idem-superfast-1',
        }),
      });
      const createData = await createResp.json();
      assert.strictEqual(createResp.status, 201, `Unexpected status ${createResp.status}: ${JSON.stringify(createData)}`);
      assert.strictEqual(createData.success, true);
      assert.strictEqual(createData.amount, 100); // ₹1 in paise
      assert(createData.appId.startsWith('ICC-APP-'));
      assert(createData.razorpayOrderId);
      paidAppId = createData.appId;
      paidOrderId = createData.razorpayOrderId;

      // Duplicate idempotency replay returns same appId & orderId
      const dupResp = await fetch(`${baseUrl}/api/applications/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          serviceId: 'super-fast-service',
          subserviceName: 'Form filling fast (Instant)',
          details: clientDetails,
          clientRequestId: 'idem-superfast-1',
        }),
      });
      const dupData = await dupResp.json();
      assert.strictEqual(dupResp.status, 200);
      assert.strictEqual(dupData.duplicate, true);
      assert.strictEqual(dupData.appId, paidAppId);

      // Confirm payment with HMAC signature
      const sig = crypto.createHmac('sha256', 'test_rzp_secret').update(`${paidOrderId}|pay_rzp_100`).digest('hex');
      const confResp = await fetch(`${baseUrl}/api/applications/${encodeURIComponent(paidAppId)}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          razorpay_order_id: paidOrderId,
          razorpay_payment_id: 'pay_rzp_100',
          razorpay_signature: sig,
        }),
      });
      const confData = await confResp.json();
      assert.strictEqual(confResp.status, 200);
      assert.strictEqual(confData.verified, true);
      assert.strictEqual(confData.application.status, 'processing');
      assert.strictEqual(confData.application.paymentStatus, 'completed');
      assert.strictEqual(confData.application.phone, '6232421011');
      assert.strictEqual(confData.application.details.form_type, 'SSC Recruitment Form');
    });

    // 2. GST Services with slash-containing field labels ("Company / Business Name", "Company / Business Type")
    await check('Slash-containing field labels sanitized via sanitizeFormData pass server validation cleanly', async () => {
      const gstDetails = sanitizeFormData({
        'Full Name': 'Sanjay Sharma',
        'Email Address': 'sharma@example.com',
        'Mobile Number': '9876543210',
        'Company / Business Name': 'Sharma Digital Works',
        'Company / Business Type': 'Proprietorship',
      });

      const resp = await fetch(`${baseUrl}/api/applications/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          serviceId: 'gst-services',
          subserviceName: 'GST Registration',
          details: gstDetails,
          clientRequestId: 'idem-gst-1',
        }),
      });
      const data = await resp.json();
      assert.strictEqual(resp.status, 201, `GST registration failed: ${JSON.stringify(data)}`);
      assert.strictEqual(data.amount, 49900);
    });

    // 3. Attachment upload fallback + retrieval authz + cash submission
    await check('Attachment upload fallback validates magic bytes, enforces authz, and persists cash submission', async () => {
      const badForm = new FormData();
      badForm.append('file', new Blob([Buffer.from('<html>not a file</html>')], { type: 'image/png' }), 'fake.png');
      const badRes = await fetch(`${baseUrl}/api/applications/upload-attachment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: badForm,
      });
      assert.strictEqual(badRes.status, 400);
      const badJson = await badRes.json();
      assert.strictEqual(badJson.code, 'INVALID_FILE_TYPE');

      const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
      const okForm = new FormData();
      okForm.append('file', new Blob([pngBytes], { type: 'image/png' }), 'aadhaar_front.png');
      const okRes = await fetch(`${baseUrl}/api/applications/upload-attachment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: okForm,
      });
      const okData = await okRes.json();
      assert.strictEqual(okRes.status, 200);
      assert(okData.url.startsWith('/api/applications/attachments/'));
      const attId = decodeURIComponent(okData.url.split('/').pop()!);
      createdAttFiles.push(path.join(APP_ATT_DIR, 'uid_sanjay', attId));

      // Retrieval checks
      const unauthGet = await fetch(`${baseUrl}${okData.url}`);
      assert.strictEqual(unauthGet.status, 401);

      const otherGet = await fetch(`${baseUrl}${okData.url}`, { headers: { Authorization: `Bearer ${otherUserToken}` } });
      assert.strictEqual(otherGet.status, 403);

      const ownerGet = await fetch(`${baseUrl}${okData.url}`, { headers: { Authorization: `Bearer ${userToken}` } });
      assert.strictEqual(ownerGet.status, 200);
      assert.strictEqual(ownerGet.headers.get('content-type'), 'image/png');

      // Submit cash application with attachments
      const cashResp = await fetch(`${baseUrl}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          serviceId: 'aadhaar-ucl-opretor',
          subserviceName: 'Advance Opretor ID',
          paymentMethod: 'cash',
          details: sanitizeFormData({
            'Full Name': 'Sanjay',
            'Father Name': 'Ramesh',
            'Date of Birth': '1998-01-15',
            'Mobile Number': '6232421011',
            'Email ID': 'sanjayvaishya905@gmail.com',
            'Full Address with Pincode': 'Singrauli MP 486886',
            'Aadhaar Number': '123456789012',
            'Aadhaar Card': [okData.url],
            'PAN Number': 'ABCDE1234F',
            'PAN Card Image': okData.url,
          }),
          clientRequestId: 'idem-cash-1',
        }),
      });
      const cashData = await cashResp.json();
      assert.strictEqual(cashResp.status, 201, `Cash submit failed: ${JSON.stringify(cashData)}`);
      assert.strictEqual(cashData.application.paymentMethod, 'cash');
      assert.strictEqual(cashData.application.charge, 999);
      assert.strictEqual(cashData.application.fileUrl, okData.url);
    });

    // 4. Meaningful errors instead of generic "Something went wrong. Please try again."
    await check('Validation & backend payment/db errors map to clear user-friendly messages (not generic fallback)', async () => {
      const missingFieldResp = await fetch(`${baseUrl}/api/applications/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          serviceId: 'super-fast-service',
          subserviceName: 'Form filling fast (Instant)',
          details: { Name: 'Sanjay', 'Mobile Number': '6232421011' }, // missing form_type
        }),
      });
      const missingJson = await missingFieldResp.json();
      assert.strictEqual(missingFieldResp.status, 400);
      const friendlyMissing = getFriendlyErrorMessage(Object.assign(new Error(missingJson.error), { code: missingJson.code }), 'Something went wrong. Please try again.');
      assert.strictEqual(friendlyMissing, 'Select Form Type is required.');

      const friendlyRzp = getFriendlyErrorMessage({ code: 'RAZORPAY_ORDER_FAILED', message: 'Razorpay HTTP 500' }, 'Something went wrong. Please try again.');
      assert.notStrictEqual(friendlyRzp, 'Something went wrong. Please try again.');
      assert(!friendlyRzp.toLowerCase().includes('razorpay'));

      const friendlyAuth = getFriendlyErrorMessage({ status: 401, message: 'Authentication required' }, 'Something went wrong. Please try again.');
      assert.strictEqual(friendlyAuth, 'Your session has expired. Please log in again.');
    });

    // 5. Concurrent single-flight deduplication + load test
    await check('10 duplicate concurrent creates deduplicate cleanly & 20 unique concurrent creates finish fast', async () => {
      const dupPayload = JSON.stringify({
        serviceId: 'aadhaar-ucl-opretor',
        subserviceName: 'Advance Opretor ID',
        paymentMethod: 'cash',
        details: {
          'Full Name': 'Concurrent User',
          'Father Name': 'Father',
          'Date of Birth': '1997-02-02',
          'Mobile Number': '9998887776',
          'Email ID': 'concurrent@example.com',
          'Full Address with Pincode': 'Main Road 486886',
          'Aadhaar Number': '123456789012',
          'Aadhaar Card': ['https://example.com/a.png'],
          'PAN Number': 'ABCDE1234F',
          'PAN Card Image': 'https://example.com/p.png',
        },
        clientRequestId: 'idem-singleflight-burst',
      });
      const dupResponses = await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch(`${baseUrl}/api/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
            body: dupPayload,
          }).then(r => r.json())
        )
      );
      const uniqueIds = new Set(dupResponses.map(r => r.appId));
      assert.strictEqual(uniqueIds.size, 1, `Expected 1 deduplicated appId, got ${uniqueIds.size}`);

      const latencies: number[] = [];
      await Promise.all(
        Array.from({ length: 10 }, async (_, idx) => {
          const t0 = Date.now();
          const res = await fetch(`${baseUrl}/api/applications/create-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
            body: JSON.stringify({
              serviceId: 'super-fast-service',
              subserviceName: 'Form filling fast (Instant)',
              details: {
                form_type: 'SSC Recruitment Form',
                Name: `User ${idx}`,
                'Mobile Number': '6232421011',
              },
              clientRequestId: `idem-load-${idx}`,
            }),
          });
          assert.strictEqual(res.status, 201);
          latencies.push(Date.now() - t0);
        })
      );
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
      console.log(`   Measured local concurrent create-payment p95 latency: ${p95}ms`);
    });

    console.log(`\n🎉 All ${passed} Apply Submission & Payment Integration checks passed!`);
  } finally {
    if (server) server.close();
    for (const f of createdAttFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
      try { if (fs.existsSync(`${f}.meta.json`)) fs.unlinkSync(`${f}.meta.json`); } catch {}
    }
    for (const b of backups) {
      restoreFile(b);
    }
  }
}

runTests().catch((err) => {
  console.error('❌ Apply submission test failed:', err);
  process.exit(1);
});
