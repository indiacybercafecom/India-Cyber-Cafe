import {
  getPublicData,
  findService,
  findSubservice,
  findProduct,
  findProductCategory,
  findDocument,
  slugify
} from "./publicDataService.js";
const DEFAULT_ICC_IMAGE = "https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png";
const DEFAULT_ICC_TITLE = "India Cyber Cafe - Digital Services, CSC & Online Form Portal";
const DEFAULT_ICC_DESC = "Apply for Government Services, CSC Online Forms, PAN Card, Aadhaar UCL, Certificates & Digital Products online at India Cyber Cafe. Fast, secure, and reliable digital partner.";
const PRODUCTION_DOMAIN = "https://b.indiacybercafe.com";
function escapeHtml(str) {
  if (str === null || str === void 0) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function cleanText(text, maxLength = 160) {
  if (!text) return "";
  const cleaned = String(text).replace(/<[^>]*>/g, "").replace(/[#*_`~>[\]]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 3).trim() + "...";
}
function renderHeader(activePath) {
  const navItems = [
    { href: "/", label: "Home" },
    { href: "/services", label: "Services" },
    { href: "/price-list", label: "Price List" },
    { href: "/store", label: "Store" },
    { href: "/forms-documents", label: "Forms & Documents" },
    { href: "/pay", label: "Pay Online" },
    { href: "/about", label: "About Us" },
    { href: "/contact", label: "Contact" }
  ];
  const linksHtml = navItems.map((item) => {
    const isActive = item.href === "/" ? activePath === "/" : activePath.startsWith(item.href);
    return `<a href="${item.href}" class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? "text-primary font-bold bg-primary/10" : "text-slate-700 hover:text-navy hover:bg-slate-100"}">${escapeHtml(item.label)}</a>`;
  }).join("");
  return `
    <header class="fixed top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between gap-4">
        <a href="/" class="flex items-center gap-3 shrink-0" aria-label="India Cyber Cafe Home">
          <img src="${DEFAULT_ICC_IMAGE}" alt="India Cyber Cafe Logo" class="w-10 h-10 object-contain rounded-lg" width="40" height="40" />
          <div class="flex flex-col">
            <span class="font-extrabold text-navy text-base sm:text-lg leading-tight tracking-tight">India Cyber Cafe</span>
            <span class="text-[11px] text-slate-500 font-medium">Digital Services &amp; CSC Portal</span>
          </div>
        </a>
        <nav class="hidden md:flex items-center gap-1" aria-label="Main Navigation">
          ${linksHtml}
        </nav>
        <div class="flex items-center gap-2">
          <a href="/login" class="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-primary text-white hover:bg-primary-dark transition-all shadow-sm">
            Sign In / Login
          </a>
        </div>
      </div>
    </header>
  `;
}
function renderBreadcrumbs(crumbs) {
  const itemsHtml = crumbs.map((crumb, idx) => {
    const isLast = idx === crumbs.length - 1;
    if (isLast || !crumb.href) {
      return `<li class="font-semibold text-navy truncate" aria-current="page">${escapeHtml(crumb.label)}</li>`;
    }
    return `
        <li>
          <a href="${crumb.href}" class="text-slate-500 hover:text-primary transition-colors">${escapeHtml(crumb.label)}</a>
        </li>
        <li class="text-slate-400 select-none" aria-hidden="true">/</li>
      `;
  }).join("");
  return `
    <nav aria-label="Breadcrumb" class="mb-6 py-2 px-1">
      <ol class="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-600">
        ${itemsHtml}
      </ol>
    </nav>
  `;
}
function renderFooter() {
  return `
    <footer class="mt-20 border-t border-slate-200 bg-slate-900 text-slate-300">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-12 lg:py-16">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div class="space-y-4">
            <div class="flex items-center gap-3">
              <img src="${DEFAULT_ICC_IMAGE}" alt="India Cyber Cafe" class="w-10 h-10 object-contain rounded-lg bg-white p-1" width="40" height="40" loading="lazy" />
              <span class="text-lg font-bold text-white">India Cyber Cafe</span>
            </div>
            <p class="text-xs text-slate-400 leading-relaxed">
              Your trusted digital partner for government forms, CSC applications, PAN card, Aadhaar UCL, smart PVC cards, and official document assistance.
            </p>
            <div class="text-xs text-slate-400 space-y-1">
              <p>\u{1F4CD} Main Road, Singrauli, MP 486889, India</p>
              <p>\u{1F4DE} +91 9203251821</p>
              <p>\u2709\uFE0F icc@indiacybercafe.com</p>
              <p>\u{1F552} Mon\u2013Sat: 09:00 AM \u2013 08:00 PM</p>
            </div>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-white uppercase tracking-wider mb-4">Digital Services</h3>
            <ul class="space-y-2 text-xs">
              <li><a href="/services" class="hover:text-white transition-colors">All Services Catalog</a></li>
              <li><a href="/services/pan-card" class="hover:text-white transition-colors">PAN Card Services</a></li>
              <li><a href="/services/aadhaar-ucl-opretor" class="hover:text-white transition-colors">Aadhaar UCL Operator</a></li>
              <li><a href="/price-list" class="hover:text-white transition-colors">Official Service Rates &amp; Fees</a></li>
              <li><a href="/forms-documents" class="hover:text-white transition-colors">Free PDF Form Downloads</a></li>
            </ul>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-white uppercase tracking-wider mb-4">Store &amp; Payments</h3>
            <ul class="space-y-2 text-xs">
              <li><a href="/store" class="hover:text-white transition-colors">ICC Online Store</a></li>
              <li><a href="/store/t-shirts" class="hover:text-white transition-colors">Custom Printed T-Shirts</a></li>
              <li><a href="/store/medical-books-pdf-guides" class="hover:text-white transition-colors">Medical Reference Books</a></li>
              <li><a href="/pay" class="hover:text-white transition-colors">Online Payment (Pay by Link)</a></li>
              <li><a href="/privacy-request" class="hover:text-white transition-colors">Grievance &amp; Privacy Portal</a></li>
            </ul>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-white uppercase tracking-wider mb-4">Legal &amp; Compliance</h3>
            <ul class="space-y-2 text-xs">
              <li><a href="/about" class="hover:text-white transition-colors">About Us</a></li>
              <li><a href="/contact" class="hover:text-white transition-colors">Contact &amp; Grievance Officer</a></li>
              <li><a href="/legal/terms" class="hover:text-white transition-colors">Terms &amp; Conditions</a></li>
              <li><a href="/legal/privacy" class="hover:text-white transition-colors">Privacy Notice (DPDP Act)</a></li>
              <li><a href="/legal/refund" class="hover:text-white transition-colors">Refund &amp; Cancellation Policy</a></li>
              <li><a href="/legal/disclaimer" class="hover:text-white transition-colors">Non-Affiliation Disclaimer</a></li>
            </ul>
          </div>
        </div>
        <div class="mt-12 pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>\xA9 2026 India Cyber Cafe. All rights reserved. Managed with strict consumer protection &amp; DPDP 2023 compliance.</p>
          <p><a href="/sitemap.xml" class="hover:text-slate-400">XML Sitemap</a> \u2022 <a href="/robots.txt" class="hover:text-slate-400">Robots.txt</a></p>
        </div>
      </div>
    </footer>
  `;
}
function renderUniversalPage(rawPath, baseUrl = PRODUCTION_DOMAIN, appRoot) {
  const cleanPath = (rawPath || "/").split("?")[0].replace(/\/+$/, "") || "/";
  const rootUrl = baseUrl.replace(/\/+$/, "");
  const data = getPublicData(appRoot);
  const headerHtml = renderHeader(cleanPath);
  const footerHtml = renderFooter();
  const buildResult = (status, title, description, canonicalPath, bodyContentHtml, options = {}) => {
    const safeTitle = escapeHtml(title.includes("India Cyber Cafe") ? title : `${title} | India Cyber Cafe`);
    const safeDesc = escapeHtml(cleanText(description));
    const canonicalUrl = canonicalPath === "/" ? `${rootUrl}/` : `${rootUrl}${canonicalPath}`;
    const safeImage = escapeHtml(options.image || DEFAULT_ICC_IMAGE);
    const robots = options.robots || (status === 200 ? "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" : "noindex, nofollow");
    const ogType = options.ogType || "website";
    const initialDataScript = `<script>window.__INITIAL_DATA__ = ${JSON.stringify(data)};</script>`;
    const ldJsonScript = options.structuredData ? `<script type="application/ld+json">${JSON.stringify(options.structuredData)}</script>` : "";
    const rootInnerHtml = `
      <div class="min-h-screen bg-slate-50 flex flex-col">
        ${headerHtml}
        <main class="flex-grow pt-[100px] pb-20 px-[3%] sm:px-[5%] w-full max-w-[1440px] mx-auto">
          ${bodyContentHtml}
        </main>
        ${footerHtml}
      </div>
    `;
    return {
      status,
      is404: Boolean(options.is404 || status === 404),
      metadata: {
        title: safeTitle,
        description: safeDesc,
        canonicalUrl,
        robots,
        ogType,
        image: safeImage
      },
      html: `
        <!-- SSR METADATA INJECTION -->
        <!-- TITLE: ${safeTitle} -->
        <!-- DESC: ${safeDesc} -->
        <!-- CANONICAL: ${canonicalUrl} -->
        <!-- ROBOTS: ${robots} -->
        <!-- OG_TYPE: ${ogType} -->
        <!-- OG_IMAGE: ${safeImage} -->
        ${ldJsonScript}
        ${initialDataScript}
        <div id="ssr-root-replacement">${rootInnerHtml}</div>
      `
    };
  };
  if (cleanPath === "/") {
    const popularServices = data.services.slice(0, 3);
    const popularProducts = data.products.filter((p) => p.inStock).slice(0, 3);
    const servicesGridHtml = popularServices.map(
      (s) => `
        <a href="/services/${escapeHtml(s.id)}" class="card group cursor-pointer p-4 sm:p-6 block">
          <div class="flex items-center justify-center mx-auto mb-3 sm:mb-4 transition-all ${s.icon && s.icon.startsWith("http") ? "w-full h-40 sm:h-48 rounded-xl border border-slate-200 overflow-hidden" : "w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-primary/10 to-navy/10 rounded-full group-hover:rotate-12 overflow-hidden"}">
            ${s.icon && s.icon.startsWith("http") ? `<img src="${escapeHtml(s.icon)}" alt="${escapeHtml(s.name)}" class="w-full h-full object-cover" width="200" height="200" loading="lazy" />` : `<span class="text-primary font-bold text-lg">\u26A1</span>`}
          </div>
          <h3 class="text-base sm:text-lg font-bold text-navy mb-1">${escapeHtml(s.name)}</h3>
          <p class="text-slate-500 text-[10px] sm:text-xs line-clamp-2">${escapeHtml(cleanText(s.description, 130))}</p>
        </a>
      `
    ).join("");
    const productsGridHtml = popularProducts.map(
      (p) => `
        <a href="/store/${escapeHtml(p.category)}/${escapeHtml(p.id)}" class="group cursor-pointer bg-white rounded-xl sm:rounded-2xl overflow-hidden border border-slate-200 hover:border-primary hover:shadow-lg transition-all block">
          <div class="relative aspect-square overflow-hidden bg-slate-100">
            ${p.images && p.images[0] ? `<img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.name)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" width="300" height="300" loading="lazy" />` : `<span class="text-3xl">\u{1F4E6}</span>`}
            ${p.discountedPrice && p.price > p.discountedPrice ? `<div class="absolute top-2 right-2 bg-red-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-bold">${Math.round((p.price - p.discountedPrice) / p.price * 100)}% OFF</div>` : ""}
          </div>
          <div class="p-3 sm:p-4">
            <h3 class="text-xs sm:text-sm font-bold text-navy mb-1 sm:mb-2 line-clamp-2 group-hover:text-primary transition-colors">${escapeHtml(p.name)}</h3>
            <p class="text-[9px] sm:text-xs text-slate-500 mb-2 sm:mb-3 line-clamp-1">${escapeHtml(cleanText(p.shortDescription, 80))}</p>
            <div class="flex items-center gap-2">
              <span class="text-xs sm:text-sm font-bold text-navy">\u20B9${p.discountedPrice || p.price}</span>
              ${p.discountedPrice && p.price > p.discountedPrice ? `<span class="text-[8px] sm:text-[9px] text-slate-400 line-through">\u20B9${p.price}</span>` : ""}
            </div>
          </div>
        </a>
      `
    ).join("");
    const bodyHtml2 = `
      <div class="space-y-8 sm:space-y-12">
        <!-- Hero Section -->
        <section class="bg-white p-6 sm:p-10 lg:p-12 rounded-3xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 md:gap-10 border border-slate-100">
          <div class="flex-1 space-y-3 sm:space-y-5 text-center md:text-left">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span> Verified CSC &amp; Digital Seva Portal
            </span>
            <h1 class="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-navy leading-tight">
              India Cyber Cafe <br />
              <span class="text-primary">Digital Seva Simplified</span>
            </h1>
            <p class="text-sm sm:text-base lg:text-lg text-slate-600 max-w-md mx-auto md:mx-0">
              Apply for Government Services, Jobs &amp; Documents online with India&#039;s trusted digital partner. Fast, secure, and reliable digital solutions.
            </p>
            <div class="flex flex-col sm:flex-row flex-wrap gap-3 justify-center md:justify-start pt-2">
              <a href="/services" class="btn-primary text-sm sm:text-base px-6 sm:px-8 py-2.5 sm:py-3 text-center inline-block">Apply Now</a>
              <a href="/track" class="btn-outline text-sm sm:text-base px-6 sm:px-8 py-2.5 sm:py-3 text-center inline-block">Track Status</a>
              <a href="/price-list" class="btn-outline text-sm sm:text-base px-6 sm:px-8 py-2.5 sm:py-3 text-center inline-block">Price List</a>
            </div>
          </div>
          <div class="hidden md:flex items-center justify-center shrink-0 w-[280px] h-[280px] bg-gradient-to-br from-primary/5 to-navy/5 rounded-3xl p-6 text-center">
            <div class="space-y-3">
              <div class="w-20 h-20 mx-auto rounded-2xl bg-white shadow-md flex items-center justify-center text-4xl">\u{1F3DB}\uFE0F</div>
              <div class="font-extrabold text-navy text-lg">One-Stop Digital Hub</div>
              <p class="text-xs text-slate-500">Government forms, PVC cards &amp; verified legal assistance</p>
            </div>
          </div>
        </section>

        <!-- Stats Section -->
        <section class="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div class="bg-white p-4 sm:p-8 rounded-2xl text-center shadow-md border-t-4 border-primary">
            <h3 class="text-xl sm:text-3xl font-bold text-navy mb-1">5000+</h3>
            <p class="text-[10px] sm:text-sm text-slate-500 font-medium uppercase tracking-wider">Active Users</p>
          </div>
          <div class="bg-white p-4 sm:p-8 rounded-2xl text-center shadow-md border-t-4 border-primary">
            <h3 class="text-xl sm:text-3xl font-bold text-navy mb-1">2500+</h3>
            <p class="text-[10px] sm:text-sm text-slate-500 font-medium uppercase tracking-wider">Applications</p>
          </div>
          <div class="bg-white p-4 sm:p-8 rounded-2xl text-center shadow-md border-t-4 border-primary">
            <h3 class="text-xl sm:text-3xl font-bold text-navy mb-1">24/7</h3>
            <p class="text-[10px] sm:text-sm text-slate-500 font-medium uppercase tracking-wider">Support</p>
          </div>
          <div class="bg-white p-4 sm:p-8 rounded-2xl text-center shadow-md border-t-4 border-primary">
            <h3 class="text-xl sm:text-3xl font-bold text-navy mb-1">4.9/5</h3>
            <p class="text-[10px] sm:text-sm text-slate-500 font-medium uppercase tracking-wider">Rating</p>
          </div>
        </section>

        <!-- Popular Services Section -->
        <section class="space-y-6 sm:space-y-8">
          <div class="text-center space-y-3 sm:space-y-4">
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">Popular Services</h2>
            <p class="text-sm sm:text-base text-slate-600">Online form application assistance with verified checklists</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            ${servicesGridHtml}
          </div>
          <div class="text-center">
            <a href="/services" class="btn-primary inline-block">View All Services \u2192</a>
          </div>
        </section>

        <!-- Features Section (Why Choose Us) -->
        <section class="space-y-6 sm:space-y-10">
          <h2 class="text-2xl sm:text-3xl font-bold text-navy text-center">Why Choose Us?</h2>
          <div class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6 lg:gap-8">
            <div class="bg-white p-4 sm:p-6 lg:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary">
              <h3 class="text-sm sm:text-base lg:text-xl font-bold text-navy mb-1 sm:mb-2">100% Secure</h3>
              <p class="text-[10px] sm:text-sm text-slate-600">Encrypted &amp; protected data under DPDP Act</p>
            </div>
            <div class="bg-white p-4 sm:p-6 lg:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary">
              <h3 class="text-sm sm:text-base lg:text-xl font-bold text-navy mb-1 sm:mb-2">Lightning Fast</h3>
              <p class="text-[10px] sm:text-sm text-slate-600">Instant application processing &amp; tracking</p>
            </div>
            <div class="bg-white p-4 sm:p-6 lg:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary">
              <h3 class="text-sm sm:text-base lg:text-xl font-bold text-navy mb-1 sm:mb-2">Mobile Friendly</h3>
              <p class="text-[10px] sm:text-sm text-slate-600">Access documents anywhere on phone or tablet</p>
            </div>
            <div class="bg-white p-4 sm:p-6 lg:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary">
              <h3 class="text-sm sm:text-base lg:text-xl font-bold text-navy mb-1 sm:mb-2">Expert Support</h3>
              <p class="text-[10px] sm:text-sm text-slate-600">Dedicated assistance via phone and WhatsApp</p>
            </div>
            <div class="bg-white p-4 sm:p-6 lg:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary">
              <h3 class="text-sm sm:text-base lg:text-xl font-bold text-navy mb-1 sm:mb-2">Easy Process</h3>
              <p class="text-[10px] sm:text-sm text-slate-600">Simple 3-step digital application flow</p>
            </div>
            <div class="bg-white p-4 sm:p-6 lg:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary">
              <h3 class="text-sm sm:text-base lg:text-xl font-bold text-navy mb-1 sm:mb-2">Real-time Updates</h3>
              <p class="text-[10px] sm:text-sm text-slate-600">Instant SMS, portal and tracking alerts</p>
            </div>
          </div>
        </section>

        <!-- Popular Products Section -->
        <section class="space-y-6 sm:space-y-8">
          <div class="text-center space-y-3 sm:space-y-4">
            <h2 class="text-2xl sm:text-3xl font-bold text-navy">Popular Products</h2>
            <p class="text-sm sm:text-base text-slate-600">Premium prints &amp; supplies with custom options</p>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5 lg:gap-6">
            ${productsGridHtml}
          </div>
          <div class="text-center">
            <a href="/store" class="btn-primary inline-block">Explore Store \u2192</a>
          </div>
        </section>

        <!-- Forms & Documents CTA -->
        <section class="rounded-3xl border border-primary/20 bg-white px-6 py-8 shadow-sm sm:px-10 lg:px-14">
          <div class="flex flex-col items-center justify-between gap-6 text-center md:flex-row md:text-left">
            <div class="max-w-3xl">
              <p class="text-xs font-black uppercase tracking-[0.24em] text-primary">Forms &amp; Documents</p>
              <p class="mt-3 text-sm font-medium leading-relaxed text-slate-600 sm:text-base lg:text-lg">
                If you need any forms or documents, visit our Forms &amp; Documents page for free verified original formats.
              </p>
            </div>
            <a href="/forms-documents" class="btn-primary whitespace-nowrap px-7 py-3 text-sm sm:text-base inline-block">
              View Forms &amp; Documents
            </a>
          </div>
        </section>
      </div>
    `;
    return buildResult(
      200,
      DEFAULT_ICC_TITLE,
      DEFAULT_ICC_DESC,
      "/",
      bodyHtml2,
      {
        ogType: "website",
        image: DEFAULT_ICC_IMAGE,
        structuredData: {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              "@id": `${rootUrl}/#website`,
              url: `${rootUrl}/`,
              name: "India Cyber Cafe",
              description: DEFAULT_ICC_DESC,
              publisher: {
                "@id": `${rootUrl}/#organization`
              },
              potentialAction: {
                "@type": "SearchAction",
                target: `${rootUrl}/services?q={search_term_string}`,
                "query-input": "required name=search_term_string"
              }
            },
            {
              "@type": "Organization",
              "@id": `${rootUrl}/#organization`,
              name: "India Cyber Cafe",
              url: `${rootUrl}/`,
              logo: DEFAULT_ICC_IMAGE,
              description: "Your trusted partner for digital government forms, CSC applications, and citizen services in India.",
              contactPoint: {
                "@type": "ContactPoint",
                telephone: "+91-9203251821",
                contactType: "customer service",
                areaServed: "IN",
                availableLanguage: ["en", "hi"]
              }
            }
          ]
        }
      }
    );
  }
  if (cleanPath === "/services") {
    const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Services" }];
    const servicesCards = data.services.map((s) => {
      const subservicesList = (s.subservices || []).map(
        (ss) => `
            <a href="/services/${escapeHtml(s.id)}/${slugify(ss.name)}" class="text-xs text-slate-700 bg-slate-100 hover:bg-primary/10 hover:text-primary px-2.5 py-1 rounded-md transition-colors">
              ${escapeHtml(ss.name)} ${ss.charge ? `(\u20B9${ss.charge})` : ""}
            </a>
          `
      ).join("");
      return `
          <article class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all space-y-4">
            <div class="flex items-start gap-4">
              <div class="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                ${s.icon && s.icon.startsWith("http") ? `<img src="${escapeHtml(s.icon)}" alt="${escapeHtml(s.name)}" class="w-10 h-10 object-contain" width="40" height="40" loading="lazy" />` : `<span class="text-2xl text-primary font-bold">\u{1F4C4}</span>`}
              </div>
              <div class="flex-grow">
                <h2 class="text-lg sm:text-xl font-bold text-navy">
                  <a href="/services/${escapeHtml(s.id)}" class="hover:text-primary transition-colors">${escapeHtml(s.name)}</a>
                </h2>
                <p class="text-xs sm:text-sm text-slate-600 mt-1 line-clamp-2">${escapeHtml(cleanText(s.description, 140))}</p>
              </div>
            </div>
            ${subservicesList ? `<div class="space-y-1.5 pt-2 border-t border-slate-100">
                    <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Sub-Services Available:</span>
                    <div class="flex flex-wrap gap-1.5">${subservicesList}</div>
                  </div>` : ""}
            <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span class="text-xs font-medium text-slate-500">${(s.subservices || []).length} Options Available</span>
              <a href="/services/${escapeHtml(s.id)}" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-white hover:bg-primary-dark transition-colors">
                Apply Online \u2192
              </a>
            </div>
          </article>
        `;
    }).join("");
    const bodyHtml2 = `
      <div class="space-y-8">
        ${renderBreadcrumbs(breadcrumbs)}
        <div class="text-center max-w-2xl mx-auto space-y-2">
          <h1 class="text-3xl sm:text-4xl font-extrabold text-navy">All Digital &amp; Government Services</h1>
          <p class="text-xs sm:text-sm text-slate-500">
            Browse ${data.services.length} available service categories. Select a service to see required documents, charges, and online application forms.
          </p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          ${servicesCards}
        </div>
      </div>
    `;
    return buildResult(
      200,
      "All Digital Services & CSC Online Applications",
      `Browse all ${data.services.length} government & digital services online at India Cyber Cafe. Apply for PAN card, Aadhaar UCL, Voter ID, Certificates, and CSC forms.`,
      "/services",
      bodyHtml2,
      {
        ogType: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "OfferCatalog",
          name: "India Cyber Cafe Digital Services",
          numberOfItems: data.services.length,
          itemListElement: data.services.map((s) => ({
            "@type": "Offer",
            name: s.name,
            url: `${rootUrl}/services/${s.id}`,
            description: s.description
          }))
        }
      }
    );
  }
  const subserviceMatch = cleanPath.match(/^\/services\/([^/]+)\/([^/]+)$/);
  if (subserviceMatch) {
    const [, serviceId, subserviceParam] = subserviceMatch;
    const service = findService(serviceId, appRoot);
    if (service) {
      const subservice = findSubservice(service, subserviceParam);
      if (subservice) {
        const canonical = `/services/${service.id}/${slugify(subservice.name)}`;
        const breadcrumbs = [
          { label: "Home", href: "/" },
          { label: "Services", href: "/services" },
          { label: service.name, href: `/services/${service.id}` },
          { label: subservice.name }
        ];
        const chargeText = subservice.charge !== void 0 ? `\u20B9${subservice.charge}` : "Market Rate";
        const origChargeText = subservice.originalCharge ? `\u20B9${subservice.originalCharge}` : "";
        const fieldsList = (subservice.fields || service.fields || []).map((f) => `<li class="flex items-center gap-2"><span class="text-primary font-bold">\u2713</span> ${escapeHtml(f.label || f.name)} ${f.required ? '<span class="text-rose-500">*</span>' : ""}</li>`).join("");
        const bodyHtml2 = `
          <div class="space-y-8 max-w-4xl mx-auto">
            ${renderBreadcrumbs(breadcrumbs)}
            <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm space-y-8">
              <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 pb-6 border-b border-slate-200">
                <div class="space-y-2">
                  <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                    ${escapeHtml(service.name)} Sub-Service
                  </span>
                  <h1 class="text-2xl sm:text-4xl font-extrabold text-navy">${escapeHtml(subservice.name)}</h1>
                  <p class="text-xs sm:text-sm text-slate-500">Official digital assistance and online submission at India Cyber Cafe.</p>
                </div>
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:text-right shrink-0">
                  <span class="text-xs text-slate-500 block">Service Fee / Charge</span>
                  <div class="flex items-baseline gap-2">
                    <span class="text-2xl sm:text-3xl font-extrabold text-navy">${chargeText}</span>
                    ${origChargeText ? `<span class="text-xs text-slate-400 line-through">${origChargeText}</span>` : ""}
                  </div>
                  <span class="text-[11px] text-emerald-600 font-semibold block mt-0.5">Includes Verification &amp; Filing</span>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <section class="space-y-4">
                  <h2 class="text-lg font-bold text-navy flex items-center gap-2">
                    <span class="w-2 h-5 bg-primary rounded-full"></span>
                    Required Information &amp; Documents
                  </h2>
                  <p class="text-xs sm:text-sm text-slate-600">Please prepare the following details before proceeding with application submission:</p>
                  <ul class="text-xs sm:text-sm space-y-2 text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    ${fieldsList || "<li>Standard Identity Proof (Aadhaar / Voter ID / PAN)</li><li>Address Proof</li><li>Active Mobile Number &amp; Email</li>"}
                  </ul>
                </section>
                <section class="space-y-4">
                  <h2 class="text-lg font-bold text-navy flex items-center gap-2">
                    <span class="w-2 h-5 bg-primary rounded-full"></span>
                    Service Highlights
                  </h2>
                  <div class="space-y-3 text-xs sm:text-sm text-slate-600">
                    <div class="p-3 rounded-xl border border-slate-100 bg-white">
                      <strong>\u26A1 Turnaround Time:</strong> Fast processing, verified within 24\u201348 hours.
                    </div>
                    <div class="p-3 rounded-xl border border-slate-100 bg-white">
                      <strong>\u{1F6E1}\uFE0F Data Protection:</strong> Compliant with DPDP Act 2023. No unauthorized storage.
                    </div>
                    <div class="p-3 rounded-xl border border-slate-100 bg-white">
                      <strong>\u{1F4DE} Tracking:</strong> Application acknowledgment receipt provided immediately upon completion.
                    </div>
                  </div>
                </section>
              </div>

              <div class="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <a href="/services/${escapeHtml(service.id)}" class="text-xs sm:text-sm text-slate-600 hover:text-navy font-semibold">
                  \u2190 Back to ${escapeHtml(service.name)}
                </a>
                <a href="/login?redirect=${encodeURIComponent(canonical)}" class="w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-sm bg-primary text-white hover:bg-primary-dark transition-all text-center shadow-md">
                  Apply Online Now (${chargeText})
                </a>
              </div>
            </article>
          </div>
        `;
        return buildResult(
          200,
          `${subservice.name} - ${service.name} | India Cyber Cafe`,
          `Apply online for ${subservice.name} under ${service.name} at India Cyber Cafe. Service charge: ${chargeText}. Fast processing and verified submission.`,
          canonical,
          bodyHtml2,
          {
            ogType: "article",
            structuredData: {
              "@context": "https://schema.org",
              "@type": "Service",
              name: `${subservice.name} (${service.name})`,
              description: `Apply online for ${subservice.name} under ${service.name} at India Cyber Cafe.`,
              provider: {
                "@type": "LocalBusiness",
                name: "India Cyber Cafe",
                url: rootUrl
              },
              offers: {
                "@type": "Offer",
                price: subservice.charge || 0,
                priceCurrency: "INR",
                url: `${rootUrl}${canonical}`
              }
            }
          }
        );
      }
    }
  }
  const serviceDetailMatch = cleanPath.match(/^\/services\/([^/]+)$/);
  if (serviceDetailMatch) {
    const [, serviceId] = serviceDetailMatch;
    const service = findService(serviceId, appRoot);
    if (service) {
      const canonical = `/services/${service.id}`;
      const breadcrumbs = [
        { label: "Home", href: "/" },
        { label: "Services", href: "/services" },
        { label: service.name }
      ];
      const subservicesHtml = (service.subservices || []).map(
        (ss) => `
          <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <h3 class="text-base font-bold text-navy">${escapeHtml(ss.name)}</h3>
                <span class="text-sm font-extrabold text-primary">\u20B9${ss.charge || 0}</span>
              </div>
              <p class="text-xs text-slate-500 mb-4">Official application assistance, data entry &amp; online submission.</p>
            </div>
            <a href="/services/${escapeHtml(service.id)}/${slugify(ss.name)}" class="text-xs font-bold text-primary hover:underline text-right block">
              Apply for ${escapeHtml(ss.name)} \u2192
            </a>
          </div>
        `
      ).join("");
      const bodyHtml2 = `
        <div class="space-y-8 max-w-5xl mx-auto">
          ${renderBreadcrumbs(breadcrumbs)}
          <header class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div class="flex items-start gap-5">
              <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                ${service.icon && service.icon.startsWith("http") ? `<img src="${escapeHtml(service.icon)}" alt="${escapeHtml(service.name)}" class="w-12 h-12 object-contain" width="48" height="48" />` : `<span class="text-3xl text-primary font-bold">\u{1F4C4}</span>`}
              </div>
              <div>
                <h1 class="text-2xl sm:text-3xl font-extrabold text-navy">${escapeHtml(service.name)}</h1>
                <p class="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed max-w-2xl">${escapeHtml(service.description)}</p>
              </div>
            </div>
            <div class="shrink-0 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
              <span class="text-xs text-slate-500 block">Available Options</span>
              <span class="text-2xl font-extrabold text-navy">${(service.subservices || []).length}</span>
              <span class="text-[11px] text-slate-400 block">Sub-services</span>
            </div>
          </header>

          <section class="space-y-4">
            <h2 class="text-xl font-bold text-navy">Select a Sub-Service to Apply</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              ${subservicesHtml || '<p class="text-slate-500 text-sm">No subservices currently listed.</p>'}
            </div>
          </section>

          <section class="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4">
            <h2 class="text-lg font-bold text-navy">General Requirements &amp; Process</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs sm:text-sm text-slate-600">
              <div class="space-y-1">
                <strong>1. Submit Details:</strong> Choose your desired sub-service and fill in the required applicant information.
              </div>
              <div class="space-y-1">
                <strong>2. Document Check:</strong> Our operators verify your uploaded documents for compliance with portal rules.
              </div>
              <div class="space-y-1">
                <strong>3. Receipt &amp; Status:</strong> Receive your official government acknowledgment receipt and track status online.
              </div>
            </div>
          </section>
        </div>
      `;
      return buildResult(
        200,
        `${service.name} - Online Application & Guidelines`,
        `Apply online for ${service.name} at India Cyber Cafe. ${cleanText(service.description, 140)} ${(service.subservices || []).length} sub-services available.`,
        canonical,
        bodyHtml2,
        {
          ogType: "article",
          structuredData: {
            "@context": "https://schema.org",
            "@type": "Service",
            name: service.name,
            description: service.description,
            provider: {
              "@type": "LocalBusiness",
              name: "India Cyber Cafe",
              url: rootUrl
            }
          }
        }
      );
    }
  }
  if (cleanPath === "/price-list") {
    const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Price List" }];
    const serviceRows = data.services.flatMap(
      (s) => (s.subservices || []).map(
        (ss) => `
          <tr class="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
            <td class="py-3 px-4 text-xs sm:text-sm font-semibold text-navy">
              <a href="/services/${escapeHtml(s.id)}" class="hover:text-primary">${escapeHtml(s.name)}</a>
            </td>
            <td class="py-3 px-4 text-xs sm:text-sm text-slate-700">
              <a href="/services/${escapeHtml(s.id)}/${slugify(ss.name)}" class="hover:text-primary font-medium">${escapeHtml(ss.name)}</a>
            </td>
            <td class="py-3 px-4 text-xs sm:text-sm font-extrabold text-navy">
              \u20B9${ss.charge || 0}
            </td>
            <td class="py-3 px-4 text-xs text-slate-400">
              ${ss.originalCharge ? `\u20B9${ss.originalCharge}` : "\u2014"}
            </td>
            <td class="py-3 px-4 text-xs sm:text-sm text-right">
              <a href="/services/${escapeHtml(s.id)}/${slugify(ss.name)}" class="text-xs font-bold text-primary hover:underline">Apply \u2192</a>
            </td>
          </tr>
        `
      )
    ).join("");
    const productRows = data.products.map(
      (p) => `
        <tr class="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
          <td class="py-3 px-4 text-xs sm:text-sm font-semibold text-navy">
            <a href="/store/${escapeHtml(p.category)}/${escapeHtml(p.id)}" class="hover:text-primary">${escapeHtml(p.name)}</a>
          </td>
          <td class="py-3 px-4 text-xs sm:text-sm text-slate-500 capitalize">
            ${escapeHtml(p.category.replace(/-/g, " "))}
          </td>
          <td class="py-3 px-4 text-xs sm:text-sm font-extrabold text-navy">
            \u20B9${p.discountedPrice || p.price}
          </td>
          <td class="py-3 px-4 text-xs text-slate-400">
            ${p.discountedPrice && p.price > p.discountedPrice ? `\u20B9${p.price}` : "\u2014"}
          </td>
          <td class="py-3 px-4 text-xs sm:text-sm text-right">
            <a href="/store/${escapeHtml(p.category)}/${escapeHtml(p.id)}" class="text-xs font-bold text-primary hover:underline">View \u2192</a>
          </td>
        </tr>
      `
    ).join("");
    const bodyHtml2 = `
      <div class="space-y-8 max-w-5xl mx-auto">
        ${renderBreadcrumbs(breadcrumbs)}
        <div class="text-center max-w-2xl mx-auto space-y-2">
          <h1 class="text-3xl sm:text-4xl font-extrabold text-navy">Official Price List &amp; Service Charges</h1>
          <p class="text-xs sm:text-sm text-slate-500">
            Complete transparent rate card for all government forms, online applications, PVC card printing, and store items.
          </p>
        </div>

        <section class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-6 sm:p-8">
          <h2 class="text-xl font-bold text-navy">Digital Services &amp; Government Applications</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50">
                  <th class="py-3 px-4">Service</th>
                  <th class="py-3 px-4">Sub-Service</th>
                  <th class="py-3 px-4">Portal Charge</th>
                  <th class="py-3 px-4">Regular Charge</th>
                  <th class="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                ${serviceRows}
              </tbody>
            </table>
          </div>
        </section>

        <section class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-6 sm:p-8">
          <h2 class="text-xl font-bold text-navy">Store Products &amp; PVC Smart Cards</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50">
                  <th class="py-3 px-4">Product Name</th>
                  <th class="py-3 px-4">Category</th>
                  <th class="py-3 px-4">Price</th>
                  <th class="py-3 px-4">MRP</th>
                  <th class="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                ${productRows}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
    return buildResult(
      200,
      "Price List - Services, Subservices & Products | India Cyber Cafe",
      "Transparent price list and service charges for all government applications, online forms, PVC smart cards, and print products at India Cyber Cafe.",
      "/price-list",
      bodyHtml2,
      {
        ogType: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "OfferCatalog",
          name: "India Cyber Cafe Price List",
          itemListElement: [
            ...data.services.flatMap(
              (s) => (s.subservices || []).map((ss) => ({
                "@type": "Offer",
                name: `${s.name} - ${ss.name}`,
                price: ss.charge || 0,
                priceCurrency: "INR",
                url: `${rootUrl}/services/${s.id}/${slugify(ss.name)}`
              }))
            ),
            ...data.products.map((p) => ({
              "@type": "Offer",
              name: p.name,
              price: p.discountedPrice || p.price,
              priceCurrency: "INR",
              url: `${rootUrl}/store/${p.category}/${p.id}`
            }))
          ]
        }
      }
    );
  }
  const storeCatMatch = cleanPath.match(/^\/store(?:\/([^/]+))?$/);
  if (storeCatMatch && cleanPath !== "/store/order-confirmation") {
    const categoryParam = storeCatMatch[1];
    const category = categoryParam ? findProductCategory(categoryParam, appRoot) : void 0;
    const isCategoryFilter = Boolean(categoryParam && category);
    if (categoryParam && !category) {
      const product = findProduct(categoryParam, appRoot);
      if (!product) {
        return buildResult(
          404,
          "Category Not Found",
          "The requested store category does not exist at India Cyber Cafe.",
          cleanPath,
          `<div class="text-center py-20 space-y-4">
            <h1 class="text-3xl font-bold text-navy">Store Category Not Found</h1>
            <p class="text-slate-500 text-sm">We could not find the category you requested.</p>
            <a href="/store" class="btn-primary inline-block">Back to Store</a>
          </div>`,
          { is404: true }
        );
      }
    }
    const filteredProducts = isCategoryFilter ? data.products.filter((p) => p.category === category.id && p.inStock) : data.products.filter((p) => p.inStock);
    const categoriesNavHtml = [
      { id: "all", name: "All Products", href: "/store" },
      ...data.productCategories.map((c) => ({ id: c.id, name: c.name, href: `/store/${c.id}` }))
    ].map(
      (c) => `
        <a href="${c.href}" class="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${isCategoryFilter && category.id === c.id || !isCategoryFilter && c.id === "all" ? "bg-primary text-white shadow-sm" : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"}">${escapeHtml(c.name)}</a>
      `
    ).join("");
    const productCardsHtml = filteredProducts.map(
      (p) => `
        <article class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
          <div>
            <div class="aspect-square rounded-xl bg-slate-100 mb-4 overflow-hidden flex items-center justify-center">
              ${p.images && p.images[0] ? `<img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.name)}" class="w-full h-full object-cover" width="300" height="300" loading="lazy" />` : `<span class="text-3xl">\u{1F4E6}</span>`}
            </div>
            <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">${escapeHtml(p.category.replace(/-/g, " "))}</span>
            <h2 class="text-sm sm:text-base font-bold text-navy mb-1 line-clamp-2">
              <a href="/store/${escapeHtml(p.category)}/${escapeHtml(p.id)}" class="hover:text-primary transition-colors">${escapeHtml(p.name)}</a>
            </h2>
            <p class="text-xs text-slate-500 line-clamp-2 mb-3">${escapeHtml(cleanText(p.shortDescription, 90))}</p>
          </div>
          <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
            <div>
              <span class="text-base font-extrabold text-navy">\u20B9${p.discountedPrice || p.price}</span>
              ${p.discountedPrice && p.price > p.discountedPrice ? `<span class="text-xs text-slate-400 line-through ml-1.5">\u20B9${p.price}</span>` : ""}
            </div>
            <a href="/store/${escapeHtml(p.category)}/${escapeHtml(p.id)}" class="text-xs font-bold text-primary hover:underline">View Product \u2192</a>
          </div>
        </article>
      `
    ).join("");
    const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Store", href: "/store" }];
    if (isCategoryFilter) {
      breadcrumbs.push({ label: category.name });
    }
    const bodyHtml2 = `
      <div class="space-y-8">
        ${renderBreadcrumbs(breadcrumbs)}
        <div class="text-center max-w-2xl mx-auto space-y-2">
          <h1 class="text-3xl sm:text-4xl font-extrabold text-navy">
            ${isCategoryFilter ? escapeHtml(category.name) : "Online Store \u2014 PVC Cards &amp; Supplies"}
          </h1>
          <p class="text-xs sm:text-sm text-slate-500">
            ${isCategoryFilter ? escapeHtml(category.description || "") : "Custom printed PVC cards, identity stationery, reference books, and digital guides."}
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-2">
          ${categoriesNavHtml}
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          ${productCardsHtml || `<div class="col-span-full text-center py-12 space-y-3 bg-white rounded-2xl border border-slate-200 p-8 max-w-xl mx-auto">
              <p class="text-slate-800 text-sm font-bold">Products in the ${isCategoryFilter ? escapeHtml(category.name) : "selected"} category are currently restocking or made-to-order.</p>
              <p class="text-slate-600 text-xs leading-relaxed">India Cyber Cafe provides custom merchandise, CSC operator uniforms, identity cards, and printed stationery. For custom bulk orders, direct inquiries, or assistance, please contact our support desk.</p>
              <div class="pt-2"><a href="/contact" class="inline-block px-5 py-2.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary-dark transition-all shadow-sm">Contact Store Desk</a></div>
            </div>`}
        </div>
      </div>
    `;
    return buildResult(
      200,
      isCategoryFilter ? `${category.name} - Online Store` : "Online Store - PVC Smart Cards & Printing Products",
      isCategoryFilter ? `Shop ${category.name} online at India Cyber Cafe. ${cleanText(category.description, 130)}` : `Shop custom printed t-shirts, PVC smart cards, medical reference books, and digital guides at India Cyber Cafe.`,
      isCategoryFilter ? `/store/${category.id}` : "/store",
      bodyHtml2,
      {
        ogType: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "OfferCatalog",
          name: isCategoryFilter ? category.name : "India Cyber Cafe Store",
          itemListElement: filteredProducts.map((p) => ({
            "@type": "Offer",
            name: p.name,
            price: p.discountedPrice || p.price,
            priceCurrency: "INR",
            url: `${rootUrl}/store/${p.category}/${p.id}`
          }))
        }
      }
    );
  }
  const productDetailMatch = cleanPath.match(/^\/store\/([^/]+)\/([^/]+)$/);
  if (productDetailMatch && cleanPath !== "/store/order-confirmation") {
    const [, categoryId, productId] = productDetailMatch;
    const product = findProduct(productId, appRoot) || findProduct(categoryId, appRoot);
    if (product) {
      const canonical = `/store/${product.category}/${product.id}`;
      const breadcrumbs = [
        { label: "Home", href: "/" },
        { label: "Store", href: "/store" },
        { label: product.category, href: `/store/${product.category}` },
        { label: product.name }
      ];
      const price = product.discountedPrice || product.price;
      const mrp = product.price;
      const image = product.images && product.images[0] ? product.images[0] : DEFAULT_ICC_IMAGE;
      const bodyHtml2 = `
        <div class="space-y-8 max-w-5xl mx-auto">
          ${renderBreadcrumbs(breadcrumbs)}
          <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
            <div>
              <div class="aspect-square rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 flex items-center justify-center">
                <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" class="w-full h-full object-contain p-4" width="500" height="500" loading="eager" />
              </div>
            </div>
            <div class="space-y-6">
              <div class="space-y-2">
                <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary capitalize">
                  ${escapeHtml(product.category.replace(/-/g, " "))}
                </span>
                <h1 class="text-2xl sm:text-3xl font-extrabold text-navy leading-tight">${escapeHtml(product.name)}</h1>
                <div class="flex items-baseline gap-3 pt-2">
                  <span class="text-3xl font-extrabold text-navy">\u20B9${price}</span>
                  ${product.discountedPrice && mrp > price ? `<span class="text-base text-slate-400 line-through">\u20B9${mrp}</span>` : ""}
                  ${product.discountedPrice && mrp > price ? `<span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">Save \u20B9${mrp - price}</span>` : ""}
                </div>
              </div>

              <div class="space-y-2 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-b border-slate-100 py-4">
                <p><strong>Status:</strong> ${product.inStock ? '<span class="text-emerald-600 font-bold">In Stock</span>' : '<span class="text-rose-500 font-bold">Out of Stock</span>'}</p>
                ${product.turnaroundTime ? `<p><strong>Delivery Time:</strong> ${escapeHtml(product.turnaroundTime)}</p>` : ""}
                ${product.deliveryCharges !== void 0 ? `<p><strong>Delivery Charges:</strong> ${product.deliveryCharges === 0 ? "Free Delivery" : `\u20B9${product.deliveryCharges}`}</p>` : ""}
              </div>

              <div class="space-y-3">
                <h2 class="text-sm font-bold text-navy uppercase tracking-wider">Product Description</h2>
                <div class="text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                  ${escapeHtml(product.longDescription || product.shortDescription || "")}
                </div>
              </div>

              <div class="pt-4 flex flex-col sm:flex-row gap-3">
                <a href="/login?redirect=${encodeURIComponent(canonical)}" class="px-6 py-3.5 rounded-xl font-bold text-sm bg-primary text-white hover:bg-primary-dark transition-all text-center shadow-md">
                  Buy Now \u2014 \u20B9${price}
                </a>
                <a href="/store" class="px-6 py-3.5 rounded-xl font-semibold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all text-center">
                  Continue Shopping
                </a>
              </div>
            </div>
          </article>
        </div>
      `;
      return buildResult(
        200,
        `${product.seoTitle || product.name} | India Cyber Cafe Store`,
        cleanText(product.shortDescription || product.seoDescription || product.name) + ` | Price: \u20B9${price}`,
        canonical,
        bodyHtml2,
        {
          ogType: "product",
          image,
          structuredData: {
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.name,
            image: [image],
            description: cleanText(product.shortDescription || product.longDescription),
            offers: {
              "@type": "Offer",
              price,
              priceCurrency: "INR",
              availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
              url: `${rootUrl}${canonical}`
            }
          }
        }
      );
    }
  }
  const formsMatch = cleanPath.match(/^\/forms-documents(?:\/([^/]+))?$/);
  if (formsMatch) {
    const param = formsMatch[1];
    const { doc, category } = param ? findDocument(param, void 0, appRoot) : { doc: void 0, category: void 0 };
    if (doc) {
      const catSlug = slugify(doc.category || "general");
      const docSlug = slugify(doc.name);
      const canonical = `/forms-documents/${catSlug}/${docSlug}`;
      const breadcrumbs = [
        { label: "Home", href: "/" },
        { label: "Forms & Documents", href: "/forms-documents" },
        { label: doc.name }
      ];
      const bodyHtml2 = `
        <div class="space-y-8 max-w-4xl mx-auto">
          ${renderBreadcrumbs(breadcrumbs)}
          <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm space-y-6">
            <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
              ${escapeHtml(doc.category || "Official Document")}
            </span>
            <h1 class="text-2xl sm:text-4xl font-extrabold text-navy">${escapeHtml(doc.name)}</h1>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
              ${escapeHtml(
        doc.description && doc.description.trim().length > 10 ? doc.description : `Official PDF document and verified application format for ${doc.name} (${doc.category || "Official Document"}). Free download provided by India Cyber Cafe public repository for applicants, students, and citizens. Verified authentic original copy.`
      )}
            </p>
            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div class="text-xs text-slate-500">
                <p><strong>File Format:</strong> ${escapeHtml(doc.fileType || "PDF")}</p>
                <p><strong>Verified Source:</strong> India Cyber Cafe Public Repository</p>
              </div>
              <a href="${escapeHtml(doc.downloadUrl || doc.previewUrl || "#")}" download class="px-6 py-3 rounded-xl font-bold text-sm bg-primary text-white hover:bg-primary-dark transition-all text-center shadow-md">
                Download Official PDF \u2193
              </a>
            </div>
          </article>
        </div>
      `;
      return buildResult(
        200,
        `${doc.name} - Free PDF Download & Guidelines | India Cyber Cafe`,
        `Download official ${doc.name} PDF format for free at India Cyber Cafe. ${cleanText(doc.description, 130)}`,
        canonical,
        bodyHtml2,
        {
          ogType: "article",
          structuredData: {
            "@context": "https://schema.org",
            "@type": "DigitalDocument",
            name: doc.name,
            description: doc.description || `Official PDF download of ${doc.name}`,
            url: `${rootUrl}${canonical}`
          }
        }
      );
    }
    if (param && !doc && !category) {
    } else {
      const isCategoryFilter = Boolean(param && category);
      const filteredDocs = isCategoryFilter ? data.documents.filter((d) => slugify(d.category || "") === slugify(category.name)) : data.documents;
      const docCardsHtml = filteredDocs.map((d) => {
        const catSlug = slugify(d.category || "general");
        const docSlug = slugify(d.name);
        return `
        <article class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4">
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">${escapeHtml(d.category || "Document")}</span>
              <span class="text-xs font-bold text-slate-400">PDF</span>
            </div>
            <h2 class="text-base font-bold text-navy">
              <a href="/forms-documents/${catSlug}/${docSlug}" class="hover:text-primary transition-colors">${escapeHtml(d.name)}</a>
            </h2>
            <p class="text-xs text-slate-500 mt-2 line-clamp-2">${escapeHtml(cleanText(d.description, 100) || "Official PDF form and guidance.")}</p>
          </div>
          <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
            <a href="/forms-documents/${catSlug}/${docSlug}" class="text-xs font-semibold text-slate-600 hover:text-navy">Details \u2192</a>
            <a href="${escapeHtml(d.downloadUrl || d.previewUrl || "#")}" download class="text-xs font-bold text-primary hover:underline">Download PDF \u2193</a>
          </div>
        </article>
      `;
      }).join("");
      const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Forms & Documents" }];
      if (isCategoryFilter) breadcrumbs.push({ label: category.name });
      const bodyHtml2 = `
      <div class="space-y-8">
        ${renderBreadcrumbs(breadcrumbs)}
        <div class="text-center max-w-2xl mx-auto space-y-2">
          <h1 class="text-3xl sm:text-4xl font-extrabold text-navy">Government Forms &amp; PDF Downloads</h1>
          <p class="text-xs sm:text-sm text-slate-500">
            Free download official application forms, certificates, PYQ papers, and guidelines in PDF format.
          </p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          ${docCardsHtml || '<p class="text-slate-500 text-sm col-span-full text-center py-12">No documents currently available in this section.</p>'}
        </div>
      </div>
    `;
      return buildResult(
        200,
        isCategoryFilter ? `${category.name} - Forms & PDF Downloads | India Cyber Cafe` : "Government Forms & PDF Downloads | India Cyber Cafe",
        isCategoryFilter ? `Download official ${category.name} application forms, formats and documents in PDF for free at India Cyber Cafe.` : "Free download official PDF application forms for government services, caste certificates, income certificates, and guidelines at India Cyber Cafe.",
        isCategoryFilter ? `/forms-documents/${slugify(category.name)}` : "/forms-documents",
        bodyHtml2,
        {
          ogType: "website",
          structuredData: {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: isCategoryFilter ? `${category.name} Forms` : "Government Forms & PDF Document Downloads",
            description: `Official PDF forms directory for ${isCategoryFilter ? category.name : "government and academic services"}.`,
            url: `${rootUrl}${isCategoryFilter ? `/forms-documents/${slugify(category.name)}` : "/forms-documents"}`
          }
        }
      );
    }
  }
  const nestedDocMatch = cleanPath.match(/^\/forms-documents\/([^/]+)\/([^/]+)$/);
  if (nestedDocMatch) {
    const [, catSlug, pdfSlug] = nestedDocMatch;
    const { doc } = findDocument(catSlug, pdfSlug, appRoot);
    if (doc) {
      const canonical = `/forms-documents/${catSlug}/${pdfSlug}`;
      const breadcrumbs = [
        { label: "Home", href: "/" },
        { label: "Forms & Documents", href: "/forms-documents" },
        { label: doc.category || "Category", href: `/forms-documents/${catSlug}` },
        { label: doc.name }
      ];
      const bodyHtml2 = `
        <div class="space-y-8 max-w-4xl mx-auto">
          ${renderBreadcrumbs(breadcrumbs)}
          <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm space-y-6">
            <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
              ${escapeHtml(doc.category || "Official Document")}
            </span>
            <h1 class="text-2xl sm:text-4xl font-extrabold text-navy">${escapeHtml(doc.name)}</h1>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
              ${escapeHtml(
        `Official PDF document and verified academic/examination format for ${doc.name} (${doc.category || "Official Document"}). ${doc.description ? `Subject details: ${doc.description}. ` : ""}Free direct download provided by India Cyber Cafe public repository for applicants, students, and citizens. Verified authentic original copy with official syllabus alignment and reference support.`
      )}
            </p>
            <div class="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div class="text-xs text-slate-500 space-y-1">
                <p><strong>File Format:</strong> ${escapeHtml(doc.fileType || "PDF")}</p>
                <p><strong>Classification:</strong> ${escapeHtml(doc.category || "Official Repository")}</p>
                <p><strong>Verification:</strong> Verified Authentic Document</p>
              </div>
              <a href="${escapeHtml(doc.downloadUrl || doc.previewUrl || "#")}" download class="px-6 py-3 rounded-xl font-bold text-sm bg-primary text-white hover:bg-primary-dark transition-all text-center shadow-md">
                Download Official PDF \u2193
              </a>
            </div>
            <div class="mt-4 pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-500">
              <h2 class="text-sm font-bold text-navy">Document Access &amp; Printing Assistance</h2>
              <p>
                This reference document is maintained in the India Cyber Cafe public repository for free citizen and student access. If you need a physical printout, spiral binding, color lamination, or assistance submitting official forms, you can visit our nearest centre or upload it to your personal My Documents Drive vault.
              </p>
            </div>
          </article>
        </div>
      `;
      return buildResult(
        200,
        `${doc.name} - Official PDF Download & Guidelines | India Cyber Cafe`,
        `Download official ${doc.name} PDF format for free at India Cyber Cafe. ${cleanText(doc.description, 130)}`,
        canonical,
        bodyHtml2,
        {
          ogType: "article",
          structuredData: {
            "@context": "https://schema.org",
            "@type": "DigitalDocument",
            name: doc.name,
            description: doc.description || `Official PDF download of ${doc.name}`,
            url: `${rootUrl}${canonical}`
          }
        }
      );
    }
  }
  if (cleanPath === "/about") {
    const breadcrumbs = [{ label: "Home", href: "/" }, { label: "About Us" }];
    const bodyHtml2 = `
      <div class="space-y-8 max-w-4xl mx-auto">
        ${renderBreadcrumbs(breadcrumbs)}
        <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-12 shadow-sm space-y-8">
          <div class="border-b border-slate-100 pb-6">
            <h1 class="text-3xl sm:text-4xl font-extrabold text-navy">About India Cyber Cafe</h1>
            <p class="text-xs sm:text-sm text-slate-500 mt-2">Connecting Citizens with Digital India &amp; Government Portals Since 2020</p>
          </div>
          <section class="space-y-4 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <h2 class="text-lg font-bold text-navy">Our Mission</h2>
            <p>
              India Cyber Cafe is a premier Common Service Centre (CSC) facilitator and digital consultation hub dedicated to bridging the technological gap for citizens, students, and businesses. We simplify complex online forms, government schemes, identity documents, and certification processes with accuracy, security, and prompt assistance.
            </p>
            <h2 class="text-lg font-bold text-navy">What We Offer</h2>
            <ul class="list-disc pl-5 space-y-1.5 text-slate-700">
              <li><strong>Government Schemes &amp; Forms:</strong> PAN card issuance/corrections, Aadhaar UCL operator consultation, domicile, caste certificates, and voter ID registration.</li>
              <li><strong>Smart PVC Card Printing:</strong> High-durability smart ID cards, health cards, and employee badges.</li>
              <li><strong>Educational Materials &amp; Guides:</strong> Verified university question papers, examination forms, and reference medical materials.</li>
              <li><strong>Safe Online Payments:</strong> Instant UPI, card, and net banking payment gateways for government fees and services.</li>
            </ul>
            <h2 class="text-lg font-bold text-navy">Commitment to Consumer Protection &amp; Privacy</h2>
            <p>
              We operate strictly under the Digital Personal Data Protection (DPDP) Act, 2023 and the Consumer Protection (E-Commerce) Rules, 2020. Customer data is handled with highest fiduciary care, never sold, and deleted upon request via our statutory privacy portal.
            </p>
          </section>
        </article>
      </div>
    `;
    return buildResult(
      200,
      "About Us - India Cyber Cafe | Trusted Digital Partner",
      "Learn about India Cyber Cafe, our mission to simplify digital government services, cyber cafe facilities, location in Singrauli MP, and team.",
      "/about",
      bodyHtml2,
      {
        ogType: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: "About India Cyber Cafe",
          description: "Official background, mission, and services of India Cyber Cafe.",
          url: `${rootUrl}/about`
        }
      }
    );
  }
  if (cleanPath === "/contact") {
    const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Contact Us" }];
    const bodyHtml2 = `
      <div class="space-y-8 max-w-4xl mx-auto">
        ${renderBreadcrumbs(breadcrumbs)}
        <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-12 shadow-sm space-y-8">
          <div class="border-b border-slate-100 pb-6">
            <h1 class="text-3xl sm:text-4xl font-extrabold text-navy">Contact &amp; Grievance Redressal</h1>
            <p class="text-xs sm:text-sm text-slate-500 mt-2">Get in touch with customer care, technical assistance, or our Grievance Redressal Officer</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs sm:text-sm text-slate-600">
            <section class="space-y-4">
              <h2 class="text-lg font-bold text-navy">Head Office &amp; Physical Center</h2>
              <p>\u{1F4CD} <strong>Address:</strong> Main Road, Singrauli, Madhya Pradesh 486889, India</p>
              <p>\u{1F4DE} <strong>Phone / WhatsApp:</strong> +91 9203251821</p>
              <p>\u2709\uFE0F <strong>General Email:</strong> icc@indiacybercafe.com</p>
              <p>\u{1F552} <strong>Working Hours:</strong> Monday \u2013 Saturday: 09:00 AM \u2013 08:00 PM (IST)</p>
            </section>
            <section class="space-y-4 bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <h2 class="text-lg font-bold text-navy">Statutory Grievance Redressal</h2>
              <p class="text-xs leading-relaxed">
                Under the Consumer Protection (E-Commerce) Rules and DPDP Act 2023, you may submit formal grievances directly to our appointed officer:
              </p>
              <p><strong>Grievance Officer:</strong> Grievance Redressal Cell</p>
              <p><strong>Email:</strong> grievance@indiacybercafe.com</p>
              <p><strong>Turnaround:</strong> Acknowledged within 48 hours; resolved within 15 days.</p>
              <div class="pt-2">
                <a href="/privacy-request" class="text-xs font-bold text-primary hover:underline">
                  Submit Online Privacy &amp; Grievance Request \u2192
                </a>
              </div>
            </section>
          </div>
        </article>
      </div>
    `;
    return buildResult(
      200,
      "Contact Us & Grievance Redressal | India Cyber Cafe",
      "Get in touch with India Cyber Cafe in Singrauli MP. Customer support phone +91 9203251821, email, physical center location, and Grievance Officer details.",
      "/contact",
      bodyHtml2,
      {
        ogType: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contact India Cyber Cafe",
          url: `${rootUrl}/contact`
        }
      }
    );
  }
  const legalMatch = cleanPath.match(/^\/legal\/(terms|privacy|refund|disclaimer|about|contact)$/);
  if (legalMatch || cleanPath === "/privacy-policy" || cleanPath === "/terms-and-conditions" || cleanPath === "/refund-policy") {
    let policyType = legalMatch ? legalMatch[1] : "privacy";
    if (cleanPath === "/terms-and-conditions") policyType = "terms";
    if (cleanPath === "/refund-policy") policyType = "refund";
    const titles = {
      privacy: "Privacy Policy & DPDP Act Compliance Notice",
      terms: "Terms and Conditions of Service",
      refund: "Refund and Cancellation Policy",
      disclaimer: "Disclaimer and Non-Affiliation Notice"
    };
    const breadcrumbs = [{ label: "Home", href: "/" }, { label: titles[policyType] || "Legal Policy" }];
    const bodyHtml2 = `
      <div class="space-y-8 max-w-4xl mx-auto">
        ${renderBreadcrumbs(breadcrumbs)}
        <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-12 shadow-sm space-y-6">
          <h1 class="text-2xl sm:text-3xl font-extrabold text-navy">${escapeHtml(titles[policyType] || "Legal Notice")}</h1>
          <p class="text-xs text-slate-400">Effective Date: 1 January 2025 \u2022 Updated: 2026 \u2022 India Cyber Cafe</p>
          <div class="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-4">
            <p>
              India Cyber Cafe operates web applications accessible at <code>indiacybercafe.com</code> and <code>b.indiacybercafe.com</code>. We provide digital consultation, document assistance, form-filling facilitation, and cyber cafe supplies to citizens across India.
            </p>
            <p>
              For complete details and to exercise any statutory rights under the DPDP Act 2023, visit our <a href="/privacy-request" class="text-primary font-bold hover:underline">Privacy &amp; Grievance Portal</a> or contact us at <a href="mailto:icc@indiacybercafe.com" class="text-primary font-bold hover:underline">icc@indiacybercafe.com</a>.
            </p>
          </div>
        </article>
      </div>
    `;
    return buildResult(
      200,
      `${titles[policyType] || "Legal"} | India Cyber Cafe`,
      `Official ${titles[policyType] || "legal policy"} for India Cyber Cafe. Compliant with Consumer Protection Act & DPDP Act 2023.`,
      `/legal/${policyType}`,
      bodyHtml2,
      {
        ogType: "article",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `${titles[policyType] || "Legal"} | India Cyber Cafe`,
          description: `Official ${titles[policyType] || "legal policy"} for India Cyber Cafe. Compliant with Consumer Protection Act & DPDP Act 2023.`,
          url: `${rootUrl}/legal/${policyType}`
        }
      }
    );
  }
  if (cleanPath === "/privacy-request" || cleanPath === "/privacy-request/track") {
    const isTrack = cleanPath.endsWith("/track");
    const breadcrumbs = [{ label: "Home", href: "/" }, { label: isTrack ? "Track Privacy Request" : "Privacy Request" }];
    const bodyHtml2 = `
      <div class="space-y-8 max-w-3xl mx-auto">
        ${renderBreadcrumbs(breadcrumbs)}
        <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm space-y-6">
          <h1 class="text-2xl sm:text-3xl font-extrabold text-navy">
            ${isTrack ? "Track Privacy Request Status" : "Privacy &amp; Statutory Grievance Redressal"}
          </h1>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Exercise your statutory rights under the Digital Personal Data Protection (DPDP) Act, 2023: Access, Correction, Erasure, or Grievance resolution.
          </p>
          <div class="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-xs sm:text-sm space-y-3">
            <p><strong>Grievance Officer:</strong> Grievance Redressal Cell</p>
            <p><strong>Response SLA:</strong> Acknowledged within 48 hours; resolved within 15\u201330 days.</p>
            <p><strong>Email:</strong> grievance@indiacybercafe.com | <strong>Contact:</strong> +91 9203251821</p>
          </div>
        </article>
      </div>
    `;
    return buildResult(
      200,
      `${isTrack ? "Track Request" : "Privacy Request"} - Grievance Redressal | India Cyber Cafe`,
      "Submit and track data privacy requests or consumer grievances with India Cyber Cafe Grievance Officer.",
      cleanPath,
      bodyHtml2,
      {
        ogType: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: `${isTrack ? "Track Request" : "Privacy Request"} - Grievance Redressal | India Cyber Cafe`,
          description: "Submit and track data privacy requests or consumer grievances with India Cyber Cafe Grievance Officer.",
          url: `${rootUrl}${cleanPath}`
        }
      }
    );
  }
  if (cleanPath === "/pay") {
    const breadcrumbs = [{ label: "Home", href: "/" }, { label: "Pay Online" }];
    const bodyHtml2 = `
      <div class="space-y-8 max-w-xl mx-auto">
        ${renderBreadcrumbs(breadcrumbs)}
        <article class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm space-y-6 text-center">
          <h1 class="text-2xl sm:text-3xl font-extrabold text-navy">Secure Online Payment</h1>
          <p class="text-xs sm:text-sm text-slate-500">Pay service charges and print orders securely via UPI, Debit/Credit Cards, or NetBanking.</p>
          <div class="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-left text-xs space-y-2 text-slate-600">
            <p>\u{1F512} 256-Bit SSL Encrypted Payment Gateway</p>
            <p>\u26A1 Instant automated payment verification and receipt</p>
            <p>\u{1F6E1}\uFE0F Powered by Razorpay &amp; Firebase RTDB transaction logging</p>
          </div>
        </article>
      </div>
    `;
    return buildResult(
      200,
      "Pay Online - Secure Payment Portal | India Cyber Cafe",
      "Make online payments for India Cyber Cafe digital services, application fees, and print orders via UPI, cards, and net banking.",
      "/pay",
      bodyHtml2,
      {
        ogType: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "CheckoutPage",
          name: "Pay Online - Secure Payment Portal | India Cyber Cafe",
          description: "Make online payments for India Cyber Cafe digital services, application fees, and print orders via UPI, cards, and net banking.",
          url: `${rootUrl}/pay`
        }
      }
    );
  }
  if (["/login", "/register", "/forgot-password", "/reset-password"].includes(cleanPath)) {
    const titles = {
      "/login": "User Sign In",
      "/register": "Create New Account",
      "/forgot-password": "Forgot Password Assistance",
      "/reset-password": "Reset Password"
    };
    const bodyHtml2 = `
      <div class="space-y-6 max-w-md mx-auto py-10">
        <div class="text-center space-y-2">
          <h1 class="text-2xl sm:text-3xl font-extrabold text-navy">${escapeHtml(titles[cleanPath])}</h1>
          <p class="text-xs sm:text-sm text-slate-500">Access your India Cyber Cafe account and track applications</p>
        </div>
        <div class="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-4">
          <p class="text-xs text-slate-600 text-center">Secure Sign-In with Google or Registered Email</p>
          <a href="/login" class="w-full block py-3 rounded-xl bg-primary text-white text-center font-bold text-sm">Proceed to Account</a>
        </div>
      </div>
    `;
    return buildResult(
      200,
      `${titles[cleanPath]} | India Cyber Cafe`,
      "Sign in or register at India Cyber Cafe to manage your applications and orders.",
      cleanPath,
      bodyHtml2,
      { robots: "noindex, follow" }
    );
  }
  if (cleanPath.startsWith("/admin") || cleanPath === "/operator" || cleanPath === "/profile" || cleanPath.startsWith("/track") || cleanPath.endsWith("/checkout") || cleanPath === "/store/order-confirmation" || cleanPath.startsWith("/my-documents")) {
    const bodyHtml2 = `
      <div class="max-w-2xl mx-auto py-16 text-center space-y-4" aria-busy="true">
        <h1 class="text-xl sm:text-2xl font-bold text-navy">Loading Portal...</h1>
        <p class="text-xs sm:text-sm text-slate-500">Checking credentials and loading secure application data.</p>
      </div>
    `;
    return buildResult(
      200,
      "Portal | India Cyber Cafe",
      "India Cyber Cafe portal dashboard.",
      cleanPath,
      bodyHtml2,
      { robots: "noindex, nofollow" }
    );
  }
  const bodyHtml = `
    <div class="text-center py-16 sm:py-24 max-w-xl mx-auto space-y-6">
      <span class="text-6xl sm:text-7xl font-extrabold text-primary block">404</span>
      <h1 class="text-2xl sm:text-4xl font-extrabold text-navy">Page Not Found</h1>
      <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
        The page or service you are looking for does not exist, has been removed, or has changed address. Please verify the URL or use the direct links below to explore our full directory of digital services, CSC applications, official price list, and government document downloads.
      </p>
      <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
        <a href="/" class="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-primary text-white hover:bg-primary-dark transition-all shadow-sm">
          Return to Homepage
        </a>
        <a href="/services" class="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-white text-navy border border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
          All Services
        </a>
        <a href="/price-list" class="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-white text-navy border border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
          Price List
        </a>
        <a href="/forms-documents" class="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-white text-navy border border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
          Forms &amp; Documents
        </a>
      </div>
    </div>
  `;
  return buildResult(
    404,
    "404 Page Not Found | India Cyber Cafe",
    "The requested URL was not found on India Cyber Cafe. Explore our public services, price list, or store products.",
    cleanPath,
    bodyHtml,
    {
      robots: "noindex, nofollow",
      is404: true
    }
  );
}
function injectSsrIntoTemplate(indexHtml, renderResult) {
  if (!indexHtml) return "";
  const { metadata, html } = renderResult;
  let rootContent = "";
  const match = html.match(/<div id="ssr-root-replacement">([\s\S]*?)<\/div>\s*$/);
  if (match) {
    rootContent = match[1];
  }
  let headScripts = "";
  const scriptsMatch = html.match(/<script[\s\S]*?<\/script>/g);
  if (scriptsMatch) {
    headScripts = scriptsMatch.join("\n    ");
  }
  let modified = indexHtml;
  if (/<title>[^<]*<\/title>/i.test(modified)) {
    modified = modified.replace(/<title>[^<]*<\/title>/i, `<title>${metadata.title}</title>`);
  } else {
    modified = modified.replace("<head>", `<head>
    <title>${metadata.title}</title>`);
  }
  if (/<meta\s+name=["']description["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      `<meta name="description" content="${metadata.description}" />`
    );
  } else {
    modified = modified.replace("</head>", `    <meta name="description" content="${metadata.description}" />
  </head>`);
  }
  if (/<meta\s+name=["']robots["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<meta\s+name=["']robots["'][^>]*>/i,
      `<meta name="robots" content="${metadata.robots}" />`
    );
  } else {
    modified = modified.replace("</head>", `    <meta name="robots" content="${metadata.robots}" />
  </head>`);
  }
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(modified)) {
    modified = modified.replace(
      /<link\s+rel=["']canonical["'][^>]*>/i,
      `<link rel="canonical" href="${metadata.canonicalUrl}" />`
    );
  } else {
    modified = modified.replace("</head>", `    <link rel="canonical" href="${metadata.canonicalUrl}" />
  </head>`);
  }
  if (/<meta\s+property=["']og:title["'][^>]*>/i.test(modified)) {
    modified = modified.replace(/<meta\s+property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${metadata.title}" />`);
  }
  if (/<meta\s+property=["']og:description["'][^>]*>/i.test(modified)) {
    modified = modified.replace(/<meta\s+property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${metadata.description}" />`);
  }
  if (/<meta\s+property=["']og:url["'][^>]*>/i.test(modified)) {
    modified = modified.replace(/<meta\s+property=["']og:url["'][^>]*>/i, `<meta property="og:url" content="${metadata.canonicalUrl}" />`);
  }
  if (/<meta\s+property=["']og:type["'][^>]*>/i.test(modified)) {
    modified = modified.replace(/<meta\s+property=["']og:type["'][^>]*>/i, `<meta property="og:type" content="${metadata.ogType}" />`);
  }
  if (/<meta\s+(?:property|name)=["']twitter:title["'][^>]*>/i.test(modified)) {
    modified = modified.replace(/<meta\s+(?:property|name)=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${metadata.title}" />`);
  }
  if (/<meta\s+(?:property|name)=["']twitter:description["'][^>]*>/i.test(modified)) {
    modified = modified.replace(/<meta\s+(?:property|name)=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${metadata.description}" />`);
  }
  if (headScripts) {
    modified = modified.replace("</head>", `    ${headScripts}
  </head>`);
  }
  if (/<div id=["']root["']>[\s\S]*?<\/div>/i.test(modified)) {
    modified = modified.replace(
      /<div id=["']root["']>[\s\S]*?<\/div>/i,
      `<div id="root">${rootContent}</div>`
    );
  } else {
    modified = modified.replace("<body>", `<body>
    <div id="root">${rootContent}</div>`);
  }
  return modified;
}
export {
  DEFAULT_ICC_DESC,
  DEFAULT_ICC_IMAGE,
  DEFAULT_ICC_TITLE,
  PRODUCTION_DOMAIN,
  cleanText,
  escapeHtml,
  injectSsrIntoTemplate,
  renderUniversalPage
};
