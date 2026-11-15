import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const require = createRequire(import.meta.url);

function loadPlaywright(): any {
  const candidates = [
    'playwright',
    '/usr/local/share/bun-global/node_modules/playwright',
    '/usr/local/share/bun-global/node_modules/playwright-core',
  ];
  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      // try next
    }
  }
  throw new Error('Playwright module not found');
}

function findChromiumExecutable(): string | undefined {
  const roots = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/root/.cache/ms-playwright',
  ].filter(Boolean) as string[];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    if (fs.statSync(root).isFile()) return root;

    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (
          entry.isFile() &&
          (entry.name === 'chrome' || entry.name === 'headless_shell' || entry.name === 'chromium')
        ) {
          return full;
        }
      }
    }
  }
  return undefined;
}

async function runTests() {
  let passed = 0;
  const check = async (name: string, fn: () => Promise<void> | void) => {
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  };

  console.log(`\n🚀 Running Guest Apply Form, Auth Security, SEO & E2E Tests against ${BASE_URL}\n`);

  // --- PART 1: API Authentication Security & Public Endpoint Parity ---
  await check('POST /api/create-razorpay-order rejects unauthenticated caller (401)', async () => {
    const res = await fetch(`${BASE_URL}/api/create-razorpay-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 5000, currency: 'INR', receipt: 'ICC-TEST-001' }),
    });
    assert.strictEqual(res.status, 401);
  });

  await check('POST /api/verify-razorpay-payment rejects unauthenticated caller (401)', async () => {
    const res = await fetch(`${BASE_URL}/api/verify-razorpay-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: 'order_123',
        razorpay_payment_id: 'pay_123',
        razorpay_signature: 'sig_123',
      }),
    });
    assert.strictEqual(res.status, 401);
  });

  await check('Public /api/pay-link/create-order & /api/store/orders/guest-track stay accessible to guests', async () => {
    const payRes = await fetch(`${BASE_URL}/api/pay-link/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: -1 }),
    });
    assert.notStrictEqual(payRes.status, 401, 'pay-link must stay accessible to guests');

    const trackRes = await fetch(`${BASE_URL}/api/store/orders/guest-track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: '', email: '' }),
    });
    assert.notStrictEqual(trackRes.status, 401, 'guest-track must stay accessible to guests');
  });

  await check('Authenticated Razorpay verify-payment endpoint enforces auth & HMAC in operator/test mode', async () => {
    const prevMode = process.env.OPERATOR_TEST_MODE;
    const prevSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.OPERATOR_TEST_MODE = '1';
    process.env.RAZORPAY_KEY_SECRET = 'test_rzp_secret_apply';

    try {
      const express = (await import('express')).default;
      const { requireAuthenticatedCaller } = await import('../src/server/operatorService.js');

      const app = express();
      app.use(express.json());
      app.post('/api/verify-razorpay-payment', async (req, res) => {
        const caller = await requireAuthenticatedCaller(req, res);
        if (!caller) return;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const expected = crypto
          .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
          .update(`${razorpay_order_id}|${razorpay_payment_id}`)
          .digest('hex');
        if (expected === razorpay_signature) {
          return res.json({ verified: true });
        }
        return res.status(400).json({ verified: false });
      });

      const srv = await new Promise<any>(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const testUrl = `http://127.0.0.1:${srv.address().port}`;

      try {
        const orderId = 'order_guest_apply_test';
        const paymentId = 'pay_guest_apply_test';
        const validSig = crypto
          .createHmac('sha256', 'test_rzp_secret_apply')
          .update(`${orderId}|${paymentId}`)
          .digest('hex');

        const unauthRes = await fetch(`${testUrl}/api/verify-razorpay-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: validSig }),
        });
        assert.strictEqual(unauthRes.status, 401);

        const token = 'test-token:cust_1:cust@example.com';
        const authRes = await fetch(`${testUrl}/api/verify-razorpay-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: validSig }),
        });
        assert.strictEqual(authRes.status, 200);
        const body = await authRes.json();
        assert.strictEqual(body.verified, true);
      } finally {
        srv.close();
      }
    } finally {
      if (prevMode === undefined) delete process.env.OPERATOR_TEST_MODE;
      else process.env.OPERATOR_TEST_MODE = prevMode;
      if (prevSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = prevSecret;
    }
  });

  // --- PART 2: SEO / Googlebot SSR & Sitemap / Robots ---
  const serviceRoutes = [
    '/services/pan-card/apply-new-pan-card',
    '/services/aadhaar-ucl-opretor/opretor-id',
    '/services/passport-seva/apply-new-passport',
    '/services/driving-license/apply-for-learning-licence',
  ];

  await check('Googlebot SSR for sub-service form pages renders canonical link, index robots, H1, JSON-LD Service/Offer & direct form CTA', async () => {
    for (const route of serviceRoutes) {
      const res = await fetch(`${BASE_URL}${route}`, {
        headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
      });
      assert.strictEqual(res.status, 200, `${route} SSR status`);
      const html = await res.text();
      assert(html.includes('<h1'), `${route} missing <h1>`);
      assert(html.includes('₹'), `${route} missing service charge`);
      assert(new RegExp(`<link\\s+rel="canonical"\\s+href="https?://[^"]+${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html), `${route} missing canonical href`);
      assert(!html.includes('noindex'), `${route} must not contain noindex`);
      assert(html.includes('"@type":"Service"') || html.includes('"@type": "Service"'), `${route} missing Service JSON-LD`);
      assert(!html.includes('/login?redirect='), `${route} crawler CTA must not point to /login?redirect=`);
      assert(html.includes(`href="${route}"`) || html.includes(`${route}"`), `${route} missing direct form CTA`);
    }
  });

  await check('/sitemap.xml lists service form URLs & /robots.txt allows /services/', async () => {
    const sitemapRes = await fetch(`${BASE_URL}/sitemap.xml`);
    assert.strictEqual(sitemapRes.status, 200);
    const xml = await sitemapRes.text();
    for (const route of serviceRoutes) {
      assert(xml.includes(`${route}</loc>`), `sitemap missing ${route}`);
    }

    const robotsRes = await fetch(`${BASE_URL}/robots.txt`);
    assert.strictEqual(robotsRes.status, 200);
    const robots = await robotsRes.text();
    assert(!/Disallow:\s*\/services/i.test(robots), 'robots.txt must not disallow /services');
  });

  // --- PART 3: Real Headless Chromium Playwright Browser E2E Verification ---
  const pw = loadPlaywright();
  const executablePath = findChromiumExecutable();
  const browser = await pw.chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await check('Browser Guest Form Flow: direct open, all field types, file upload, AuthModal in place, draft preservation & DOM SEO tags', async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const server5xx: string[] = [];

      let expectingInvalidLoginConsoleError = false;
      page.on('pageerror', (err: any) => pageErrors.push(err?.message || String(err)));
      page.on('console', (msg: any) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (text.includes('WebSocket')) return;
          if (
            expectingInvalidLoginConsoleError &&
            (text.includes('status of 400') || text.includes('auth/invalid-credential') || text.includes('Incorrect email or password'))
          ) {
            return;
          }
          consoleErrors.push(text);
        }
      });
      page.on('response', (res: any) => {
        if (res.status() >= 500) {
          server5xx.push(`${res.status()} ${res.url()}`);
        }
      });

      // 1) Open /services/aadhaar-ucl-opretor/opretor-id (has text, date, tel, email, textarea, file, multiselect)
      await page.goto(`${BASE_URL}/services/aadhaar-ucl-opretor/opretor-id`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="guest-login-banner"]', { timeout: 15000 });

      assert.strictEqual(new URL(page.url()).pathname, '/services/aadhaar-ucl-opretor/opretor-id', 'Guest must not be redirected away from form URL');

      // Check SEO tags in live rendered DOM
      const seoMeta = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        canonicals: Array.from(document.querySelectorAll('link[rel="canonical"]')).map(el => el.getAttribute('href') || ''),
        helmetCanonical: document.querySelector('link[rel="canonical"][data-rh="true"]')?.getAttribute('href') || '',
        h1: document.querySelector('h1')?.textContent?.trim() || '',
        ldJsonCount: document.querySelectorAll('script[type="application/ld+json"]').length,
      }));
      assert(seoMeta.title.includes('Opretor') && seoMeta.title.includes('India Cyber Cafe'), `Unexpected title: ${seoMeta.title}`);
      assert(seoMeta.description.length > 30, 'Missing description meta');
      assert.strictEqual(seoMeta.helmetCanonical, 'https://b.indiacybercafe.com/services/aadhaar-ucl-opretor/opretor-id');
      assert(seoMeta.canonicals.every(c => c.endsWith('/services/aadhaar-ucl-opretor/opretor-id')), `Unexpected canonicals: ${seoMeta.canonicals}`);
      assert(seoMeta.h1.length > 0, 'Missing rendered <h1>');
      assert(seoMeta.ldJsonCount >= 1, 'Missing JSON-LD script in DOM');

      // Check submit button locked/disabled
      const submitBtn = page.locator('[data-testid="apply-submit-btn"]');
      assert.strictEqual(await submitBtn.isDisabled(), true, 'Submit button must be disabled for guest');
      const submitText = (await submitBtn.innerText()).trim();
      assert(submitText.includes('Login Required'), `Expected lock text, got: ${submitText}`);

      // Fill all fields on the form
      await page.locator('input[placeholder*="full name" i]').fill('Aarav Mehta');
      await page.locator('input[placeholder*="father" i]').fill('Rajesh Mehta');
      await page.locator('input[type="date"]').fill('1996-05-14');
      await page.locator('input[type="tel"]').fill('9876543210');
      await page.locator('input[type="email"]').fill('aarav.mehta@example.com');
      await page.locator('textarea').fill('120 Nehru Nagar, Singrauli, MP 486886');
      await page.locator('input[placeholder*="aadhaar number" i]').fill('123456789012');
      await page.locator('input[placeholder*="pan number" i]').fill('ABCDE1234F');

      // Check multiselect checkbox
      const firstMultiselect = page.locator('div[role="group"] input[type="checkbox"]').first();
      await firstMultiselect.check();
      assert.strictEqual(await firstMultiselect.isChecked(), true);

      // Attach a test file to #file-7 (Aadhaar Card)
      await page.locator('#file-7').setInputFiles({
        name: 'aadhaar_front.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      });
      await page.waitForFunction(() => document.body.innerText.includes('aadhaar_front.png'));

      // Check declaration checkbox
      const declCheckbox = page.locator('input[type="checkbox"]').last();
      await declCheckbox.check();
      assert.strictEqual(await declCheckbox.isChecked(), true);

      // Store DOM element reference to confirm form never unmounts
      await page.evaluate(() => {
        (window as any).__nameInputRef = document.querySelector('input[placeholder*="full name" i]');
      });

      // Click guest banner Login button -> opens AuthModal in place without navigation
      await page.locator('[data-testid="guest-banner-login-btn"]').click();
      await page.waitForSelector('h2:has-text("Login")', { timeout: 5000 });
      assert.strictEqual(new URL(page.url()).pathname, '/services/aadhaar-ucl-opretor/opretor-id');

      // Switch to Create Account view inside modal & back to Login
      await page.locator('button:has-text("Create Account")').click();
      await page.waitForSelector('h2:has-text("Register")', { timeout: 5000 });
      await page.locator('button:has-text("Sign In Here")').click();
      await page.waitForSelector('h2:has-text("Login")', { timeout: 5000 });

      // Attempt invalid login -> error shown cleanly, modal stays, form untouched
      expectingInvalidLoginConsoleError = true;
      await page.locator('input[placeholder="Email or Mobile"]').fill('nonexistent.guest@example.com');
      await page.locator('input[placeholder="Password"]').fill('WrongPassword123!');
      await page.locator('form button[type="submit"]:not([data-testid="apply-submit-btn"])').click();
      await page.waitForTimeout(1200);
      expectingInvalidLoginConsoleError = false;

      // Close AuthModal
      await page.locator('button[aria-label="Close modal"]').click();
      await page.waitForTimeout(300);

      // Verify ALL entered data, checkbox state, uploaded filename, and DOM node identity are 100% preserved!
      assert.strictEqual(new URL(page.url()).pathname, '/services/aadhaar-ucl-opretor/opretor-id');
      assert.strictEqual(await page.locator('input[placeholder*="full name" i]').inputValue(), 'Aarav Mehta');
      assert.strictEqual(await page.locator('input[placeholder*="father" i]').inputValue(), 'Rajesh Mehta');
      assert.strictEqual(await page.locator('input[type="date"]').inputValue(), '1996-05-14');
      assert.strictEqual(await page.locator('input[type="tel"]').inputValue(), '9876543210');
      assert.strictEqual(await page.locator('input[type="email"]').inputValue(), 'aarav.mehta@example.com');
      assert.strictEqual(await page.locator('textarea').inputValue(), '120 Nehru Nagar, Singrauli, MP 486886');
      assert.strictEqual(await firstMultiselect.isChecked(), true);
      assert.strictEqual(await declCheckbox.isChecked(), true);
      const bodyTextAfter = await page.locator('body').innerText();
      assert(bodyTextAfter.includes('aadhaar_front.png'), 'Selected file label lost after AuthModal interaction');

      const sameNode = await page.evaluate(() => (window as any).__nameInputRef === document.querySelector('input[placeholder*="full name" i]'));
      assert.strictEqual(sameNode, true, 'Form unmounted or remounted during AuthModal flow!');

      // Also test Passport Seva page with SelectDropdown (select + phone + textarea)
      await page.goto(`${BASE_URL}/services/passport-seva/apply-new-passport`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="guest-login-banner"]', { timeout: 15000 });
      await page.locator('input[type="tel"]').fill('9988776655');
      // Open SelectDropdown for Passport Booklet & pick option
      await page.locator('button[aria-label="Passport Booklet"]').click();
      await page.locator('[role="option"]').nth(1).click();
      assert.strictEqual(await page.locator('input[type="tel"]').inputValue(), '9988776655');

      // Test top Navbar Login button opens modal in place on Apply route
      await page.locator('nav button:has-text("Login")').click();
      await page.waitForSelector('h2:has-text("Login")', { timeout: 5000 });
      assert.strictEqual(new URL(page.url()).pathname, '/services/passport-seva/apply-new-passport');
      await page.locator('button[aria-label="Close modal"]').click();

      assert.strictEqual(pageErrors.length, 0, `Uncaught pageErrors: ${pageErrors.join(' | ')}`);
      assert.strictEqual(consoleErrors.length, 0, `Unexpected consoleErrors: ${consoleErrors.join(' | ')}`);
      assert.strictEqual(server5xx.length, 0, `Unexpected 5xx responses: ${server5xx.join(' | ')}`);

      await context.close();
    });

    await check('Responsive & Single-Scroll Verification across Desktop (1280x800), Tablet (768x1024), Mobile (390x844)', async () => {
      const viewports = [
        { name: 'Desktop', width: 1280, height: 800 },
        { name: 'Tablet', width: 768, height: 1024 },
        { name: 'Mobile', width: 390, height: 844 },
      ];

      for (const vp of viewports) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/services/aadhaar-ucl-opretor/opretor-id`, { waitUntil: 'networkidle' });
        await page.waitForSelector('[data-testid="guest-login-banner"]', { timeout: 15000 });

        const metrics = await page.evaluate(() => {
          const doc = document.documentElement;
          const formCard = document.querySelector('form')?.parentElement;
          const formCardStyle = formCard ? window.getComputedStyle(formCard) : null;
          return {
            docScrollWidth: doc.scrollWidth,
            innerWidth: window.innerWidth,
            cardOverflowY: formCardStyle?.overflowY || 'visible',
            cardMaxHeight: formCardStyle?.maxHeight || 'none',
          };
        });

        assert(
          metrics.docScrollWidth <= metrics.innerWidth,
          `${vp.name}: horizontal overflow detected (${metrics.docScrollWidth} > ${metrics.innerWidth})`
        );
        assert.notStrictEqual(metrics.cardOverflowY, 'auto', `${vp.name}: inner scroll overflowY=auto must not exist`);
        assert.notStrictEqual(metrics.cardOverflowY, 'scroll', `${vp.name}: inner scroll overflowY=scroll must not exist`);
        assert.strictEqual(metrics.cardMaxHeight, 'none', `${vp.name}: form card must not have fixed maxHeight`);

        await context.close();
      }
    });
  } finally {
    await browser.close();
  }

  console.log(`\n🎉 All ${passed} Guest Apply Form, Security, SEO & E2E checks passed!\n`);
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
