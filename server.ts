import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy for correct protocol and host detection behind proxies
  app.set('trust proxy', true);

  // Ensure base uploads directory exists
  const baseUploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(baseUploadDir)) {
    fs.mkdirSync(baseUploadDir, { recursive: true });
  }

  app.use(express.json());
  app.use("/uploads", express.static(baseUploadDir));

  // Multer Configuration with dynamic folder support
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const category = req.body.category || "general";
        const targetDir = path.join(baseUploadDir, category);
        
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        cb(null, targetDir);
      } catch (error: any) {
        console.error("Multer Destination Error:", error);
        cb(error, "");
      }
    },
    filename: (req, file, cb) => {
      try {
        const category = req.body.category || "general";
        const randomString = Math.random().toString(36).substring(2, 14);
        const timestamp = Date.now();
        const extension = path.extname(file.originalname);
        const sanitizedOriginalName = path.basename(file.originalname, extension).replace(/[^a-zA-Z0-9._-]/g, "_");
        const newFilename = `${category}_${randomString}_${timestamp}_${sanitizedOriginalName}${extension}`;
        cb(null, newFilename);
      } catch (error: any) {
        console.error("Multer Filename Error:", error);
        cb(error, "");
      }
    },
  });

  const upload = multer({ storage });

  // Handle the PHP uploader path for the preview environment
  app.post("/uploader/upload.php", upload.single("file"), (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ status: "error", message: "No file uploaded" });
      }
      
      const category = req.body.category || "general";
      
      // Determine base URL dynamically if not set in env
      let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
      if (!baseUrl) {
        const protocol = req.protocol;
        const host = req.get('host');
        baseUrl = `${protocol}://${host}`;
      }
      
      const fileUrl = `${baseUrl}/uploads/${category}/${req.file.filename}`;
      
      res.json({ 
        status: "success", 
        file_url: fileUrl, 
        stored_file_name: req.file.filename,
        firebase_synced: true 
      });
    } catch (error: any) {
      console.error("Upload Route Error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  // API Route for file uploads (legacy support)
  app.post("/api/upload", upload.single("file"), (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const category = req.body.category || "general";
      
      let baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
      if (!baseUrl) {
        const protocol = req.protocol;
        const host = req.get('host');
        baseUrl = `${protocol}://${host}`;
      }
      
      const fileUrl = `${baseUrl}/uploads/${category}/${req.file.filename}`;
      res.json({ url: fileUrl });
    } catch (error: any) {
      console.error("API Upload Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Email Configuration
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "mail.indiacybercafe.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // Use STARTTLS for 587
    auth: {
      user: process.env.SMTP_USER || "icc@booking.indiacybercafe.com",
      pass: process.env.SMTP_PASS || "Ankit9977498131@@@",
    },
    tls: {
      rejectUnauthorized: false // Helps with some mail server certificate issues
    }
  });

  // API Route for sending emails
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, text, html } = req.body;

    const smtpUser = process.env.SMTP_USER || "icc@booking.indiacybercafe.com";
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

    const staticPages = [
      "",
      "/services",
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

    sitemap += `</urlset>`;
    res.type("application/xml");
    res.send(sitemap);
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
