import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { syncAllPublicJson, syncDataType, initializePublicDataOnStartup } from './src/server/dataSyncRuntime.js';
import { getMetadataForUrl, injectOpenGraphMetadata, isSocialCrawler } from './src/server/shareMetadata.js';
import { driveRouter } from './src/server/driveRoutes.js';
import { renderUniversalPage, injectSsrIntoTemplate } from './src/server/universalHtmlRenderer.js';
import { generateSitemapXml, generateRobotsTxt } from './src/server/sitemapService.js';
import { invalidatePublicDataCache } from './src/server/publicDataService.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server configuration
const PORT = Number(process.env.PORT) || 3000;
const DIST_PATH = path.join(__dirname, 'dist');
const APP_ROOT = __dirname;

console.log('Production server starting...');
console.log('PORT:', PORT);
console.log('DIST_PATH:', DIST_PATH);

const app = express();

initializePublicDataOnStartup().catch(error => {
  console.error('[DATA SYNC] Startup initialization error:', error);
});

// Trust proxy for correct protocol and host detection behind proxies
app.set('trust proxy', true);

// Middleware
app.use(express.json());

// Security Headers - Content Security Policy
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "frame-ancestors *; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' " +
      "https://apis.google.com " +
      "https://www.googletagmanager.com " +
      "https://*.razorpay.com " +
      "https://india-cyber-cafe-default-rtdb.firebaseio.com " +
      "https://*.firebaseio.com; " +
    "script-src-elem 'self' 'unsafe-inline' " +
      "https://apis.google.com " +
      "https://www.googletagmanager.com " +
      "https://*.razorpay.com " +
      "https://india-cyber-cafe-default-rtdb.firebaseio.com " +
      "https://*.firebaseio.com; " +
    "worker-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob: https://indiacybercafe.com https://cdn-icons-png.flaticon.com https://firebasestorage.googleapis.com https://api.dicebear.com https://www.google-analytics.com https://region1.google-analytics.com https://*.razorpay.com https://*.googleusercontent.com https://*.ggpht.com https://*.gravatar.com; " +
    "media-src 'self'; " +
    "connect-src 'self' " +
      "https://firebase.googleapis.com " +
      "https://firebaseinstallations.googleapis.com " +
      "https://identitytoolkit.googleapis.com " +
      "https://securetoken.googleapis.com " +
      "https://apis.google.com " +
      "https://www.googleapis.com " +
      "https://india-cyber-cafe-default-rtdb.firebaseio.com " +
      "https://*.firebaseio.com " +
      "wss://*.firebaseio.com " +
      "https://firebasestorage.googleapis.com " +
      "https://www.google-analytics.com " +
      "https://region1.google-analytics.com " +
      "https://*.razorpay.com " +
      "wss://*.razorpay.com " +
      "blob:; " +
    "frame-src 'self' " +
      "https://*.razorpay.com " +
      "https://*.firebaseapp.com " +
      "https://accounts.google.com " +
      "https://*.firebaseio.com"
  );
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

// Email Configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // Use false for STARTTLS (port 587)
  auth: {
    user: process.env.SMTP_USER || 'icc@indiacybercafe.com',
    pass: process.env.SMTP_PASS || '',
  },
  tls: {
    rejectUnauthorized: false // Helps with some mail server certificate issues
  }
});

