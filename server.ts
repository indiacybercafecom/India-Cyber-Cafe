import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { syncAllPublicJson, syncDataType, initializePublicDataOnStartup } from "./src/server/dataSyncRuntime.js";
import { getMetadataForUrl, injectOpenGraphMetadata, isSocialCrawler } from "./src/server/shareMetadata.js";
import { driveRouter } from "./src/server/driveRoutes.js";
import { renderUniversalPage, injectSsrIntoTemplate } from "./src/server/universalHtmlRenderer.js";
import { generateSitemapXml, generateRobotsTxt } from "./src/server/sitemapService.js";
import { invalidatePublicDataCache } from "./src/server/publicDataService.js";
import {
  handleCodOrder,
  handleCreatePaymentOrder,
  handleVerifyPayment,
  handleRecoverPayment,
  handleRazorpayWebhook,
  handleGetMyOrders,
  handleGuestTrackOrder,
  handleLinkGuestOrders,
  handleLookupEmail,
  handleUploadCustomImage,
  getStoreServiceHealth
} from "./src/server/storeOrderService.js";
import {
  verifyCallerWithRole,
  requireAdminMiddleware,
  handleGetOperatorApplication,
  handleOperatorUpdateApplication,
  handleOperatorUploadAttachment,
  handleGetOperatorAttachment,
  handleVerifyApplicationPayment
} from "./src/server/operatorService.js";

