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
  const prevOrderTestMode = process.env.STORE_ORDER_TEST_MODE;
  const prevNodeEnv = process.env.NODE_ENV;
  delete process.env.STORE_TEST_MODE;
  delete process.env.STORE_ORDER_TEST_MODE;
  process.env.NODE_ENV = 'production';
  try {
    return await fn();
  } finally {
    if (prevTestMode === undefined) delete process.env.STORE_TEST_MODE;
    else process.env.STORE_TEST_MODE = prevTestMode;
    if (prevOrderTestMode === undefined) delete process.env.STORE_ORDER_TEST_MODE;
    else process.env.STORE_ORDER_TEST_MODE = prevOrderTestMode;
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

test('validateAndComputeOrder allows virtual product checkout without physical address and still enforces address for physical products', async () => {
  const prevTestMode = process.env.STORE_ORDER_TEST_MODE;
  process.env.STORE_ORDER_TEST_MODE = '1';
  try {
    const { validateAndComputeOrder, handleAdminSaveDigitalProductResources } = await import('./storeOrderService');
    const virtualProductId = 'bt-105-autocad-complete-solved-notes-20222026';
    const physicalProductId = 'mfs110-with-aadhaar-rd-service-l1-biometric-fingerprint-scanner';

    // Seed a digital resource for the virtual product in test mode
    const fakeReq: any = {
      params: { productId: virtualProductId },
      headers: { authorization: 'Bearer test-token:admin_uid_1:admin1@indiacybercafe.com' },
      body: {
        resources: [
          {
            id: 'res-test-1',
            fileName: 'BT-105_AutoCAD_Notes.pdf',
            label: 'Download Notes PDF',
            url: FIREBASE_PDF_URL,
          },
        ],
      },
    };
    let saveStatus = 200;
    const fakeRes: any = {
      status(code: number) {
        saveStatus = code;
        return this;
      },
      json() {
        return this;
      },
    };
    await handleAdminSaveDigitalProductResources(fakeReq, fakeRes);
    assert.equal(saveStatus, 200);

    const contactOnly = {
      name: 'Suresh Kumar',
      email: 'suresh@example.com',
      phone: '9876543210',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      pincode: '',
      country: 'India',
    };

    const virtualResult = await validateAndComputeOrder(
      [{ productId: virtualProductId, quantity: 1 }],
      contactOnly,
      'online'
    );
    assert.equal(virtualResult.valid, true);
    if (virtualResult.valid) {
      assert.equal(virtualResult.deliveryCharges, 0);
      assert.equal(virtualResult.sanitizedAddress.addressLine1, '');
      assert.equal(virtualResult.sanitizedAddress.pincode, '');
      assert.equal(virtualResult.sanitizedAddress.email, 'suresh@example.com');
    }

    const physicalMissingAddress = await validateAndComputeOrder(
      [{ productId: physicalProductId, quantity: 1 }],
      contactOnly,
      'online'
    );
    assert.equal(physicalMissingAddress.valid, false);
    if (!physicalMissingAddress.valid) {
      assert.equal(physicalMissingAddress.status, 400);
      assert.match(physicalMissingAddress.error, /street address/i);
    }
  } finally {
    if (prevTestMode === undefined) delete process.env.STORE_ORDER_TEST_MODE;
    else process.env.STORE_ORDER_TEST_MODE = prevTestMode;
  }
});

test('virtual products require login to buy, only the purchasing buyer (or admin) can download the PDF, and redirect helpers safely preserve URLs', async () => {
  const crypto = await import('node:crypto');
  const { PassThrough } = await import('node:stream');
  const prevTestMode = process.env.STORE_ORDER_TEST_MODE;
  const prevOperatorTestMode = process.env.OPERATOR_TEST_MODE;
  const prevSecret = process.env.DIGITAL_DOWNLOAD_TOKEN_SECRET;
  process.env.STORE_ORDER_TEST_MODE = '1';
  process.env.OPERATOR_TEST_MODE = '1';
  delete process.env.DIGITAL_DOWNLOAD_TOKEN_SECRET;

  const originalFetch = globalThis.fetch;

  const makeRes = () => {
    let statusCode = 200;
    let body: any = undefined;
    let redirectTarget: string | undefined = undefined;
    const headers: Record<string, string> = {};
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        body = payload;
        return this;
      },
      send(payload: any) {
        body = payload;
        return this;
      },
      redirect(code: number, target: string) {
        statusCode = code;
        redirectTarget = target;
        return this;
      },
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      get result() {
        return { statusCode, body, headers, redirectTarget };
      },
    };
    return res;
  };

  try {
    const {
      handleAdminSaveDigitalProductResources,
      handleCreatePaymentOrder,
      handleVerifyPayment,
      handleGuestTrackOrder,
      handleDigitalDownload,
    } = await import('./storeOrderService');
    const { serverEmailTemplates } = await import('./emailNotificationService');

    const virtualProductId = 'bt-105-autocad-complete-solved-notes-20222026';

    // 1. Admin seeds digital resource for virtual product
    const seedRes = makeRes();
    await handleAdminSaveDigitalProductResources(
      {
        params: { productId: virtualProductId },
        headers: { authorization: 'Bearer test-token:admin_uid_1:admin1@indiacybercafe.com' },
        body: {
          resources: [
            {
              id: 'res-buyer-1',
              fileName: 'BT-105_AutoCAD_Complete_Solved_Notes.pdf',
              label: 'Download AutoCAD Notes PDF',
              url: FIREBASE_PDF_URL,
            },
          ],
        },
      } as any,
      seedRes
    );
    assert.equal(seedRes.result.statusCode, 200);

    // 2. Logged-out guest CANNOT buy a virtual product (blocked with 401)
    const guestBlockedRes = makeRes();
    await handleCreatePaymentOrder(
      {
        headers: {},
        ip: '203.0.113.10',
        socket: { remoteAddress: '203.0.113.10' },
        body: {
          items: [{ productId: virtualProductId, quantity: 1 }],
          deliveryAddress: {
            name: 'Guest Visitor',
            email: 'guest.visitor@example.com',
            phone: '9876543211',
            addressLine1: '',
            addressLine2: '',
            city: '',
            state: '',
            pincode: '',
            country: 'India',
          },
        },
      } as any,
      guestBlockedRes
    );
    assert.equal(guestBlockedRes.result.statusCode, 401);
    assert.match(String(guestBlockedRes.result.body?.error || ''), /sign in/i);

    // 3. Logged-in buyer creates online payment order without physical shipping address
    const buyerAuthHeader = 'Bearer test-token:buyer_uid_101:buyer101@example.com';
    const otherUserAuthHeader = 'Bearer test-token:other_uid_202:stranger202@example.com';

    const createRes = makeRes();
    await handleCreatePaymentOrder(
      {
        headers: { authorization: buyerAuthHeader },
        ip: '203.0.113.10',
        socket: { remoteAddress: '203.0.113.10' },
        body: {
          items: [{ productId: virtualProductId, quantity: 1 }],
          deliveryAddress: {
            name: 'Verified Buyer',
            email: 'buyer101@example.com',
            phone: '9876543211',
            addressLine1: '',
            addressLine2: '',
            city: '',
            state: '',
            pincode: '',
            country: 'India',
          },
        },
      } as any,
      createRes
    );
    assert.equal(createRes.result.statusCode, 201);
    const createdOrderId = createRes.result.body.orderId;
    const razorpayOrderId = createRes.result.body.razorpayOrderId;
    assert.ok(createdOrderId);
    assert.ok(razorpayOrderId);

    // 4. Logged-in buyer verifies Razorpay payment
    const razorpayPaymentId = `pay_buyer_${Date.now()}`;
    const signature = crypto
      .createHmac('sha256', 'test_rzp_secret')
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const verifyRes = makeRes();
    await handleVerifyPayment(
      {
        headers: { authorization: buyerAuthHeader },
        ip: '203.0.113.10',
        socket: { remoteAddress: '203.0.113.10' },
        body: {
          orderId: createdOrderId,
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: signature,
        },
      } as any,
      verifyRes
    );
    assert.equal(verifyRes.result.statusCode, 200);
    assert.equal(verifyRes.result.body.verified, true);
    const verifiedOrder = verifyRes.result.body.order;
    assert.ok(Array.isArray(verifiedOrder.digitalDownloads) && verifiedOrder.digitalDownloads.length === 1);
    const downloadResource = verifiedOrder.digitalDownloads[0].resources[0];
    assert.match(downloadResource.downloadUrl, /\/api\/store\/downloads\/[A-Za-z0-9_-]{40,60}$/);
    assert.match(downloadResource.downloadPageUrl, /\/store\/download\/[A-Za-z0-9_-]{40,60}$/);
    const downloadToken = downloadResource.downloadUrl.split('/').pop()!;

    // 5. Unauthenticated guest track does NOT expose digitalDownloads
    const guestTrackRes = makeRes();
    await handleGuestTrackOrder(
      {
        headers: {},
        ip: '203.0.113.11',
        socket: { remoteAddress: '203.0.113.11' },
        body: { orderId: createdOrderId, email: 'buyer101@example.com' },
      } as any,
      guestTrackRes
    );
    assert.equal(guestTrackRes.result.statusCode, 200);
    assert.deepEqual(guestTrackRes.result.body.order.digitalDownloads, []);

    // 6. Unauthenticated API download is rejected with 401
    const unauthApiRes = makeRes();
    await handleDigitalDownload(
      {
        params: { token: downloadToken },
        headers: { accept: 'application/pdf' },
      } as any,
      unauthApiRes
    );
    assert.equal(unauthApiRes.result.statusCode, 401);

    // 7. Unauthenticated browser click on API link redirects cleanly to SPA /store/download/:token
    const unauthBrowserRes = makeRes();
    await handleDigitalDownload(
      {
        params: { token: downloadToken },
        headers: { accept: 'text/html,application/xhtml+xml' },
      } as any,
      unauthBrowserRes
    );
    assert.equal(unauthBrowserRes.result.statusCode, 302);
    assert.equal(unauthBrowserRes.result.redirectTarget, `/store/download/${downloadToken}`);

    // 8. Different signed-in user CANNOT download another buyer's PDF (403)
    const otherUserRes = makeRes();
    await handleDigitalDownload(
      {
        params: { token: downloadToken },
        headers: { authorization: otherUserAuthHeader },
      } as any,
      otherUserRes
    );
    assert.equal(otherUserRes.result.statusCode, 403);
    assert.match(String(otherUserRes.result.body?.error || ''), /Only the account that purchased/i);

    // 9. Actual buyer downloads PDF cleanly (twice in a row to confirm counter works reliably)
    const pdfPayload = Buffer.from('%PDF-1.4\n% Buyer-Only Virtual Product PDF Content\n%%EOF', 'utf8');
    globalThis.fetch = (async () =>
      new Response(pdfPayload, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(pdfPayload.length),
        },
      })) as any;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const chunks: Buffer[] = [];
      const streamRes: any = new PassThrough();
      streamRes.headersSent = false;
      streamRes.statusCode = 200;
      streamRes.headers = {} as Record<string, string>;
      streamRes.status = (code: number) => {
        streamRes.statusCode = code;
        return streamRes;
      };
      streamRes.json = (payload: any) => {
        streamRes.body = payload;
        return streamRes;
      };
      streamRes.send = (msg: any) => {
        streamRes.body = msg;
        return streamRes;
      };
      streamRes.setHeader = (k: string, v: string) => {
        streamRes.headers[k.toLowerCase()] = v;
      };
      streamRes.on('data', (chunk: Buffer) => chunks.push(chunk));

      await handleDigitalDownload(
        {
          params: { token: downloadToken },
          headers: { authorization: buyerAuthHeader },
        } as any,
        streamRes
      );
      assert.equal(streamRes.statusCode, 200);
      assert.equal(streamRes.headers['content-type'], 'application/pdf');
      assert.match(streamRes.headers['content-disposition'], /attachment; filename\*=UTF-8''/);
      assert.equal(Buffer.concat(chunks).toString('utf8'), pdfPayload.toString('utf8'));
    }

    // 10. Email templates link to authenticated downloadPageUrl (/store/download/:token)
    const confirmEmailHtml = serverEmailTemplates.customerOrderConfirmed({
      customerName: 'Verified Buyer',
      orderId: createdOrderId,
      items: verifiedOrder.items,
      totalAmount: verifiedOrder.total,
      paymentMethod: 'online',
      paymentStatus: 'completed',
      address: verifiedOrder.deliveryAddress,
      isGuest: false,
      digitalDownloads: verifiedOrder.digitalDownloads,
    });
    assert.ok(confirmEmailHtml.includes(downloadResource.downloadPageUrl));
    assert.ok(confirmEmailHtml.includes('Download AutoCAD Notes PDF'));
    assert.ok(confirmEmailHtml.includes('Sign in with your buyer account'));

    const deliveryEmailHtml = serverEmailTemplates.customerDigitalDelivery({
      customerName: 'Verified Buyer',
      orderId: createdOrderId,
      downloads: verifiedOrder.digitalDownloads,
      totalAmount: verifiedOrder.total,
    });
    assert.ok(deliveryEmailHtml.includes(downloadResource.downloadPageUrl));
  } finally {
    globalThis.fetch = originalFetch;
    if (prevTestMode === undefined) delete process.env.STORE_ORDER_TEST_MODE;
    else process.env.STORE_ORDER_TEST_MODE = prevTestMode;
    if (prevOperatorTestMode === undefined) delete process.env.OPERATOR_TEST_MODE;
    else process.env.OPERATOR_TEST_MODE = prevOperatorTestMode;
    if (prevSecret === undefined) delete process.env.DIGITAL_DOWNLOAD_TOKEN_SECRET;
    else process.env.DIGITAL_DOWNLOAD_TOKEN_SECRET = prevSecret;
  }
});


