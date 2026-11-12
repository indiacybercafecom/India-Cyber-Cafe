import fs from "fs";
import path from "path";
import { getAllPublicUrls } from "./publicDataService.js";
function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}
function resolveAppRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "package.json"))) return cwd;
  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "package.json"))) return parent;
  return cwd;
}
function getDataFileModificationDate(appRoot, filename) {
  try {
    const p = path.join(appRoot, "public/data", filename);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      return stat.mtime.toISOString().split("T")[0];
    }
  } catch {
  }
  return (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
}
function generateSitemapXml(baseUrl = "https://b.indiacybercafe.com", appRoot = resolveAppRoot()) {
  const root = baseUrl.replace(/\/+$/, "");
  const urlList = getAllPublicUrls(root, appRoot);
  const servicesLastMod = getDataFileModificationDate(appRoot, "services.json");
  const productsLastMod = getDataFileModificationDate(appRoot, "products.json");
  const documentsLastMod = getDataFileModificationDate(appRoot, "documents.json");
  const defaultLastMod = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const entries = urlList.map((item) => {
    let lastmod = defaultLastMod;
    if (item.path.startsWith("/services")) {
      lastmod = servicesLastMod;
    } else if (item.path.startsWith("/store")) {
      lastmod = productsLastMod;
    } else if (item.path.startsWith("/forms-documents")) {
      lastmod = documentsLastMod;
    }
    return `  <url>
    <loc>${escapeXml(item.fullUrl)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>${escapeXml(item.changefreq)}</changefreq>
    <priority>${escapeXml(item.priority)}</priority>
  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>`;
}
function generateRobotsTxt(baseUrl = "https://b.indiacybercafe.com") {
  const root = baseUrl.replace(/\/+$/, "");
  return `# Robots.txt for India Cyber Cafe (Production)
# Comprehensive Crawling & Indexing Policy

User-agent: *
# Allow crawling of all public routes
Allow: /
Allow: /services
Allow: /services/
Allow: /price-list
Allow: /store
Allow: /store/
Allow: /forms-documents
Allow: /forms-documents/
Allow: /about
Allow: /contact
Allow: /pay
Allow: /legal/

# Disallow private user portals, admin dashboard & payment checkouts
Disallow: /admin
Disallow: /admin/
Disallow: /operator
Disallow: /operator/
Disallow: /profile
Disallow: /track
Disallow: /track/
Disallow: /my-documents
Disallow: /my-documents/
Disallow: /store/*/*/checkout
Disallow: /store/order-confirmation
Disallow: /api/
Disallow: /*.env
Disallow: /*.json$

# Googlebot specific
User-agent: Googlebot
Allow: /
Crawl-delay: 0

# Bingbot specific
User-agent: Bingbot
Allow: /
Crawl-delay: 1

# XML Sitemap
Sitemap: ${root}/sitemap.xml
`;
}
export {
  escapeXml,
  generateRobotsTxt,
  generateSitemapXml
};