const resolvedRoot = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');
dotenv.config({ path: path.join(resolvedRoot, '.env'), quiet: true } as any);

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

  app.use(express.json({
    limit: '2mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));

  const customImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
  });
  const operatorAttachmentUploadMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    customImageUpload.single("file")(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File exceeds the 5 MB limit.' });
        }
        return res.status(400).json({ success: false, error: `Invalid attachment upload: ${err.message}` });
      }
      return res.status(400).json({ success: false, error: err?.message || 'Failed to parse attachment upload.' });
    });
  };
  app.use('/uploads/custom-images', express.static(path.join(APP_ROOT, 'data/uploads/custom-images')));

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

  const OFFICIAL_ADMIN_EMAILS = new Set(["icc@indiacybercafe.com", "indiacybercafe.com@gmail.com"]);
  const emailRateLimits = new Map<string, { count: number; resetTime: number }>();
  function checkEmailRateLimit(ip: string, maxRequests = 30, windowMs = 60000): boolean {
    const now = Date.now();
    const record = emailRateLimits.get(ip);
    if (!record || now > record.resetTime) {
      emailRateLimits.set(ip, { count: 1, resetTime: now + windowMs });
      return true;
    }
    if (record.count >= maxRequests) return false;
    record.count++;
    return true;
  }

  // API Route for sending emails (authorized recipient enforcement)
  app.post("/api/send-email", async (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkEmailRateLimit(clientIp, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many email requests. Please wait a moment." });
    }

    const { to, subject, text, html } = req.body || {};
    const recipients = (Array.isArray(to) ? to : String(to || '').split(','))
      .map((item: unknown) => String(item || '').trim().toLowerCase())
      .filter((item: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));

    if (recipients.length === 0 || typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ success: false, error: "Valid recipient email and subject are required" });
    }

    const caller = await verifyCallerWithRole(req);
    const isAdminCaller = Boolean(caller && !caller.disabled && caller.role === 'admin');
    if (!isAdminCaller) {
      const callerEmail = caller && !caller.disabled ? caller.email.toLowerCase().trim() : '';
      const allRecipientsAllowed = recipients.every(
        (addr: string) => OFFICIAL_ADMIN_EMAILS.has(addr) || (callerEmail && addr === callerEmail)
      );
      if (!allRecipientsAllowed) {
        return res.status(403).json({
          success: false,
          error: "Only administrators may dispatch emails to third-party recipients"
        });
      }
    }

    const smtpUser = process.env.SMTP_USER || "";
    const smtpPass = process.env.SMTP_PASS || "";

    if (!smtpUser || !smtpPass) {
      console.warn("SMTP credentials missing. Email not sent.");
      return res.status(200).json({ success: true, message: "Email simulation: Credentials missing" });
    }

    try {
      await transporter.sendMail({
        from: `"India Cyber Cafe" <${smtpUser}>`,
        to: recipients.join(', '),
        subject: subject.trim().slice(0, 200),
        text,
        html,
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Email error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  function isCrawlerRequest(req: express.Request): boolean {
    const ua = (req.get('user-agent') || '').trim();
    if (req.query?._ssr === '1') return true;
    if (!ua) return true;
    if (isSocialCrawler(ua)) return true;
    return /\b(bot|crawler|spider|slurp|mediapartners|adsbot|google-inspectiontool|googleother|storebot-google|apis-google|duplexweb-google|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|bytespider|gptbot|claudebot|perplexitybot|ccbot|lighthouse|chrome-lighthouse|pagespeed|gtmetrix|pingdom|screaming\s*frog|seobility|sitebulb|curl|wget|httpie|postmanruntime|insomnia|python-requests|python-urllib|node-fetch|undici|axios|got|go-http-client)\b/i.test(ua);
  }

  // Health check
  app.get("/api/health", async (req, res) => {
    const dataDir = path.join(APP_ROOT, 'public/data');
    const hasPublicData =
      fs.existsSync(path.join(dataDir, 'services.json')) &&
      fs.existsSync(path.join(dataDir, 'products.json')) &&
      fs.existsSync(path.join(dataDir, 'product-categories.json')) &&
      fs.existsSync(path.join(dataDir, 'documents.json')) &&
      fs.existsSync(path.join(dataDir, 'document-categories.json'));

    const forceCheck = req.query?.force === '1' || req.query?.deep === '1';
    const health = await getStoreServiceHealth({ checkConnectivity: true, force: forceCheck });

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.json({
      status: "ok",
      success: true,
      publicDataAvailable: hasPublicData,
      ...health,
      environment: process.env.NODE_ENV || 'production',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // --- Phone Lookup & Authentication Protection Endpoints ---
  const PHONE_INDEX_PATH = path.join(APP_ROOT, 'data/users_phone_index.json');

  function normalizeMobile(raw: string): { valid: boolean; normalized: string } {
    if (!raw || typeof raw !== 'string') return { valid: false, normalized: '' };
    let cleaned = raw.trim().replace(/[\s\-\(\)]/g, '');
    if (cleaned.startsWith('+91')) cleaned = cleaned.slice(3);
    else if (cleaned.startsWith('0') && cleaned.length === 11) cleaned = cleaned.slice(1);
    else if (cleaned.startsWith('91') && cleaned.length === 12) cleaned = cleaned.slice(2);
    if (!/^[6-9]\d{9}$/.test(cleaned)) return { valid: false, normalized: cleaned };
    return { valid: true, normalized: cleaned };
  }

  const phoneLookupRateLimits = new Map<string, { count: number; resetTime: number }>();
  function checkPhoneRateLimit(ip: string, maxRequests = 20, windowMs = 60000): boolean {
    const now = Date.now();
    const record = phoneLookupRateLimits.get(ip);
    if (!record || now > record.resetTime) {
      phoneLookupRateLimits.set(ip, { count: 1, resetTime: now + windowMs });
      return true;
    }
    if (record.count >= maxRequests) {
      return false;
    }
    record.count++;
    return true;
  }

  function readPhoneIndex(): Record<string, { uid?: string; email: string; isGoogleOnly?: boolean }> {
    try {
      if (fs.existsSync(PHONE_INDEX_PATH)) {
        return JSON.parse(fs.readFileSync(PHONE_INDEX_PATH, 'utf-8'));
      }
    } catch (e) {
      console.warn("Could not read phone index:", e);
    }
    return {};
  }

  function updatePhoneIndex(phone: string, data: { uid?: string; email: string; isGoogleOnly?: boolean }) {
    try {
      const current = readPhoneIndex();
      current[phone] = data;
      fs.mkdirSync(path.dirname(PHONE_INDEX_PATH), { recursive: true });
      fs.writeFileSync(PHONE_INDEX_PATH, JSON.stringify(current, null, 2), 'utf-8');
    } catch (e) {
      console.warn("Could not update phone index:", e);
    }
  }

  // Secure Phone Lookup: Returns only email & provider flag for login; zero PII leakage
  app.post("/api/auth/lookup-phone", (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkPhoneRateLimit(clientIp, 20, 60000)) {
      return res.status(429).json({ success: false, error: "Too many attempts. Please try again shortly." });
    }

    const { phone } = req.body;
    const { valid, normalized } = normalizeMobile(phone);
    if (!valid) {
      return res.status(400).json({ success: false, error: "Invalid 10-digit Indian mobile number format." });
    }

    const phoneIndex = readPhoneIndex();
    const entry = phoneIndex[normalized];
    if (entry) {
      return res.json({
        success: true,
        found: true,
        email: entry.email,
        isGoogleOnly: Boolean(entry.isGoogleOnly)
      });
    }

    return res.json({
      success: true,
      found: false
    });
  });

  // Phone Uniqueness Check for Registration and Checkout
  app.post("/api/auth/check-phone", (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkPhoneRateLimit(clientIp, 30, 60000)) {
      return res.status(429).json({ success: false, error: "Too many attempts. Please try again shortly." });
    }

    const { phone, excludeUid } = req.body;
    const { valid, normalized } = normalizeMobile(phone);
    if (!valid) {
      return res.status(400).json({ success: false, error: "Invalid 10-digit Indian mobile number format." });
    }

    const phoneIndex = readPhoneIndex();
    const entry = phoneIndex[normalized];
    if (entry && (!excludeUid || entry.uid !== excludeUid)) {
      return res.json({
        success: true,
        inUse: true,
        isGoogleOnly: Boolean(entry.isGoogleOnly)
      });
    }

    return res.json({
      success: true,
      inUse: false
    });
  });

  // Secure Phone Index Sync from Client on Profile Update or Registration
  app.post("/api/auth/sync-phone", async (req, res) => {
    const caller = await verifyCallerWithRole(req);
    if (!caller) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    if (caller.disabled) {
      return res.status(403).json({ success: false, error: "Account is disabled" });
    }

    const { phone, email, uid, isGoogleOnly } = req.body || {};
    if (uid && uid !== caller.uid && caller.role !== 'admin') {
      return res.status(403).json({ success: false, error: "Cannot sync phone for another account" });
    }

    const { valid, normalized } = normalizeMobile(phone);
    if (!valid || !email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: "Invalid parameters" });
    }

    updatePhoneIndex(normalized, {
      uid: typeof uid === 'string' && caller.role === 'admin' ? uid : caller.uid,
      email: email.trim().toLowerCase(),
      isGoogleOnly: Boolean(isGoogleOnly)
    });

    return res.json({ success: true });
  });

  // --- Trusted Operator & Application Endpoints (Server-Authoritative) ---
  app.get("/api/operator/applications/:appId", handleGetOperatorApplication);
  app.post("/api/operator/applications/:appId/update", handleOperatorUpdateApplication);
  app.post("/api/operator/applications/:appId/upload-attachment", operatorAttachmentUploadMiddleware, handleOperatorUploadAttachment);
  app.get("/api/operator/attachments/:attachmentId", handleGetOperatorAttachment);
  app.post("/api/applications/:appId/verify-payment", handleVerifyApplicationPayment);

  // --- Trusted Store Order Endpoints (Server-Authoritative, COD & Razorpay) ---
  app.post("/api/auth/lookup-email", handleLookupEmail);
  app.post("/api/store/upload-custom-image", customImageUpload.single("customImage"), handleUploadCustomImage);
  app.post("/api/store/orders/cod", handleCodOrder);
  app.post("/api/store/orders/create-payment", handleCreatePaymentOrder);
  app.post("/api/store/orders/verify-payment", handleVerifyPayment);
  app.post("/api/store/orders/recover-payment", handleRecoverPayment);
  app.post("/api/store/orders/razorpay-webhook", handleRazorpayWebhook);
  app.get("/api/store/orders/my", handleGetMyOrders);
  app.post("/api/store/orders/guest-track", handleGuestTrackOrder);
  app.post("/api/store/orders/link-guest-orders", handleLinkGuestOrders);


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
      if (req.query.download === '1' || req.query.download === 'true') {
        const downloadFilename = typeof req.query.filename === 'string' && req.query.filename.trim()
          ? req.query.filename.trim()
          : 'document.pdf';
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadFilename)}"`);
      }
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
    res.send(generateRobotsTxt(baseUrl));
  });

  app.get("/sitemap.xml", (req, res) => {
    let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
    if (!baseUrl) {
      const protocol = req.protocol;
      const host = req.get('host');
      baseUrl = `${protocol}://${host}`;
    }
    res.set({
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
    });
    res.send(generateSitemapXml(baseUrl, APP_ROOT));
  });

  app.get(["/page-sitemap.xml", "/service-sitemap.xml", "/subservice-sitemap.xml", "/product-sitemap.xml"], (req, res) => {
    let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
    if (!baseUrl) {
      const protocol = req.protocol;
      const host = req.get('host');
      baseUrl = `${protocol}://${host}`;
    }
    res.set({
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
    });
    res.send(generateSitemapXml(baseUrl, APP_ROOT));
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
        signal: AbortSignal.timeout(12000),
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
  app.post("/api/sync-data", requireAdminMiddleware, async (req, res) => {
    try {
      console.log("[DATA SYNC] Manual sync triggered from API");
      const result = await syncAllPublicJson();
      
      if (result.success) {
        invalidatePublicDataCache();
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
  app.post("/api/sync-data/:type", requireAdminMiddleware, async (req, res) => {
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
        invalidatePublicDataCache();
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

  // --- Robust Document Management & Embed Resolver ---
  // --- Robust Document Management & Embed Resolver ---
  const DOCS_STORE_PATH = path.join(APP_ROOT, 'data/documents.json');
  const PUBLIC_DOCS_PATH = path.join(APP_ROOT, 'public/data/documents.json');
  const DOC_CATS_STORE_PATH = path.join(APP_ROOT, 'data/document-categories.json');
  const PUBLIC_DOC_CATS_PATH = path.join(APP_ROOT, 'public/data/document-categories.json');

  const setNoCacheHeaders = (res: express.Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  };

  const writeJsonAtomically = (filePath: string, data: any) => {
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

  const serverSlugify = (str: string): string => {
    return (str || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const extractCoreTokens = (title: string): string[] => {
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
    ]);
    return String(title)
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 1 && !noise.has(w))
      .sort();
  };

  const getDocSignature = (title: string): string => {
    const tokens = extractCoreTokens(title);
    return tokens.length > 0 ? tokens.join('-') : serverSlugify(title);
  };

  const deduplicateServerDocs = (docs: any[]): any[] => {
    if (!Array.isArray(docs)) return [];
    const idMap = new Map<string, any>();
    const catSigMap = new Map<string, any>();
    const catSlugMap = new Map<string, any>();
    const urlMap = new Map<string, any>();

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

    const resultSet = new Set<any>([
      ...catSigMap.values(),
      ...idMap.values()
    ]);

    return Array.from(resultSet).sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  };

  const readServerDocuments = (): any[] => {
    const candidates = [PUBLIC_DOCS_PATH, DOCS_STORE_PATH, path.join(DIST_PATH, 'data/documents.json')];
    const allFound: any[] = [];
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

  const saveServerDocuments = (docs: any[]) => {
    // Firebase is the single source of truth; deduplicate and overwrite completely
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
    invalidatePublicDataCache();
  };

  const readServerDocCategories = (): any[] => {
    const targetPath = fs.existsSync(PUBLIC_DOC_CATS_PATH) ? PUBLIC_DOC_CATS_PATH : DOC_CATS_STORE_PATH;
    if (fs.existsSync(targetPath)) {
      try {
        const raw = fs.readFileSync(targetPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const cats = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.categories) ? parsed.categories : [];
        const seen = new Set<string>();
        const result: any[] = [];
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

  const saveServerDocCategories = (cats: any[]) => {
    const seen = new Set<string>();
    const deduplicated: any[] = [];
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
    invalidatePublicDataCache();
  };

  // 12-Hour Automatic Document Refresh & Background Sync Scheduler
  const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
  const run12HourDocumentSync = async () => {
    try {
      console.log(`[12-HOUR SYNC] Starting scheduled documents refresh from database at ${new Date().toISOString()}...`);
      
      // Step 1: Fetch fresh documents directly from RTDB
      let freshDocs: any[] = [];
      try {
        const rtdbResp = await fetch("https://india-cyber-cafe-default-rtdb.firebaseio.com/documents.json", {
          signal: AbortSignal.timeout(8000),
          headers: { 'Accept': 'application/json' }
        });
        if (rtdbResp.ok) {
          const rtdbData = await rtdbResp.json();
          if (rtdbData && typeof rtdbData === 'object') {
            freshDocs = Object.entries(rtdbData).map(([k, v]: [string, any]) => ({ id: k, ...v }));
          }
        }
      } catch (err: any) {
        console.warn('[12-HOUR SYNC] RTDB documents fetch notice:', err?.message);
      }

      // Step 2: Fetch fresh categories directly from RTDB
      let freshCats: any[] = [];
      try {
        const rtdbCatsResp = await fetch("https://india-cyber-cafe-default-rtdb.firebaseio.com/documentCategories.json", {
          signal: AbortSignal.timeout(8000),
          headers: { 'Accept': 'application/json' }
        });
        if (rtdbCatsResp.ok) {
          const rtdbCatsData = await rtdbCatsResp.json();
          if (rtdbCatsData && typeof rtdbCatsData === 'object') {
            freshCats = Object.entries(rtdbCatsData).map(([k, v]: [string, any]) => ({ id: k, ...v }));
          }
        }
      } catch (err: any) {
        console.warn('[12-HOUR SYNC] RTDB categories fetch notice:', err?.message);
      }

      // If RTDB returned documents, clear old JSON and write fresh deduplicated snapshot without duplicates or overlaps
      if (freshDocs.length > 0) {
        saveServerDocuments(freshDocs);
      } else {
        // Fallback: sync via runtime helper
        await syncDataType('documents');
      }

      if (freshCats.length > 0) {
        saveServerDocCategories(freshCats);
      } else {
        await syncDataType('documentCategories');
      }

      invalidatePublicDataCache();
      const finalDocs = readServerDocuments();
      console.log(`[12-HOUR SYNC] ✅ Scheduled sync completed. Saved ${finalDocs.length} clean documents.`);
    } catch (err: any) {
      console.error('[12-HOUR SYNC] Error during scheduled sync:', err?.message || err);
    }
  };

  // Run periodic sync on startup and repeat every 12 hours
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

    // Filter by category if specified and not 'All'
    if (rawCategory && rawCategory.toLowerCase() !== 'all') {
      const catSlug = serverSlugify(rawCategory);
      filtered = filtered.filter(d => {
        return (d.category || '').toLowerCase() === rawCategory.toLowerCase() ||
          serverSlugify(d.category || '') === catSlug;
      });
    }

    // Filter by query string across name, description, category, id, and slugs
    if (rawQuery) {
      const queryTokens = rawQuery.split(/\s+/).filter(Boolean);
      const querySig = getDocSignature(rawQuery);

      filtered = filtered.filter(d => {
        const name = (d.name || '').toLowerCase();
        const desc = (d.description || '').toLowerCase();
        const cat = (d.category || '').toLowerCase();
        const id = (d.id || '').toLowerCase();
        const docSig = getDocSignature(d.name || '');

        // 1. Direct substring in name or id
        if (name.includes(rawQuery) || id.includes(rawQuery)) return true;

        // 2. Signature match
        if (querySig && docSig && (docSig === querySig || docSig.includes(querySig) || querySig.includes(docSig))) return true;

        // 3. Substring in description or category
        if (desc.includes(rawQuery) || cat.includes(rawQuery)) return true;

        // 4. All query tokens present in document fields
        const combined = `${name} ${desc} ${cat} ${id}`;
        if (queryTokens.every(token => combined.includes(token))) return true;

        return false;
      });
    }

    setNoCacheHeaders(res);
    res.json({ success: true, count: filtered.length, documents: filtered });
  });

  // Manual / on-demand trigger to refresh documents from database
  app.post('/api/documents/refresh', async (req, res) => {
    try {
      await run12HourDocumentSync();
      const docs = readServerDocuments();
      setNoCacheHeaders(res);
      res.json({
        success: true,
        message: "Documents refreshed and synchronized from database",
        count: docs.length,
        documents: docs,
        refreshedAt: new Date().toISOString()
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || "Failed to refresh documents" });
    }
  });

  app.get('/api/version', (req, res) => {
    setNoCacheHeaders(res);
    res.json({ success: true, version: '2026.11.02-v1', timestamp: Date.now() });
  });

  app.get('/api/documents/lookup', async (req, res) => {
    const slug = ((req.query.slug as string) || '').trim();
    const category = ((req.query.category as string) || '').trim();
    const id = ((req.query.id as string) || '').trim();

    if (!slug && !id) {
      return res.status(400).json({ success: false, error: "Slug or id is required" });
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

      // 1. Exact ID match
      if (id && (docId === id || docIdLower === id.toLowerCase() || docId === cleanTargetSlug)) return true;
      if (slug && (docId === slug || docIdLower === rawTarget || docId === cleanTargetSlug)) return true;

      // 2. Category + Slug match
      if (cleanCatSlug && docCatSlug === cleanCatSlug && docNameSlug === cleanTargetSlug) return true;

      // 3. Name slug match regardless of category
      if (cleanTargetSlug && docNameSlug === cleanTargetSlug) return true;

      // 4. Token signature match
      if (targetSig && docSig && targetSig === docSig) return true;

      // 5. Compact alphanumeric match (e.g., 'pyqbt102')
      if (cleanTargetCompact && docNameSlug.replace(/-/g, '') === cleanTargetCompact) return true;
      if (cleanTargetCompact && docIdLower.replace(/[^a-z0-9]/g, '') === cleanTargetCompact) return true;

      // 6. Case-insensitive raw title match
      if (rawTarget && (d.name || '').trim().toLowerCase() === rawTarget) return true;

      // 7. Substring if target length is at least 4
      if (cleanTargetSlug.length >= 4 && (docNameSlug.includes(cleanTargetSlug) || cleanTargetSlug.includes(docNameSlug))) return true;

      return false;
    });

    // If not found in local store, attempt RTDB fetch if possible
    if (!match) {
      try {
        const rtdbResp = await fetch("https://india-cyber-cafe-default-rtdb.firebaseio.com/documents.json");
        if (rtdbResp.ok) {
          const rtdbData = await rtdbResp.json();
          if (rtdbData) {
            const remoteList = Object.entries(rtdbData).map(([k, v]: [string, any]) => ({ id: k, ...v }));
            match = remoteList.find((d: any) => {
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
        console.warn("RTDB lookup check notice:", err);
      }
    }

    // If still not found, check live upstream production snapshot
    if (!match) {
      try {
        const prodResp = await fetch("https://b.indiacybercafe.com/data/documents.json", {
          signal: AbortSignal.timeout(4000),
          headers: { 'Accept': 'application/json' }
        });
        if (prodResp.ok) {
          const prodData = await prodResp.json();
          const prodDocs = Array.isArray(prodData?.documents) ? prodData.documents : [];
          match = prodDocs.find((d: any) => {
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

    return res.status(404).json({ success: false, error: "Document not found" });
  });

  app.post('/api/documents', requireAdminMiddleware, async (req, res) => {
    try {
      const doc = req.body;
      if (!doc || !doc.name) {
        return res.status(400).json({ success: false, error: "Document name is required" });
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

      // Attempt Firebase RTDB write
      try {
        await fetch(`https://india-cyber-cafe-default-rtdb.firebaseio.com/documents/${encodeURIComponent(docId)}.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (rtdbErr) {
        console.warn("RTDB save document notice:", rtdbErr);
      }

      return res.json({ success: true, document: payload });
    } catch (error: any) {
      console.error("Save document error:", error);
      res.status(500).json({ success: false, error: "Failed to save document" });
    }
  });

  app.post('/api/documents/sync-bulk', requireAdminMiddleware, async (req, res) => {
    try {
      const { documents } = req.body;
      if (!Array.isArray(documents)) {
        return res.status(400).json({ success: false, error: "Documents array required" });
      }
      // Firebase is the single source of truth:
      // Authoritative remote snapshot completely replaces the local store.
      // Never merge with stale records!
      saveServerDocuments(documents);
      return res.json({ success: true, count: documents.length });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/documents/:id', requireAdminMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const docs = readServerDocuments();
      const filtered = docs.filter(d => d.id !== id && serverSlugify(d.name) !== serverSlugify(id));
      saveServerDocuments(filtered);

      try {
        await fetch(`https://india-cyber-cafe-default-rtdb.firebaseio.com/documents/${encodeURIComponent(id)}.json`, {
          method: "DELETE"
        });
      } catch (rtdbErr) {
        console.warn("RTDB delete notice:", rtdbErr);
      }

      return res.json({ success: true, message: "Document deleted" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: "Failed to delete document" });
    }
  });

  app.get('/api/document-categories', (req, res) => {
    const cats = readServerDocCategories();
    setNoCacheHeaders(res);
    res.json({ success: true, categories: cats });
  });

  app.post('/api/document-categories', requireAdminMiddleware, (req, res) => {
    try {
      const cat = req.body;
      if (!cat || !cat.name) return res.status(400).json({ success: false, error: "Category name required" });
      const cats = readServerDocCategories();
      const id = cat.id || serverSlugify(cat.name);
      const payload = { ...cat, id };
      const filtered = cats.filter(c => c.id !== id && serverSlugify(c.name) !== serverSlugify(cat.name));
      filtered.push(payload);
      saveServerDocCategories(filtered);
      return res.json({ success: true, category: payload });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/document-categories/sync-bulk', requireAdminMiddleware, async (req, res) => {
    try {
      const { categories } = req.body;
      if (!Array.isArray(categories)) {
        return res.status(400).json({ success: false, error: "Categories array required" });
      }
      saveServerDocCategories(categories);
      return res.json({ success: true, count: categories.length });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/document-categories/:id', requireAdminMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const cats = readServerDocCategories();
      const filtered = cats.filter(c => c.id !== id && serverSlugify(c.name) !== serverSlugify(id));
      saveServerDocCategories(filtered);

      try {
        await fetch(`https://india-cyber-cafe-default-rtdb.firebaseio.com/documentCategories/${encodeURIComponent(id)}.json`, {
          method: "DELETE"
        });
      } catch (rtdbErr) {
        console.warn("RTDB delete category notice:", rtdbErr);
      }

      return res.json({ success: true, message: "Category deleted" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: "Failed to delete category" });
    }
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
  app.get("/api/admin/privacy-requests", requireAdminMiddleware, async (req, res) => {
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
  app.patch("/api/admin/privacy-requests/:id", requireAdminMiddleware, async (req, res) => {
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

  // Mount Google Drive API routes
  app.use('/api/drive', driveRouter);

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

  // Vite middleware for development; use the built app whenever dist exists.
  const distIndex = path.join(DIST_PATH, 'index.html');
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(distIndex);

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    const executeDevSsr = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try {
        const indexPath = path.join(APP_ROOT, 'index.html');
        if (!fs.existsSync(indexPath)) return next();
        let rawHtml = fs.readFileSync(indexPath, 'utf-8');
        rawHtml = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
        const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const baseUrl = process.env.APP_URL || (host.includes('localhost') ? `${proto}://${host}` : `https://${host}`);
        const pageResult = renderUniversalPage(req.path, baseUrl, APP_ROOT);
        const includeBodyHtml = isCrawlerRequest(req);
        const injectedHtml = injectSsrIntoTemplate(rawHtml, pageResult, { includeBodyHtml });
        setNoCacheHeaders(res);
        return res.status(pageResult.status).set({
          'Content-Type': 'text/html; charset=utf-8',
          'Vary': 'User-Agent, Accept-Encoding',
        }).send(injectedHtml);
      } catch (err) {
        next(err);
      }
    };

    // Explicit Homepage Route in dev mode
    app.get('/', async (req, res, next) => {
      return executeDevSsr(req, res, next);
    });

    // In development: intercept HTML page requests to dynamically render complete SSR HTML
    app.get(/^\/(?!api\/|data\/|assets\/|@|node_modules\/|src\/|manifest\.json$|robots\.txt$|sitemap\.xml$|favicon\.?\w*$).*/, async (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/data/') || req.path.startsWith('/assets/')) {
        return next();
      }
      const crawler = isCrawlerRequest(req);
      const isPageRequest = crawler || req.accepts('html') || !req.path.includes('.');
      if (!isPageRequest) {
        return next();
      }
      return executeDevSsr(req, res, next);
    });

    app.use(vite.middlewares);
  } else {
    // Serve synchronized live public data BEFORE dist fallback with strict no-store headers
    app.use('/data', express.static(path.join(APP_ROOT, 'public/data'), {
      etag: false,
      lastModified: false,
      maxAge: 0,
      setHeaders: (res) => {
        setNoCacheHeaders(res);
      }
    }));
    app.use('/data', express.static(path.join(DIST_PATH, 'data'), {
      etag: false,
      lastModified: false,
      maxAge: 0,
      setHeaders: (res) => {
        setNoCacheHeaders(res);
      }
    }));

    app.use('/assets', express.static(path.join(DIST_PATH, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));

    app.use(express.static(DIST_PATH, {
      index: false,
      extensions: ['html'],
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
          setNoCacheHeaders(res);
        }
      },
    }));

    const executeProdSsr = (req: express.Request, res: express.Response) => {
      if (!fs.existsSync(distIndex)) {
        return res.status(404).send('dist/index.html not found');
      }
      try {
        const rawHtml = fs.readFileSync(distIndex, 'utf-8');
        const host = req.get('x-forwarded-host') || req.get('host') || 'b.indiacybercafe.com';
        const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const baseUrl = process.env.APP_URL || (host.includes('localhost') ? `${proto}://${host}` : `https://${host}`);
        const pageResult = renderUniversalPage(req.path, baseUrl, APP_ROOT);
        const includeBodyHtml = isCrawlerRequest(req);
        const injectedHtml = injectSsrIntoTemplate(rawHtml, pageResult, { includeBodyHtml });
        setNoCacheHeaders(res);
        return res.status(pageResult.status).set({
          'Content-Type': 'text/html; charset=utf-8',
          'Vary': 'User-Agent, Accept-Encoding',
        }).send(injectedHtml);
      } catch (err: any) {
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
        setNoCacheHeaders(res);
        return res.status(500).set({
          'Content-Type': 'text/html; charset=utf-8',
          'Vary': 'User-Agent, Accept-Encoding',
          'X-Request-Id': requestId,
        }).send(errorHtml);
      }
    };

    // Explicit Homepage Route - Guarantees root request "/" reaches authoritative SSR renderer
    app.get('/', (req, res) => {
      return executeProdSsr(req, res);
    });

    app.get(/^\/(?!api\/|data\/|assets\/|manifest\.json$|robots\.txt$|sitemap\.xml$|favicon\.?\w*$).*/, (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/data/') || req.path.startsWith('/assets/')) {
        return next();
      }

      const crawler = isCrawlerRequest(req);
      const isPageRequest = crawler || req.accepts('html') || !req.path.includes('.');

      if (isPageRequest) {
        return executeProdSsr(req, res);
      }
      next();
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
