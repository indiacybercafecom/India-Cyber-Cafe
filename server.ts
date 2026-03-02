import dotenv from "dotenv";
dotenv.config(); // MUST be called before any other imports that use process.env

import express from "express";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { adminAuth, adminDb } from "./src/services/adminFirebase";
import path from "path";
import fs from "fs";

// Global error handling for top-level crashes
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

async function startServer() {
  console.log('Starting server...');
  const app = express();
  const PORT = 3000;

  // Trust proxy for correct protocol and host detection behind proxies
  app.set('trust proxy', true);

  // Session Configuration
  app.use(session({
    secret: process.env.SESSION_SECRET || "icc-secret-key-2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Passport Configuration
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: any, done) => {
    done(null, user.uid);
  });

  passport.deserializeUser(async (uid: string, done) => {
    try {
      if (adminDb) {
        const snapshot = await adminDb.ref(`users/${uid}`).once('value');
        const user = snapshot.val();
        done(null, user);
      } else {
        done(new Error("Firebase Admin not initialized"), null);
      }
    } catch (error) {
      done(error, null);
    }
  });

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    console.log('Google OAuth enabled.');
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback",
      proxy: true
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        if (!adminDb || !adminAuth) return done(new Error("Firebase Admin not initialized"));

        const email = profile.emails?.[0].value;
        if (!email) return done(new Error("No email found in Google profile"));

        // Check if user exists by email
        let userRecord;
        try {
          userRecord = await adminAuth.getUserByEmail(email);
        } catch (error: any) {
          if (error.code === 'auth/user-not-found') {
            // Create new user in Firebase Auth
            userRecord = await adminAuth.createUser({
              email,
              displayName: profile.displayName,
              photoURL: profile.photos?.[0].value,
            });
          } else {
            throw error;
          }
        }

        const uid = userRecord.uid;
        const userRef = adminDb.ref(`users/${uid}`);
        const snapshot = await userRef.once('value');
        let userData = snapshot.val();

        if (!userData) {
          // Auto-register in RTDB
          userData = {
            uid,
            email,
            name: profile.displayName,
            avatar: profile.photos?.[0].value,
            role: 'user',
            createdAt: new Date().toISOString(),
            googleId: profile.id
          };
          await userRef.set(userData);
        } else {
          // Update existing user
          await userRef.update({
            avatar: profile.photos?.[0].value,
            googleId: profile.id
          });
          userData = { ...userData, avatar: profile.photos?.[0].value, googleId: profile.id };
        }

        return done(null, userData);
      } catch (error) {
        return done(error as Error);
      }
    }));
  } else {
    console.warn('Google OAuth disabled: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing.');
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('FIREBASE_SERVICE_ACCOUNT variable found.');
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT variable missing.');
  }

  app.use(express.json());

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

  // Google Auth Routes
  app.get("/auth/google", (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error("Google OAuth credentials missing in environment variables.");
      return res.status(500).send("Google OAuth is not configured on the server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment variables.");
    }
    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
  });

  app.get("/auth/google/callback", 
    passport.authenticate("google", { failureRedirect: "/login?error=google_auth_failed" }),
    async (req, res) => {
      try {
        if (req.user && adminAuth) {
          const user = req.user as any;
          // Generate Firebase Custom Token
          const customToken = await adminAuth.createCustomToken(user.uid);
          // Redirect back to frontend with token
          res.redirect(`/auth/callback?token=${customToken}`);
        } else {
          res.redirect("/login?error=auth_failed");
        }
      } catch (error) {
        console.error("Error generating custom token:", error);
        res.redirect("/login?error=token_generation_failed");
      }
    }
  );

  app.get("/api/auth/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json(req.user || null);
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
    const distPath = path.resolve("dist");
    if (fs.existsSync(distPath)) {
      console.log('Serving static files from dist/');
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      console.warn('WARNING: dist/ directory not found. Static file serving might fail. Did you run npm run build?');
      app.get("*", (req, res) => {
        res.status(503).send("Application is still building or dist/ folder is missing. Please try again in a minute.");
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
