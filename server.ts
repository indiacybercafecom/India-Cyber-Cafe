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
      const category = req.body.category || "general";
      const targetDir = path.join(baseUploadDir, category);
      
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      cb(null, targetDir);
    },
    filename: (req, file, cb) => {
      const category = req.body.category || "general";
      const randomString = Math.random().toString(36).substring(2, 14);
      const timestamp = Date.now();
      const extension = path.extname(file.originalname);
      const sanitizedOriginalName = path.basename(file.originalname, extension).replace(/[^a-zA-Z0-9._-]/g, "_");
      const newFilename = `${category}_${randomString}_${timestamp}_${sanitizedOriginalName}${extension}`;
      cb(null, newFilename);
    },
  });

  const upload = multer({ storage });

  // Handle the PHP uploader path for the preview environment
  app.post("/uploader/upload.php", upload.single("file"), (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "No file uploaded" });
    }
    
    const category = req.body.category || "general";
    const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
    const fileUrl = `${baseUrl}/uploads/${category}/${req.file.filename}`;
    
    res.json({ 
      status: "success", 
      file_url: fileUrl, 
      stored_file_name: req.file.filename,
      firebase_synced: true // Simulate sync for preview
    });
  });

  // API Route for file uploads (legacy support)
  app.post("/api/upload", upload.single("file"), (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const category = req.body.category || "general";
    const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
    const fileUrl = `${baseUrl}/uploads/${category}/${req.file.filename}`;
    res.json({ url: fileUrl });
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