// ============================================================================
// API ROUTES - Define these BEFORE the SPA fallback
// ============================================================================
// Health check endpoint
app.get('/api/health', (req, res) => {
  const dataDir = path.join(APP_ROOT, 'public/data');
  const hasPublicData =
    fs.existsSync(path.join(dataDir, 'services.json')) &&
    fs.existsSync(path.join(dataDir, 'products.json')) &&
    fs.existsSync(path.join(dataDir, 'product-categories.json'));

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json({
    status: 'ok',
    success: true,
    message: 'Backend is running',
    publicDataAvailable: hasPublicData,
    environment: process.env.NODE_ENV || 'production',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Email API Route
app.post('/api/send-email', async (req, res) => {
  const { to, subject, text, html } = req.body;

  const smtpUser = process.env.SMTP_USER || '';
  const smtpPass = process.env.SMTP_PASS || '';

  if (!smtpUser || !smtpPass) {
    console.warn('SMTP credentials missing. Email not sent.');
    return res.status(200).json({ success: true, message: 'Email simulation: Credentials missing' });
  }

  try {
    await transporter.sendMail({
      from: `"India Cyber Cafe" <${smtpUser}>`,
      to,
      subject,
      text,
      html,
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PDF Proxy endpoint - Fetches PDFs from external URLs and streams them to prevent CORS issues
app.get('/api/pdf-proxy', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  const source = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!source) return res.status(400).json({ success: false, error: 'PDF URL is required' });

  try {
    const publicDir = path.join(APP_ROOT, 'public');

    // Helper to serve local file safely
    const serveLocalPath = (relPath) => {
      const safePath = path.resolve(publicDir, relPath.replace(/^\/+/, ''));
      if (!safePath.startsWith(publicDir)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const bytes = fs.readFileSync(safePath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', bytes.length.toString());
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        return res.send(bytes);
      }
      return null;
    };

    // 1. Direct local file support: /documents/..., /data/..., etc.
    if (source.startsWith('/')) {
      const served = serveLocalPath(source);
      if (served) return;
      return res.status(404).json({ success: false, error: 'Local document not found' });
    }

    // Check if URL points to self domain or localhost with local documents path
    let parsedUrl;
    try {
      parsedUrl = new URL(source);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid PDF URL format' });
    }

    if (parsedUrl.pathname.startsWith('/documents/')) {
      const served = serveLocalPath(parsedUrl.pathname);
      if (served) return;
    }

    if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
      return res.status(400).json({ success: false, error: 'Only HTTPS PDF URLs are supported' });
    }

    // 2. Google Drive Support with fallback and confirmation handling
    const driveMatch = source.match(/drive\.google\.com\/(?:file\/d\/|open\?[^#]*\bid=|uc\?[^#]*\bid=)([a-zA-Z0-9_-]+)/i) || source.match(/[?&]id=([a-zA-Z0-9_-]+)/i);

    let targetUrls = [source];
    if (/drive\.google\.com/i.test(source) && driveMatch?.[1]) {
      const fileId = driveMatch[1];
      targetUrls = [
        `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`,
        `https://docs.google.com/uc?export=download&id=${fileId}&confirm=t`,
        source
      ];
    }

    let pdfBuffer = null;
    let lastStatus = 502;

    for (const targetUrl of targetUrls) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        const response = await fetch(targetUrl, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/pdf,application/octet-stream,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          lastStatus = response.status === 401 || response.status === 403 ? 403 : 502;
          continue;
        }

        const arrayBuf = await response.arrayBuffer();
        const buf = Buffer.from(arrayBuf);

        // Verify PDF magic bytes (%PDF -> 0x25 0x50 0x44 0x46)
        if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
          pdfBuffer = buf;
          break;
        }

        // If Google Drive returned an HTML warning/confirmation page, attempt to parse confirm token
        const text = buf.toString('utf-8', 0, Math.min(buf.length, 5000));
        const confirmMatch = text.match(/confirm=([0-9a-zA-Z_-]+)/) || text.match(/download_warning_([0-9a-zA-Z_-]+)/);
        if (confirmMatch && driveMatch?.[1]) {
          const confirmToken = confirmMatch[1];
          const confirmUrl = `https://drive.usercontent.google.com/download?id=${driveMatch[1]}&export=download&confirm=${confirmToken}&authuser=0`;
          const retryResp = await fetch(confirmUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'application/pdf,*/*',
            },
          });
          if (retryResp.ok) {
            const retryBuf = Buffer.from(await retryResp.arrayBuffer());
            if (retryBuf.length >= 4 && retryBuf[0] === 0x25 && retryBuf[1] === 0x50 && retryBuf[2] === 0x44 && retryBuf[3] === 0x46) {
              pdfBuffer = retryBuf;
              break;
            }
          }
        }
      } catch (fetchErr) {
        console.warn(`[pdf-proxy] Target attempt failed (${targetUrl}):`, fetchErr.message);
      }
    }

    if (!pdfBuffer) {
      return res.status(lastStatus).json({
        success: false,
        error: 'Unable to retrieve valid PDF document from source',
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length.toString());
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    if (req.query.download === '1' || req.query.download === 'true') {
      const downloadFilename = typeof req.query.filename === 'string' && req.query.filename.trim()
        ? req.query.filename.trim()
        : 'document.pdf';
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadFilename)}"`);
    }
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF proxy error:', error.message);
    return res.status(502).json({ success: false, error: 'Unable to fetch PDF' });
  }
});

app.get('/robots.txt', (req, res) => {
  let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '';
  if (!baseUrl) {
    const protocol = req.protocol;
    const host = req.get('host');
    baseUrl = `${protocol}://${host}`;
  }
  res.type('text/plain');
  res.send(generateRobotsTxt(baseUrl));
});

app.get('/sitemap.xml', (req, res) => {
  let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '';
  if (!baseUrl) {
    const protocol = req.protocol;
    const host = req.get('host');
    baseUrl = `${protocol}://${host}`;
  }
  res.type('application/xml');
  res.send(generateSitemapXml(baseUrl, APP_ROOT));
});

app.get(['/page-sitemap.xml', '/service-sitemap.xml', '/subservice-sitemap.xml', '/product-sitemap.xml'], (req, res) => {
  let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '';
  if (!baseUrl) {
    const protocol = req.protocol;
    const host = req.get('host');
    baseUrl = `${protocol}://${host}`;
  }
  res.type('application/xml');
  res.send(generateSitemapXml(baseUrl, APP_ROOT));
});

// ============================================================================
// RAZORPAY API ROUTES
// ============================================================================

// Helper function to validate and convert amount to exact integer paise
function validateAndParsePayAmount(rawAmount) {
  if (rawAmount === undefined || rawAmount === null || typeof rawAmount === 'boolean') {
    return { valid: false, paise: 0, error: 'Payment amount is required' };
  }
  const amountStr = String(rawAmount).trim();
  // Validate: only numbers with maximum 2 decimal places allowed
  if (!/^\d+(\.\d{1,2})?$/.test(amountStr)) {
    return { valid: false, paise: 0, error: 'Invalid payment amount. Must be a positive number with at most 2 decimal places' };
  }
  const [rupeesPart, decimalPart = ''] = amountStr.split('.');
  const rupees = parseInt(rupeesPart, 10);
  if (!Number.isSafeInteger(rupees)) {
    return { valid: false, paise: 0, error: 'Amount exceeds maximum supported value' };
  }
  const paise = parseInt(decimalPart.padEnd(2, '0').slice(0, 2), 10);
  const totalPaise = rupees * 100 + paise;

  const MIN_PAISE = 100; // ₹1.00
  const MAX_PAISE = 10000000; // ₹1,00,000.00 (1 Lakh INR limit)

  if (totalPaise < MIN_PAISE) {
    return { valid: false, paise: 0, error: 'Amount must be at least ₹1.00' };
  }
  if (totalPaise > MAX_PAISE) {
    return { valid: false, paise: 0, error: 'Amount exceeds maximum limit of ₹1,00,000' };
  }

  return { valid: true, paise: totalPaise };
}

// Pay-by-Link Order Creation Endpoint (Secure Server-Side Validation)
app.post('/api/pay-link/create-order', async (req, res) => {
  try {
    const { amount, ref } = req.body;
    const validation = validateAndParsePayAmount(amount);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    const amountInPaise = validation.paise;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error('Razorpay keys not configured');
      return res.status(500).json({
        success: false,
        error: 'Payment gateway is not configured'
      });
    }

    const cleanRef = typeof ref === 'string' ? ref.trim().slice(0, 64) : '';
    const receiptId = 'PAY_' + crypto.randomBytes(6).toString('hex').toUpperCase();

    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    console.log(`📡 Creating Pay-Link order: ${amountInPaise} paise (₹${amountInPaise / 100}), Ref: ${cleanRef || 'none'}`);

    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: {
          paymentType: 'pay_link',
          receiptId,
          reference: cleanRef || 'none'
        }
      })
    });

    if (!razorpayResponse.ok) {
      const errorData = await razorpayResponse.json().catch(() => ({}));
      console.error('❌ Razorpay Orders API error:', errorData);
      return res.status(400).json({
        success: false,
        error: errorData.error?.description || 'Failed to create order with Razorpay'
      });
    }

    const orderData = await razorpayResponse.json();
    console.log('✅ Pay-Link Order created with Razorpay:', orderData.id);

    return res.json({
      success: true,
      keyId,
      order_id: orderData.id,
      orderId: orderData.id,
      amount: orderData.amount, // Exact integer paise from server
      amountInRupees: amountInPaise / 100,
      currency: orderData.currency || 'INR',
      receiptId,
      reference: cleanRef
    });
  } catch (error) {
    console.error('Pay-Link order creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create payment order'
    });
  }
});

