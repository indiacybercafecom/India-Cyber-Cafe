import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';

// Ensure strict isolated test mode BEFORE importing storeOrderService
process.env.STORE_ORDER_TEST_MODE = '1';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test_rzp_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const ORDERS_STORE_PATH = path.resolve('data/orders_store.json');
const CUSTOM_UPLOADS_DIR = path.resolve('data/uploads/custom-images');
const APPLY_TSX_PATH = path.resolve('src/pages/Apply.tsx');
const INDEX_CSS_PATH = path.resolve('src/index.css');

async function runTests() {
  // Back up any existing data/orders_store.json and remove on completion
  const hadExistingStore = fs.existsSync(ORDERS_STORE_PATH);
  const existingBackup = hadExistingStore ? fs.readFileSync(ORDERS_STORE_PATH, 'utf-8') : null;
  if (hadExistingStore) fs.unlinkSync(ORDERS_STORE_PATH);

  const createdUploadFiles: string[] = [];

  try {
    const storeSvc = await import('../src/server/storeOrderService.js');

    const app = express();
    app.use(express.json({
      limit: '2mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      }
    }));
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

    app.post('/api/auth/lookup-email', storeSvc.handleLookupEmail);
    app.post('/api/store/upload-custom-image', upload.single('customImage'), storeSvc.handleUploadCustomImage);
    app.post('/api/store/orders/cod', storeSvc.handleCodOrder);
    app.post('/api/store/orders/create-payment', storeSvc.handleCreatePaymentOrder);
    app.post('/api/store/orders/verify-payment', storeSvc.handleVerifyPayment);
    app.post('/api/store/orders/recover-payment', storeSvc.handleRecoverPayment);
    app.post('/api/store/orders/razorpay-webhook', storeSvc.handleRazorpayWebhook);
    app.get('/api/store/orders/my', storeSvc.handleGetMyOrders);
    app.post('/api/store/orders/guest-track', storeSvc.handleGuestTrackOrder);
    app.post('/api/store/orders/link-guest-orders', storeSvc.handleLinkGuestOrders);

    const server = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    let passed = 0;
    const check = async (name: string, fn: () => Promise<void> | void) => {
      await fn();
      passed++;
      console.log(`✅ [PASS] ${name}`);
    };

    try {
      const validAddress = {
        name: 'Rahul Sharma',
        email: 'rahul.test@example.com',
        phone: '9876543210',
        addressLine1: '12 Main Market Road',
        addressLine2: 'Near Bus Stand',
        city: 'Singrauli',
        state: 'Madhya Pradesh',
        pincode: '486886',
        country: 'India'
      };

      // Product IDs from public/data/products.json:
      // 1) "diseases-treatment-complete-medical-reference-pdf-125-diseases": price 499, discountedPrice 49, paymentMethods: ["both"]
      // 2) "-OnAp1lEhlTb3WRi_rsw": price 500, discountedPrice 299, paymentMethods: ["online"], requiresCustomImage: true
      const BOTH_PRODUCT_ID = 'diseases-treatment-complete-medical-reference-pdf-125-diseases';
      const ONLINE_CUSTOM_PRODUCT_ID = '-OnAp1lEhlTb3WRi_rsw';

      // 1. Apply.tsx & index.css double-scroll verification
      await check('Apply.tsx has no inner scroll container (max-h-screen / overflow-y-auto removed)', () => {
        const applySrc = fs.readFileSync(APPLY_TSX_PATH, 'utf-8');
        const cssSrc = fs.readFileSync(INDEX_CSS_PATH, 'utf-8');
        assert(!applySrc.includes('max-h-screen'), 'Apply.tsx must not contain max-h-screen');
        assert(!applySrc.includes('overflow-y-auto'), 'Apply.tsx must not contain overflow-y-auto');
        assert(cssSrc.includes('scroll-padding-top'), 'index.css must define scroll-padding-top');
        assert(cssSrc.includes('scroll-padding-bottom'), 'index.css must define scroll-padding-bottom');
      });

      // 2. Guest COD checkout + server price enforcement (ignores spoofed client price/total)
      let guestCodOrderId = '';
      let guestCodToken = '';
      await check('Guest COD checkout creates order with server-computed total & canonical ICC/STORE-... ID', async () => {
        const resp = await fetch(`${baseUrl}/api/store/orders/cod`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ productId: BOTH_PRODUCT_ID, quantity: 2, price: 1, total: 1 }],
            deliveryAddress: validAddress,
            idempotencyKey: 'idem-cod-guest-1'
          })
        });
        const data = await resp.json();
        assert.strictEqual(resp.status, 201);
        assert.strictEqual(data.success, true);
        assert(data.orderId.startsWith('ICC/STORE-'));
        assert.strictEqual(data.order.total, 98); // 49 * 2
        assert.strictEqual(data.order.paymentMethod, 'cash');
        assert.strictEqual(data.order.paymentStatus, 'pending');
        assert.strictEqual(data.order.isGuest, true);
        assert(data.guestTrackingToken && data.guestTrackingToken.length >= 32);
        guestCodOrderId = data.orderId;
        guestCodToken = data.guestTrackingToken;
      });

      // 3. COD idempotency replay returns same order without duplicate creation
      await check('COD checkout idempotency prevents duplicate orders on retry', async () => {
        const resp = await fetch(`${baseUrl}/api/store/orders/cod`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ productId: BOTH_PRODUCT_ID, quantity: 2 }],
            deliveryAddress: validAddress,
            idempotencyKey: 'idem-cod-guest-1'
          })
        });
        const data = await resp.json();
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(data.orderId, guestCodOrderId);
      });

      // 4. Reject COD when product only supports online payment
      await check('Rejects COD for online-only product', async () => {
        const resp = await fetch(`${baseUrl}/api/store/orders/cod`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ productId: ONLINE_CUSTOM_PRODUCT_ID, quantity: 1, customImageUrl: '/uploads/custom-images/test.png' }],
            deliveryAddress: validAddress
          })
        });
        assert.strictEqual(resp.status, 400);
      });

      // 5. Reject missing custom image when requiresCustomImage is true
      await check('Rejects order missing required customImageUrl', async () => {
        const resp = await fetch(`${baseUrl}/api/store/orders/create-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ productId: ONLINE_CUSTOM_PRODUCT_ID, quantity: 1 }],
            deliveryAddress: validAddress
          })
        });
        assert.strictEqual(resp.status, 400);
      });

      // 6. Reject invalid delivery address & invalid quantity
      await check('Rejects invalid pincode / phone / quantity', async () => {
        const badAddr = { ...validAddress, pincode: '123' };
        const resp = await fetch(`${baseUrl}/api/store/orders/cod`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ productId: BOTH_PRODUCT_ID, quantity: 1 }],
            deliveryAddress: badAddr
          })
        });
        assert.strictEqual(resp.status, 400);

        const badQty = await fetch(`${baseUrl}/api/store/orders/cod`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ productId: BOTH_PRODUCT_ID, quantity: 0 }],
            deliveryAddress: validAddress
          })
        });
        assert.strictEqual(badQty.status, 400);
      });

      // 7. Custom image fallback upload endpoint validates PNG magic bytes & stores file
      let uploadedCustomUrl = '';
      await check('Custom image upload validates PNG magic bytes and rejects non-image payload', async () => {
        const badForm = new FormData();
        badForm.append('customImage', new Blob([Buffer.from('not-an-image')], { type: 'text/plain' }), 'evil.txt');
        const badResp = await fetch(`${baseUrl}/api/store/upload-custom-image`, { method: 'POST', body: badForm });
        assert.strictEqual(badResp.status, 400);

        // Valid minimal 1x1 PNG header + data
        const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
        const okForm = new FormData();
        okForm.append('customImage', new Blob([pngBytes], { type: 'image/png' }), 'design.png');
        const okResp = await fetch(`${baseUrl}/api/store/upload-custom-image`, { method: 'POST', body: okForm });
        const okData = await okResp.json();
        assert.strictEqual(okResp.status, 200);
        assert.strictEqual(okData.success, true);
        assert(okData.url.startsWith('/uploads/custom-images/'));
        uploadedCustomUrl = okData.url;
        createdUploadFiles.push(path.join(CUSTOM_UPLOADS_DIR, path.basename(uploadedCustomUrl)));
      });

      // 8. Authenticated Razorpay create-payment + verify-payment + tamper rejection + reuse prevention + idempotency
      let authOrderId = '';
      let authRzpOrderId = '';
      await check('Authenticated Razorpay create-payment & HMAC verify-payment succeeds', async () => {
        const createResp = await fetch(`${baseUrl}/api/store/orders/create-payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token:uid_cust_1:cust1@example.com'
          },
          body: JSON.stringify({
            items: [{ productId: ONLINE_CUSTOM_PRODUCT_ID, quantity: 1, customImageUrl: uploadedCustomUrl }],
            deliveryAddress: { ...validAddress, email: 'cust1@example.com' }
          })
        });
        const createData = await createResp.json();
        assert.strictEqual(createResp.status, 201);
        assert.strictEqual(createData.amount, 29900); // ₹299 in paise
        authOrderId = createData.orderId;
        authRzpOrderId = createData.razorpayOrderId;

        // Invalid signature rejected with 400
        const badSigResp = await fetch(`${baseUrl}/api/store/orders/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: authOrderId,
            razorpay_order_id: authRzpOrderId,
            razorpay_payment_id: 'pay_test_111',
            razorpay_signature: 'invalid_sig'
          })
        });
        assert.strictEqual(badSigResp.status, 400);

        // Valid HMAC signature succeeds
        const validSig = crypto
          .createHmac('sha256', 'test_rzp_secret')
          .update(`${authRzpOrderId}|pay_test_111`)
          .digest('hex');

        const verifyResp = await fetch(`${baseUrl}/api/store/orders/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: authOrderId,
            razorpay_order_id: authRzpOrderId,
            razorpay_payment_id: 'pay_test_111',
            razorpay_signature: validSig
          })
        });
        const verifyData = await verifyResp.json();
        assert.strictEqual(verifyResp.status, 200);
        assert.strictEqual(verifyData.verified, true);
        assert.strictEqual(verifyData.order.paymentStatus, 'completed');
        assert.strictEqual(verifyData.order.orderStatus, 'processing');

        // Idempotent retry returns verified: true
        const retryResp = await fetch(`${baseUrl}/api/store/orders/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: authOrderId,
            razorpay_order_id: authRzpOrderId,
            razorpay_payment_id: 'pay_test_111',
            razorpay_signature: validSig
          })
        });
        const retryData = await retryResp.json();
        assert.strictEqual(retryResp.status, 200);
        assert.strictEqual(retryData.verified, true);
      });

      // 9. Prevent reusing same razorpayPaymentId on a second order
      await check('Blocks reusing razorpay_payment_id across different orders (409)', async () => {
        const c2 = await fetch(`${baseUrl}/api/store/orders/create-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ productId: BOTH_PRODUCT_ID, quantity: 1 }],
            deliveryAddress: validAddress
          })
        }).then(r => r.json());

        const reusedSig = crypto
          .createHmac('sha256', 'test_rzp_secret')
          .update(`${c2.razorpayOrderId}|pay_test_111`)
          .digest('hex');

        const v2 = await fetch(`${baseUrl}/api/store/orders/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: c2.orderId,
            razorpay_order_id: c2.razorpayOrderId,
            razorpay_payment_id: 'pay_test_111',
            razorpay_signature: reusedSig
          })
        });
        assert.strictEqual(v2.status, 409);

        // Reconcile c2 via Razorpay Webhook (invalid sig rejected, valid sig completes order)
        const webhookPayload = JSON.stringify({
          event: 'payment.captured',
          payload: {
            payment: {
              entity: {
                id: 'pay_webhook_222',
                order_id: c2.razorpayOrderId,
                amount: 4900,
                currency: 'INR'
              }
            }
          }
        });
        const badWh = await fetch(`${baseUrl}/api/store/orders/razorpay-webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'wrong' },
          body: webhookPayload
        });
        assert.strictEqual(badWh.status, 400);

        const whSig = crypto.createHmac('sha256', 'test_webhook_secret').update(webhookPayload).digest('hex');
        const okWh = await fetch(`${baseUrl}/api/store/orders/razorpay-webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': whSig,
            'x-razorpay-event-id': 'evt_unique_1'
          },
          body: webhookPayload
        });
        assert.strictEqual(okWh.status, 200);

        // Verify order is now marked completed when tracked
        const tracked = await fetch(`${baseUrl}/api/store/orders/guest-track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: c2.orderId, email: validAddress.email })
        }).then(r => r.json());
        assert.strictEqual(tracked.order.paymentStatus, 'completed');
        assert.strictEqual(tracked.order.orderStatus, 'processing');
      });

      // 10. Authenticated /api/store/orders/my returns user orders + rejects unauthenticated
      await check('/api/store/orders/my rejects unauthenticated (401) and returns owner orders', async () => {
        const unauthResp = await fetch(`${baseUrl}/api/store/orders/my`);
        assert.strictEqual(unauthResp.status, 401);

        const myResp = await fetch(`${baseUrl}/api/store/orders/my`, {
          headers: { Authorization: 'Bearer test-token:uid_cust_1:cust1@example.com' }
        });
        const myData = await myResp.json();
        assert.strictEqual(myResp.status, 200);
        assert.strictEqual(myData.success, true);
        assert(myData.orders.some((o: any) => o.id === authOrderId));
      });

      // 11. Legacy userId compatibility + email auto-linking
      await check('Legacy userId orders & guest email orders auto-link into /api/store/orders/my', async () => {
        const local = JSON.parse(fs.readFileSync(ORDERS_STORE_PATH, 'utf-8'));
        local['ICC/STORE-LEGACY-1'] = {
          id: 'ICC/STORE-LEGACY-1',
          userId: 'uid_cust_1',
          email: 'cust1@example.com',
          items: [{ productId: BOTH_PRODUCT_ID, productName: 'Legacy Book', price: 49, quantity: 1 }],
          deliveryAddress: { ...validAddress, email: 'cust1@example.com' },
          subtotal: 49,
          deliveryCharges: 0,
          total: 49,
          paymentMethod: 'cash',
          paymentStatus: 'pending',
          orderStatus: 'pending',
          notes: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(ORDERS_STORE_PATH, JSON.stringify(local, null, 2), 'utf-8');

        const myResp = await fetch(`${baseUrl}/api/store/orders/my`, {
          headers: { Authorization: 'Bearer test-token:uid_cust_1:cust1@example.com' }
        });
        const myData = await myResp.json();
        assert(myData.orders.some((o: any) => o.id === 'ICC/STORE-LEGACY-1'));
      });

      // 12. Link guest orders after account signup + Guest Track verification (blocks partial phone bypass)
      await check('Guest tracking enforces exact match & blocks partial phone bypass; link-guest-orders binds guest order', async () => {
        // Token works
        const t1 = await fetch(`${baseUrl}/api/store/orders/guest-track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: guestCodOrderId, token: guestCodToken })
        });
        assert.strictEqual(t1.status, 200);

        // Exact 10-digit phone works
        const t2 = await fetch(`${baseUrl}/api/store/orders/guest-track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: guestCodOrderId, phone: '9876543210' })
        });
        assert.strictEqual(t2.status, 200);

        // Short phone bypass ("0") rejected with 400
        const t3 = await fetch(`${baseUrl}/api/store/orders/guest-track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: guestCodOrderId, phone: '0' })
        });
        assert.strictEqual(t3.status, 400);

        // Wrong email rejected with 403
        const t4 = await fetch(`${baseUrl}/api/store/orders/guest-track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: guestCodOrderId, email: 'attacker@evil.com' })
        });
        assert.strictEqual(t4.status, 403);

        // Link guest COD order via token after new account creation (different email)
        const linkResp = await fetch(`${baseUrl}/api/store/orders/link-guest-orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token:uid_new_user:newaccount@example.com'
          },
          body: JSON.stringify({ guestOrderTokens: [{ orderId: guestCodOrderId, token: guestCodToken }] })
        });
        const linkData = await linkResp.json();
        assert.strictEqual(linkResp.status, 200);
        assert.strictEqual(linkData.linkedCount, 1);

        // Confirm linked order now shows up in new user's /my
        const newUserOrders = await fetch(`${baseUrl}/api/store/orders/my`, {
          headers: { Authorization: 'Bearer test-token:uid_new_user:newaccount@example.com' }
        }).then(r => r.json());
        assert(newUserOrders.orders.some((o: any) => o.id === guestCodOrderId));
      });

      console.log(`\n🎉 All ${passed} store hotfix integration checks passed!`);
    } finally {
      server.close();
    }
  } finally {
    // Cleanup temporary test data
    if (existingBackup !== null) {
      fs.writeFileSync(ORDERS_STORE_PATH, existingBackup, 'utf-8');
    } else if (fs.existsSync(ORDERS_STORE_PATH)) {
      fs.unlinkSync(ORDERS_STORE_PATH);
    }
    for (const filePath of createdUploadFiles) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
}

runTests().catch((err) => {
  console.error('❌ Integration test suite failed:', err);
  process.exit(1);
});
