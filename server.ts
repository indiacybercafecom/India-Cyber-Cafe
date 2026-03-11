import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import multer from "multer";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import * as admin from "firebase-admin";

dotenv.config();

// Initialize Firebase Admin SDK
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "./firebase-service-account.json";
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "india-cyber-cafe.firebasestorage.app",
  });
} else {
  console.warn(`⚠️  Firebase service account not found at ${serviceAccountPath}. Uploads may fail.`);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy for correct protocol and host detection behind proxies
  app.set('trust proxy', true);

  app.use(express.json());

  // Configure multer for file uploads (in memory storage)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB max
    }
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

  // File Upload Endpoint (for guest checkout and guest uploads)
  // Uses Firebase Admin SDK for secure server-side uploads
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const category = req.body.category || "general";
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 12);
      const fileExtension = path.extname(req.file.originalname);
      const fileName = `${timestamp}-${randomString}${fileExtension}`;
      const storagePath = `${category}/${fileName}`;

      console.log(`[Upload] Starting upload: ${storagePath}, size: ${req.file.size} bytes, type: ${req.file.mimetype}`);

      // Check if Firebase Admin is initialized
      if (!admin.apps.length) {
        console.error("[Upload] Firebase Admin not initialized");
        return res.status(500).json({
          error: "Upload service not configured",
          message: "Firebase service account not set up"
        });
      }

      try {
        // Get Firebase Storage bucket reference
        const bucket = admin.storage().bucket();
        
        // Create file reference
        const file = bucket.file(storagePath);
        
        // Upload file with metadata
        await file.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
            metadata: {
              uploadedAt: new Date().toISOString(),
            }
          }
        });

        // Make file public if needed (for public folders)
        const publicFolders = ['products', 'reviews', 'custom-images'];
        const isPublicFolder = publicFolders.includes(category);
        
        if (isPublicFolder) {
          await file.makePublic();
        }

        console.log(`[Upload] ✅ File uploaded successfully to ${storagePath}`);

        // Generate download URL
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/india-cyber-cafe.firebasestorage.app/o/${encodeURIComponent(storagePath)}?alt=media`;

        res.json({
          success: true,
          url: downloadUrl,
          path: storagePath,
        });
      } catch (firebaseError: any) {
        console.error(`[Upload] Firebase error: ${firebaseError.message}`);
        return res.status(500).json({
          error: "Upload to Firebase failed",
          message: firebaseError.message,
        });
      }
    } catch (error: any) {
      console.error("[Upload] Error:", error);
      res.status(500).json({
        error: "Upload failed",
        message: error.message,
      });
    }
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

  app.get("/sitemap.xml", async (req, res) => {
    // Use APP_URL if set, otherwise fallback to current request host
    // This ensures that in production it uses the real domain if configured
    let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
    
    if (!baseUrl) {
      const protocol = req.protocol;
      const host = req.get('host');
      baseUrl = `${protocol}://${host}`;
    }
    
    const databaseURL = "https://india-cyber-cafe-default-rtdb.firebaseio.com";
    
    let services: any[] = [];
    let productCategories: any[] = [];
    let products: any[] = [];
    
    try {
      const response = await fetch(`${databaseURL}/services.json`);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          // Firebase might return an object or an array
          services = Array.isArray(data) ? data : Object.values(data);
        }
      }
    } catch (error) {
      console.error("Error fetching services for sitemap:", error);
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
      console.error("Error fetching product categories for sitemap:", error);
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
      console.error("Error fetching products for sitemap:", error);
    }

    const staticPages = [
      "",
      "/services",
      "/store",
      "/track",
      "/profile",
      "/about",
      "/contact",
      "/legal/terms",
      "/legal/privacy",
      "/legal/refund",
    ];

    const slugify = (text: string) => text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // Current date for lastmod
    const today = new Date().toISOString().split('T')[0];

    // Static pages
    staticPages.forEach(page => {
      sitemap += `  <url>\n    <loc>${baseUrl}${page}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${page === "" ? "1.0" : "0.8"}</priority>\n  </url>\n`;
    });

    // Services
    services.forEach(service => {
      if (service && service.id) {
        sitemap += `  <url>\n    <loc>${baseUrl}/services/${service.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
        
        // Subservices
        if (service.subservices && Array.isArray(service.subservices)) {
          service.subservices.forEach((ss: any) => {
            if (ss && ss.name) {
              sitemap += `  <url>\n    <loc>${baseUrl}/services/${service.id}/${slugify(ss.name)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
            }
          });
        }
      }
    });

    // Product Categories
    productCategories.forEach(category => {
      if (category && category.id) {
        sitemap += `  <url>\n    <loc>${baseUrl}/store/${category.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
      }
    });

    // Products
    products.forEach(product => {
      if (product && product.id && product.category) {
        sitemap += `  <url>\n    <loc>${baseUrl}/store/${product.category}/${product.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
      }
    });

    sitemap += `</urlset>`;
    res.type("application/xml");
    res.send(sitemap);
  });

  // Razorpay Order Creation Endpoint
  app.post("/api/create-razorpay-order", async (req, res) => {
    try {
      const { amount, currency = 'INR', receipt, notes = {} } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          error: "Invalid amount"
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

      const isSignatureValid = expectedSignature === razorpay_signature;

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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