// Pay-by-Link Server-side Payment Verification & Recording Endpoint
app.post('/api/pay-link/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      reference,
      receiptId
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        verified: false,
        error: 'Missing required payment verification data'
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('RAZORPAY_KEY_SECRET is not configured');
      return res.status(500).json({
        verified: false,
        error: 'Payment verification not configured'
      });
    }

    // Compute and verify HMAC-SHA256 signature
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');

    const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedSignatureBuffer = Buffer.from(razorpay_signature, 'utf8');
    const isSignatureValid = expectedSignatureBuffer.length === receivedSignatureBuffer.length &&
      crypto.timingSafeEqual(expectedSignatureBuffer, receivedSignatureBuffer);

    if (!isSignatureValid) {
      console.warn(`❌ Invalid payment signature - Order: ${razorpay_order_id}, Payment ID: ${razorpay_payment_id}`);
      return res.status(400).json({
        verified: false,
        error: 'Invalid payment signature'
      });
    }

    console.log(`✅ Pay-link payment verified - Order: ${razorpay_order_id}, Payment ID: ${razorpay_payment_id}`);

    const numAmount = typeof amount === 'number' ? amount : (parseFloat(amount) || 0);
    const createdAt = new Date().toISOString();
    const finalRef = typeof reference === 'string' && reference.trim() ? reference.trim() : (receiptId || 'none');

    const paymentRecord = {
      payment_id: razorpay_payment_id,
      paymentId: razorpay_payment_id,
      order_id: razorpay_order_id,
      orderId: razorpay_order_id,
      amount: numAmount,
      currency: 'INR',
      status: 'completed',
      reference: finalRef,
      receiptId: receiptId || razorpay_order_id,
      type: 'pay_link',
      created_at: createdAt,
      createdAt: createdAt
    };

    // Persist verified transaction record to Firebase RTDB
    try {
      const databaseURL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';
      await fetch(`${databaseURL}/payments.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentRecord)
      });
    } catch (dbError) {
      console.error('Failed to record payment in RTDB from server:', dbError);
    }

    return res.json({
      verified: true,
      message: 'Payment successfully verified',
      record: paymentRecord
    });
  } catch (error) {
    console.error('Pay link verification error:', error);
    res.status(500).json({
      verified: false,
      error: error.message || 'Payment verification failed'
    });
  }
});

// Create Razorpay Order
app.post('/api/create-razorpay-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes = {} } = req.body;

    if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive integer in paise (max ₹1,00,000)'
      });
    }

    if (currency !== 'INR' || (receipt !== undefined && typeof receipt !== 'string') || typeof notes !== 'object' || notes === null || Array.isArray(notes)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order details'
      });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error('Razorpay keys not configured');
      return res.status(500).json({
        error: 'Payment gateway not configured'
      });
    }

    try {
      // Call Razorpay Orders API to create order
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

      console.log('📡 Calling Razorpay Orders API...');
      const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: amount,
          currency: currency,
          receipt: receipt,
          notes: notes
        })
      });

      if (!razorpayResponse.ok) {
        const errorData = await razorpayResponse.json();
        console.error('❌ Razorpay API error:', errorData);
        return res.status(400).json({
          error: errorData.error?.description || 'Failed to create order with Razorpay'
        });
      }

      const orderData = await razorpayResponse.json();
      console.log('✅ Order created with Razorpay:', orderData.id);

      res.json({
        success: true,
        keyId,
        order_id: orderData.id,
        orderId: orderData.id,
        amount: orderData.amount,
        currency: orderData.currency
      });
    } catch (apiError) {
      console.error('❌ Error calling Razorpay API:', apiError);
      return res.status(500).json({
        error: apiError.message || 'Failed to create order'
      });
    }
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({
      error: error.message || 'Failed to create order'
    });
  }
});

// Verify Razorpay Payment
app.post('/api/verify-razorpay-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        verified: false,
        error: 'Missing required payment verification data'
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('RAZORPAY_KEY_SECRET is not configured');
      return res.status(500).json({
        verified: false,
        error: 'Payment verification not configured'
      });
    }

    // Create HMAC-SHA256 signature
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');

    const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedSignatureBuffer = Buffer.from(razorpay_signature, 'utf8');
    const isSignatureValid = expectedSignatureBuffer.length === receivedSignatureBuffer.length &&
      crypto.timingSafeEqual(expectedSignatureBuffer, receivedSignatureBuffer);

    if (isSignatureValid) {
      console.log(`✅ Payment verified - Order: ${razorpay_order_id}, Payment ID: ${razorpay_payment_id}`);
      res.json({
        verified: true,
        message: 'Payment successfully verified'
      });
    } else {
      console.warn(`❌ Invalid payment signature - Order: ${razorpay_order_id}, Payment ID: ${razorpay_payment_id}`);
      res.status(400).json({
        verified: false,
        error: 'Invalid payment signature'
      });
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({
      verified: false,
      error: error.message || 'Failed to verify payment'
    });
  }
});

// ============================================================================
// DATA SYNC ROUTES
// ============================================================================

app.post('/api/sync-data', async (req, res) => {
  try {
    console.log('[DATA SYNC] Manual sync triggered from API');
    const result = await syncAllPublicJson();
    if (result.success) {
      invalidatePublicDataCache();
      return res.json({ success: true, message: 'Data synchronization completed', results: result.results });
    }
    return res.status(202).json({ success: false, message: 'Synchronization completed with errors', results: result.results });
  } catch (error) {
    console.error('[DATA SYNC] Error in sync endpoint:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync-data/:type', async (req, res) => {
  const { type } = req.params;

  if (!['services', 'products', 'categories', 'documents', 'documentCategories'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid sync type',
    });
  }

  console.log(`[DATA SYNC] Sync triggered for type: ${type}`);
  try {
    const authHeader = req.headers.authorization;
    const firebaseToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const result = await syncDataType(type, firebaseToken);
    if (result.success) {
      invalidatePublicDataCache();
      return res.json({ success: true, message: `${type} synchronized`, result });
    }
    return res.status(202).json({ success: false, message: `Failed to sync ${type}`, result });
  } catch (error) {
    console.error(`[DATA SYNC] Error syncing ${type}:`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Dynamic Open Graph metadata API endpoint
app.get('/api/share-meta', (req, res) => {
  const targetPath = req.query.path || '/';
  const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const baseUrl = process.env.APP_URL || `${proto}://${host}`;
  const meta = getMetadataForUrl(targetPath, baseUrl, APP_ROOT);
  res.json({ success: true, metadata: meta });
});

