import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { spawn } from 'child_process';

process.env.STORE_ORDER_TEST_MODE = '1';
process.env.OPERATOR_TEST_MODE = '1';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test_rzp_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const DATA_FILES_TO_BACKUP = [
  'data/operator_test_store.json',
  'data/orders_store.json',
  'data/reviews_test_store.json',
  'data/privacy_requests.json',
  'data/notification_events.json',
  'data/notification_outbox.json',
  'data/async_queue_jobs.json',
  'data/async_queue_dlq.json',
  'data/store_idempotency.json',
  'data/payment_transactions_store.json',
];

function backupFiles(relPaths: string[]) {
  return relPaths.map(rel => {
    const abs = path.resolve(rel);
    const existed = fs.existsSync(abs);
    const content = existed ? fs.readFileSync(abs, 'utf-8') : null;
    if (existed) fs.unlinkSync(abs);
    return { abs, existed, content };
  });
}

function restoreFiles(backups: Array<{ abs: string; existed: boolean; content: string | null }>) {
  for (const b of backups) {
    try {
      if (b.existed && b.content !== null) {
        fs.mkdirSync(path.dirname(b.abs), { recursive: true });
        fs.writeFileSync(b.abs, b.content, 'utf-8');
      } else if (fs.existsSync(b.abs)) {
        fs.unlinkSync(b.abs);
      }
    } catch {}
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

async function runLoadStage(
  label: string,
  concurrency: number,
  totalRequests: number,
  fn: (i: number) => Promise<{ ok: boolean; status: number }>
) {
  const latencies: number[] = [];
  let errors = 0;
  let rateLimited = 0;
  let nextIdx = 0;
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= totalRequests) return;
        const t0 = performance.now();
        try {
          const r = await fn(i);
          if (!r.ok) {
            if (r.status === 429) rateLimited++;
            else errors++;
          }
        } catch {
          errors++;
        } finally {
          latencies.push(performance.now() - t0);
        }
      }
    })
  );

  const elapsedMs = performance.now() - startedAt;
  latencies.sort((a, b) => a - b);
  const rps = Number(((totalRequests / elapsedMs) * 1000).toFixed(1));
  const summary = {
    label,
    concurrency,
    totalRequests,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    rps,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: Number((latencies[latencies.length - 1] || 0).toFixed(2)),
    errors,
    rateLimited,
  };
  console.log('[LOAD]', JSON.stringify(summary));
  return summary;
}

