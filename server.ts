import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { syncAllPublicJson, syncDataType, initializePublicDataOnStartup } from "./src/server/dataSyncRuntime.js";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
    ? process.cwd()
    : path.resolve(process.cwd(), '..');
  const DIST_PATH = path.join(APP_ROOT, 'dist');

  // Initialize public data on startup (non-blocking)
  // This ensures JSON files exist or are created before the app starts handling requests
  initializePublicDataOnStartup().catch(err => {
    console.error("[DATA SYNC] Startup initialization error (non-fatal):", err);
    // App continues to run; Firebase fallback will be used
  });

  // Trust proxy for correct protocol and host detection behind proxies
  app.set('trust proxy', true);

  app.use(express.json());

  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
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
    next();
  });

  // Email Configuration
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.hostinger.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false, // Use false for STARTTLS (port 587)
    auth: {
      user: process.env.SMTP_USER || "icc@indiacybercafe.com",
      pass: process.env.SMTP_PASS || "Ankit9977498131@@@",
    },
    tls: {
      rejectUnauthorized: false // Helps with some mail server certificate issues
    }
  });

  // API Route for sending emails
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, text, html } = req.body;

    const smtpUser = process.env.SMTP_USER || "icc@indiacybercafe.com";
    const smtpPass = process.env.SMTP_PASS || "Ankit9977498131@@@";

    if (!smtpUser || !smtpPass) {
      console.warn("SMTP credentials missing. Email not sent.");
      return res.status(200).json({ success: true, message: "Email simulation: Credentials missing" });
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
    } catch (error: any) {
      console.error("Email error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Sitemap and Robots.txt
  app.get("/robots.txt", (req, res) => {
    let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
    if (!baseUrl) {
      const protocol = req.protocol;
      const host = req.get('host');
      baseUrl = `${protocol}://${host}`;
    }
    res.type("text/plain");
    res.send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml`);
  });

  const getSitemapBaseUrl = (req: any) => {
    let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
    if (!baseUrl) baseUrl = `${req.protocol}://${req.get('host')}`;
    return baseUrl;
  };

  const escapeSitemapXml = (value: unknown) => String(value).replace(/[<>&'\"]/g, character => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  }[character] || character));

  const loadSitemapData = async () => {
    const databaseURL = "https://india-cyber-cafe-default-rtdb.firebaseio.com";
    const localFiles: Record<string, string> = {
      services: 'services.json',
      productCategories: 'product-categories.json',
      products: 'products.json'
    };
    const readCollection = async (name: string): Promise<any[]> => {
      let remoteItems: any[] = [];
      try {
        const response = await fetch(`${databaseURL}/${name}.json`);
        if (response.ok) {
          const data = await response.json();
          remoteItems = data ? (Array.isArray(data) ? data : Object.values(data)) : [];
        }
      } catch (error) {
        console.error(`Error fetching ${name} for sitemap:`, error);
      }
      try {
        const localData = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'public/data', localFiles[name]), 'utf8'));
        const localItems = localData?.[name === 'productCategories' ? 'categories' : name] || [];
        const merged = new Map([...localItems, ...remoteItems].filter(item => item?.id).map(item => [item.id, item]));
        return [...merged.values()];
      } catch (error) {
        return remoteItems;
      }
    };
    const [services, productCategories, products] = await Promise.all([
      readCollection('services'),
      readCollection('productCategories'),
      readCollection('products')
    ]);
    return { services, productCategories, products };
  };

  const createSitemapXml = (urls: Array<{ url: string; priority?: string }>) => {
    const today = new Date().toISOString().split('T')[0];
    const entries = urls.map(({ url, priority = '0.8' }) => `  <url>\n    <loc>${escapeSitemapXml(url)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${priority}</priority>\n  </url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
  };

  const slugifySitemap = (text: string) => text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

  app.get("/sitemap.xml", (req, res) => {
    const baseUrl = getSitemapBaseUrl(req);
    const sitemapNames = ['page-sitemap.xml', 'service-sitemap.xml', 'subservice-sitemap.xml', 'product-sitemap.xml'];
    const entries = sitemapNames.map(name => `  <sitemap>\n    <loc>${escapeSitemapXml(`${baseUrl}/${name}`)}</loc>\n    <lastmod>${new Date().toISOString()}</lastmod>\n  </sitemap>`).join('\n');
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`);
  });

  app.get("/page-sitemap.xml", (req, res) => {
    const baseUrl = getSitemapBaseUrl(req);
    const pages = ['', '/services', '/store', '/price-list', '/track', '/profile', '/about', '/contact', '/legal/terms', '/legal/privacy', '/legal/refund'];
    res.type("application/xml").send(createSitemapXml(pages.map(url => ({ url: `${baseUrl}${url}`, priority: url === '' ? '1.0' : '0.8' }))));
  });

  app.get("/service-sitemap.xml", async (req, res) => {
    const baseUrl = getSitemapBaseUrl(req);
    const { services } = await loadSitemapData();
    const urls = services.filter(service => service && service.id).map(service => ({ url: `${baseUrl}/services/${encodeURIComponent(service.id)}`, priority: '0.7' }));
    res.type("application/xml").send(createSitemapXml(urls));
  });

  app.get("/subservice-sitemap.xml", async (req, res) => {
    const baseUrl = getSitemapBaseUrl(req);
    const { services } = await loadSitemapData();
    const urls = services.flatMap(service => (service?.subservices || []).filter((ss: any) => ss && ss.name).map((ss: any) => ({
      url: `${baseUrl}/services/${encodeURIComponent(service.id)}/${slugifySitemap(ss.name)}`,
      priority: '0.6'
    })));
    res.type("application/xml").send(createSitemapXml(urls));
  });

  app.get("/product-sitemap.xml", async (req, res) => {
    const baseUrl = getSitemapBaseUrl(req);
    const { productCategories, products } = await loadSitemapData();
    const categoryUrls = productCategories.filter(category => category && category.id).map(category => ({ url: `${baseUrl}/store/${encodeURIComponent(category.id)}`, priority: '0.7' }));
    const productUrls = products.filter(product => product && product.id && product.category).map(product => ({
      url: `${baseUrl}/store/${encodeURIComponent(product.category)}/${encodeURIComponent(product.id)}`,
      priority: '0.6'
    }));
    res.type("application/xml").send(createSitemapXml([...categoryUrls, ...productUrls]));
  });

  // Razorpay Order Creation Endpoint
  app.post("/api/create-razorpay-order", async (req, res) => {
    try {
      const { amount, currency = 'INR', receipt, notes = {} } = req.body;

      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: "Amount must be a positive integer in paise"
        });
      }

      if (currency !== 'INR' || (receipt !== undefined && typeof receipt !== 'string') || typeof notes !== 'object' || notes === null || Array.isArray(notes)) {
        return res.status(400).json({
          success: false,
          error: "Invalid order details"
        });
      }

      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;

      if (!keyId || !keySecret) {
        console.error("Razorpay keys not configured");
        return res.status(500).json({
          error: "Payment gateway not configured"
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
            amount: amount, // in paisa
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
      } catch (apiError: any) {
        console.error('❌ Error calling Razorpay API:', apiError);
        return res.status(500).json({
          error: apiError.message || 'Failed to create order'
        });
      }
    } catch (error: any) {
      console.error("Order creation error:", error);
      res.status(500).json({
        error: error.message || "Failed to create order"
      });
    }
  });

  // Razorpay Payment Verification Endpoint
  app.post("/api/verify-razorpay-payment", (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({
          verified: false,
          error: "Missing required payment verification data"
        });
      }

      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (!keySecret) {
        console.error("RAZORPAY_KEY_SECRET is not configured");
        return res.status(500).json({
          verified: false,
          error: "Payment verification not configured"
        });
      }

      // Create HMAC-SHA256 signature
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(body)
        .digest("hex");

      const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
      const receivedSignatureBuffer = Buffer.from(razorpay_signature, "utf8");
      const isSignatureValid = expectedSignatureBuffer.length === receivedSignatureBuffer.length &&
        crypto.timingSafeEqual(expectedSignatureBuffer, receivedSignatureBuffer);

      if (isSignatureValid) {
        console.log(`✅ Payment verified - Order: ${razorpay_order_id}, Payment ID: ${razorpay_payment_id}`);
        res.json({
          verified: true,
          message: "Payment successfully verified"
        });
      } else {
        console.warn(`❌ Invalid payment signature - Order: ${razorpay_order_id}, Payment ID: ${razorpay_payment_id}`);
        res.status(400).json({
          verified: false,
          error: "Invalid payment signature"
        });
      }
    } catch (error: any) {
      console.error("Payment verification error:", error);
      res.status(500).json({
        verified: false,
        error: error.message || "Failed to verify payment"
      });
    }
  });

  // JSON Data Sync Endpoints
  // Endpoint for manual/scheduled sync (admin only in production)
  app.post("/api/sync-data", async (req, res) => {
    try {
      console.log("[DATA SYNC] Manual sync triggered from API");
      const result = await syncAllPublicJson();
      
      if (result.success) {
        res.json({
          success: true,
          message: "Data synchronization completed",
          results: result.results,
        });
      } else {
        res.status(202).json({
          success: false,
          message: "Synchronization completed with errors",
          results: result.results,
        });
      }
    } catch (error: any) {
      console.error("[DATA SYNC] Error in sync endpoint:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Endpoint for syncing specific data type
  // Used by admin CRUD operations (internal use)
  app.post("/api/sync-data/:type", async (req, res) => {
    try {
      const { type } = req.params;
      
      if (!['services', 'products', 'categories'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: "Invalid sync type",
        });
      }

      console.log(`[DATA SYNC] Sync triggered for type: ${type}`);
      const result = await syncDataType(type as 'services' | 'products' | 'categories');
      
      if (result.success) {
        res.json({
          success: true,
          message: `${type} synchronized`,
          result,
        });
      } else {
        res.status(202).json({
          success: false,
          message: `Failed to sync ${type}`,
          result,
        });
      }
    } catch (error: any) {
      console.error(`[DATA SYNC] Error syncing ${req.params.type}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: 'API endpoint not found' });
  });

  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api/')) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.type === 'entity.parse.failed' ? 'Invalid JSON request body' : 'Internal server error'
      });
    }
    next(error);
  });

  // Health check endpoint includes sync status
  app.get("/api/health", (req, res) => {
    const dataDir = path.join(APP_ROOT, 'public/data');
    const hasPublicData = 
      fs.existsSync(path.join(dataDir, 'services.json')) &&
      fs.existsSync(path.join(dataDir, 'products.json')) &&
      fs.existsSync(path.join(dataDir, 'product-categories.json'));

    res.json({ 
      status: "ok",
      publicDataAvailable: hasPublicData,
      timestamp: new Date().toISOString(),
    });
  });

  // Vite middleware for development; use the built app whenever dist exists.
  const distIndex = path.join(DIST_PATH, 'index.html');
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(distIndex);

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_PATH, {
      index: false,
      extensions: ['html'],
      maxAge: '1h',
    }));

    app.use('/assets', express.static(path.join(DIST_PATH, 'assets')));
    app.use('/data', express.static(path.join(DIST_PATH, 'data')));

    app.get(/^\/(?!api\/|data\/|assets\/|manifest\.json$|robots\.txt$|sitemap\.xml$|favicon\.?\w*$).*/, (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/data/') || req.path.startsWith('/assets/')) {
        return next();
      }

      if (req.accepts('html')) {
        return res.sendFile(distIndex);
      }

      next();
    });

    app.get('/robots.txt', (req, res) => {
      res.sendFile(path.join(DIST_PATH, 'robots.txt'));
    });

    app.get('/sitemap.xml', (req, res) => {
      res.sendFile(path.join(DIST_PATH, 'sitemap.xml'));
    });

    app.get('/manifest.json', (req, res) => {
      res.sendFile(path.join(DIST_PATH, 'manifest.json'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `[SERVER] Port ${PORT} is already in use. Stop the stale process or set PORT to a free port.`
      );
    } else {
      console.error("[SERVER] Failed to start server:", error);
    }
    process.exit(1);
  });
}

startServer();
