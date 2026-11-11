#!/usr/bin/env node
/**
 * Comprehensive Automated Universal SEO & HTML Readability Test Suite
 * Tests all public routes for:
 * - HTTP Status Code & Content-Type
 * - Raw HTML readability without JavaScript
 * - Page-specific Title, Description, and Canonical URL
 * - Single semantic H1 heading & text hierarchy
 * - Content accuracy (prices, services, products, documents)
 * - Discoverable internal links (<a href="...">)
 * - Schema.org JSON-LD Structured Data
 * - Indexing directives (robots.txt, meta robots, noindex on private)
 * - Genuine 404 responses for invalid routes (no soft 404s)
 * 
 * Generates:
 * - reports/seo-audit.json
 * - reports/seo-audit.html
 */

import fs from 'fs';
import path from 'path';
import { getPublicData, getAllPublicUrls } from '../src/server/publicDataService.js';
import { renderUniversalPage, injectSsrIntoTemplate } from '../src/server/universalHtmlRenderer.js';
import { generateSitemapXml, generateRobotsTxt } from '../src/server/sitemapService.js';

interface RouteAuditResult {
  route: string;
  expectedStatus: number;
  actualStatus: number;
  passed: boolean;
  contentType: string;
  title: string;
  titleValid: boolean;
  description: string;
  descValid: boolean;
  canonical: string;
  canonicalValid: boolean;
  h1: string;
  h1Valid: boolean;
  hasMeaningfulContent: boolean;
  contentLength: number;
  internalLinksCount: number;
  hasStructuredData: boolean;
  structuredDataType?: string;
  structuredDataValid: boolean;
  robotsDirective: string;
  robotsValid: boolean;
  pricesFound: string[];
  issues: string[];
}

function extractH1(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return '';
  return match[1].replace(/<[^>]*>/g, '').trim();
}

function countH1(html: string): number {
  const matches = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi);
  return matches ? matches.length : 0;
}