// --- Robust Document Management & Embed Resolver ---
const DOCS_STORE_PATH = path.join(APP_ROOT, 'data/documents.json');
const PUBLIC_DOCS_PATH = path.join(APP_ROOT, 'public/data/documents.json');
const DOC_CATS_STORE_PATH = path.join(APP_ROOT, 'data/document-categories.json');
const PUBLIC_DOC_CATS_PATH = path.join(APP_ROOT, 'public/data/document-categories.json');

const setNoCacheHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
};

const writeJsonAtomically = (filePath, data) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.warn(`Atomic write error for ${filePath}:`, err);
  }
};

const serverSlugify = (str) => {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const extractCoreTokens = (title) => {
  if (!title) return [];
  const noise = new Set([
    'form',
    'certificate',
    'application',
    'official',
    'document',
    'pdf',
    'prapatra',
    'praman',
    'patra',
    'pyq',
    'notes',
    'paper',
    'syllabus',
    'solution',
  ]);
  return String(title)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !noise.has(w))
    .sort();
};

const getDocSignature = (title) => {
  const tokens = extractCoreTokens(title);
  return tokens.length > 0 ? tokens.join('-') : serverSlugify(title);
};

const deduplicateServerDocs = (docs) => {
  if (!Array.isArray(docs)) return [];
  const idMap = new Map();
  const catSigMap = new Map();
  const catSlugMap = new Map();
  const urlMap = new Map();

  const validDocs = docs.filter(d => Boolean(d && typeof d === 'object' && (d.name || d.id)));

  for (const doc of validDocs) {
    const id = (doc.id || '').trim();
    const catSlug = serverSlugify(doc.category || 'general');
    const nameSlug = serverSlugify(doc.name || '');
    const signature = getDocSignature(doc.name || '');
    const catSigKey = `${catSlug}::${signature}`;
    const catSlugKey = `${catSlug}::${nameSlug}`;
    const cleanUrl = (doc.downloadUrl || doc.previewUrl || '').trim().toLowerCase();
    const isGenericUrl = !cleanUrl || cleanUrl.includes('incomeaay-certificate-form.pdf');

    const existing = (id && idMap.get(id)) || catSigMap.get(catSigKey) || catSlugMap.get(catSlugKey) || (!isGenericUrl ? urlMap.get(cleanUrl) : undefined);

    if (existing) {
      const urlA = cleanUrl;
      const urlB = (existing.downloadUrl || existing.previewUrl || '').toLowerCase();
      const isDummyA = urlA.includes('incomeaay-certificate-form.pdf') || (doc.id && (doc.id.startsWith('mp-') || doc.id.startsWith('pan-')));
      const isDummyB = urlB.includes('incomeaay-certificate-form.pdf') || (existing.id && (existing.id.startsWith('mp-') || existing.id.startsWith('pan-')));
      const timeA = new Date(doc.updatedAt || doc.createdAt || 0).getTime();
      const timeB = new Date(existing.updatedAt || existing.createdAt || 0).getTime();

      const docWins = (!isDummyA && isDummyB) || (isDummyA === isDummyB && timeA >= timeB);
      if (docWins) {
        if (existing.id) idMap.delete(existing.id);
        const oldCatSlug = serverSlugify(existing.category || 'general');
        catSigMap.delete(`${oldCatSlug}::${getDocSignature(existing.name || '')}`);
        catSlugMap.delete(`${oldCatSlug}::${serverSlugify(existing.name || '')}`);
        if (!isGenericUrl) urlMap.delete(urlB);

        if (id) idMap.set(id, doc);
        catSigMap.set(catSigKey, doc);
        catSlugMap.set(catSlugKey, doc);
        if (!isGenericUrl) urlMap.set(cleanUrl, doc);
      }
      continue;
    }

    if (id) idMap.set(id, doc);
    catSigMap.set(catSigKey, doc);
    catSlugMap.set(catSlugKey, doc);
    if (!isGenericUrl) urlMap.set(cleanUrl, doc);
  }

  const resultSet = new Set([
    ...catSigMap.values(),
    ...idMap.values()
  ]);

  return Array.from(resultSet).sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });
};

const readServerDocuments = () => {
  const candidates = [PUBLIC_DOCS_PATH, DOCS_STORE_PATH, path.join(DIST_PATH, 'data/documents.json')];
  const allFound = [];
  for (const targetPath of candidates) {
    if (fs.existsSync(targetPath)) {
      try {
        const raw = fs.readFileSync(targetPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.documents) ? parsed.documents : [];
        if (list.length > 0) {
          allFound.push(...list);
        }
      } catch (err) {
        console.warn(`Read ${targetPath} notice:`, err);
      }
    }
  }
  return deduplicateServerDocs(allFound);
};

const saveServerDocuments = (docs) => {
  const deduplicated = deduplicateServerDocs(docs);
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    documents: deduplicated
  };

  writeJsonAtomically(PUBLIC_DOCS_PATH, output);
  writeJsonAtomically(DOCS_STORE_PATH, output);
  if (fs.existsSync(DIST_PATH)) {
    writeJsonAtomically(path.join(DIST_PATH, 'data/documents.json'), output);
  }
};

const readServerDocCategories = () => {
  const targetPath = fs.existsSync(PUBLIC_DOC_CATS_PATH) ? PUBLIC_DOC_CATS_PATH : DOC_CATS_STORE_PATH;
  if (fs.existsSync(targetPath)) {
    try {
      const raw = fs.readFileSync(targetPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const cats = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.categories) ? parsed.categories : [];
      const seen = new Set();
      const result = [];
      for (const c of cats) {
        if (!c || !c.name) continue;
        const slug = serverSlugify(c.name);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        result.push(c);
      }
      return result;
    } catch (err) {
      console.warn(`Read ${targetPath} notice:`, err);
    }
  }
  return [];
};

