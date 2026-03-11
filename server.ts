import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy for correct protocol and host detection behind proxies
  app.set('trust proxy', true);

  app.use(express.json());

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
        sitemap += `  <url>\n    <loc>${baseUrl}/services/${service.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
        
        // Subservices
        if (service.subservices && Array.isArray(service.subservices)) {
          service.subservices.forEach((ss: any) => {
            if (ss && ss.name) {
              sitemap += `  <url>\n    <loc>${baseUrl}/services/${service.id}/${slugify(ss.name)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
            }
          });
        }
      }
    });

    // Product Categories
    productCategories.forEach(category => {
      if (category && category.id) {
        sitemap += `  <url>\n    <loc>${baseUrl}/store/${category.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
      }
    });

    // Products
    products.forEach(product => {
      if (product && product.id) {
        sitemap += `  <url>\n    <loc>${baseUrl}/store/${product.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
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