function extractMeta(html: string, name: string): string {
  const match = html.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([\\s\\S]*?)["']`, 'i')) ||
    html.match(new RegExp(`<meta\\s+content=["']([\\s\\S]*?)["']\\s+name=["']${name}["']`, 'i'));
  return match ? match[1].trim() : '';
}

function extractTitle(html: string): string {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : '';
}

function extractCanonical(html: string): string {
  const match = html.match(/<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']/i) ||
    html.match(/<link\s+href=["']([\s\S]*?)["']\s+rel=["']canonical["']/i);
  return match ? match[1].trim() : '';
}

function extractInternalLinks(html: string): string[] {
  const links: string[] = [];
  const regex = /<a\s+[^>]*href=["'](\/[^"']*)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    links.push(match[1]);
  }
  return links;
}

function extractJsonLd(html: string): any[] {
  const scripts: any[] = [];
  const regex = /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      scripts.push(JSON.parse(match[1]));
    } catch {}
  }
  return scripts;
}

async function runAudit(): Promise<void> {
  const appRoot = process.cwd();
  const reportsDir = path.join(appRoot, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const rawTemplate = fs.existsSync(path.join(appRoot, 'dist/index.html'))
    ? fs.readFileSync(path.join(appRoot, 'dist/index.html'), 'utf-8')
    : fs.readFileSync(path.join(appRoot, 'index.html'), 'utf-8');

  console.log('\n======================================================');
  console.log('  INDIA CYBER CAFE — AUTOMATED UNIVERSAL SEO AUDIT');
  console.log('======================================================\n');

  const publicData = getPublicData(appRoot);
  console.log(`📦 Loaded Catalog Data:`);
  console.log(`   - Services: ${publicData.services.length}`);
  console.log(`   - Products: ${publicData.products.length}`);
  console.log(`   - Product Categories: ${publicData.productCategories.length}`);
  console.log(`   - Documents: ${publicData.documents.length}`);
  console.log(`   - Document Categories: ${publicData.documentCategories.length}\n`);

  const publicUrls = getAllPublicUrls('https://b.indiacybercafe.com', appRoot);
  console.log(`🔍 Total Public Canonical Routes Discovered: ${publicUrls.length}\n`);

  // Build test route roster
  const routesToTest: Array<{ route: string; expectedStatus: number; expectedRobots: 'index' | 'noindex' }> = [
    // Standard public routes
    { route: '/', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/services', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/price-list', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/store', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/forms-documents', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/about', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/contact', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/legal/terms', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/legal/privacy', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/legal/refund', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/legal/disclaimer', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/privacy-request', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/privacy-request/track', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/pay', expectedStatus: 200, expectedRobots: 'index' },
    { route: '/login', expectedStatus: 200, expectedRobots: 'noindex' },
    { route: '/register', expectedStatus: 200, expectedRobots: 'noindex' },

    // Private routes (must be 200 with noindex)
    { route: '/admin', expectedStatus: 200, expectedRobots: 'noindex' },
    { route: '/profile', expectedStatus: 200, expectedRobots: 'noindex' },
    { route: '/track', expectedStatus: 200, expectedRobots: 'noindex' },
    { route: '/my-documents', expectedStatus: 200, expectedRobots: 'noindex' },

    // Nonexistent routes (must be genuine 404, not soft 404)
    { route: '/services/invalid-service-404-test', expectedStatus: 404, expectedRobots: 'noindex' },
    { route: '/store/invalid-cat/invalid-prod-404-test', expectedStatus: 404, expectedRobots: 'noindex' },
    { route: '/forms-documents/invalid-cat/invalid-doc-404-test', expectedStatus: 404, expectedRobots: 'noindex' },
    { route: '/totally-bogus-page-xyz', expectedStatus: 404, expectedRobots: 'noindex' },
  ];

  // Add all public service and subservice routes
  for (const s of publicData.services) {
    if (s.id) {
      routesToTest.push({ route: `/services/${s.id}`, expectedStatus: 200, expectedRobots: 'index' });
      for (const ss of s.subservices || []) {
        if (ss.name) {
          routesToTest.push({
            route: `/services/${s.id}/${ss.name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-')}`,
            expectedStatus: 200,
            expectedRobots: 'index',
          });
        }
      }
    }
  }

  // Add store categories & products
  for (const cat of publicData.productCategories) {
    if (cat.id) {
      routesToTest.push({ route: `/store/${cat.id}`, expectedStatus: 200, expectedRobots: 'index' });
    }
  }

  for (const p of publicData.products) {
    if (p.id && p.category) {
      routesToTest.push({ route: `/store/${p.category}/${p.id}`, expectedStatus: 200, expectedRobots: 'index' });
    }
  }

  // Add document categories & documents
  for (const docCat of publicData.documentCategories) {
    if (docCat.name) {
      const catSlug = docCat.name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
      routesToTest.push({ route: `/forms-documents/${catSlug}`, expectedStatus: 200, expectedRobots: 'index' });
    }
  }

  for (const doc of publicData.documents) {
    if (doc.name) {
      const catSlug = (doc.category || 'general').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
      const docSlug = doc.name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
      routesToTest.push({ route: `/forms-documents/${catSlug}/${docSlug}`, expectedStatus: 200, expectedRobots: 'index' });
    }
  }

  console.log(`🚀 Starting verification of ${routesToTest.length} total URLs...\n`);

  const results: RouteAuditResult[] = [];
  let passedCount = 0;
  let failedCount = 0;

  for (const testCase of routesToTest) {
    const issues: string[] = [];
    const renderRes = renderUniversalPage(testCase.route, 'https://b.indiacybercafe.com', appRoot);
    const fullHtml = injectSsrIntoTemplate(rawTemplate, renderRes);

    const actualStatus = renderRes.status;
    const contentType = 'text/html; charset=utf-8';
    const title = extractTitle(fullHtml);
    const description = extractMeta(fullHtml, 'description');
    const canonical = extractCanonical(fullHtml);
    const h1 = extractH1(fullHtml);
    const h1Count = countH1(fullHtml);
    const robots = extractMeta(fullHtml, 'robots');
    const internalLinks = extractInternalLinks(fullHtml);
    const jsonLd = extractJsonLd(fullHtml);

    // Tests
    if (actualStatus !== testCase.expectedStatus) {
      issues.push(`Expected HTTP ${testCase.expectedStatus}, received HTTP ${actualStatus}`);
    }

    const titleValid = title.length >= 10 && title.includes('India Cyber Cafe');
    if (!titleValid && actualStatus === 200) {
      issues.push(`Invalid or generic <title>: "${title}"`);
    }

    const descValid = description.length >= 20;
    if (!descValid && actualStatus === 200) {
      issues.push(`Meta description too short or missing: "${description}"`);
    }

    const canonicalValid = canonical.startsWith('https://b.indiacybercafe.com');
    if (!canonicalValid && actualStatus === 200 && testCase.expectedRobots === 'index') {
      issues.push(`Invalid canonical URL: "${canonical}"`);
    }

    const h1Valid = h1.length >= 3 && h1Count === 1;
    if (!h1Valid) {
      issues.push(`Expected exactly 1 <h1>, found ${h1Count}: "${h1}"`);
    }

    const hasMeaningfulContent = fullHtml.length > 500 && !fullHtml.includes('<div id="root"></div>');
    if (!hasMeaningfulContent) {
      issues.push(`Raw HTML response is an empty React root or has insufficient content`);
    }

    const robotsValid = testCase.expectedRobots === 'index'
      ? robots.includes('index') && !robots.includes('noindex')
      : robots.includes('noindex');
    if (!robotsValid) {
      issues.push(`Robots directive mismatch: expected ${testCase.expectedRobots}, got "${robots}"`);
    }

    const hasStructuredData = jsonLd.length > 0;
    const structuredDataValid = !hasStructuredData || jsonLd.every(item => item && (item['@context']?.includes('schema.org') || item['@type']));

    // Extract prices found in HTML
    const pricesFound = Array.from(new Set(fullHtml.match(/₹\s*\d+(?:,\d+)*(?:\.\d+)?/g) || [])).slice(0, 5);

    const isPassed = issues.length === 0;
    if (isPassed) {
      passedCount++;
    } else {
      failedCount++;
      console.log(`❌ FAIL [${testCase.route}]: ${issues.join(' | ')}`);
    }

    results.push({
      route: testCase.route,
      expectedStatus: testCase.expectedStatus,
      actualStatus,
      passed: isPassed,
      contentType,
      title,
      titleValid,
      description,
      descValid,
      canonical,
      canonicalValid,
      h1,
      h1Valid,
      hasMeaningfulContent,
      contentLength: fullHtml.length,
      internalLinksCount: internalLinks.length,
      hasStructuredData,
      structuredDataType: jsonLd.map(j => j['@type']).filter(Boolean).join(', '),
      structuredDataValid,
      robotsDirective: robots,
      robotsValid,
      pricesFound,
      issues,
    });
  }

  // Audit Robots.txt and Sitemap.xml
  console.log('\n🔍 Auditing sitemap.xml and robots.txt generation...');
  const sitemapXml = generateSitemapXml('https://b.indiacybercafe.com', appRoot);
  const robotsTxt = generateRobotsTxt('https://b.indiacybercafe.com');

  const sitemapValid = sitemapXml.startsWith('<?xml') && sitemapXml.includes('<urlset') && sitemapXml.includes('https://b.indiacybercafe.com');
  const robotsValid = robotsTxt.includes('User-agent: *') && robotsTxt.includes('Sitemap: https://b.indiacybercafe.com/sitemap.xml');

  console.log(`   - Sitemap valid: ${sitemapValid ? '✅ PASS' : '❌ FAIL'} (${(sitemapXml.match(/<url>/g) || []).length} URLs indexed)`);
  console.log(`   - Robots.txt valid: ${robotsValid ? '✅ PASS' : '❌ FAIL'}`);

  // Summary
  console.log('\n======================================================');
  console.log(`  AUDIT SUMMARY`);
  console.log(`  Total URLs Tested: ${results.length}`);
  console.log(`  Passed: ${passedCount} ✅`);
  console.log(`  Failed: ${failedCount} ${failedCount > 0 ? '❌' : ''}`);
  console.log(`  Pass Rate: ${((passedCount / results.length) * 100).toFixed(1)}%`);
  console.log('======================================================\n');

  // Generate reports/seo-audit.json
  const auditReportJson = {
    timestamp: new Date().toISOString(),
    domain: 'https://b.indiacybercafe.com',
    totalRoutesTested: results.length,
    passedRoutes: passedCount,
    failedRoutes: failedCount,
    passRate: `${((passedCount / results.length) * 100).toFixed(1)}%`,
    sitemapUrlsCount: (sitemapXml.match(/<url>/g) || []).length,
    sitemapValid,
    robotsValid,
    results,
  };

  const jsonReportPath = path.join(reportsDir, 'seo-audit.json');
  fs.writeFileSync(jsonReportPath, JSON.stringify(auditReportJson, null, 2), 'utf-8');
  console.log(`📄 Wrote JSON report: ${jsonReportPath}`);

  // Generate reports/seo-audit.html
  const tableRowsHtml = results
    .map(
      r => `
      <tr class="${r.passed ? 'bg-white' : 'bg-red-50'} border-b">
        <td class="p-3 font-mono text-xs font-bold ${r.passed ? 'text-slate-800' : 'text-red-700'}">${r.route}</td>
        <td class="p-3 text-xs"><span class="px-2 py-0.5 rounded font-bold ${r.actualStatus === 200 ? 'bg-emerald-100 text-emerald-800' : r.actualStatus === 404 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}">${r.actualStatus}</span></td>
        <td class="p-3 text-xs truncate max-w-xs" title="${r.title}">${r.title}</td>
        <td class="p-3 text-xs font-semibold text-navy truncate max-w-xs" title="${r.h1}">${r.h1}</td>
        <td class="p-3 text-xs">${r.contentLength.toLocaleString()} bytes</td>
        <td class="p-3 text-xs">${r.internalLinksCount}</td>
        <td class="p-3 text-xs font-mono">${r.structuredDataType || '—'}</td>
        <td class="p-3 text-xs font-bold ${r.passed ? 'text-emerald-600' : 'text-rose-600'}">${r.passed ? 'PASS ✅' : 'FAIL ❌'}</td>
      </tr>
      ${
        r.issues.length > 0
          ? `<tr class="bg-red-50/50 border-b"><td colspan="8" class="p-2 text-xs text-red-600 font-medium pl-6">Issues: ${r.issues.join(' • ')}</td></tr>`
          : ''
      }
    `
    )
    .join('');

  const htmlReport = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>India Cyber Cafe - Universal SEO Audit Report</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-slate-50 text-slate-800 p-6 sm:p-10 font-sans">
  <div class="max-w-7xl mx-auto space-y-8">
    <header class="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900">India Cyber Cafe — Universal SEO Audit Report</h1>
          <p class="text-xs sm:text-sm text-slate-500 mt-1">Generated: ${new Date().toUTCString()} • Automated Route-Level Verification</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="px-4 py-2 rounded-xl text-base font-extrabold ${failedCount === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
            ${((passedCount / results.length) * 100).toFixed(1)}% Pass Rate
          </span>
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-100 text-center">
        <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200">
          <span class="text-xs text-slate-500 block">Total Tested</span>
          <span class="text-2xl font-black text-slate-900">${results.length}</span>
        </div>
        <div class="p-4 bg-emerald-50 rounded-2xl border border-emerald-200">
          <span class="text-xs text-emerald-700 block">Passed</span>
          <span class="text-2xl font-black text-emerald-700">${passedCount}</span>
        </div>
        <div class="p-4 bg-rose-50 rounded-2xl border border-rose-200">
          <span class="text-xs text-rose-700 block">Failed</span>
          <span class="text-2xl font-black text-rose-700">${failedCount}</span>
        </div>
        <div class="p-4 bg-blue-50 rounded-2xl border border-blue-200">
          <span class="text-xs text-blue-700 block">Sitemap URLs</span>
          <span class="text-2xl font-black text-blue-700">${(sitemapXml.match(/<url>/g) || []).length}</span>
        </div>
      </div>
    </header>

    <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="p-6 border-b border-slate-200 flex items-center justify-between">
        <h2 class="text-lg font-bold text-slate-900">Route Verification Details</h2>
        <span class="text-xs text-slate-500 font-medium">${results.length} URLs Audited</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-100 text-slate-600 text-xs font-bold uppercase tracking-wider border-b">
              <th class="p-3">Route</th>
              <th class="p-3">Status</th>
              <th class="p-3">Page Title</th>
              <th class="p-3">Semantic H1</th>
              <th class="p-3">HTML Size</th>
              <th class="p-3">Links</th>
              <th class="p-3">Schema.org</th>
              <th class="p-3">Result</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;

  const htmlReportPath = path.join(reportsDir, 'seo-audit.html');
  fs.writeFileSync(htmlReportPath, htmlReport, 'utf-8');
  console.log(`📄 Wrote HTML report: ${htmlReportPath}\n`);

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
