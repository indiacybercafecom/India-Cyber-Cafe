import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

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

// Trust proxy for correct protocol and host detection behind proxies
app.set('trust proxy', true);

// Middleware
app.use(express.json());

// Security Headers - Content Security Policy
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
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
    "img-src 'self' data: blob: https://indiacybercafe.com https://cdn-icons-png.flaticon.com https://firebasestorage.googleapis.com https://api.dicebear.com https://www.google-analytics.com https://region1.google-analytics.com https://*.razorpay.com; " +
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
      "wss://*.razorpay.com; " +
    "frame-src 'self' " +
      "https://*.razorpay.com " +
      "https://*.firebaseapp.com " +
      "https://accounts.google.com " +
      "https://*.firebaseio.com"
  );
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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
    pass: process.env.SMTP_PASS || 'Ankit9977498131@@@',
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

  res.json({
    status: 'ok',
    success: true,
    message: 'Backend is running',
    publicDataAvailable: hasPublicData,
    timestamp: new Date().toISOString(),
  });
});

// Email API Route
app.post('/api/send-email', async (req, res) => {
  const { to, subject, text, html } = req.body;

  const smtpUser = process.env.SMTP_USER || 'icc@indiacybercafe.com';
  const smtpPass = process.env.SMTP_PASS || 'Ankit9977498131@@@';

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

// Robots.txt Route
app.get('/robots.txt', (req, res) => {
  let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '';
  if (!baseUrl) {
    const protocol = req.protocol;
    const host = req.get('host');
    baseUrl = `${protocol}://${host}`;
  }
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml`);
});

// Sitemap Route
app.get('/sitemap.xml', async (req, res) => {
  let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '';

  if (!baseUrl) {
    const protocol = req.protocol;
    const host = req.get('host');
    baseUrl = `${protocol}://${host}`;
  }

  const databaseURL = 'https://india-cyber-cafe-default-rtdb.firebaseio.com';

  let services = [];
  let productCategories = [];
  let products = [];

  try {
    const response = await fetch(`${databaseURL}/services.json`);
    if (response.ok) {
      const data = await response.json();
      if (data) {
        services = Array.isArray(data) ? data : Object.values(data);
      }
    }
  } catch (error) {
    console.error('Error fetching services for sitemap:', error);
  }

  try {
    const response = await fetch(`${databaseURL}/productCategories.json`);
    if (response.ok) {
      const data = await response.json();
      if (data) {
        productCategories = Array.isArray(data) ? data : Object.values(data);
      }
    }
  } catch (error) {
    console.error('Error fetching product categories for sitemap:', error);
  }

  try {
    const response = await fetch(`${databaseURL}/products.json`);
    if (response.ok) {
      const data = await response.json();
      if (data) {
        products = Array.isArray(data) ? data : Object.values(data);
      }
    }
  } catch (error) {
    console.error('Error fetching products for sitemap:', error);
  }

  const staticPages = ['', '/services', '/store', '/track', '/profile', '/about', '/contact', '/legal/terms', '/legal/privacy', '/legal/refund'];

  const slugify = (text) => text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  const today = new Date().toISOString().split('T')[0];

  staticPages.forEach(page => {
    sitemap += `  <url>\n    <loc>${baseUrl}${page}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${page === '' ? '1.0' : '0.8'}</priority>\n  </url>\n`;
  });

  services.forEach(service => {
    if (service && service.id) {
      sitemap += `  <url>\n    <loc>${baseUrl}/services/${service.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;

      if (service.subservices && Array.isArray(service.subservices)) {
        service.subservices.forEach(ss => {
          if (ss && ss.name) {
            sitemap += `  <url>\n    <loc>${baseUrl}/services/${service.id}/${slugify(ss.name)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
          }
        });
      }
    }
  });

  productCategories.forEach(category => {
    if (category && category.id) {
      sitemap += `  <url>\n    <loc>${baseUrl}/store/${category.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
    }
  });

  products.forEach(product => {
    if (product && product.id && product.category) {
      sitemap += `  <url>\n    <loc>${baseUrl}/store/${product.category}/${product.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
    }
  });

  sitemap += `</urlset>`;
  res.type('application/xml');
  res.send(sitemap);
});

// ============================================================================
// RAZORPAY API ROUTES
// ============================================================================

// Create Razorpay Order
app.post('/api/create-razorpay-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes = {} } = req.body;

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive integer in paise'
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
// DATA SYNC ROUTES (Stub for production - can be implemented if needed)
// ============================================================================

app.post('/api/sync-data', (req, res) => {
  console.log('[DATA SYNC] Manual sync triggered from API');
  res.json({
    success: true,
    message: 'Data synchronization completed',
    results: {}
  });
});

app.post('/api/sync-data/:type', (req, res) => {
  const { type } = req.params;

  if (!['services', 'products', 'categories'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid sync type',
    });
  }

  console.log(`[DATA SYNC] Sync triggered for type: ${type}`);
  res.json({
    success: true,
    message: `${type} synchronized`,
    result: {}
  });
});

// API 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

// Serve static files from dist
app.use(express.static(DIST_PATH, {
  index: false,
  maxAge: '1h',
}));

app.use('/assets', express.static(path.join(DIST_PATH, 'assets')));
app.use('/data', express.static(path.join(DIST_PATH, 'data')));

// ============================================================================
// SPA FALLBACK - Serve index.html for frontend routes
// ============================================================================

// Must come AFTER all /api/* routes to avoid catching API calls
const distIndex = path.join(DIST_PATH, 'index.html');

app.get(/^\/(?!api\/|data\/|assets\/|manifest\.json$|robots\.txt$|sitemap\.xml$|favicon\.?\w*$).*/, (req, res, next) => {
  // Don't catch API routes
  if (req.path.startsWith('/api/') || req.path.startsWith('/data/') || req.path.startsWith('/assets/')) {
    return next();
  }

  if (req.accepts('html')) {
    if (fs.existsSync(distIndex)) {
      return res.sendFile(distIndex);
    } else {
      return res.status(404).send('dist/index.html not found');
    }
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