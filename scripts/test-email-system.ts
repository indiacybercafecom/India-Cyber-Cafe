import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';

// Isolate completely in local test mode BEFORE importing server modules
process.env.STORE_ORDER_TEST_MODE = '1';
process.env.OPERATOR_TEST_MODE = '1';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test_rzp_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const OPERATOR_STORE_PATH = path.resolve('data/operator_test_store.json');
const ORDERS_STORE_PATH = path.resolve('data/orders_store.json');
const LEDGER_PATH = path.resolve('data/notification_events.json');

interface CapturedMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

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
    backupFile(ORDERS_STORE_PATH),
    backupFile(LEDGER_PATH),
  ];

  let server: any = null;

  try {
    const emailSvc = await import('../src/server/emailNotificationService.js');
    const opSvc = await import('../src/server/operatorService.js');
    const storeSvc = await import('../src/server/storeOrderService.js');
    const clientEmailSvc = await import('../src/services/emailService.js');

    const sentMails: CapturedMail[] = [];
    let transportBehavior: 'ok' | 'flaky2' | 'failAll' = 'ok';
    let attemptCounter = 0;

    emailSvc.setEmailTransportForTesting({
      sendMail: async (mail) => {
        attemptCounter += 1;
        if (transportBehavior === 'failAll') {
          const err: any = new Error('550 5.1.1 Mailbox unavailable');
          err.responseCode = 550;
          throw err;
        }
        if (transportBehavior === 'flaky2' && attemptCounter <= 2) {
          const err: any = new Error('421 Temporary SMTP failure');
          err.responseCode = 421;
          throw err;
        }
        sentMails.push({ ...mail });
        return { messageId: `<mock-${Date.now()}-${attemptCounter}@indiacybercafe.com>` };
      },
    });
    emailSvc.resetNotificationStateForTesting();

    // Seed isolated test store users & applications
    const adminUid = 'admin_uid_1';
    const opAUid = 'op_uid_a';
    const opBUid = 'op_uid_b';
    const custUid = 'cust_uid_1';

    const seedStore = {
      users: {
        [adminUid]: { uid: adminUid, name: 'Admin One', email: 'admin1@indiacybercafe.com', role: 'admin' },
        [opAUid]: { uid: opAUid, name: 'Ramesh Operator', email: 'ramesh.op@example.com', role: 'operator' },
        [opBUid]: { uid: opBUid, name: 'Suresh Operator', email: 'suresh.op@example.com', role: 'operator' },
        [custUid]: { uid: custUid, name: 'Priya Verma', email: 'priya.verma@example.com', phone: '9876543210', role: 'user' },
      },
      applications: {
        'ICC-APP-1001': {
          id: 'ICC-APP-1001',
          uid: custUid,
          name: 'Priya Verma',
          email: 'priya.verma@example.com',
          serviceId: 'pan-card',
          serviceName: 'PAN Card Correction',
          status: 'processing',
          paymentStatus: 'pending',
          charge: 250,
          assignedTo: 'ramesh.op@example.com',
          assignedToUid: opAUid,
          notes: {},
          date: new Date().toISOString(),
        },
        'ICC-APP-1002': {
          id: 'ICC-APP-1002',
          uid: custUid,
          name: 'Priya Verma',
          email: 'priya.verma@example.com',
          serviceId: 'income-cert',
          serviceName: 'Income Certificate',
          status: 'processing',
          paymentStatus: 'pending',
          paymentMethod: 'pay_after_work',
          charge: 180,
          notes: {},
          date: new Date().toISOString(),
        },
        'ICC-APP-BADMAIL': {
          id: 'ICC-APP-BADMAIL',
          uid: 'cust_bad',
          name: 'Missing Mail User',
          email: 'invalid-email-address',
          serviceId: 'pan-card',
          serviceName: 'PAN Card New',
          status: 'processing',
          paymentStatus: 'pending',
          charge: 150,
          notes: {},
          date: new Date().toISOString(),
        },
      },
      payments: {},
    };
    fs.mkdirSync(path.dirname(OPERATOR_STORE_PATH), { recursive: true });
    fs.writeFileSync(OPERATOR_STORE_PATH, JSON.stringify(seedStore, null, 2), 'utf-8');

    const adminToken = `Bearer test-token:${adminUid}:admin1@indiacybercafe.com`;
    const opAToken = `Bearer test-token:${opAUid}:ramesh.op@example.com`;
    const opBToken = `Bearer test-token:${opBUid}:suresh.op@example.com`;
    const custToken = `Bearer test-token:${custUid}:priya.verma@example.com`;

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

    app.post('/api/send-email', (_req, res) => {
      return res.status(403).json({
        success: false,
        code: 'ARBITRARY_EMAIL_DISABLED',
        error: 'Arbitrary HTML or third-party email dispatch is disabled.',
      });
    });

    app.post('/api/operator/applications/:appId/upload-attachment', upload.single('file'), opSvc.handleOperatorUploadAttachment);
    app.post('/api/operator/applications/:appId/update', opSvc.handleOperatorUpdateApplication);
    app.post('/api/applications/:appId/verify-payment', opSvc.handleVerifyApplicationPayment);
    app.post('/api/applications/:appId/assign', opSvc.handleAssignApplicationOperator);
    app.post('/api/applications/:appId/payment-status', opSvc.handleAdminUpdateApplicationPaymentStatus);
    app.post('/api/notifications/application-submitted', opSvc.handleNotifyApplicationSubmitted);
    app.post('/api/notifications/registration', opSvc.handleNotifyRegistration);
    app.post('/api/notifications/profile-updated', opSvc.handleNotifyProfileUpdated);
    app.post('/api/notifications/review-submitted', opSvc.handleNotifyReviewSubmitted);
    app.post('/api/notifications/callback', opSvc.handleNotifyCallback);
    app.get('/api/admin/notifications', opSvc.handleListNotificationEvents);
    app.post('/api/admin/notifications/:eventId/retry', opSvc.handleRetryNotificationEvent);

    app.post('/api/store/orders/cod', storeSvc.handleCodOrder);
    app.post('/api/store/orders/create-payment', storeSvc.handleCreatePaymentOrder);
    app.post('/api/store/orders/verify-payment', storeSvc.handleVerifyPayment);
    app.post('/api/admin/orders/:orderId/status', storeSvc.handleAdminUpdateOrderStatus);
    app.post('/api/admin/orders/:orderId/refund', storeSvc.handleAdminOrderRefund);

    server = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    let passed = 0;
    const check = async (name: string, fn: () => Promise<void> | void) => {
      await fn();
      passed++;
      console.log(`✅ [PASS] ${name}`);
    };

    const clearMails = () => { sentMails.length = 0; };

    // 1. Confirmed bug fix: Operator status update sends separate templates to Customer & Admins
    await check('1. Operator status update sends Customer template to customer and Admin alert ("Hello Admin Team") to admins — never customer HTML to admin', async () => {
      clearMails();
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], { type: 'application/pdf' }), 'sample-guide.pdf');
      const uploadResp = await fetch(`${baseUrl}/api/operator/applications/ICC-APP-1001/upload-attachment`, {
        method: 'POST',
        headers: { Authorization: opAToken },
        body: form,
      });
      const uploadData = await uploadResp.json();
      assert.strictEqual(uploadResp.status, 200);
      assert(uploadData.attachmentUrl);

      const resp = await fetch(`${baseUrl}/api/operator/applications/ICC-APP-1001/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: opAToken },
        body: JSON.stringify({
          status: 'clarification',
          note: 'Please re-upload Aadhaar front side clearly.',
          attachmentUrl: uploadData.attachmentUrl,
          attachmentName: uploadData.attachmentName,
        }),
      });
      const data = await resp.json();
      assert.strictEqual(resp.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.emailDelivery.failedCount, 0);

      const custMails = sentMails.filter(m => m.to === 'priya.verma@example.com');
      const adminMails = sentMails.filter(m => m.to === 'icc@indiacybercafe.com' || m.to === 'indiacybercafe.com@gmail.com');
      const opMails = sentMails.filter(m => m.to === 'ramesh.op@example.com');

      assert.strictEqual(custMails.length, 1, 'Customer should receive exactly 1 email');
      assert.strictEqual(adminMails.length, 2, 'Both admins should receive an alert email');
      assert.strictEqual(opMails.length, 0, 'Performing operator should not be emailed their own update');

      assert(custMails[0].html.includes('Hello <strong>Priya Verma</strong>'), 'Customer email must greet customer');
      assert(custMails[0].html.includes('CLARIFICATION'), 'Customer email must show new status');
      assert(custMails[0].html.includes('Please re-upload Aadhaar front side clearly.'), 'Customer email must include processing note');
      assert(custMails[0].html.includes('sample-guide.pdf'), 'Customer email must include attachment filename');

      for (const am of adminMails) {
        assert(!am.html.includes('Hello <strong>Priya Verma</strong>'), 'CRITICAL: Admin email must NEVER contain "Hello Priya Verma"');
        assert(am.html.includes('Hello <strong>Admin Team</strong>'), 'Admin email must greet Admin Team');
        assert(am.html.includes('priya.verma@example.com'), 'Admin alert must include customer email');
        assert(am.html.includes('Ramesh Operator'), 'Admin alert must include operator performer name');
        assert(am.html.includes('b.indiacybercafe.com/admin'), 'Admin alert must link to admin dashboard');
      }
    });

    // 2. When Admin updates application status, Assigned Operator receives Operator template
    await check('2. Admin update on assigned application sends role-appropriate Operator notification to assigned operator', async () => {
      clearMails();
      const resp = await fetch(`${baseUrl}/api/operator/applications/ICC-APP-1001/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({
          status: 'completed',
          note: 'Final certificate approved.',
        }),
      });
      const data = await resp.json();
      assert.strictEqual(resp.status, 200);
      assert.strictEqual(data.success, true);

      const opMails = sentMails.filter(m => m.to === 'ramesh.op@example.com');
      assert.strictEqual(opMails.length, 1, 'Assigned operator should receive update notification when admin acts');
      assert(opMails[0].html.includes('Hello <strong>Ramesh Operator</strong>'), 'Operator email must greet assigned operator');
      assert(!opMails[0].html.includes('Hello <strong>Priya Verma</strong>'), 'Operator email must not use customer greeting');
    });

    // 3. Operator reassignment excludes previous operator from future status updates
    await check('3. Operator reassignment notifies new operator & previous operator, and future updates exclude previous operator', async () => {
      clearMails();
      const assignResp = await fetch(`${baseUrl}/api/applications/ICC-APP-1001/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ operatorUid: opBUid, operatorEmail: 'suresh.op@example.com' }),
      });
      const assignData = await assignResp.json();
      assert.strictEqual(assignResp.status, 200);
      assert.strictEqual(assignData.success, true);

      const opBMails = sentMails.filter(m => m.to === 'suresh.op@example.com');
      const opAMails = sentMails.filter(m => m.to === 'ramesh.op@example.com');
      const custMails = sentMails.filter(m => m.to === 'priya.verma@example.com');
      const adminMails = sentMails.filter(m => m.to === 'icc@indiacybercafe.com' || m.to === 'indiacybercafe.com@gmail.com');

      assert.strictEqual(opBMails.length, 1);
      assert(opBMails[0].html.includes('Hello <strong>Suresh Operator</strong>'));
      assert.strictEqual(opAMails.length, 1);
      assert(opAMails[0].html.includes('Hello <strong>Ramesh Operator</strong>'));
      assert.strictEqual(custMails.length, 1);
      assert(custMails[0].html.includes('Hello <strong>Priya Verma</strong>'));
      assert.strictEqual(adminMails.length, 2);
      for (const am of adminMails) {
        assert(am.html.includes('Hello <strong>Admin Team</strong>'), 'Admin assignment email must greet Admin Team, not operatorNewAssignment');
      }

      // Now Admin updates again — old operator Ramesh must NOT receive any email
      clearMails();
      const updateAfterReassign = await fetch(`${baseUrl}/api/operator/applications/ICC-APP-1001/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ note: 'Follow-up after reassignment' }),
      });
      assert.strictEqual(updateAfterReassign.status, 200);
      assert.strictEqual(sentMails.filter(m => m.to === 'ramesh.op@example.com').length, 0, 'Previous operator must receive ZERO future updates');
      assert.strictEqual(sentMails.filter(m => m.to === 'suresh.op@example.com').length, 1, 'Current operator receives update');
    });

    // 4. Application submission + Admin payment status toggle + customer post-work verify-payment
    await check('4. Application submission, admin payment toggle & post-work Razorpay verify-payment dispatch Customer + Admin confirmation emails', async () => {
      clearMails();
      const subResp = await fetch(`${baseUrl}/api/notifications/application-submitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({ appId: 'ICC-APP-1001' }),
      });
      assert.strictEqual(subResp.status, 200);
      assert.strictEqual(sentMails.filter(m => m.to === 'priya.verma@example.com').length, 1);
      assert.strictEqual(sentMails.filter(m => m.to === 'icc@indiacybercafe.com').length, 1);

      clearMails();
      const verifyPayResp = await fetch(`${baseUrl}/api/applications/ICC-APP-1001/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({
          razorpay_payment_id: 'pay_app_test_1',
          razorpay_order_id: 'order_app_test_1',
          razorpay_signature: 'test_valid_sig',
        }),
      });
      const verifyPayData = await verifyPayResp.json();
      assert.strictEqual(verifyPayResp.status, 200);
      assert.strictEqual(verifyPayData.paymentStatus, 'completed');
      assert.strictEqual(sentMails.filter(m => m.to === 'priya.verma@example.com').length, 1);
      assert.strictEqual(sentMails.filter(m => m.to === 'icc@indiacybercafe.com').length, 1);

      // Admin toggle pay-after-work application payment status pending -> completed
      clearMails();
      const adminPayResp = await fetch(`${baseUrl}/api/applications/ICC-APP-1002/payment-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ paymentStatus: 'completed' }),
      });
      assert.strictEqual(adminPayResp.status, 200);
      assert.strictEqual(sentMails.filter(m => m.to === 'priya.verma@example.com').length, 1);
      assert.strictEqual(sentMails.filter(m => m.to === 'icc@indiacybercafe.com').length, 1);
    });

    // 5. Direct /pay link server dispatcher
    await check('5. Direct /pay payment notification dispatches adminPaymentReceived to admins', async () => {
      clearMails();
      const report = await emailSvc.notifyDirectPayLinkPayment({
        receiptId: 'PAY-LINK-9001',
        amount: 499,
        razorpayPaymentId: 'pay_link_123',
        razorpayOrderId: 'order_link_123',
        reference: 'Pan Rush Fee',
      });
      assert.strictEqual(report.failedCount, 0);
      const adminMails = sentMails.filter(m => m.to === 'icc@indiacybercafe.com' || m.to === 'indiacybercafe.com@gmail.com');
      assert.strictEqual(adminMails.length, 2);
      assert(adminMails[0].html.includes('Hello <strong>Admin Team</strong>'));
      assert(adminMails[0].html.includes('pay_link_123'));
    });

    // 6 & 7 & 8. Store COD checkout, Online checkout, Status update, Cancellation ("adminOrderCancelled", NOT "New Store Order Received"), & Refund
    const BOTH_PRODUCT_ID = 'diseases-treatment-complete-medical-reference-pdf-125-diseases';
    const validAddress = {
      name: 'Priya Verma',
      email: 'priya.verma@example.com',
      phone: '9876543210',
      addressLine1: '42 Civil Lines',
      city: 'Singrauli',
      state: 'Madhya Pradesh',
      pincode: '486886',
      country: 'India',
    };
    let codOrderId = '';
    let onlineOrderId = '';

    await check('6. Store COD & Online checkout send role-separated Customer & Admin confirmation emails', async () => {
      clearMails();
      const codResp = await fetch(`${baseUrl}/api/store/orders/cod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ productId: BOTH_PRODUCT_ID, quantity: 1 }],
          deliveryAddress: validAddress,
          idempotencyKey: 'email-test-cod-1',
        }),
      });
      const codData = await codResp.json();
      assert.strictEqual(codResp.status, 201);
      codOrderId = codData.orderId;
      assert.strictEqual(codData.emailDelivery.failedCount, 0);
      assert.strictEqual(sentMails.filter(m => m.to === 'priya.verma@example.com').length, 1);
      assert.strictEqual(sentMails.filter(m => m.to === 'icc@indiacybercafe.com').length, 1);

      clearMails();
      const createResp = await fetch(`${baseUrl}/api/store/orders/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({
          items: [{ productId: BOTH_PRODUCT_ID, quantity: 1 }],
          deliveryAddress: validAddress,
        }),
      });
      const createData = await createResp.json();
      assert.strictEqual(createResp.status, 201);
      onlineOrderId = createData.orderId;
      const rzpSig = crypto
        .createHmac('sha256', 'test_rzp_secret')
        .update(`${createData.razorpayOrderId}|pay_store_999`)
        .digest('hex');
      const verifyResp = await fetch(`${baseUrl}/api/store/orders/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: onlineOrderId,
          razorpay_order_id: createData.razorpayOrderId,
          razorpay_payment_id: 'pay_store_999',
          razorpay_signature: rzpSig,
        }),
      });
      const verifyData = await verifyResp.json();
      assert.strictEqual(verifyResp.status, 200);
      assert.strictEqual(verifyData.verified, true);
      assert.strictEqual(sentMails.filter(m => m.to === 'priya.verma@example.com').length, 1);
      assert.strictEqual(sentMails.filter(m => m.to === 'icc@indiacybercafe.com').length, 1);
    });

    await check('7. Admin order status update (shipped) & cancellation use dedicated cancellation alert (NEVER "New Store Order Received")', async () => {
      clearMails();
      const shipResp = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(codOrderId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ orderStatus: 'shipped', estimatedDelivery: '20 Nov 2026' }),
      });
      assert.strictEqual(shipResp.status, 200);
      assert.strictEqual(sentMails.filter(m => m.to === 'priya.verma@example.com').length, 1);
      assert(sentMails[0].subject.includes('SHIPPED'));

      clearMails();
      const cancelResp = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(codOrderId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ orderStatus: 'cancelled', reason: 'Customer requested cancellation' }),
      });
      const cancelData = await cancelResp.json();
      assert.strictEqual(cancelResp.status, 200);
      assert.strictEqual(cancelData.order.orderStatus, 'cancelled');

      const custCancel = sentMails.filter(m => m.to === 'priya.verma@example.com');
      const adminCancel = sentMails.filter(m => m.to === 'icc@indiacybercafe.com' || m.to === 'indiacybercafe.com@gmail.com');
      assert.strictEqual(custCancel.length, 1);
      assert.strictEqual(adminCancel.length, 2);
      for (const am of adminCancel) {
        assert(!am.subject.includes('New Store Order Received'), 'CRITICAL BUG REGRESSION: Cancelled order must NEVER send "New Store Order Received"');
        assert(am.subject.includes('Order Cancelled'), 'Admin subject must clearly say Order Cancelled');
        assert(am.html.includes('Hello <strong>Admin Team</strong>'));
      }
    });

    await check('8. Admin order refund initiates refund record & sends Customer + Admin refund emails', async () => {
      clearMails();
      const refundResp = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(onlineOrderId)}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ refundAmount: 49, expectedDays: 5, reason: 'Duplicate purchase' }),
      });
      const refundData = await refundResp.json();
      assert.strictEqual(refundResp.status, 200);
      assert.strictEqual(refundData.order.paymentStatus, 'refunded');
      assert.strictEqual(sentMails.filter(m => m.to === 'priya.verma@example.com').length, 1);
      assert.strictEqual(sentMails.filter(m => m.to === 'icc@indiacybercafe.com').length, 1);
    });

    // 9. Registration, Profile Update, Review, Callback, Privacy + Zero Plaintext Password
    await check('9. Registration, Profile, Review & Callback endpoints send role-separated emails with zero plaintext passwords', async () => {
      clearMails();
      const regResp = await fetch(`${baseUrl}/api/notifications/registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({ isGuestCheckout: true }),
      });
      assert.strictEqual(regResp.status, 200);

      const profResp = await fetch(`${baseUrl}/api/notifications/profile-updated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({ updateType: 'Name, Phone & Address' }),
      });
      assert.strictEqual(profResp.status, 200);

      const revResp = await fetch(`${baseUrl}/api/notifications/review-submitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({
          productId: BOTH_PRODUCT_ID,
          productName: '125 Diseases Guide PDF',
          rating: 5,
          reviewText: 'Very useful reference book!',
        }),
      });
      assert.strictEqual(revResp.status, 200);

      const cbResp = await fetch(`${baseUrl}/api/notifications/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber: '9876543210' }),
      });
      assert.strictEqual(cbResp.status, 200);

      // Verify zero plaintext password strings anywhere in generated HTML or client fallback templates
      for (const m of sentMails) {
        assert(!m.html.includes('YOUR PASSWORD'), 'Must never include plaintext password block');
        assert(!m.html.includes('TempSecretPass'), 'Must never expose password');
      }
      const pwdHtml = clientEmailSvc.emailTemplates.userPasswordDelivery('Priya', 'TempSecretPass123!');
      const guestHtml = clientEmailSvc.emailTemplates.guestAccountWelcome('Priya', 'priya@example.com', 'TempSecretPass123!');
      assert(!pwdHtml.includes('TempSecretPass123!'), 'userPasswordDelivery must strip password');
      assert(!guestHtml.includes('TempSecretPass123!'), 'guestAccountWelcome must strip password');
    });

    // 10. HTML Escaping & XSS prevention
    await check('10. Dynamic HTML fields are safely escaped / stripped against XSS injection', async () => {
      clearMails();
      await fetch(`${baseUrl}/api/notifications/review-submitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({
          productId: BOTH_PRODUCT_ID,
          productName: '<script>alert("xss")</script>Guide',
          rating: 4,
          reviewText: 'Nice <img src=x onerror=alert(1)> guide!',
        }),
      });
      const adminRev = sentMails.find(m => m.to === 'icc@indiacybercafe.com');
      assert(adminRev, 'Admin review email must be present');
      assert(!adminRev!.html.includes('<script>'), 'Raw <script> tag must never appear in sent email');
      assert(!adminRev!.html.includes('<img src=x onerror='), 'Injected img tag must never appear in sent email');

      const directEscapedHtml = emailSvc.serverEmailTemplates.adminReviewReceived({
        productName: '<script>alert("xss")</script>Guide',
        customerName: '<b>Bad</b> User',
        customerEmail: 'user@example.com',
        rating: 5,
        reviewText: '<img src=x onerror="alert(1)">',
        timestamp: '2026-11-14',
      });
      assert(!directEscapedHtml.includes('<script>alert'), 'Direct template must escape <script>');
      assert(directEscapedHtml.includes('&lt;script&gt;alert'), 'Direct template must contain HTML-escaped &lt;script&gt;');
      assert(directEscapedHtml.includes('&lt;b&gt;Bad&lt;/b&gt;'), 'Direct template must HTML-escape bold tags');
      assert(!directEscapedHtml.includes('<img src=x'), 'Direct template must escape injected <img> tags');
    });

    // 11. Email layout CSS checks (no #xffe6e6 typo, no display: grid footer)
    await check('11. Email templates contain no #xffe6e6 color typo and no display:grid footer', () => {
      const clientSrc = fs.readFileSync(path.resolve('src/services/emailService.ts'), 'utf-8');
      const serverSrc = fs.readFileSync(path.resolve('src/server/emailNotificationService.ts'), 'utf-8');
      assert(!clientSrc.includes('#xffe6e6'), 'Client emailService must fix #xffe6e6');
      assert(!clientSrc.includes('display: grid'), 'Client emailService must use Gmail-safe table footer');
      assert(!serverSrc.includes('#xffe6e6'), 'Server emailNotificationService must not have #xffe6e6');
      assert(!serverSrc.includes('grid-template-columns'), 'Server emailNotificationService footer must not rely on CSS Grid');
    });

    // 12. Missing/invalid customer email handling
    await check('12. Invalid customer email records explicit customer failure while Admin alerts still deliver', async () => {
      clearMails();
      const resp = await fetch(`${baseUrl}/api/operator/applications/ICC-APP-BADMAIL/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ status: 'completed' }),
      });
      const data = await resp.json();
      assert.strictEqual(resp.status, 200);
      assert.strictEqual(data.emailDelivery.hasFailures, true);
      assert(data.emailDelivery.failedCount >= 1);
      assert(data.emailDelivery.sentCount >= 2, 'Admin notifications still succeed');
      const failedCust = data.emailDelivery.events.find((e: any) => e.recipientRole === 'customer');
      assert.strictEqual(failedCust.state, 'failed');
    });

    // 13. Transient SMTP retry (flaky2 -> succeeds on 3rd attempt) + permanent fail + Admin retry without DB mutation
    await check('13. Bounded SMTP retry recovers transient failures; Admin retry replays failed email without mutating DB', async () => {
      clearMails();
      transportBehavior = 'flaky2';
      attemptCounter = 0;
      const transientResp = await fetch(`${baseUrl}/api/notifications/profile-updated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: custToken },
        body: JSON.stringify({ updateType: 'Phone Number' }),
      });
      const transientData = await transientResp.json();
      assert.strictEqual(transientResp.status, 200);
      assert.strictEqual(transientData.emailDelivery.failedCount, 0);
      assert.strictEqual(transientData.emailDelivery.events[0].wasRetried, true);
      assert.strictEqual(transientData.emailDelivery.events[0].attempts, 3);

      // Permanent failure, then Admin retry
      clearMails();
      transportBehavior = 'failAll';
      attemptCounter = 0;
      const failResp = await fetch(`${baseUrl}/api/operator/applications/ICC-APP-1001/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ note: 'Note sent during SMTP outage' }),
      });
      const failData = await failResp.json();
      assert.strictEqual(failResp.status, 200);
      assert.strictEqual(failData.emailDelivery.hasFailures, true);
      const failedEventId = failData.emailDelivery.events[0].eventId;
      const storeBeforeRetry = fs.readFileSync(OPERATOR_STORE_PATH, 'utf-8');

      // Verify Admin can list failed events
      const listResp = await fetch(`${baseUrl}/api/admin/notifications?state=failed`, {
        headers: { Authorization: adminToken },
      });
      const listData = await listResp.json();
      assert.strictEqual(listResp.status, 200);
      assert(listData.events.some((e: any) => e.eventId === failedEventId));

      // Switch transport back to healthy & retry via Admin endpoint
      transportBehavior = 'ok';
      clearMails();
      const retryResp = await fetch(`${baseUrl}/api/admin/notifications/${encodeURIComponent(failedEventId)}/retry`, {
        method: 'POST',
        headers: { Authorization: adminToken },
      });
      const retryData = await retryResp.json();
      assert.strictEqual(retryResp.status, 200);
      assert.strictEqual(retryData.event.smtpAccepted, true);
      assert.strictEqual(sentMails.length, 1);
      const storeAfterRetry = fs.readFileSync(OPERATOR_STORE_PATH, 'utf-8');
      assert.strictEqual(storeAfterRetry, storeBeforeRetry, 'Retrying notification must NOT mutate application DB record');
    });

    // 14. Idempotency deduplication
    await check('14. Notification idempotency skips duplicate re-dispatch for identical idempotencyKey', async () => {
      clearMails();
      const appObj = JSON.parse(fs.readFileSync(OPERATOR_STORE_PATH, 'utf-8')).applications['ICC-APP-1001'];
      const r1 = await emailSvc.notifyApplicationUpdate({
        appId: 'ICC-APP-1001',
        app: appObj,
        previousStatus: 'clarification',
        newStatus: 'processing',
        performedBy: { uid: adminUid, name: 'Admin One', email: 'admin1@indiacybercafe.com', role: 'admin' },
        idempotencyKey: 'dedup-test-key-42',
      });
      assert(r1.sentCount > 0);
      const countAfterFirst = sentMails.length;

      const r2 = await emailSvc.notifyApplicationUpdate({
        appId: 'ICC-APP-1001',
        app: appObj,
        previousStatus: 'clarification',
        newStatus: 'processing',
        performedBy: { uid: adminUid, name: 'Admin One', email: 'admin1@indiacybercafe.com', role: 'admin' },
        idempotencyKey: 'dedup-test-key-42',
      });
      assert.strictEqual(sentMails.length, countAfterFirst, 'Duplicate idempotencyKey must not re-send SMTP emails');
      assert(r2.skippedDuplicateCount > 0);
    });

    // 15. Security boundary checks: /api/send-email -> 403 & RBAC checks
    await check('15. Arbitrary /api/send-email returns 403 and non-admin callers are blocked from privileged endpoints', async () => {
      clearMails();
      const rawRes = await fetch(`${baseUrl}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ to: 'victim@example.com', subject: 'Phish', html: '<p>bad</p>' }),
      });
      assert.strictEqual(rawRes.status, 403);
      assert.strictEqual(sentMails.length, 0);

      const rbacChecks = [
        fetch(`${baseUrl}/api/applications/ICC-APP-1001/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: opAToken },
          body: JSON.stringify({ operatorUid: opBUid, operatorEmail: 'suresh.op@example.com' }),
        }),
        fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(codOrderId)}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: custToken },
          body: JSON.stringify({ orderStatus: 'delivered' }),
        }),
        fetch(`${baseUrl}/api/admin/notifications`, {
          headers: { Authorization: custToken },
        }),
      ];
      const responses = await Promise.all(rbacChecks);
      for (const r of responses) {
        assert.strictEqual(r.status, 403, `Expected 403 RBAC rejection, got ${r.status}`);
      }
    });

    // 16. COD Checkout never fails if SMTP fails completely
    await check('16. Store COD order succeeds (201) and reports emailDelivery failure gracefully when SMTP is down', async () => {
      transportBehavior = 'failAll';
      const codResp = await fetch(`${baseUrl}/api/store/orders/cod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ productId: BOTH_PRODUCT_ID, quantity: 1 }],
          deliveryAddress: validAddress,
          idempotencyKey: 'email-test-cod-smtp-down',
        }),
      });
      const codData = await codResp.json();
      assert.strictEqual(codResp.status, 201);
      assert.strictEqual(codData.success, true);
      assert.strictEqual(codData.emailDelivery.hasFailures, true);
      transportBehavior = 'ok';
    });

    console.log(`\n🎉 All ${passed} email system audit, routing, template, reliability & security tests passed!`);
  } finally {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    try {
      fs.rmSync(path.resolve('data/uploads/attachments/ICC-APP-1001'), { recursive: true, force: true });
    } catch {}
    for (const b of backups) {
      restoreFile(b);
    }
  }
}

runTests().catch((err) => {
  console.error('❌ Email system test suite failed:', err);
  process.exit(1);
});