const saveServerDocCategories = (cats) => {
  const seen = new Set();
  const deduplicated = [];
  for (const c of cats) {
    if (!c || !c.name) continue;
    const slug = serverSlugify(c.name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    deduplicated.push(c);
  }

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    categories: deduplicated
  };

  writeJsonAtomically(PUBLIC_DOC_CATS_PATH, output);
  writeJsonAtomically(DOC_CATS_STORE_PATH, output);
  if (fs.existsSync(DIST_PATH)) {
    writeJsonAtomically(path.join(DIST_PATH, 'data/document-categories.json'), output);
  }
};

// 12-Hour Automatic Document Refresh & Background Sync Scheduler
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;
const run12HourDocumentSync = async () => {
  try {
    console.log(`[12-HOUR SYNC] Starting scheduled documents refresh from database at ${new Date().toISOString()}...`);
    
    // Step 1: Fetch fresh documents directly from RTDB
    let freshDocs = [];
    try {
      const rtdbResp = await fetch("https://india-cyber-cafe-default-rtdb.firebaseio.com/documents.json", {
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'application/json' }
      });
      if (rtdbResp.ok) {
        const rtdbData = await rtdbResp.json();
        if (rtdbData && typeof rtdbData === 'object') {
          freshDocs = Object.entries(rtdbData).map(([k, v]) => ({ id: k, ...v }));
        }
      }
    } catch (err) {
      console.warn('[12-HOUR SYNC] RTDB documents fetch notice:', err?.message);
    }

    // Step 2: Fetch fresh categories directly from RTDB
    let freshCats = [];
    try {
      const rtdbCatsResp = await fetch("https://india-cyber-cafe-default-rtdb.firebaseio.com/documentCategories.json", {
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'application/json' }
      });
      if (rtdbCatsResp.ok) {
        const rtdbCatsData = await rtdbCatsResp.json();
        if (rtdbCatsData && typeof rtdbCatsData === 'object') {
          freshCats = Object.entries(rtdbCatsData).map(([k, v]) => ({ id: k, ...v }));
        }
      }
    } catch (err) {
      console.warn('[12-HOUR SYNC] RTDB categories fetch notice:', err?.message);
    }

    if (freshDocs.length > 0) {
      saveServerDocuments(freshDocs);
    } else {
      await syncDataType('documents');
    }

    if (freshCats.length > 0) {
      saveServerDocCategories(freshCats);
    } else {
      await syncDataType('documentCategories');
    }

    const finalDocs = readServerDocuments();
    console.log(`[12-HOUR SYNC] ✅ Scheduled sync completed. Saved ${finalDocs.length} clean documents.`);
  } catch (err) {
    console.error('[12-HOUR SYNC] Error during scheduled sync:', err?.message || err);
  }
};

setTimeout(run12HourDocumentSync, 2000);
const syncTimer = setInterval(run12HourDocumentSync, SYNC_INTERVAL_MS);
if (syncTimer.unref) syncTimer.unref();

// Dedicated dynamic endpoints for documents and categories with strict no-cache headers
app.get('/data/documents.json', (req, res) => {
  const docs = readServerDocuments();
  setNoCacheHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    version: 1,
    generatedAt: new Date().toISOString(),
    documents: docs
  });
});

app.get('/data/document-categories.json', (req, res) => {
  const cats = readServerDocCategories();
  setNoCacheHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    version: 1,
    generatedAt: new Date().toISOString(),
    categories: cats
  });
});

// Direct Live Database Search & Retrieval Endpoint
app.get(['/api/documents', '/api/documents/search'], (req, res) => {
  const includeInactive = req.query.includeInactive === 'true' || req.query.all === 'true';
  const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const rawCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';

  const docs = readServerDocuments();
  let filtered = includeInactive ? docs : docs.filter(d => d.active !== false);

  if (rawCategory && rawCategory.toLowerCase() !== 'all') {
    const catSlug = serverSlugify(rawCategory);
    filtered = filtered.filter(d => {
      return (d.category || '').toLowerCase() === rawCategory.toLowerCase() ||
        serverSlugify(d.category || '') === catSlug;
    });
  }

  if (rawQuery) {
    const queryTokens = rawQuery.split(/\s+/).filter(Boolean);
    const querySig = getDocSignature(rawQuery);

    filtered = filtered.filter(d => {
      const name = (d.name || '').toLowerCase();
      const desc = (d.description || '').toLowerCase();
      const cat = (d.category || '').toLowerCase();
      const id = (d.id || '').toLowerCase();
      const docSig = getDocSignature(d.name || '');

      if (name.includes(rawQuery) || id.includes(rawQuery)) return true;
      if (querySig && docSig && (docSig === querySig || docSig.includes(querySig) || querySig.includes(docSig))) return true;
      if (desc.includes(rawQuery) || cat.includes(rawQuery)) return true;
      const combined = `${name} ${desc} ${cat} ${id}`;
      if (queryTokens.every(token => combined.includes(token))) return true;

      return false;
    });
  }

  setNoCacheHeaders(res);
  res.json({ success: true, count: filtered.length, documents: filtered });
});