async function waitForHttpReady(url: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (resp.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const backups = backupFiles(DATA_FILES_TO_BACKUP);
  const createdAppAttDir = path.resolve('data/uploads/attachments/ICC-TEST-MULTIPART-APP');
  let mockServer: any = null;
  let spawnedServer: any = null;
  let spawnedWorker: any = null;

  try {
    const queueSvc = await import('../src/server/asyncQueueService.js');
    const emailSvc = await import('../src/server/emailNotificationService.js');
    const opSvc = await import('../src/server/operatorService.js');
    const storeSvc = await import('../src/server/storeOrderService.js');

    // ---------------------------------------------------------
    // 1. Distributed-style Queue, Lease Expiry, Contention & DLQ
    // ---------------------------------------------------------
    queueSvc.resetAsyncQueueForTesting();
    emailSvc.resetNotificationStateForTesting();

    let processedIds: string[] = [];
    let failMode: 'none' | 'failOnce' | 'failAlways' = 'none';
    const seenOnce = new Set<string>();

    queueSvc.registerQueueProcessor('bench_job', async (job) => {
      if (failMode === 'failAlways') {
        return { ok: false, retryable: true, error: 'Simulated permanent downstream outage' };
      }
      if (failMode === 'failOnce' && !seenOnce.has(job.jobId)) {
        seenOnce.add(job.jobId);
        return { ok: false, retryable: true, error: 'Transient glitch' };
      }
      processedIds.push(job.jobId);
      return { ok: true, report: { ok: true } };
    });

    // Idempotency check
    const enq1 = queueSvc.enqueueAsyncJob({ kind: 'bench_job', idempotencyKey: 'dedup-key-1', payload: { n: 1 }, maxAttempts: 3 });
    const enq2 = queueSvc.enqueueAsyncJob({ kind: 'bench_job', idempotencyKey: 'dedup-key-1', payload: { n: 1 }, maxAttempts: 3 });
    assert.strictEqual(enq1.jobId, enq2.jobId);

    await queueSvc.flushAsyncQueueForTesting();
    assert.strictEqual(processedIds.filter(id => id === enq1.jobId).length, 1, 'Idempotent job must execute once');

    // Expired lease crash recovery test
    processedIds = [];
    const crashJob = queueSvc.enqueueAsyncJob({ kind: 'bench_job', idempotencyKey: 'lease-crash-1', payload: { crash: true }, maxAttempts: 3, delayMs: 60000 });
    // Simulate a crashed worker leaving job in 'processing' with expired lease
    const allBefore = queueSvc.getAllQueueJobsForTesting();
    const target = allBefore.find(j => j.jobId === crashJob.jobId)!;
    target.state = 'processing';
    target.leaseOwner = 'dead-worker-999';
    target.leaseExpiresAt = Date.now() - 10000;
    const recoveredCount = queueSvc.recoverExpiredQueueLeases();
    assert(recoveredCount >= 1, 'Expired lease must be recovered');
    await queueSvc.flushAsyncQueueForTesting();
    assert.strictEqual(processedIds.filter(id => id === crashJob.jobId).length, 1, 'Recovered lease job must execute cleanly');

    // 100-job burst + concurrent pumpAsyncQueue contention
    processedIds = [];
    const tQueueStart = performance.now();
    for (let i = 0; i < 100; i++) {
      queueSvc.enqueueAsyncJob({ kind: 'bench_job', idempotencyKey: `burst-${i}`, payload: { i }, maxAttempts: 3 });
    }
    await Promise.all([
      queueSvc.pumpAsyncQueue(true),
      queueSvc.pumpAsyncQueue(true),
      queueSvc.pumpAsyncQueue(true),
      queueSvc.flushAsyncQueueForTesting(),
    ]);
    const queueDrainMs = Number((performance.now() - tQueueStart).toFixed(2));
    assert.strictEqual(processedIds.length, 100, 'All 100 burst jobs processed exactly once');
    assert.strictEqual(new Set(processedIds).size, 100, 'No duplicate job execution under concurrent pumps');
    console.log(`✅ [PASS] 100-job burst drained cleanly with 0 duplicates in ${queueDrainMs}ms`);

    // DLQ + Async DLQ listing + Replay recovery
    failMode = 'failAlways';
    const dlqEnq = queueSvc.enqueueAsyncJob({ kind: 'bench_job', idempotencyKey: 'dlq-test-1', payload: { dlq: true }, maxAttempts: 1 });
    await queueSvc.flushAsyncQueueForTesting();
    const dlqList = queueSvc.getDlqJobs(50);
    assert(dlqList.some(j => j.jobId === dlqEnq.jobId), 'Failed job must move to DLQ');

    failMode = 'none';
    processedIds = [];
    const replayRes = await queueSvc.replayDlqJob(dlqEnq.jobId);
    assert.strictEqual(replayRes.found, true);
    await queueSvc.flushAsyncQueueForTesting();
    assert(processedIds.includes(dlqEnq.jobId), 'Replayed DLQ job must complete cleanly');
    console.log('✅ [PASS] Queue lease expiry recovery, DLQ capture, and replay verified');

    // ---------------------------------------------------------
    // 2. Concurrent API Writes, Razorpay, Webhook & Attachments
    // ---------------------------------------------------------
    emailSvc.setEmailTransportForTesting({
      sendMail: async () => ({ messageId: `<ok-${Date.now()}@test>` }),
    });
    emailSvc.resetNotificationStateForTesting();

    const adminUid = 'admin_uid_scale';
    const custUid = 'cust_uid_scale';
    const otherUid = 'other_uid_scale';
    const operatorStorePath = path.resolve('data/operator_test_store.json');
    fs.mkdirSync(path.dirname(operatorStorePath), { recursive: true });
    fs.writeFileSync(operatorStorePath, JSON.stringify({
      users: {
        [adminUid]: { uid: adminUid, name: 'Admin Scale', email: 'admin.scale@indiacybercafe.com', role: 'admin' },
        [custUid]: { uid: custUid, name: 'Cust Scale', email: 'cust.scale@example.com', phone: '9876543210', role: 'user' },
        [otherUid]: { uid: otherUid, name: 'Other User', email: 'other@example.com', phone: '9123456789', role: 'user' },
      },
      applications: {
        'ICC-TEST-MULTIPART-APP': {
          id: 'ICC-TEST-MULTIPART-APP',
          uid: custUid,
          name: 'Cust Scale',
          email: 'cust.scale@example.com',
          serviceId: 'pan-card',
          serviceName: 'PAN Card',
          status: 'clarification',
          paymentStatus: 'pending',
          charge: 200,
          notes: {},
          date: new Date().toISOString(),
        },
      },
      payments: {},
      callbacks: {},
    }, null, 2));

    const app = express();
    app.use('/api/store/orders/razorpay-webhook', express.raw({ type: 'application/json' }), (req: any, _res, next) => {
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body;
        try { req.body = JSON.parse(req.body.toString('utf-8')); } catch { req.body = {}; }
      }
      next();
    });
    app.use(express.json({ limit: '2mb' }));
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

    app.post('/api/applications', opSvc.handleCreateApplication);
    app.post('/api/applications/create-payment', opSvc.handleCreateApplicationPayment);
    app.post('/api/applications/:appId/confirm-payment', opSvc.handleConfirmApplicationPayment);
    app.post('/api/applications/:appId/recover-payment', opSvc.handleRecoverApplicationPayment);
    app.post('/api/applications/:appId/upload-reply-attachments', upload.any(), opSvc.handleUserReplyAttachmentUpload);
    app.get('/api/operator/attachments/:attachmentId', opSvc.handleGetOperatorAttachment);
    app.post('/api/store/orders/cod', storeSvc.handleCodOrder);
    app.post('/api/store/orders/create-payment', storeSvc.handleCreatePaymentOrder);
    app.post('/api/store/orders/verify-payment', storeSvc.handleVerifyPayment);
    app.post('/api/store/orders/recover-payment', storeSvc.handleRecoverPayment);
    app.post('/api/store/orders/razorpay-webhook', storeSvc.handleRazorpayWebhook);
    app.post('/api/admin/orders/:orderId/notes', storeSvc.handleAdminAddOrderNote);
    app.post('/api/store/reviews', storeSvc.handleSubmitStoreReview);
    app.get('/api/admin/queue/dlq', opSvc.handleListDlqJobs);
    app.post('/api/admin/queue/:jobId/replay', opSvc.handleReplayDlqJob);

    storeSvc.registerApplicationWebhookReconciler(opSvc.reconcilePendingApplicationFromWebhook);

    mockServer = await new Promise<any>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${mockServer.address().port}`;
    const adminToken = `Bearer test-token:${adminUid}:admin.scale@indiacybercafe.com`;
    const custToken = `Bearer test-token:${custUid}:cust.scale@example.com`;
    const otherToken = `Bearer test-token:${otherUid}:other@example.com`;

    // Concurrent duplicate COD orders (same idempotencyKey)
    const codPayloads = Array.from({ length: 10 }, () =>
      fetch(`${baseUrl}/api/store/orders/cod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({
          idempotencyKey: 'dup-cod-key-001',
          items: [{ productId: 'diseases-treatment-complete-medical-reference-pdf-125-diseases', quantity: 1 }],
          deliveryAddress: {
            name: 'Cust Scale',
            email: 'cust.scale@example.com',
            phone: '9876543210',
            addressLine1: '12 Main Road',
            city: 'Bhopal',
            state: 'Madhya Pradesh',
            pincode: '462001',
          },
        }),
      }).then(async r => ({ status: r.status, body: await r.json() }))
    );
    const codResults = await Promise.all(codPayloads);
    const codOrderIds = new Set(codResults.map(r => r.body?.orderId).filter(Boolean));
    assert.strictEqual(codOrderIds.size, 1, '10 concurrent duplicate COD requests must produce exactly 1 orderId');

    // Concurrent duplicate Store Review submissions
    const revPayloads = Array.from({ length: 8 }, () =>
      fetch(`${baseUrl}/api/store/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({
          idempotencyKey: 'dup-rev-001',
          productId: 'diseases-treatment-complete-medical-reference-pdf-125-diseases',
          rating: 5,
          comment: 'Very clear print quality!',
          userName: 'Cust Scale',
        }),
      }).then(async r => ({ status: r.status, body: await r.json() }))
    );
    const revResults = await Promise.all(revPayloads);
    const revIds = new Set(revResults.map(r => r.body?.reviewId).filter(Boolean));
    assert.strictEqual(revIds.size, 1, '8 concurrent duplicate review requests must create 1 review');

    // Concurrent duplicate Order Notes
    const createdCodOrderId = Array.from(codOrderIds)[0];
    const noteResults = await Promise.all(
      Array.from({ length: 8 }, () =>
        fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(createdCodOrderId)}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: adminToken },
          body: JSON.stringify({ text: 'Packed and ready for dispatch', clientRequestId: 'dup-note-001' }),
        }).then(r => r.json())
      )
    );
    const finalNotes = noteResults.find(r => Array.isArray(r.notes))?.notes || [];
    assert.strictEqual(finalNotes.filter((n: any) => n.clientRequestId === 'dup-note-001').length, 1, 'Order note deduplication failed');

    // Concurrent duplicate Free/Cash Service Applications
    const validAppDetails = {
      fullName: 'Cust Scale',
      fatherName: 'Father Scale',
      dateOfBirth: '1995-05-15',
      mobileNumber: '9876543210',
      emailId: 'cust.scale@example.com',
      fullAddress: '12 Main Road Bhopal 462001',
      aadhaarNumber: '123456789012',
      aadhaarCard: ['/api/applications/attachments/appatt_test_1.png'],
      panNumber: 'ABCDE1234F',
      panCardImage: '/api/applications/attachments/appatt_test_2.png',
    };
    const appPayloads = Array.from({ length: 8 }, () =>
      fetch(`${baseUrl}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({
          serviceId: 'aadhaar-ucl-opretor',
          subserviceName: 'Advance Opretor ID',
          paymentMethod: 'cash',
          clientRequestId: 'dup-app-001',
          details: validAppDetails,
        }),
      }).then(r => r.json())
    );
    const appResults = await Promise.all(appPayloads);
    const createdAppIds = new Set(appResults.map(r => r.appId).filter(Boolean));
    assert.strictEqual(createdAppIds.size, 1, '8 concurrent duplicate application creates must produce 1 appId');

    // ---------------------------------------------------------
    // 2B. Application Razorpay Payment Initiation Fault & E2E Flow Tests
    // ---------------------------------------------------------
    // Concurrent duplicate create-payment requests -> 1 appId & 1 razorpayOrderId
    const concurrentCreatePay = await Promise.all(
      Array.from({ length: 8 }, () =>
        fetch(`${baseUrl}/api/applications/create-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: custToken },
          body: JSON.stringify({
            serviceId: 'aadhaar-ucl-opretor',
            subserviceName: 'Advance Opretor ID',
            clientRequestId: 'dup-app-pay-001',
            details: validAppDetails,
          }),
        }).then(async r => ({ status: r.status, body: await r.json() }))
      )
    );
    const payAppIds = new Set(concurrentCreatePay.map(r => r.body?.appId).filter(Boolean));
    const payOrderIds = new Set(concurrentCreatePay.map(r => r.body?.razorpayOrderId).filter(Boolean));
    assert.strictEqual(payAppIds.size, 1, '8 concurrent duplicate create-payment requests must yield 1 appId');
    assert.strictEqual(payOrderIds.size, 1, '8 concurrent duplicate create-payment requests must yield 1 razorpayOrderId');

    // Full Application Form -> Create Razorpay Order -> Confirm Payment
    const createdAppId = Array.from(payAppIds)[0] as string;
    const createdRzpOrderId = Array.from(payOrderIds)[0] as string;
    const simPaymentId = 'pay_app_test_verified_001';
    const simSig = crypto
      .createHmac('sha256', 'test_rzp_secret')
      .update(`${createdRzpOrderId}|${simPaymentId}`)
      .digest('hex');
    const confirmAppPayResp = await fetch(`${baseUrl}/api/applications/${encodeURIComponent(createdAppId)}/confirm-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: custToken },
      body: JSON.stringify({
        razorpay_order_id: createdRzpOrderId,
        razorpay_payment_id: simPaymentId,
        razorpay_signature: simSig,
      }),
    });
    const confirmAppPayJson = await confirmAppPayResp.json();
    assert.strictEqual(confirmAppPayResp.status, 200);
    assert.strictEqual(confirmAppPayJson.verified, true);
    assert.strictEqual(confirmAppPayJson.application?.paymentStatus, 'completed');

    // Also verify service with NO fileUrl (previously threw on undefined in RTDB .set)
    const noFilePayResp = await fetch(`${baseUrl}/api/applications/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: custToken },
      body: JSON.stringify({
        serviceId: 'gst-services',
        subserviceName: 'GST Registration',
        clientRequestId: 'app-pay-no-file-001',
        details: {
          name: 'Cust Scale',
          email: 'cust.scale@example.com',
          mobile: '9876543210',
          company_name: 'Scale Enterprises',
          company_type: 'Proprietorship',
        },
      }),
    });
    const noFilePayJson = await noFilePayResp.json();
    assert.strictEqual(noFilePayResp.status, 201, `No-file paid service should succeed cleanly: ${JSON.stringify(noFilePayJson)}`);
    const persistedStoreAfterNoFile = JSON.parse(fs.readFileSync(operatorStorePath, 'utf-8'));
    const savedNoFileDraft = persistedStoreAfterNoFile.pendingApplications?.[noFilePayJson.appId];
    assert(savedNoFileDraft, 'Pending application draft must be durably stored');
    assert(!('fileUrl' in savedNoFileDraft), 'Undefined fileUrl must be stripped from persisted pending draft');

    // Fault injection matrix: Razorpay & Firebase failure stage/code isolation + retry order reuse
    const faultCases: Array<{
      label: string;
      behavior: any;
      clientRequestId: string;
      expectedStatus: number;
      expectedStage: string;
      expectedCode: string;
    }> = [
      {
        label: 'razorpay_unconfigured',
        behavior: { razorpayMode: 'unconfigured' },
        clientRequestId: 'fault-unconf-1',
        expectedStatus: 503,
        expectedStage: 'preflight_payment',
        expectedCode: 'RAZORPAY_UNCONFIGURED',
      },
      {
        label: 'razorpay_http_error',
        behavior: { razorpayMode: 'http_error', razorpayStatus: 401, razorpayErrorCode: 'BAD_REQUEST_ERROR', razorpayErrorDescription: 'Authentication failed' },
        clientRequestId: 'fault-http-1',
        expectedStatus: 502,
        expectedStage: 'razorpay_create_order',
        expectedCode: 'RAZORPAY_ORDER_FAILED',
      },
      {
        label: 'razorpay_network_error',
        behavior: { razorpayMode: 'network_error' },
        clientRequestId: 'fault-net-1',
        expectedStatus: 502,
        expectedStage: 'razorpay_create_order',
        expectedCode: 'RAZORPAY_NETWORK_ERROR',
      },
      {
        label: 'razorpay_timeout',
        behavior: { razorpayMode: 'timeout' },
        clientRequestId: 'fault-timeout-1',
        expectedStatus: 504,
        expectedStage: 'razorpay_create_order',
        expectedCode: 'RAZORPAY_TIMEOUT',
      },
      {
        label: 'razorpay_invalid_json',
        behavior: { razorpayMode: 'invalid_json' },
        clientRequestId: 'fault-json-1',
        expectedStatus: 502,
        expectedStage: 'razorpay_parse_response',
        expectedCode: 'RAZORPAY_INVALID_RESPONSE',
      },
      {
        label: 'razorpay_missing_order_id',
        behavior: { razorpayMode: 'missing_order_id' },
        clientRequestId: 'fault-noid-1',
        expectedStatus: 502,
        expectedStage: 'razorpay_parse_response',
        expectedCode: 'RAZORPAY_INVALID_RESPONSE',
      },
      {
        label: 'firebase_write_reject',
        behavior: { razorpayMode: 'ok', firebaseWriteMode: 'reject' },
        clientRequestId: 'fault-fb-reject-1',
        expectedStatus: 503,
        expectedStage: 'save_pending_application',
        expectedCode: 'FIREBASE_WRITE_FAILED',
      },
      {
        label: 'firebase_permission_denied',
        behavior: { razorpayMode: 'ok', firebaseWriteMode: 'permission_denied' },
        clientRequestId: 'fault-fb-perm-1',
        expectedStatus: 403,
        expectedStage: 'save_pending_application',
        expectedCode: 'FIREBASE_PERMISSION_DENIED',
      },
      {
        label: 'firebase_write_timeout',
        behavior: { razorpayMode: 'ok', firebaseWriteMode: 'timeout' },
        clientRequestId: 'fault-fb-timeout-1',
        expectedStatus: 504,
        expectedStage: 'save_pending_application',
        expectedCode: 'FIREBASE_WRITE_TIMEOUT',
      },
    ];

    opSvc.resetPaymentInitCachesForTesting();
    for (const fc of faultCases) {
      opSvc.setPaymentInitTestBehaviorForTesting(fc.behavior);
      const r = await fetch(`${baseUrl}/api/applications/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({
          serviceId: 'aadhaar-ucl-opretor',
          subserviceName: 'Advance Opretor ID',
          clientRequestId: fc.clientRequestId,
          details: validAppDetails,
        }),
      });
      const j = await r.json();
      assert.strictEqual(r.status, fc.expectedStatus, `${fc.label}: expected status ${fc.expectedStatus}, got ${r.status} (${JSON.stringify(j)})`);
      assert.strictEqual(j.success, false, `${fc.label}: success must be false`);
      assert.strictEqual(j.stage, fc.expectedStage, `${fc.label}: expected stage ${fc.expectedStage}, got ${j.stage}`);
      assert.strictEqual(j.code, fc.expectedCode, `${fc.label}: expected code ${fc.expectedCode}, got ${j.code}`);
      assert(typeof j.requestId === 'string' && j.requestId.length > 0, `${fc.label}: diagnostic requestId must be returned`);
      const serialized = JSON.stringify(j);
      assert(!serialized.includes('test_rzp_secret') && !serialized.includes('PRIVATE KEY') && !serialized.includes('Basic '), `${fc.label}: response must never leak credentials`);
      if (fc.expectedStage === 'save_pending_application') {
        assert(!/details remain saved|form data saved/i.test(String(j.error || '')), `${fc.label}: must not falsely claim durable save succeeded`);
      }
    }

    // Retry after save_pending_application failure must succeed & reuse order without duplicating
    opSvc.setPaymentInitTestBehaviorForTesting({ razorpayMode: 'ok', firebaseWriteMode: 'ok' });
    const recoveredAfterFbResp = await fetch(`${baseUrl}/api/applications/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: custToken },
      body: JSON.stringify({
        serviceId: 'aadhaar-ucl-opretor',
        subserviceName: 'Advance Opretor ID',
        clientRequestId: 'fault-fb-reject-1',
        details: validAppDetails,
      }),
    });
    const recoveredAfterFbJson = await recoveredAfterFbResp.json();
    assert.strictEqual(recoveredAfterFbResp.status, 201);
    assert(recoveredAfterFbJson.razorpayOrderId?.startsWith('order_test_app_'));

    // Verify zero undefined in persisted pending draft & retrying reuses exact same orderId
    const secondRetryResp = await fetch(`${baseUrl}/api/applications/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: custToken },
      body: JSON.stringify({
        serviceId: 'aadhaar-ucl-opretor',
        subserviceName: 'Advance Opretor ID',
        clientRequestId: 'fault-fb-reject-1',
        details: validAppDetails,
      }),
    });
    const secondRetryJson = await secondRetryResp.json();
    assert.strictEqual(secondRetryResp.status, 200);
    assert.strictEqual(secondRetryJson.duplicate, true);
    assert.strictEqual(secondRetryJson.razorpayOrderId, recoveredAfterFbJson.razorpayOrderId);
    console.log('✅ [PASS] Razorpay payment initiation E2E, fault stages, idempotency & no-duplicate-order recovery verified');

    // Razorpay invalid HMAC -> 400; webhook reconciliation -> completed
    const payOrderResp = await fetch(`${baseUrl}/api/store/orders/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: custToken },
      body: JSON.stringify({
        idempotencyKey: 'rzp-flow-001',
        items: [{ productId: 'diseases-treatment-complete-medical-reference-pdf-125-diseases', quantity: 1 }],
        deliveryAddress: {
          name: 'Cust Scale',
          email: 'cust.scale@example.com',
          phone: '9876543210',
          addressLine1: '12 Main Road',
          city: 'Bhopal',
          state: 'Madhya Pradesh',
          pincode: '462001',
        },
      }),
    });
    const payOrder = await payOrderResp.json();
    assert.strictEqual(payOrderResp.status, 201);

    const badVerifyResp = await fetch(`${baseUrl}/api/store/orders/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: custToken },
      body: JSON.stringify({
        orderId: payOrder.orderId,
        razorpay_order_id: payOrder.razorpayOrderId,
        razorpay_payment_id: 'pay_test_999',
        razorpay_signature: 'invalid_signature',
      }),
    });
    assert.strictEqual(badVerifyResp.status, 400, 'Invalid Razorpay HMAC must return 400');

    // Simulate user closing tab after paying — Razorpay delivers signed webhook
    const whPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_recovered_1',
            order_id: payOrder.razorpayOrderId,
            amount: payOrder.amount,
            currency: 'INR',
            status: 'captured',
            notes: { orderId: payOrder.orderId },
          },
        },
      },
    });
    const whSig = crypto.createHmac('sha256', 'test_webhook_secret').update(whPayload).digest('hex');
    const whResp = await fetch(`${baseUrl}/api/store/orders/razorpay-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': whSig,
        'x-razorpay-event-id': 'evt_scale_1',
      },
      body: whPayload,
    });
    assert.strictEqual(whResp.status, 200);

    const recResp = await fetch(`${baseUrl}/api/store/orders/recover-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: payOrder.orderId }),
    });
    const recJson = await recResp.json();
    assert.strictEqual(recJson.verified, true, 'Webhook-reconciled order must be recoverable after tab closure');

    // Parallel multi-file attachment upload & auth check
    const minimalPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360f8cf000000020101e221bc330000000049454e44ae426082', 'hex');
    const fd = new FormData();
    fd.append('files', new Blob([minimalPng], { type: 'image/png' }), 'front.png');
    fd.append('files', new Blob([minimalPng], { type: 'image/png' }), 'back.png');
    fd.append('files', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'doc.pdf');

    const upResp = await fetch(`${baseUrl}/api/applications/ICC-TEST-MULTIPART-APP/upload-reply-attachments`, {
      method: 'POST',
      headers: { Authorization: custToken },
      body: fd,
    });
    const upJson = await upResp.json();
    assert.strictEqual(upResp.status, 200);
    assert.strictEqual(upJson.attachments.length, 3);

    const firstUrl = `${baseUrl}${upJson.attachments[0].url}`;
    const ownerFetch = await fetch(firstUrl, { headers: { Authorization: custToken } });
    assert.strictEqual(ownerFetch.status, 200);
    const otherFetch = await fetch(firstUrl, { headers: { Authorization: otherToken } });
    assert.strictEqual(otherFetch.status, 403, 'Unauthorized user must not access another user attachment');

    console.log('✅ [PASS] Concurrent idempotency, Razorpay/webhook recovery, and parallel attachments verified');

    // ---------------------------------------------------------
    // 3. Standalone Worker Process Health + Clean Shutdown
    // ---------------------------------------------------------
    spawnedWorker = spawn('node', ['worker.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STORE_ORDER_TEST_MODE: '1',
        OPERATOR_TEST_MODE: '1',
        WORKER_HEALTH_PORT: '3911',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForHttpReady('http://127.0.0.1:3911/health', 12000);
    const workerExitPromise = new Promise<number | null>(resolve => {
      spawnedWorker.once('exit', (code: number | null) => resolve(code));
    });
    spawnedWorker.kill('SIGTERM');
    const workerExitCode = await workerExitPromise;
    assert.strictEqual(workerExitCode, 0, 'Worker must exit cleanly with code 0 on SIGTERM');
    spawnedWorker = null;
    console.log('✅ [PASS] Standalone node worker.js health check & graceful SIGTERM exit=0 verified');

    // ---------------------------------------------------------
    // 4. Compiled node server.js Staged Load Tests (25c / 100c / 250c)
    // ---------------------------------------------------------
    spawnedServer = spawn('node', ['server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '3910',
        STORE_ORDER_TEST_MODE: '1',
        OPERATOR_TEST_MODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForHttpReady('http://127.0.0.1:3910/api/health', 15000);

    const srvBase = 'http://127.0.0.1:3910';
    const stage1 = await runLoadStage('Stage1-25c-250reqs', 25, 250, async (i) => {
      const target = i % 3 === 0 ? '/api/health' : i % 3 === 1 ? '/api/documents' : '/';
      const r = await fetch(`${srvBase}${target}`);
      await r.arrayBuffer();
      return { ok: r.ok, status: r.status };
    });

    const stage2 = await runLoadStage('Stage2-100c-500reqs', 100, 500, async (i) => {
      if (i % 5 === 0) {
        const r = await fetch(`${srvBase}/api/store/orders/cod`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: custToken },
          body: JSON.stringify({
            idempotencyKey: `load-cod-${i}`,
            items: [{ productId: 'diseases-treatment-complete-medical-reference-pdf-125-diseases', quantity: 1 }],
            deliveryAddress: {
              name: 'Load User',
              email: 'load@example.com',
              phone: '9876543210',
              addressLine1: '99 Test Street',
              city: 'Bhopal',
              state: 'Madhya Pradesh',
              pincode: '462001',
            },
          }),
        });
        await r.arrayBuffer();
        return { ok: r.status === 201 || r.status === 200 || r.status === 429, status: r.status };
      }
      const target = i % 2 === 0 ? '/api/health' : '/services';
      const r = await fetch(`${srvBase}${target}`);
      await r.arrayBuffer();
      return { ok: r.ok, status: r.status };
    });

    const stage3 = await runLoadStage('Stage3-250c-1000reqs', 250, 1000, async (i) => {
      const target = i % 4 === 0 ? '/api/health' : i % 4 === 1 ? '/api/document-categories' : i % 4 === 2 ? '/' : '/store';
      const r = await fetch(`${srvBase}${target}`);
      await r.arrayBuffer();
      return { ok: r.ok, status: r.status };
    });

    assert.strictEqual(stage1.errors, 0, 'Stage 1 should have 0 unexpected errors');
    assert.strictEqual(stage2.errors, 0, 'Stage 2 should have 0 unexpected errors');
    assert.strictEqual(stage3.errors, 0, 'Stage 3 should have 0 unexpected errors');

    const metricsResp = await fetch(`${srvBase}/api/admin/metrics`, { headers: { Authorization: adminToken } });
    assert.strictEqual(metricsResp.status, 200);
    const metricsJson = await metricsResp.json();
    console.log('[METRICS]', JSON.stringify(metricsJson.metrics));

    const dlqAdminResp = await fetch(`${srvBase}/api/admin/queue/dlq`, { headers: { Authorization: adminToken } });
    assert.strictEqual(dlqAdminResp.status, 200);

    const serverExitPromise = new Promise<number | null>(resolve => {
      spawnedServer.once('exit', (code: number | null) => resolve(code));
    });
    spawnedServer.kill('SIGTERM');
    await serverExitPromise;
    spawnedServer = null;
    console.log('✅ [PASS] Staged load benchmark & metrics verified');
  } finally {
    if (spawnedWorker) { try { spawnedWorker.kill('SIGKILL'); } catch {} }
    if (spawnedServer) { try { spawnedServer.kill('SIGKILL'); } catch {} }
    if (mockServer) { try { await new Promise(r => mockServer.close(() => r(undefined))); } catch {} }
    try { fs.rmSync(createdAppAttDir, { recursive: true, force: true }); } catch {}
    restoreFiles(backups);
  }
}

main().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
