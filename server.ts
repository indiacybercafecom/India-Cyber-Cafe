import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { syncAllPublicJson, syncDataType, initializePublicDataOnStartup } from "./src/server/dataSyncRuntime.js";
import { getMetadataForUrl, injectOpenGraphMetadata, isSocialCrawler } from "./src/server/shareMetadata.js";

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
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
        "worker-src 'self' blob: data:; " +
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
          "https://cdn.jsdelivr.net " +
          "https://www.google-analytics.com " +
          "https://region1.google-analytics.com " +
          "https://*.razorpay.com " +
          "wss://*.razorpay.com " +
          "blob: " +
          "data:; " +
        "frame-src 'self' " +
          "https://*.razorpay.com " +
          "https://*.firebaseapp.com " +
          "https://accounts.google.com " +
          "https://*.firebaseio.com " +
          "https://docs.google.com " +
          "https://drive.google.com"
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
      pass: process.env.SMTP_PASS || "",
    },
    tls: {
      rejectUnauthorized: false // Helps with some mail server certificate issues
    }
  });

  // API Route for sending emails
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, text, html } = req.body;

    const smtpUser = process.env.SMTP_USER || "";
    const smtpPass = process.env.SMTP_PASS || "";

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

  app.options("/api/pdf-proxy", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.sendStatus(204);
  });

  app.get("/api/pdf-proxy", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    const source = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!source) return res.status(400).json({ success: false, error: "PDF URL is required" });

    try {
      const publicDir = path.join(APP_ROOT, 'public');

      // Helper to serve local file safely
      const serveLocalPath = (relPath: string) => {
        const safePath = path.resolve(publicDir, relPath.replace(/^\/+/, ''));
        if (!safePath.startsWith(publicDir)) {
          return res.status(403).json({ success: false, error: "Access denied" });
        }
        if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
          const bytes = fs.readFileSync(safePath);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Length", bytes.length.toString());
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
          return res.send(bytes);
        }
        return null;
      };

      // 1. Direct local file support: /documents/..., /data/..., etc.
      if (source.startsWith('/')) {
        const served = serveLocalPath(source);
        if (served) return;
        return res.status(404).json({ success: false, error: "Local document not found" });
      }

      // Check if URL points to self domain or localhost with local documents path
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(source);
      } catch {
        return res.status(400).json({ success: false, error: "Invalid PDF URL format" });
      }

      if (parsedUrl.pathname.startsWith('/documents/')) {
        const served = serveLocalPath(parsedUrl.pathname);
        if (served) return;
      }

      if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
        return res.status(400).json({ success: false, error: "Only HTTPS PDF URLs are supported" });
      }

      // 2. Google Drive Support with fallback and confirmation handling
      const driveMatch = source.match(/drive\.google\.com\/(?:file\/d\/|open\?[^#]*\bid=|uc\?[^#]*\bid=)([a-zA-Z0-9_-]+)/i) || source.match(/[?&]id=([a-zA-Z0-9_-]+)/i);

      let targetUrls: string[] = [source];
      if (/drive\.google\.com/i.test(source) && driveMatch?.[1]) {
        const fileId = driveMatch[1];
        targetUrls = [
          `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`,
          `https://docs.google.com/uc?export=download&id=${fileId}&confirm=t`,
          source
        ];
      }

      let pdfBuffer: Buffer | null = null;
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
        } catch (fetchErr: any) {
          console.warn(`[pdf-proxy] Target attempt failed (${targetUrl}):`, fetchErr.message);
        }
      }

      if (!pdfBuffer) {
        return res.status(lastStatus).json({
          success: false,
          error: "Unable to retrieve valid PDF document from source",
        });
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", pdfBuffer.length.toString());
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      return res.send(pdfBuffer);
    } catch (error: any) {
      console.error("PDF proxy error:", error.message);
      return res.status(502).json({ success: false, error: "Unable to fetch PDF" });
    }
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

  const sitemapCacheTtlMs = 5 * 60 * 1000;
  let sitemapDataCache: { expiresAt: number; data: { services: any[]; productCategories: any[]; products: any[] } } | null = null;

  const loadSitemapData = async () => {
    if (sitemapDataCache && sitemapDataCache.expiresAt > Date.now()) {
      return sitemapDataCache.data;
    }

    const databaseURL = "https://india-cyber-cafe-default-rtdb.firebaseio.com";
    const localFiles: Record<string, string> = {
      services: 'services.json',
      productCategories: 'product-categories.json',
      products: 'products.json'
    };
    const readCollection = async (name: string): Promise<any[]> => {
      let remoteItems: any[] = [];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(`${databaseURL}/${name}.json`, { signal: controller.signal });
        clearTimeout(timeout);
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
    const data = { services, productCategories, products };
    sitemapDataCache = { data, expiresAt: Date.now() + sitemapCacheTtlMs };
    return data;
  };

  const createSitemapXml = (urls: Array<{ url: string; priority?: string }>) => {
    const today = new Date().toISOString().split('T')[0];
    const entries = urls.map(({ url, priority = '0.8' }) => `  <url>\n    <loc>${escapeSitemapXml(url)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${priority}</priority>\n  </url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
  };

  const slugifySitemap = (text: string) => text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

  app.get("/sitemap.xml", async (req, res) => {
    try {
      const baseUrl = getSitemapBaseUrl(req);
      const { services, productCategories, products } = await loadSitemapData();
      const staticPages = ['', '/services', '/store', '/price-list', '/forms-documents', '/about', '/contact', '/legal/terms', '/legal/privacy', '/legal/refund', '/legal/disclaimer'];
      const pageUrls = staticPages.map(url => ({ url: `${baseUrl}${url}`, priority: url === '' ? '1.0' : '0.8' }));
      const serviceUrls = services.filter(service => service?.id).map(service => ({ url: `${baseUrl}/services/${encodeURIComponent(service.id)}`, priority: '0.7' }));
      const subserviceUrls = services.flatMap(service => (service?.subservices || []).filter((subservice: any) => subservice?.name).map((subservice: any) => ({ url: `${baseUrl}/services/${encodeURIComponent(service.id)}/${slugifySitemap(subservice.name)}`, priority: '0.6' })));
      const categoryUrls = productCategories.filter(category => category?.id).map(category => ({ url: `${baseUrl}/store/${encodeURIComponent(category.id)}`, priority: '0.7' }));
      const productUrls = products.filter(product => product?.id && product?.category).map(product => ({ url: `${baseUrl}/store/${encodeURIComponent(product.category)}/${encodeURIComponent(product.id)}`, priority: '0.6' }));
      res.type("application/xml").send(createSitemapXml([...pageUrls, ...serviceUrls, ...subserviceUrls, ...categoryUrls, ...productUrls]));
    } catch (error) {
      console.error("Sitemap generation error:", error);
      res.type("application/xml").send(createSitemapXml([]));
    }
  });

  app.get("/page-sitemap.xml", (req, res) => {
    const baseUrl = getSitemapBaseUrl(req);
    const pages = ['', '/services', '/store', '/price-list', '/forms-documents', '/about', '/contact', '/legal/terms', '/legal/privacy', '/legal/refund', '/legal/disclaimer'];
    res.type("application/xml").send(createSitemapXml(pages.map(url => ({ url: `${baseUrl}${url}`, priority: url === '' ? '1.0' : '0.8' }))));
  });

  app.get("/service-sitemap.xml", async (req, res) => {
    try {
      const baseUrl = getSitemapBaseUrl(req);
      const { services } = await loadSitemapData();
      const urls = services.filter(service => service && service.id).map(service => ({ url: `${baseUrl}/services/${encodeURIComponent(service.id)}`, priority: '0.7' }));
      res.type("application/xml").send(createSitemapXml(urls));
    } catch (error) {
      console.error("Service sitemap generation error:", error);
      res.type("application/xml").send(createSitemapXml([]));
    }
  });

  app.get("/subservice-sitemap.xml", async (req, res) => {
    try {
      const baseUrl = getSitemapBaseUrl(req);
      const { services } = await loadSitemapData();
      const urls = services.flatMap(service => (service?.subservices || []).filter((ss: any) => ss && ss.name).map((ss: any) => ({
        url: `${baseUrl}/services/${encodeURIComponent(service.id)}/${slugifySitemap(ss.name)}`,
        priority: '0.6'
      })));
      res.type("application/xml").send(createSitemapXml(urls));
    } catch (error) {
      console.error("Subservice sitemap generation error:", error);
      res.type("application/xml").send(createSitemapXml([]));
    }
  });

  app.get("/product-sitemap.xml", async (req, res) => {
    try {
      const baseUrl = getSitemapBaseUrl(req);
      const { productCategories, products } = await loadSitemapData();
      const categoryUrls = productCategories.filter(category => category && category.id).map(category => ({ url: `${baseUrl}/store/${encodeURIComponent(category.id)}`, priority: '0.7' }));
      const productUrls = products.filter(product => product && product.id && product.category).map(product => ({
        url: `${baseUrl}/store/${encodeURIComponent(product.category)}/${encodeURIComponent(product.id)}`,
        priority: '0.6'
      }));
      res.type("application/xml").send(createSitemapXml([...categoryUrls, ...productUrls]));
    } catch (error) {
      console.error("Product sitemap generation error:", error);
      res.type("application/xml").send(createSitemapXml([]));
    }
  });

  // Helper function to validate and convert amount to exact integer paise
  function validateAndParsePayAmount(rawAmount: any): { valid: boolean; paise: number; error?: string } {
    if (rawAmount === undefined || rawAmount === null || typeof rawAmount === 'boolean') {
      return { valid: false, paise: 0, error: "Payment amount is required" };
    }
    const amountStr = String(rawAmount).trim();
    // Validate: only numbers with maximum 2 decimal places allowed
    if (!/^\d+(\.\d{1,2})?$/.test(amountStr)) {
      return { valid: false, paise: 0, error: "Invalid payment amount. Must be a positive number with at most 2 decimal places" };
    }
    const [rupeesPart, decimalPart = ''] = amountStr.split('.');
    const rupees = parseInt(rupeesPart, 10);
    if (!Number.isSafeInteger(rupees)) {
      return { valid: false, paise: 0, error: "Amount exceeds maximum supported value" };
    }
    const paise = parseInt(decimalPart.padEnd(2, '0').slice(0, 2), 10);
    const totalPaise = rupees * 100 + paise;

    const MIN_PAISE = 100; // ₹1.00
    const MAX_PAISE = 10000000; // ₹1,00,000.00 (1 Lakh INR limit)

    if (totalPaise < MIN_PAISE) {
      return { valid: false, paise: 0, error: "Amount must be at least ₹1.00" };
    }
    if (totalPaise > MAX_PAISE) {
      return { valid: false, paise: 0, error: "Amount exceeds maximum limit of ₹1,00,000" };
    }

    return { valid: true, paise: totalPaise };
  }

  // Pay-by-Link Order Creation Endpoint (Secure Server-Side Validation)
  app.post("/api/pay-link/create-order", async (req, res) => {
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
        console.error("Razorpay keys not configured");
        return res.status(500).json({
          success: false,
          error: "Payment gateway is not configured"
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
    } catch (error: any) {
      console.error("Pay-Link order creation error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to create payment order"
      });
    }
  });

  // Pay-by-Link Server-side Payment Verification & Recording Endpoint
  app.post("/api/pay-link/verify", async (req, res) => {
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

      // Compute and verify HMAC-SHA256 signature
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(body)
        .digest("hex");

      const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
      const receivedSignatureBuffer = Buffer.from(razorpay_signature, "utf8");
      const isSignatureValid = expectedSignatureBuffer.length === receivedSignatureBuffer.length &&
        crypto.timingSafeEqual(expectedSignatureBuffer, receivedSignatureBuffer);

      if (!isSignatureValid) {
        console.warn(`❌ Invalid payment signature - Order: ${razorpay_order_id}, Payment ID: ${razorpay_payment_id}`);
        return res.status(400).json({
          verified: false,
          error: "Invalid payment signature"
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
        currency: "INR",
        status: "completed",
        reference: finalRef,
        receiptId: receiptId || razorpay_order_id,
        type: "pay_link",
        created_at: createdAt,
        createdAt: createdAt
      };

      // Persist verified transaction record to Firebase RTDB
      try {
        const databaseURL = "https://india-cyber-cafe-default-rtdb.firebaseio.com";
        await fetch(`${databaseURL}/payments.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(paymentRecord)
        });
      } catch (dbError) {
        console.error("Failed to record payment in RTDB from server:", dbError);
      }

      return res.json({
        verified: true,
        message: "Payment successfully verified",
        record: paymentRecord
      });
    } catch (error: any) {
      console.error("Pay link verification error:", error);
      res.status(500).json({
        verified: false,
        error: error.message || "Payment verification failed"
      });
    }
  });

  // Razorpay Order Creation Endpoint
  app.post("/api/create-razorpay-order", async (req, res) => {
    try {
      const { amount, currency = 'INR', receipt, notes = {} } = req.body;

      if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) {
        return res.status(400).json({
          success: false,
          error: "Amount must be a positive integer in paise (max ₹1,00,000)"
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
      
      if (!['services', 'products', 'categories', 'documents', 'documentCategories'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: "Invalid sync type",
        });
      }

      console.log(`[DATA SYNC] Sync triggered for type: ${type}`);
      const authHeader = req.headers.authorization;
      const firebaseToken = authHeader?.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : undefined;
      const result = await syncDataType(type as 'services' | 'products' | 'categories' | 'documents' | 'documentCategories', firebaseToken);
      
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

  // Dynamic Open Graph metadata API endpoint
  app.get('/api/share-meta', (req, res) => {
    const targetPath = (req.query.path as string) || '/';
    const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const baseUrl = process.env.APP_URL || `${proto}://${host}`;
    const meta = getMetadataForUrl(targetPath, baseUrl, APP_ROOT);
    res.json({ success: true, metadata: meta });
  });

  // --- Privacy & Grievance Request Management ---
  const RTDB_URL = "https://india-cyber-cafe-default-rtdb.firebaseio.com";
  const PRIVACY_STORE_PATH = path.join(APP_ROOT, 'data/privacy_requests.json');

  const readLocalPrivacyRequests = (): Record<string, any> => {
    try {
      if (fs.existsSync(PRIVACY_STORE_PATH)) {
        const raw = fs.readFileSync(PRIVACY_STORE_PATH, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn("Could not read local privacy store:", err);
    }
    return {};
  };

  const saveLocalPrivacyRequest = (record: any) => {
    try {
      const dataDir = path.dirname(PRIVACY_STORE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const existing = readLocalPrivacyRequests();
      existing[record.id] = record;
      fs.writeFileSync(PRIVACY_STORE_PATH, JSON.stringify(existing, null, 2), 'utf-8');
    } catch (err) {
      console.error("Failed to write to local privacy store:", err);
    }
  };

  // Public submission of privacy request or grievance
  app.post("/api/privacy-requests", async (req, res) => {
    try {
      const { category, name, email, phone, referenceId, description } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: "Name is required" });
      }
      if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ success: false, error: "Valid email address is required" });
      }
      if (!description || typeof description !== 'string' || description.trim().length < 10) {
        return res.status(400).json({ success: false, error: "Please provide a detailed description (minimum 10 characters)" });
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

      // Always persist to local secure data store
      saveLocalPrivacyRequest(privacyRecord);

      // Attempt to save to Firebase RTDB if possible
      try {
        await fetch(`${RTDB_URL}/privacy_requests/${ticketId}.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(privacyRecord)
        });
      } catch (dbErr) {
        console.warn("RTDB write notice:", dbErr);
      }

      // Send confirmation email to user & admin if transporter is configured
      try {
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
          await transporter.sendMail({
            from: `"India Cyber Cafe Grievance Cell" <${process.env.SMTP_USER}>`,
            to: privacyRecord.email,
            subject: `[${ticketId}] Acknowledgment: Privacy & Grievance Request`,
            text: `Dear ${privacyRecord.name},\n\nWe have received your privacy request (Ticket ID: ${ticketId}).\nCategory: ${selectedCategory}\n\nOur Grievance Redressal Officer will review your request and acknowledge within 48 hours, with resolution within 15 to 30 days as per Consumer Protection (E-Commerce) Rules and DPDP Act provisions.\n\nYou can track your request at: https://b.indiacybercafe.com/privacy-request/track\n\nRegards,\nGrievance Officer\nIndia Cyber Cafe\nSingrauli, MP, India\nContact: icc@indiacybercafe.com | +91 9203251821`,
          }).catch(err => console.warn("Privacy ack email error:", err.message));

          await transporter.sendMail({
            from: `"India Cyber Cafe Portal" <${process.env.SMTP_USER}>`,
            to: "icc@indiacybercafe.com",
            subject: `🔔 New Privacy Request [${ticketId}] - ${privacyRecord.name}`,
            text: `A new privacy request has been submitted:\nTicket ID: ${ticketId}\nCategory: ${selectedCategory}\nName: ${privacyRecord.name}\nEmail: ${privacyRecord.email}\nPhone: ${privacyRecord.phone || 'N/A'}\nReference: ${privacyRecord.referenceId || 'N/A'}\n\nDescription:\n${privacyRecord.description}\n\nReview in Admin Portal: https://b.indiacybercafe.com/admin/privacy-requests`,
          }).catch(err => console.warn("Admin privacy alert email error:", err.message));
        }
      } catch (mailErr) {
        console.warn("Mail dispatch failed:", mailErr);
      }

      return res.json({
        success: true,
        ticketId,
        message: "Your request has been recorded. An acknowledgment has been generated.",
        request: privacyRecord
      });
    } catch (error: any) {
      console.error("Privacy request submission error:", error);
      res.status(500).json({ success: false, error: "Failed to process privacy request" });
    }
  });

  // Track privacy request by ticket ID and email
  app.post("/api/privacy-requests/track", async (req, res) => {
    try {
      const { ticketId, email } = req.body;
      if (!ticketId || typeof ticketId !== 'string') {
        return res.status(400).json({ success: false, error: "Ticket ID is required" });
      }
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ success: false, error: "Verification email is required" });
      }

      const cleanTicket = ticketId.trim();
      const cleanEmail = email.trim().toLowerCase();

      // Check local store first
      const localStore = readLocalPrivacyRequests();
      let record = localStore[cleanTicket];

      // If not in local store, attempt RTDB fetch
      if (!record) {
        try {
          const rtdbResp = await fetch(`${RTDB_URL}/privacy_requests/${encodeURIComponent(cleanTicket)}.json`);
          if (rtdbResp.ok) {
            record = await rtdbResp.json();
          }
        } catch (rtdbErr) {
          console.warn("RTDB fetch notice:", rtdbErr);
        }
      }

      if (!record || !record.id) {
        return res.status(404).json({ success: false, error: "No privacy request found matching this Ticket ID" });
      }

      if (record.email?.toLowerCase().trim() !== cleanEmail) {
        return res.status(403).json({ success: false, error: "Email address does not match the record on file" });
      }

      return res.json({ success: true, request: record });
    } catch (error: any) {
      console.error("Privacy tracking error:", error);
      res.status(500).json({ success: false, error: "Failed to retrieve status" });
    }
  });

  // Admin: List all privacy requests
  app.get("/api/admin/privacy-requests", async (req, res) => {
    try {
      const localStore = readLocalPrivacyRequests();
      const combined: Record<string, any> = { ...localStore };

      try {
        const rtdbResp = await fetch(`${RTDB_URL}/privacy_requests.json`);
        if (rtdbResp.ok) {
          const data = await rtdbResp.json();
          if (data && typeof data === 'object') {
            Object.assign(combined, data);
          }
        }
      } catch (rtdbErr) {
        console.warn("RTDB list notice:", rtdbErr);
      }

      const requests = Object.values(combined).sort((a: any, b: any) => 
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      return res.json({ success: true, requests });
    } catch (error: any) {
      console.error("Admin privacy fetch error:", error);
      res.status(500).json({ success: false, error: "Failed to load privacy requests" });
    }
  });

  // Admin: Update privacy request status
  app.patch("/api/admin/privacy-requests/:id", async (req, res) => {
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

      const updates: Record<string, any> = {
        updatedAt: now,
      };
      if (status) updates.status = status;
      if (adminNotes !== undefined) updates.adminNotes = adminNotes;
      if (status === 'resolved') updates.resolvedAt = now;

      try {
        await fetch(`${RTDB_URL}/privacy_requests/${encodeURIComponent(id)}.json`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates)
        });
      } catch (rtdbErr) {
        console.warn("RTDB patch notice:", rtdbErr);
      }

      return res.json({ success: true, message: "Request updated" });
    } catch (error: any) {
      console.error("Admin privacy update error:", error);
      res.status(500).json({ success: false, error: "Failed to update request" });
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
      fs.existsSync(path.join(dataDir, 'product-categories.json')) &&
      fs.existsSync(path.join(dataDir, 'documents.json')) &&
      fs.existsSync(path.join(dataDir, 'document-categories.json'));

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

    // In development: intercept HTML page requests to dynamically inject Open Graph tags
    app.get(/^\/(?!api\/|data\/|assets\/|@|node_modules\/|src\/|manifest\.json$|robots\.txt$|sitemap\.xml$|favicon\.?\w*$).*/, async (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/data/') || req.path.startsWith('/assets/')) {
        return next();
      }
      const ua = req.get('user-agent') || '';
      const isCrawler = isSocialCrawler(ua);
      const isPageRequest = isCrawler || req.accepts('html') || !req.path.includes('.');
      if (!isPageRequest) {
        return next();
      }
      try {
        const indexPath = path.join(APP_ROOT, 'index.html');
        if (!fs.existsSync(indexPath)) return next();
        let rawHtml = fs.readFileSync(indexPath, 'utf-8');
        rawHtml = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
        const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const baseUrl = process.env.APP_URL || (host.includes('localhost') ? `${proto}://${host}` : `https://${host}`);
        const metadata = getMetadataForUrl(req.path, baseUrl, APP_ROOT);
        const injectedHtml = injectOpenGraphMetadata(rawHtml, metadata);
        return res.status(200).set({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        }).send(injectedHtml);
      } catch (err) {
        next(err);
      }
    });

    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_PATH, {
      index: false,
      extensions: ['html'],
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    }));

    app.use('/assets', express.static(path.join(DIST_PATH, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));
    app.use('/data', express.static(path.join(DIST_PATH, 'data')));

    app.get(/^\/(?!api\/|data\/|assets\/|manifest\.json$|robots\.txt$|sitemap\.xml$|favicon\.?\w*$).*/, (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/data/') || req.path.startsWith('/assets/')) {
        return next();
      }

      const ua = req.get('user-agent') || '';
      const isCrawler = isSocialCrawler(ua);
      const isPageRequest = isCrawler || req.accepts('html') || !req.path.includes('.');

      if (isPageRequest) {
        if (!fs.existsSync(distIndex)) {
          return res.status(404).send('dist/index.html not found');
        }
        try {
          const rawHtml = fs.readFileSync(distIndex, 'utf-8');
          const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
          const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
          const baseUrl = process.env.APP_URL || (host.includes('localhost') ? `${proto}://${host}` : `https://${host}`);
          const metadata = getMetadataForUrl(req.path, baseUrl, APP_ROOT);
          const injectedHtml = injectOpenGraphMetadata(rawHtml, metadata);
          return res.status(200).set({
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }).send(injectedHtml);
        } catch (err) {
          console.error('[SERVER] HTML injection error:', err);
          return res.sendFile(distIndex);
        }
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