app.post('/api/documents/refresh', async (req, res) => {
  try {
    await run12HourDocumentSync();
    const docs = readServerDocuments();
    setNoCacheHeaders(res);
    res.json({
      success: true,
      message: 'Documents refreshed and synchronized from database',
      count: docs.length,
      documents: docs,
      refreshedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to refresh documents' });
  }
});

app.get('/api/version', (req, res) => {
  setNoCacheHeaders(res);
  res.json({ success: true, version: '2026.11.02-v1', timestamp: Date.now() });
});

app.get('/api/documents/lookup', async (req, res) => {
  const slug = (req.query.slug || '').trim();
  const category = (req.query.category || '').trim();
  const id = (req.query.id || '').trim();

  if (!slug && !id) {
    return res.status(400).json({ success: false, error: 'Slug or id is required' });
  }

  const docs = readServerDocuments();
  const rawTarget = (slug || id).trim().toLowerCase();
  const cleanTargetSlug = serverSlugify(slug || id);
  const cleanTargetCompact = cleanTargetSlug.replace(/-/g, '');
  const cleanCatSlug = serverSlugify(category);
  const targetSig = getDocSignature(slug || id);

  let match = docs.find(d => {
    const docId = (d.id || '').trim();
    const docIdLower = docId.toLowerCase();
    const docNameSlug = serverSlugify(d.name || '');
    const docCatSlug = serverSlugify(d.category || '');
    const docSig = getDocSignature(d.name || '');

    if (id && (docId === id || docIdLower === id.toLowerCase() || docId === cleanTargetSlug)) return true;
    if (slug && (docId === slug || docIdLower === rawTarget || docId === cleanTargetSlug)) return true;
    if (cleanCatSlug && docCatSlug === cleanCatSlug && docNameSlug === cleanTargetSlug) return true;
    if (cleanTargetSlug && docNameSlug === cleanTargetSlug) return true;
    if (targetSig && docSig && targetSig === docSig) return true;
    if (cleanTargetCompact && docNameSlug.replace(/-/g, '') === cleanTargetCompact) return true;
    if (cleanTargetCompact && docIdLower.replace(/[^a-z0-9]/g, '') === cleanTargetCompact) return true;
    if (rawTarget && (d.name || '').trim().toLowerCase() === rawTarget) return true;
    if (cleanTargetSlug.length >= 4 && (docNameSlug.includes(cleanTargetSlug) || cleanTargetSlug.includes(docNameSlug))) return true;

    return false;
  });

  if (!match) {
    try {
      const rtdbResp = await fetch('https://india-cyber-cafe-default-rtdb.firebaseio.com/documents.json');
      if (rtdbResp.ok) {
        const rtdbData = await rtdbResp.json();
        if (rtdbData) {
          const remoteList = Object.entries(rtdbData).map(([k, v]) => ({ id: k, ...v }));
          match = remoteList.find(d => {
            const docId = (d.id || '').trim();
            const docNameSlug = serverSlugify(d.name || '');
            const docSig = getDocSignature(d.name || '');
            if (docId === slug || docId.toLowerCase() === rawTarget || docId === cleanTargetSlug) return true;
            if (docNameSlug === cleanTargetSlug || docNameSlug.replace(/-/g, '') === cleanTargetCompact) return true;
            if (targetSig && docSig && targetSig === docSig) return true;
            if (cleanTargetSlug.length >= 3 && (docNameSlug.includes(cleanTargetSlug) || cleanTargetSlug.includes(docNameSlug))) return true;
            if (rawTarget && (d.name || '').trim().toLowerCase() === rawTarget) return true;
            return false;
          });
          if (match) {
            const existingList = readServerDocuments();
            saveServerDocuments([...existingList, match]);
          }
        }
      }
    } catch (err) {
      console.warn('RTDB lookup check notice:', err);
    }
  }

  if (!match) {
    try {
      const prodResp = await fetch('https://b.indiacybercafe.com/data/documents.json', {
        signal: AbortSignal.timeout(4000),
        headers: { 'Accept': 'application/json' }
      });
      if (prodResp.ok) {
        const prodData = await prodResp.json();
        const prodDocs = Array.isArray(prodData?.documents) ? prodData.documents : [];
        match = prodDocs.find(d => {
          const docId = (d.id || '').trim();
          const docNameSlug = serverSlugify(d.name || '');
          return docId === slug || docNameSlug === cleanTargetSlug || docNameSlug.replace(/-/g, '') === cleanTargetCompact || (d.name || '').trim().toLowerCase() === rawTarget;
        });
        if (match) {
          saveServerDocuments([...docs, match]);
        }
      }
    } catch (err) {}
  }

  setNoCacheHeaders(res);
  if (match) {
    return res.json({ success: true, document: match });
  }

  return res.status(404).json({ success: false, error: 'Document not found' });
});

app.post('/api/documents', async (req, res) => {
  try {
    const doc = req.body;
    if (!doc || !doc.name) {
      return res.status(400).json({ success: false, error: 'Document name is required' });
    }

    const docs = readServerDocuments();
    const docId = doc.id || `doc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const payload = {
      ...doc,
      id: docId,
      fileType: 'PDF',
      active: doc.active !== false,
      updatedAt: new Date().toISOString(),
      createdAt: doc.createdAt || new Date().toISOString()
    };

    const filtered = docs.filter(d => d.id !== docId && serverSlugify(d.name) !== serverSlugify(payload.name));
    filtered.unshift(payload);
    saveServerDocuments(filtered);

    try {
      await fetch(`https://india-cyber-cafe-default-rtdb.firebaseio.com/documents/${encodeURIComponent(docId)}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (rtdbErr) {
      console.warn('RTDB save document notice:', rtdbErr);
    }

    return res.json({ success: true, document: payload });
  } catch (error) {
    console.error('Save document error:', error);
    res.status(500).json({ success: false, error: 'Failed to save document' });
  }
});

app.post('/api/documents/sync-bulk', async (req, res) => {
  try {
    const { documents } = req.body;
    if (!Array.isArray(documents)) {
      return res.status(400).json({ success: false, error: 'Documents array required' });
    }
    saveServerDocuments(documents);
    return res.json({ success: true, count: documents.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const docs = readServerDocuments();
    const filtered = docs.filter(d => d.id !== id && serverSlugify(d.name) !== serverSlugify(id));
    saveServerDocuments(filtered);

    try {
      await fetch(`https://india-cyber-cafe-default-rtdb.firebaseio.com/documents/${encodeURIComponent(id)}.json`, {
        method: 'DELETE'
      });
    } catch (rtdbErr) {
      console.warn('RTDB delete notice:', rtdbErr);
    }

    return res.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    console.error('Failed to delete document:', error);
    res.status(500).json({ success: false, error: 'Failed to delete document' });
  }
});

app.get('/api/document-categories', (req, res) => {
  const cats = readServerDocCategories();
  setNoCacheHeaders(res);
  res.json({ success: true, categories: cats });
});

app.post('/api/document-categories', (req, res) => {
  try {
    const cat = req.body;
    if (!cat || !cat.name) return res.status(400).json({ success: false, error: 'Category name required' });
    const cats = readServerDocCategories();
    const id = cat.id || serverSlugify(cat.name);
    const payload = { ...cat, id };
    const filtered = cats.filter(c => c.id !== id && serverSlugify(c.name) !== serverSlugify(cat.name));
    filtered.push(payload);
    saveServerDocCategories(filtered);
    return res.json({ success: true, category: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/document-categories/sync-bulk', async (req, res) => {
  try {
    const { categories } = req.body;
    if (!Array.isArray(categories)) {
      return res.status(400).json({ success: false, error: 'Categories array required' });
    }
    saveServerDocCategories(categories);
    return res.json({ success: true, count: categories.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/document-categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cats = readServerDocCategories();
    const filtered = cats.filter(c => c.id !== id && serverSlugify(c.name) !== serverSlugify(id));
    saveServerDocCategories(filtered);

    try {
      await fetch(`https://india-cyber-cafe-default-rtdb.firebaseio.com/documentCategories/${encodeURIComponent(id)}.json`, {
        method: 'DELETE'
      });
    } catch (rtdbErr) {
      console.warn('RTDB delete category notice:', rtdbErr);
    }

    return res.json({ success: true, message: 'Category deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete category' });
  }
});

// --- Privacy & Grievance Request Management ---
const RTDB_URL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';
const PRIVACY_STORE_PATH = path.join(APP_ROOT, 'data/privacy_requests.json');

const readLocalPrivacyRequests = () => {
  try {
    if (fs.existsSync(PRIVACY_STORE_PATH)) {
      const raw = fs.readFileSync(PRIVACY_STORE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not read local privacy store:', err);
  }
  return {};
};

const saveLocalPrivacyRequest = (record) => {
  try {
    const dataDir = path.dirname(PRIVACY_STORE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const existing = readLocalPrivacyRequests();
    existing[record.id] = record;
    fs.writeFileSync(PRIVACY_STORE_PATH, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write to local privacy store:', err);
  }
};

app.post('/api/privacy-requests', async (req, res) => {
  try {
    const { category, name, email, phone, referenceId, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ success: false, error: 'Valid email address is required' });
    }
    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      return res.status(400).json({ success: false, error: 'Please provide a detailed description (minimum 10 characters)' });
    }

    const validCategories = [
      'privacy_question',
      'data_access',
      'data_correction',
      'data_deletion',
      'consent_withdrawal',
      'consumer_grievance',
      'other'
    ];
    const selectedCategory = validCategories.includes(category) ? category : 'other';

    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const ticketId = `PRV-${Date.now().toString().slice(-6)}-${randomSuffix}`;
    const now = new Date().toISOString();

    const privacyRecord = {
      id: ticketId,
      category: selectedCategory,
      name: name.trim().slice(0, 100),
      email: email.trim().toLowerCase().slice(0, 120),
      phone: typeof phone === 'string' ? phone.trim().slice(0, 20) : '',
      referenceId: typeof referenceId === 'string' ? referenceId.trim().slice(0, 60) : '',
      description: description.trim().slice(0, 4000),
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };

    saveLocalPrivacyRequest(privacyRecord);

    try {
      await fetch(`${RTDB_URL}/privacy_requests/${ticketId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(privacyRecord)
      });
    } catch (dbErr) {
      console.warn('RTDB write notice:', dbErr);
    }

    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        await transporter.sendMail({
          from: `"India Cyber Cafe Grievance Cell" <${process.env.SMTP_USER}>`,
          to: privacyRecord.email,
          subject: `[${ticketId}] Acknowledgment: Privacy & Grievance Request`,
          text: `Dear ${privacyRecord.name},\n\nWe have received your privacy request (Ticket ID: ${ticketId}).\nCategory: ${selectedCategory}\n\nOur Grievance Redressal Officer will review your request and acknowledge within 48 hours, with resolution within 15 to 30 days as per Consumer Protection (E-Commerce) Rules and DPDP Act provisions.\n\nYou can track your request at: https://b.indiacybercafe.com/privacy-request/track\n\nRegards,\nGrievance Officer\nIndia Cyber Cafe\nSingrauli, MP, India\nContact: icc@indiacybercafe.com | +91 9203251821`,
        }).catch(err => console.warn('Privacy ack email error:', err.message));

        await transporter.sendMail({
          from: `"India Cyber Cafe Portal" <${process.env.SMTP_USER}>`,
          to: 'icc@indiacybercafe.com',
          subject: `🔔 New Privacy Request [${ticketId}] - ${privacyRecord.name}`,
          text: `A new privacy request has been submitted:\nTicket ID: ${ticketId}\nCategory: ${selectedCategory}\nName: ${privacyRecord.name}\nEmail: ${privacyRecord.email}\nPhone: ${privacyRecord.phone || 'N/A'}\nReference: ${privacyRecord.referenceId || 'N/A'}\n\nDescription:\n${privacyRecord.description}\n\nReview in Admin Portal: https://b.indiacybercafe.com/admin/privacy-requests`,
        }).catch(err => console.warn('Admin privacy alert email error:', err.message));
      }
    } catch (mailErr) {
      console.warn('Mail dispatch failed:', mailErr);
    }

    return res.json({
      success: true,
      ticketId,
      message: 'Your request has been recorded. An acknowledgment has been generated.',
      request: privacyRecord
    });
  } catch (error) {
    console.error('Privacy request submission error:', error);
    res.status(500).json({ success: false, error: 'Failed to process privacy request' });
  }
});

app.post('/api/privacy-requests/track', async (req, res) => {
  try {
    const { ticketId, email } = req.body;
    if (!ticketId || typeof ticketId !== 'string') {
      return res.status(400).json({ success: false, error: 'Ticket ID is required' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Verification email is required' });
    }

    const cleanTicket = ticketId.trim();
    const cleanEmail = email.trim().toLowerCase();

    const localStore = readLocalPrivacyRequests();
    let record = localStore[cleanTicket];

    if (!record) {
      try {
        const rtdbResp = await fetch(`${RTDB_URL}/privacy_requests/${encodeURIComponent(cleanTicket)}.json`);
        if (rtdbResp.ok) {
          record = await rtdbResp.json();
        }
      } catch (rtdbErr) {
        console.warn('RTDB fetch notice:', rtdbErr);
      }
    }

    if (!record || !record.id) {
      return res.status(404).json({ success: false, error: 'No privacy request found matching this Ticket ID' });
    }

    if (record.email?.toLowerCase().trim() !== cleanEmail) {
      return res.status(403).json({ success: false, error: 'Email address does not match the record on file' });
    }

    return res.json({ success: true, request: record });
  } catch (error) {
    console.error('Privacy tracking error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve status' });
  }
});

app.get('/api/admin/privacy-requests', async (req, res) => {
  try {
    const localStore = readLocalPrivacyRequests();
    const combined = { ...localStore };

    try {
      const rtdbResp = await fetch(`${RTDB_URL}/privacy_requests.json`);
      if (rtdbResp.ok) {
        const data = await rtdbResp.json();
        if (data && typeof data === 'object') {
          Object.assign(combined, data);
        }
      }
    } catch (rtdbErr) {
      console.warn('RTDB list notice:', rtdbErr);
    }

    const requests = Object.values(combined).sort((a, b) => 
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    return res.json({ success: true, requests });
  } catch (error) {
    console.error('Admin privacy fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to load privacy requests' });
  }
});

app.patch('/api/admin/privacy-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const now = new Date().toISOString();
    const localStore = readLocalPrivacyRequests();
    if (localStore[id]) {
      if (status) localStore[id].status = status;
      if (adminNotes !== undefined) localStore[id].adminNotes = adminNotes;
      if (status === 'resolved') localStore[id].resolvedAt = now;
      localStore[id].updatedAt = now;
      saveLocalPrivacyRequest(localStore[id]);
    }

    const updates = {
      updatedAt: now,
    };
    if (status) updates.status = status;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (status === 'resolved') updates.resolvedAt = now;

    try {
      await fetch(`${RTDB_URL}/privacy_requests/${encodeURIComponent(id)}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (rtdbErr) {
      console.warn('RTDB patch notice:', rtdbErr);
    }

    return res.json({ success: true, message: 'Request updated' });
  } catch (error) {
    console.error('Admin privacy update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update request' });
  }
});

// Mount Google Drive API routes
app.use('/api/drive', driveRouter);

// API 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

// Serve synchronized public data before the dist fallback so runtime syncs are visible immediately.
app.use('/data', express.static(path.join(APP_ROOT, 'public/data')));

// Serve static files from dist
app.use(express.static(DIST_PATH, {
  index: false,
  maxAge: '1h',
}));

app.use('/assets', express.static(path.join(DIST_PATH, 'assets')));

// ============================================================================
// SPA FALLBACK - Serve index.html with dynamic Open Graph injection for frontend routes
// ============================================================================

// Must come AFTER all /api/* routes to avoid catching API calls
const distIndex = path.join(DIST_PATH, 'index.html');

// Helper for executing SSR and injecting into HTML template
function executeSsr(req, res, indexPath, appRoot) {
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('dist/index.html not found');
  }
  try {
    const rawHtml = fs.readFileSync(indexPath, 'utf-8');
    const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const baseUrl = process.env.APP_URL || (host.includes('localhost') ? `${proto}://${host}` : `https://${host}`);
    const pageResult = renderUniversalPage(req.path, baseUrl, appRoot);
    const injectedHtml = injectSsrIntoTemplate(rawHtml, pageResult);
    return res.status(pageResult.status).set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': pageResult.status === 200 ? 'public, max-age=300, stale-while-revalidate=86400' : 'no-cache, no-store, must-revalidate'
    }).send(injectedHtml);
  } catch (err) {
    const requestId = `ssr_prod_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    console.error(`[SSR_ERROR] RequestID=${requestId} Route=${req.path} Error:`, err?.stack || err?.message || err);
    const errorHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Temporarily Unavailable | India Cyber Cafe</title>
    <link rel="icon" type="image/png" href="https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png" />
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
      .card { max-width: 540px; width: 100%; text-align: center; background: #ffffff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
      h1 { font-size: 26px; font-weight: 800; color: #0f172a; margin: 16px 0 10px; }
      p { color: #64748b; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
      .btn { display: inline-block; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none; }
      .btn-primary { background: #FF9933; color: #ffffff; }
      .btn-secondary { background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; }
      .ref { margin-top: 28px; font-size: 11px; color: #94a3b8; font-family: monospace; }
    </style>
  </head>
  <body>
    <div class="card">
      <img src="https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png" alt="India Cyber Cafe" width="60" height="60" style="margin: 0 auto;" />
      <h1>Temporarily Unavailable</h1>
      <p>We encountered an issue preparing this page. Our technical team has been notified. You can return to our homepage or explore our catalog of services.</p>
      <div class="actions">
        <a href="/" class="btn btn-primary">Return to Home</a>
        <a href="/services" class="btn btn-secondary">Browse Services</a>
        <a href="/contact" class="btn btn-secondary">Contact Support</a>
      </div>
      <div class="ref">Request ID: ${requestId}</div>
    </div>
  </body>
</html>`;
    return res.status(500).set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    }).send(errorHtml);
  }
}

// Explicit Homepage Route - Guarantees root request "/" reaches authoritative SSR renderer
app.get('/', (req, res) => {
  return executeSsr(req, res, distIndex, APP_ROOT);
});

app.get(/^\/(?!api\/|data\/|assets\/|manifest\.json$|robots\.txt$|sitemap\.xml$|favicon\.?\w*$).*/, (req, res, next) => {
  // Don't catch API routes
  if (req.path.startsWith('/api/') || req.path.startsWith('/data/') || req.path.startsWith('/assets/')) {
    return next();
  }

  const ua = req.get('user-agent') || '';
  const isCrawler = isSocialCrawler(ua);
  const isPageRequest = isCrawler || req.accepts('html') || !req.path.includes('.');

  if (isPageRequest) {
    return executeSsr(req, res, distIndex, APP_ROOT);
  }

  next();
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((error, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.type === 'entity.parse.failed' ? 'Invalid JSON request body' : 'Internal server error'
    });
  }
  next(error);
});

// ============================================================================
// START SERVER
// ============================================================================

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Bind address: 0.0.0.0`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[SERVER] Port ${PORT} is already in use. Stop the stale process or set PORT to a free port.`);
  } else {
    console.error('[SERVER] Failed to start server:', error);
  }
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error);
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
  process.exit(1);
});
