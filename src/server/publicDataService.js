import fs from "fs";
import path from "path";
function slugify(text) {
  if (!text) return "";
  return String(text).toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
let cachedData = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1e3;
function invalidatePublicDataCache() {
  cachedData = null;
  lastCacheTime = 0;
  console.log("[PUBLIC DATA SERVICE] Cache invalidated");
}
function resolveAppRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "package.json"))) return cwd;
  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "package.json"))) return parent;
  return cwd;
}
function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn(`[PUBLIC DATA SERVICE] Warning reading ${filePath}:`, err.message);
  }
  return null;
}
function getPublicData(appRoot = resolveAppRoot()) {
  const now = Date.now();
  if (cachedData && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedData;
  }
  const dataDir = path.join(appRoot, "public/data");
  const distDataDir = path.join(appRoot, "dist/data");
  const servicesJson = readJsonFile(path.join(dataDir, "services.json")) || readJsonFile(path.join(distDataDir, "services.json"));
  const services = Array.isArray(servicesJson?.services) ? servicesJson.services : [];
  const productsJson = readJsonFile(path.join(dataDir, "products.json")) || readJsonFile(path.join(distDataDir, "products.json"));
  const products = Array.isArray(productsJson?.products) ? productsJson.products : [];
  const prodCatJson = readJsonFile(path.join(dataDir, "product-categories.json")) || readJsonFile(path.join(distDataDir, "product-categories.json"));
  const productCategories = Array.isArray(prodCatJson?.categories) ? prodCatJson.categories : [];
  const docsJson = readJsonFile(path.join(dataDir, "documents.json")) || readJsonFile(path.join(appRoot, "data/documents.json")) || readJsonFile(path.join(distDataDir, "documents.json"));
  const rawDocs = Array.isArray(docsJson) ? docsJson : Array.isArray(docsJson?.documents) ? docsJson.documents : [];
  const documents = rawDocs.filter((d) => Boolean(d && (d.name || d.id)));
  const docCatJson = readJsonFile(path.join(dataDir, "document-categories.json")) || readJsonFile(path.join(appRoot, "data/document-categories.json")) || readJsonFile(path.join(distDataDir, "document-categories.json"));
  const rawDocCats = Array.isArray(docCatJson) ? docCatJson : Array.isArray(docCatJson?.categories) ? docCatJson.categories : [];
  const documentCategories = rawDocCats.filter((c) => Boolean(c && c.name));
  cachedData = {
    services,
    products,
    productCategories,
    documents,
    documentCategories
  };
  lastCacheTime = now;
  return cachedData;
}
function findService(identifier, appRoot) {
  const data = getPublicData(appRoot);
  const target = decodeURIComponent(identifier).toLowerCase().trim();
  const targetSlug = slugify(identifier);
  return data.services.find(
    (s) => s.id === identifier || s.id.toLowerCase() === target || slugify(s.name) === targetSlug
  );
}
function findSubservice(service, subserviceParam) {
  if (!service.subservices || !Array.isArray(service.subservices)) return void 0;
  const target = decodeURIComponent(subserviceParam).toLowerCase().trim();
  const targetSlug = slugify(subserviceParam);
  return service.subservices.find(
    (ss) => slugify(ss.name) === targetSlug || ss.name.toLowerCase().trim() === target || ss.id === subserviceParam
  );
}
function findProduct(productId, appRoot) {
  const data = getPublicData(appRoot);
  const target = decodeURIComponent(productId).toLowerCase().trim();
  const targetSlug = slugify(productId);
  return data.products.find(
    (p) => p.id === productId || p.id.toLowerCase() === target || p.permalink && p.permalink.toLowerCase() === target || slugify(p.name) === targetSlug
  );
}
function findProductCategory(categoryId, appRoot) {
  const data = getPublicData(appRoot);
  const target = decodeURIComponent(categoryId).toLowerCase().trim();
  const targetSlug = slugify(categoryId);
  return data.productCategories.find(
    (c) => c.id === categoryId || c.id.toLowerCase() === target || slugify(c.name) === targetSlug
  );
}
function findDocument(param1, param2, appRoot) {
  const data = getPublicData(appRoot);
  const slug1 = slugify(param1);
  const slug2 = param2 ? slugify(param2) : void 0;
  if (slug2) {
    const matchedCategory = data.documentCategories.find((c) => slugify(c.name) === slug1);
    const matchedDoc = data.documents.find(
      (d) => slugify(d.name) === slug2 && (!matchedCategory || !d.category || slugify(d.category) === slug1)
    );
    if (matchedDoc) {
      return { doc: matchedDoc, category: matchedCategory };
    }
  }
  const matchedDocSingle = data.documents.find((d) => slugify(d.name) === slug1 || d.id === param1);
  if (matchedDocSingle) {
    const cat = data.documentCategories.find((c) => c.name === matchedDocSingle.category);
    return { doc: matchedDocSingle, category: cat };
  }
  const matchedCatSingle = data.documentCategories.find((c) => slugify(c.name) === slug1);
  return { category: matchedCatSingle };
}
function getAllPublicUrls(baseUrl = "https://b.indiacybercafe.com", appRoot) {
  const root = (baseUrl || "https://b.indiacybercafe.com").replace(/\/+$/, "");
  const data = getPublicData(appRoot);
  const list = [];
  const add = (p, title, priority = "0.7", changefreq = "weekly") => {
    const cleanP = p === "/" ? "" : p;
    list.push({
      path: p,
      fullUrl: `${root}${cleanP}`,
      title,
      priority,
      changefreq
    });
  };
  add("/", "India Cyber Cafe - Digital Services, CSC & Online Form Portal", "1.0", "daily");
  add("/services", "All Digital Services & CSC Applications", "0.9", "daily");
  add("/price-list", "Official Price List & Service Charges", "0.9", "daily");
  add("/store", "Online Store - PVC Smart Cards & Print Products", "0.8", "daily");
  add("/forms-documents", "Government Forms & PDF Document Downloads", "0.8", "daily");
  add("/about", "About India Cyber Cafe - Trusted Digital Partner", "0.6", "monthly");
  add("/contact", "Contact Us & Grievance Redressal", "0.6", "monthly");
  add("/legal/terms", "Terms and Conditions of Service", "0.5", "monthly");
  add("/legal/privacy", "Privacy Policy & DPDP Act Compliance Notice", "0.5", "monthly");
  add("/legal/refund", "Refund and Cancellation Policy", "0.5", "monthly");
  add("/legal/disclaimer", "Disclaimer and Non-Affiliation Notice", "0.5", "monthly");
  add("/privacy-request", "Submit Privacy & Grievance Redressal Request", "0.5", "monthly");
  add("/privacy-request/track", "Track Privacy Request Status", "0.4", "monthly");
  add("/pay", "Online Payment Portal - Pay by Link", "0.6", "weekly");
  add("/sitemap.html", "HTML Sitemap & Directory - Complete Website Services", "0.7", "weekly");
  for (const s of data.services) {
    if (!s.id) continue;
    add(`/services/${s.id}`, `${s.name} - Online Application & Guidelines`, "0.8", "weekly");
    for (const ss of s.subservices || []) {
      if (!ss.name) continue;
      add(
        `/services/${s.id}/${slugify(ss.name)}`,
        `${ss.name} (${s.name}) - Apply Online`,
        "0.7",
        "weekly"
      );
    }
  }
  for (const cat of data.productCategories) {
    if (!cat.id) continue;
    add(`/store/${cat.id}`, `${cat.name} - Store Category`, "0.7", "weekly");
  }
  for (const p of data.products) {
    if (!p.id || !p.category) continue;
    add(
      `/store/${p.category}/${p.id}`,
      `${p.seoTitle || p.name} - India Cyber Cafe Store`,
      "0.7",
      "weekly"
    );
  }
  for (const docCat of data.documentCategories) {
    if (!docCat.name) continue;
    const catSlug = slugify(docCat.name);
    add(`/forms-documents/${catSlug}`, `${docCat.name} - Forms & Documents`, "0.7", "weekly");
  }
  for (const doc of data.documents) {
    if (!doc.name) continue;
    const catSlug = slugify(doc.category || "general");
    const docSlug = slugify(doc.name);
    add(
      `/forms-documents/${catSlug}/${docSlug}`,
      `${doc.name} - PDF Download & Guidelines`,
      "0.6",
      "weekly"
    );
  }
  return list;
}
export {
  findDocument,
  findProduct,
  findProductCategory,
  findService,
  findSubservice,
  getAllPublicUrls,
  getPublicData,
  invalidatePublicDataCache,
  slugify
};
