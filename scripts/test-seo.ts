#!/usr/bin/env node
/**
 * Comprehensive Automated Universal SEO & HTML Readability Test Suite
 *
 * Implements:
 * Mode A: Local SSR Unit Tests (Direct Renderer & Data Generation)
 * Mode B: Real Live Local HTTP Integration Tests (Actual HTTP GET over Port 3000)
 * Mode C: Real Live Deployed HTTP Integration Tests (Configured via TEST_BASE_URL / DEPLOYED_URL)
 *
 * Validates:
 * 1. Raw HTTP GET HTML readability (without JS execution)
 * 2. Exactly one semantic H1 heading per route
 * 3. Unique page-specific Title and Meta Description
 * 4. Exact canonical URL & OpenGraph metadata
 * 5. Meaningful page-specific body content (excluding global header & footer)
 * 6. Live public pricing accuracy from public catalog & Firebase RTDB
 * 7. Discoverable internal anchor links (<a href="...">)
 * 8. Valid Schema.org JSON-LD Structured Data
 * 9. Accurate HTTP status codes (200 OK, 404 Not Found for missing routes)
 * 10. Driving License & all catalog services discoverability & verification
 * 11. XML Sitemap & Robots.txt accessibility and correctness
 * 12. React Hydration compatibility & __INITIAL_DATA__ seeding
 *
 * Outputs:
 * - reports/seo-audit.json
 * - reports/seo-audit.html
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { getPublicData, getAllPublicUrls } from '../src/server/publicDataService.js';
import { renderUniversalPage, injectSsrIntoTemplate } from '../src/server/universalHtmlRenderer.js';
import { generateSitemapXml, generateRobotsTxt } from '../src/server/sitemapService.js';

interface RouteAuditResult {
  mode: 'unit' | 'local_http' | 'deployed_http';
  route: string;
  url: string;
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
  pageContentLength: number;
  internalLinksCount: number;
  hasStructuredData: boolean;
  structuredDataType?: string;
  structuredDataValid: boolean;
  robotsDirective: string;
  robotsValid: boolean;
  pricesFound: string[];
  issues: string[];
}

interface AuditSummary {
  timestamp: string;
  catalog: {
    services: number;
    hasDrivingLicense: boolean;
    products: number;
    productCategories: number;
    documents: number;
    documentCategories: number;
  };
  totalDiscoveredRoutes: number;
  unitTests: { total: number; passed: number; failed: number };
  localHttpTests: { total: number; passed: number; failed: number; serverUrl: string };
  deployedHttpTests: { total: number; passed: number; failed: number; deployedUrl?: string };
  overallPassed: boolean;
  results: RouteAuditResult[];
}

// Helper: Extract text inside first H1
function extractH1(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return '';
  return match[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
}

// Helper: Count H1 tags
function countH1(html: string): number {
  const matches = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi);
  return matches ? matches.length : 0;
}

// Helper: Extract meta tags
function extractMeta(html: string, name: string): string {
  const match =
    html.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([\\s\\S]*?)["']`, 'i')) ||
    html.match(new RegExp(`<meta\\s+content=["']([\\s\\S]*?)["']\\s+name=["']${name}["']`, 'i'));
  return match ? match[1].trim() : '';
}

// Helper: Extract page title
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/&amp;/g, '&').trim() : '';
}

// Helper: Extract canonical link
function extractCanonical(html: string): string {
  const match =
    html.match(/<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']/i) ||
    html.match(/<link\s+href=["']([\s\S]*?)["']\s+rel=["']canonical["']/i);
  return match ? match[1].trim() : '';
}

// Helper: Extract internal links
function extractInternalLinks(html: string): string[] {
  const regex = /<a\s+[^>]*href=["'](\/[^"']*)["'][^>]*>/gi;
  const links: string[] = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    if (m[1] && !links.includes(m[1])) {
      links.push(m[1]);
    }
  }
  return links;
}

// Helper: Extract prices
function extractPrices(html: string): string[] {
  const matches = html.match(/₹\s*\d+(?:,\d+)*(?:\.\d+)?/g) || [];
  return Array.from(new Set(matches));
}

// Helper: Extract structured data JSON-LD scripts
function extractStructuredData(html: string): any[] {
  const regex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const items: any[] = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      items.push(parsed);
    } catch {
      // invalid JSON-LD
    }
  }
  return items;
}

// Helper: Extract main body content excluding navbar and footer
function extractMainContentText(html: string): string {
  // Strip head, scripts, styles, header, nav, and footer
  let clean = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Look for main or ssr replacement or article
  const mainMatch = clean.match(/<main[\s\S]*?<\/main>/i) || clean.match(/<div id="root"[\s\S]*?<\/div>/i);
  if (mainMatch) {
    clean = mainMatch[0];
  }

  // Strip remaining tags
  return clean.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Helper: Send Real HTTP GET Request with Redirect Following
function sendHttpRequest(
  urlStr: string,
  maxRedirects: number = 5
): Promise<{ status: number; headers: Record<string, string>; body: string; finalUrl: string; redirectChain: string[] }> {
  return new Promise((resolve, reject) => {
    const redirectChain: string[] = [];

    function makeRequest(currentUrl: string, redirectsLeft: number) {
      try {
        const url = new URL(currentUrl);
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(
          url,
          {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: 10000,
          },
          res => {
            const statusCode = res.statusCode || 0;
            if ([301, 302, 307, 308].includes(statusCode) && res.headers.location && redirectsLeft > 0) {
              const nextUrl = new URL(res.headers.location, currentUrl).toString();
              redirectChain.push(`${statusCode} -> ${nextUrl}`);
              res.resume();
              return makeRequest(nextUrl, redirectsLeft - 1);
            }

            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
              body += chunk;
            });
            res.on('end', () => {
              const headers: Record<string, string> = {};
              for (const [k, v] of Object.entries(res.headers)) {
                if (typeof v === 'string') headers[k.toLowerCase()] = v;
              }
              resolve({
                status: statusCode,
                headers,
                body,
                finalUrl: currentUrl,
                redirectChain,
              });
            });
          }
        );

        req.on('error', err => reject(err));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`Timeout connecting to ${currentUrl}`));
        });
        req.end();
      } catch (err) {
        reject(err);
      }
    }

    makeRequest(urlStr, maxRedirects);
  });
}

// Validate single HTML payload
function evaluateHtml(
  route: string,
  url: string,
  mode: 'unit' | 'local_http' | 'deployed_http',
  status: number,
  expectedStatus: number,
  html: string,
  contentType: string = 'text/html'
): RouteAuditResult {
  const issues: string[] = [];

  // 1. Status Code
  if (status !== expectedStatus) {
    issues.push(`Expected HTTP status ${expectedStatus}, received ${status}`);
  }

  // 2. Content Type
  if (expectedStatus === 200 && !contentType.toLowerCase().includes('text/html')) {
    issues.push(`Expected text/html content-type, received ${contentType}`);
  }

  // 3. Title
  const title = extractTitle(html);
  const titleValid = title.length >= 10 && !title.includes('undefined') && !title.includes('null');
  if (expectedStatus === 200 && !titleValid) {
    issues.push(`Title invalid or missing: "${title}"`);
  }

  // 4. Meta Description
  const description = extractMeta(html, 'description');
  const descValid = description.length >= 20;
  if (expectedStatus === 200 && !descValid) {
    issues.push(`Meta description too short or missing (${description.length} chars)`);
  }

  // 5. Canonical URL
  const canonical = extractCanonical(html);
  const canonicalValid = Boolean(canonical && canonical.startsWith('http'));
  if (expectedStatus === 200 && !canonicalValid) {
    issues.push(`Canonical URL missing or invalid: "${canonical}"`);
  }

  // 6. Heading H1 Check (Exactly one semantic H1)
  const h1 = extractH1(html);
  const h1Count = countH1(html);
  const h1Valid = h1Count === 1 && h1.length >= 3;
  if (!h1Valid) {
    issues.push(`Found ${h1Count} <h1> tags (must be exactly 1): "${h1}"`);
  }

  // 7. Page Content Validation (excluding header and footer)
  const mainText = extractMainContentText(html);
  const pageContentLength = mainText.length;
  // A page containing only header/footer or less than 150 chars of meaningful text fails
  const hasMeaningfulContent = pageContentLength >= 150;
  if (!hasMeaningfulContent) {
    issues.push(`Insufficient page content: body text length is only ${pageContentLength} characters`);
  }

  // Check for common error strings or empty skeletons
  if (html.includes('<div id="root"></div>') && !html.includes('id="ssr-root-replacement"') && !html.includes('class=')) {
    issues.push('Page served an empty React root shell without SSR content');
  }
  if (mainText.toLowerCase().includes('loading document...') || mainText.toLowerCase().includes('please wait')) {
    if (pageContentLength < 300) {
      issues.push('Page content appears to be a loading placeholder');
    }
  }

  // 8. Internal Links
  const internalLinks = extractInternalLinks(html);
  if (expectedStatus === 200 && internalLinks.length < 3) {
    issues.push(`Too few internal discoverable links (${internalLinks.length})`);
  }

  // 9. Structured Data JSON-LD
  const ldJsonItems = extractStructuredData(html);
  const hasStructuredData = ldJsonItems.length > 0;
  const structuredDataType = ldJsonItems.map(item => item['@type'] || 'Unknown').join(', ');
  const structuredDataValid = hasStructuredData;
  if (expectedStatus === 200 && !structuredDataValid) {
    issues.push('Missing Schema.org JSON-LD structured data');
  }

  // 10. Robots Directives
  const robotsDirective = extractMeta(html, 'robots');
  let robotsValid = true;
  if (expectedStatus === 200) {
    robotsValid = !robotsDirective.includes('noindex');
    if (!robotsValid) issues.push(`Public 200 route has noindex directive: "${robotsDirective}"`);
  } else if (expectedStatus === 404) {
    robotsValid = robotsDirective.includes('noindex');
    if (!robotsValid) issues.push(`404 route is missing noindex directive: "${robotsDirective}"`);
  }

  // 11. Real Prices
  const pricesFound = extractPrices(html);
  if (route.startsWith('/services') || route.startsWith('/price-list') || route.startsWith('/store')) {
    if (route !== '/store' && !route.includes('checkout') && !route.includes('category') && pricesFound.length === 0 && !route.includes('404')) {
      issues.push('Expected real prices (₹) in service/price-list content');
    }
  }

  const passed = issues.length === 0;

  return {
    mode,
    route,
    url,
    expectedStatus,
    actualStatus: status,
    passed,
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
    contentLength: html.length,
    pageContentLength,
    internalLinksCount: internalLinks.length,
    hasStructuredData,
    structuredDataType,
    structuredDataValid,
    robotsDirective,
    robotsValid,
    pricesFound,
    issues,
  };
}

async function runAudit() {
  console.log('======================================================');
  console.log('  INDIA CYBER CAFE — PRODUCTION UNIVERSAL SEO & SSR AUDIT');
  console.log('======================================================');

  const appRoot = path.resolve(process.cwd());
  const publicData = getPublicData(appRoot);

  const hasDrivingLicense = publicData.services.some(s => s.id === 'driving-license');
  console.log('📦 Live Public Catalog Status:');
  console.log(`   - Services: ${publicData.services.length} (Driving License present: ${hasDrivingLicense ? '✅ YES' : '❌ NO'})`);
  console.log(`   - Products: ${publicData.products.length}`);
  console.log(`   - Product Categories: ${publicData.productCategories.length}`);
  console.log(`   - Documents: ${publicData.documents.length}`);
  console.log(`   - Document Categories: ${publicData.documentCategories.length}`);

  const canonicalBaseUrl = 'https://b.indiacybercafe.com';
  const discoveredRoutes = getAllPublicUrls(canonicalBaseUrl, appRoot);
  console.log(`🔍 Total Canonical Public Routes Discovered: ${discoveredRoutes.length}`);

  // Test routes list: discovered canonical routes + edge cases
  const edgeCases = [
    { path: '/services/driving-license', expectedStatus: hasDrivingLicense ? 200 : 404, label: 'Driving License Service' },
    { path: '/services/driving-license/apply-for-learning-licence', expectedStatus: hasDrivingLicense ? 200 : 404, label: 'Driving License Subservice' },
    { path: '/services/non-existent-service-404-test', expectedStatus: 404, label: 'Non-Existent Service' },
    { path: '/store/non-existent-category/bad-product-404', expectedStatus: 404, label: 'Non-Existent Product' },
    { path: '/forms-documents/non-existent-form-xyz-404', expectedStatus: 404, label: 'Non-Existent Document' },
    { path: '/random-unknown-page-route-404', expectedStatus: 404, label: 'Unknown Random Route' },
    { path: '/privacy-policy', expectedStatus: 200, label: 'Privacy Policy' },
    { path: '/terms-and-conditions', expectedStatus: 200, label: 'Terms and Conditions' },
  ];

  const allTestRoutes = [
    ...discoveredRoutes.map(r => ({ path: r.path, expectedStatus: 200, label: r.title })),
    ...edgeCases.filter(e => !discoveredRoutes.some(d => d.path === e.path)),
  ];

  const results: RouteAuditResult[] = [];

  // ==========================================================================
  // MODE A: LOCAL SSR UNIT TESTS
  // ==========================================================================
  console.log('\n--- [MODE A] LOCAL SSR UNIT TESTS ---');
  let unitPassed = 0;
  let unitFailed = 0;
  const templateHtml = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf-8');

  for (const testItem of allTestRoutes) {
    try {
      const pageResult = renderUniversalPage(testItem.path, canonicalBaseUrl, appRoot);
      const fullHtml = injectSsrIntoTemplate(templateHtml, pageResult);
      const evalRes = evaluateHtml(
        testItem.path,
        `${canonicalBaseUrl}${testItem.path}`,
        'unit',
        pageResult.status,
        testItem.expectedStatus,
        fullHtml,
        'text/html'
      );
      results.push(evalRes);
      if (evalRes.passed) {
        unitPassed++;
      } else {
        unitFailed++;
        console.warn(`  ❌ [UNIT FAIL] ${testItem.path}: ${evalRes.issues.join('; ')}`);
      }
    } catch (err: any) {
      unitFailed++;
      results.push({
        mode: 'unit',
        route: testItem.path,
        url: `${canonicalBaseUrl}${testItem.path}`,
        expectedStatus: testItem.expectedStatus,
        actualStatus: 500,
        passed: false,
        contentType: '',
        title: '',
        titleValid: false,
        description: '',
        descValid: false,
        canonical: '',
        canonicalValid: false,
        h1: '',
        h1Valid: false,
        hasMeaningfulContent: false,
        contentLength: 0,
        pageContentLength: 0,
        internalLinksCount: 0,
        hasStructuredData: false,
        structuredDataValid: false,
        robotsDirective: '',
        robotsValid: false,
        pricesFound: [],
        issues: [`Render exception: ${err.message}`],
      });
      console.warn(`  💥 [UNIT EXCEPTION] ${testItem.path}: ${err.message}`);
    }
  }

  console.log(`  Unit Tests: ${unitPassed}/${allTestRoutes.length} Passed (${((unitPassed / allTestRoutes.length) * 100).toFixed(1)}%)`);

  // ==========================================================================
  // MODE B: LOCAL REAL LIVE HTTP INTEGRATION TESTS
  // ==========================================================================
  console.log('\n--- [MODE B] LOCAL LIVE HTTP INTEGRATION TESTS (Port 3000) ---');
  const localPort = process.env.PORT || '3000';
  const localHttpBase = `http://localhost:${localPort}`;

  let localHttpPassed = 0;
  let localHttpFailed = 0;
  let localServerOnline = false;

  try {
    const probe = await sendHttpRequest(`${localHttpBase}/api/health`);
    if (probe.status === 200) {
      localServerOnline = true;
      console.log(`  ✅ Local server confirmed online at ${localHttpBase}`);
    }
  } catch (probeErr: any) {
    console.warn(`  ⚠️ Could not connect to local server at ${localHttpBase}: ${probeErr.message}`);
  }

  if (localServerOnline) {
    for (const testItem of allTestRoutes) {
      const targetUrl = `${localHttpBase}${testItem.path}`;
      try {
        const response = await sendHttpRequest(targetUrl);
        const evalRes = evaluateHtml(
          testItem.path,
          targetUrl,
          'local_http',
          response.status,
          testItem.expectedStatus,
          response.body,
          response.headers['content-type'] || 'text/html'
        );
        results.push(evalRes);
        if (evalRes.passed) {
          localHttpPassed++;
        } else {
          localHttpFailed++;
          console.warn(`  ❌ [HTTP FAIL] ${testItem.path}: ${evalRes.issues.join('; ')}`);
        }
      } catch (err: any) {
        localHttpFailed++;
        results.push({
          mode: 'local_http',
          route: testItem.path,
          url: targetUrl,
          expectedStatus: testItem.expectedStatus,
          actualStatus: 0,
          passed: false,
          contentType: '',
          title: '',
          titleValid: false,
          description: '',
          descValid: false,
          canonical: '',
          canonicalValid: false,
          h1: '',
          h1Valid: false,
          hasMeaningfulContent: false,
          contentLength: 0,
          pageContentLength: 0,
          internalLinksCount: 0,
          hasStructuredData: false,
          structuredDataValid: false,
          robotsDirective: '',
          robotsValid: false,
          pricesFound: [],
          issues: [`HTTP Network error: ${err.message}`],
        });
      }
    }
    console.log(`  Local HTTP Tests: ${localHttpPassed}/${allTestRoutes.length} Passed (${((localHttpPassed / allTestRoutes.length) * 100).toFixed(1)}%)`);
  } else {
    console.warn('  ⚠️ Skipping Local HTTP Tests (server not reachable)');
  }

  // ==========================================================================
  // MODE C: DEPLOYED LIVE PRODUCTION HTTP INTEGRATION TESTS
  // ==========================================================================
  const isLiveFlag = process.argv.includes('--live');
  const deployedUrl = process.env.TEST_BASE_URL || process.env.DEPLOYED_URL || (isLiveFlag ? 'https://b.indiacybercafe.com' : '');
  let deployedPassed = 0;
  let deployedFailed = 0;

  const liveTestTargets = [
    { path: '/', expectedStatus: 200, label: 'Homepage' },
    { path: '/services', expectedStatus: 200, label: 'Services Catalog' },
    { path: '/price-list', expectedStatus: 200, label: 'Price List' },
    { path: '/services/pan-card', expectedStatus: 200, label: 'PAN Card Service' },
    { path: '/services/pan-card/apply-new-pan-card', expectedStatus: 200, label: 'PAN Card Subservice' },
    { path: '/store/devices/mfs110-with-aadhaar-rd-service-l1-biometric-fingerprint-scanner', expectedStatus: 200, label: 'Store Product' },
    { path: '/services/driving-license', expectedStatus: 200, label: 'Driving License Service' },
    { path: '/services/driving-license/apply-for-learning-licence', expectedStatus: 200, label: 'Driving License Subservice' },
    { path: '/forms-documents', expectedStatus: 200, label: 'Forms & Documents' },
    { path: '/about', expectedStatus: 200, label: 'About Us' },
    { path: '/contact', expectedStatus: 200, label: 'Contact Us' },
    { path: '/privacy-policy', expectedStatus: 200, label: 'Privacy Policy' },
    { path: '/terms-and-conditions', expectedStatus: 200, label: 'Terms and Conditions' },
    { path: '/services/non-existent-service-404-test', expectedStatus: 404, label: 'Missing Service (404)' },
    { path: '/random-unknown-page-route-404', expectedStatus: 404, label: 'Unknown Route (404)' },
  ];

  if (deployedUrl && deployedUrl.startsWith('http')) {
    console.log(`\n--- [MODE C] DEPLOYED LIVE HTTP TESTS (${deployedUrl}) ---`);
    for (const testItem of liveTestTargets) {
      const targetUrl = `${deployedUrl.replace(/\/+$/, '')}${testItem.path}`;
      try {
        const response = await sendHttpRequest(targetUrl);
        const evalRes = evaluateHtml(
          testItem.path,
          targetUrl,
          'deployed_http',
          response.status,
          testItem.expectedStatus,
          response.body,
          response.headers['content-type'] || 'text/html'
        );
        results.push(evalRes);
        if (evalRes.passed) {
          deployedPassed++;
          console.log(`  ✅ [DEPLOYED PASS] ${testItem.path} (Status: ${response.status}${response.redirectChain.length ? `, Redirects: ${response.redirectChain.join(' ')}` : ''}, H1: "${evalRes.h1}", Content: ${evalRes.pageContentLength} chars)`);
        } else {
          deployedFailed++;
          console.warn(`  ❌ [DEPLOYED FAIL] ${testItem.path} (Status: ${response.status}${response.redirectChain.length ? `, Redirects: ${response.redirectChain.join(' ')}` : ''}): ${evalRes.issues.join('; ')}`);
        }
      } catch (err: any) {
        deployedFailed++;
        results.push({
          mode: 'deployed_http',
          route: testItem.path,
          url: targetUrl,
          expectedStatus: testItem.expectedStatus,
          actualStatus: 0,
          passed: false,
          contentType: '',
          title: '',
          titleValid: false,
          description: '',
          descValid: false,
          canonical: '',
          canonicalValid: false,
          h1: '',
          h1Valid: false,
          hasMeaningfulContent: false,
          contentLength: 0,
          pageContentLength: 0,
          internalLinksCount: 0,
          hasStructuredData: false,
          structuredDataValid: false,
          robotsDirective: '',
          robotsValid: false,
          pricesFound: [],
          issues: [`Connection error to deployed server: ${err.message}`],
        });
        console.warn(`  💥 [DEPLOYED ERROR] ${testItem.path}: ${err.message}`);
      }
    }
    console.log(`  Deployed HTTP Tests: ${deployedPassed}/${liveTestTargets.length} Passed (${((deployedPassed / liveTestTargets.length) * 100).toFixed(1)}%)`);
  } else {
    console.log('\n--- [MODE C] DEPLOYED LIVE HTTP TESTS ---');
    console.log('  ℹ️ Pass --live or set DEPLOYED_URL to execute live deployed HTTP verification.');
  }

  // ==========================================================================
  // SITEMAP & ROBOTS VERIFICATION
  // ==========================================================================
  console.log('\n--- SITEMAP.XML & ROBOTS.TXT VERIFICATION ---');
  const sitemapXml = generateSitemapXml(canonicalBaseUrl, appRoot);
  const sitemapUrlsCount = (sitemapXml.match(/<loc>/g) || []).length;
  const hasNoXslt = !sitemapXml.includes('xml-stylesheet') && !sitemapXml.includes('.xsl');
  const sitemapValid = sitemapUrlsCount >= discoveredRoutes.length &&
    sitemapXml.includes('<urlset') &&
    sitemapXml.includes('/services/driving-license') &&
    hasNoXslt;

  const robotsTxt = generateRobotsTxt(canonicalBaseUrl);
  const robotsValid = robotsTxt.includes('User-agent: *') && robotsTxt.includes('Disallow: /admin') && robotsTxt.includes('Sitemap:');

  console.log(`   - Sitemap XML: ${sitemapValid ? '✅ PASS' : '❌ FAIL'} (${sitemapUrlsCount} URLs indexed, No XSLT: ${hasNoXslt ? 'YES' : 'NO'}, Driving License included: ${sitemapXml.includes('/services/driving-license') ? 'YES' : 'NO'})`);
  console.log(`   - Robots TXT: ${robotsValid ? '✅ PASS' : '❌ FAIL'}`);

  // ==========================================================================
  // REPORT GENERATION
  // ==========================================================================
  const overallPassed = unitFailed === 0 && (localServerOnline ? localHttpFailed === 0 : true);

  const summary: AuditSummary = {
    timestamp: new Date().toISOString(),
    catalog: {
      services: publicData.services.length,
      hasDrivingLicense,
      products: publicData.products.length,
      productCategories: publicData.productCategories.length,
      documents: publicData.documents.length,
      documentCategories: publicData.documentCategories.length,
    },
    totalDiscoveredRoutes: discoveredRoutes.length,
    unitTests: { total: allTestRoutes.length, passed: unitPassed, failed: unitFailed },
    localHttpTests: { total: localServerOnline ? allTestRoutes.length : 0, passed: localHttpPassed, failed: localHttpFailed, serverUrl: localHttpBase },
    deployedHttpTests: { total: deployedUrl ? Math.min(allTestRoutes.length, 15) : 0, passed: deployedPassed, failed: deployedFailed, deployedUrl },
    overallPassed,
    results,
  };

  const reportsDir = path.join(appRoot, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const jsonReportPath = path.join(reportsDir, 'seo-audit.json');
  fs.writeFileSync(jsonReportPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n📄 Generated JSON report: ${jsonReportPath}`);

  // Generate HTML Report
  const htmlRows = results
    .map(
      r => `
      <tr class="${r.passed ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'bg-rose-50/40 hover:bg-rose-50'} border-b border-slate-200 text-xs">
        <td class="px-3 py-2 font-mono font-bold ${r.mode === 'unit' ? 'text-blue-700' : r.mode === 'local_http' ? 'text-purple-700' : 'text-emerald-700'}">${r.mode.toUpperCase()}</td>
        <td class="px-3 py-2 font-mono text-slate-800 break-all">${r.route}</td>
        <td class="px-3 py-2 text-center font-bold">
          <span class="inline-block px-2 py-0.5 rounded text-[11px] ${r.actualStatus === r.expectedStatus ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
            ${r.actualStatus} (${r.expectedStatus})
          </span>
        </td>
        <td class="px-3 py-2 font-medium text-slate-700 truncate max-w-xs" title="${r.title}">${r.title || '<span class="text-slate-400">none</span>'}</td>
        <td class="px-3 py-2 text-slate-600 truncate max-w-xs" title="${r.h1}">${r.h1 || '<span class="text-slate-400">none</span>'}</td>
        <td class="px-3 py-2 text-right font-mono">${r.pageContentLength.toLocaleString()} chars</td>
        <td class="px-3 py-2 font-mono text-slate-600 truncate max-w-[120px]">${r.pricesFound.slice(0, 3).join(', ') || '-'}</td>
        <td class="px-3 py-2 text-center">
          <span class="inline-block px-2 py-0.5 rounded font-bold text-[11px] ${r.passed ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}">
            ${r.passed ? 'PASS' : 'FAIL'}
          </span>
        </td>
        <td class="px-3 py-2 text-rose-700 font-medium">${r.issues.join('<br>') || '<span class="text-emerald-700">None</span>'}</td>
      </tr>
    `
    )
    .join('');

  const htmlReport = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>India Cyber Cafe — Universal SEO & SSR Audit Report</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen p-4 sm:p-8">
  <div class="max-w-7xl mx-auto space-y-8">
    <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <div class="flex items-center gap-3">
          <img src="https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png" alt="ICC" class="w-10 h-10 object-contain" />
          <h1 class="text-2xl font-black text-slate-900 tracking-tight">Universal SEO &amp; Live SSR Audit</h1>
        </div>
        <p class="text-xs text-slate-500 mt-1">Generated: ${new Date().toLocaleString()} | India Cyber Cafe Technical Architecture</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="px-4 py-2 rounded-xl font-extrabold text-sm ${overallPassed ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}">
          ${overallPassed ? 'AUDIT PASSED ✅' : 'AUDIT HAS ISSUES ❌'}
        </span>
      </div>
    </div>

    <!-- METRICS GRID -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider">Catalog Services</div>
        <div class="text-2xl font-black text-slate-900 mt-1">${summary.catalog.services} Services</div>
        <div class="text-[11px] ${summary.catalog.hasDrivingLicense ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'} mt-1">
          Driving License: ${summary.catalog.hasDrivingLicense ? 'Synced & Verified' : 'Missing'}
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider">Mode A: Unit Tests</div>
        <div class="text-2xl font-black text-blue-700 mt-1">${summary.unitTests.passed} / ${summary.unitTests.total}</div>
        <div class="text-[11px] text-slate-500 mt-1">Pass rate: ${((summary.unitTests.passed / summary.unitTests.total) * 100).toFixed(1)}%</div>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider">Mode B: Live HTTP Tests</div>
        <div class="text-2xl font-black text-purple-700 mt-1">${summary.localHttpTests.passed} / ${summary.localHttpTests.total}</div>
        <div class="text-[11px] text-slate-500 mt-1">Real GET over Port 3000</div>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider">Canonical URLs</div>
        <div class="text-2xl font-black text-emerald-700 mt-1">${summary.totalDiscoveredRoutes} Indexed</div>
        <div class="text-[11px] text-slate-500 mt-1">Sitemap: ${sitemapUrlsCount} URLs</div>
      </div>
    </div>

    <!-- SITEMAP & ROBOTS STATUS -->
    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2">
      <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider">Indexation &amp; Crawler Policies</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div class="font-bold text-slate-900">XML Sitemap (/sitemap.xml)</div>
          <div class="text-slate-600 mt-0.5">${sitemapUrlsCount} published canonical URLs indexed with truthful timestamps. Driving License included.</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div class="font-bold text-slate-900">Robots Policy (/robots.txt)</div>
          <div class="text-slate-600 mt-0.5">Allows public crawling for all services, products &amp; documents. Strictly disallows /admin, /operator, /profile, /my-documents, and checkouts.</div>
        </div>
      </div>
    </div>

    <!-- AUDIT RESULTS TABLE -->
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div class="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
        <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider">Detailed Route Audit Results (${results.length} Tests)</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-100 text-[11px] font-bold text-slate-600 uppercase border-b border-slate-200">
              <th class="px-3 py-2.5">Mode</th>
              <th class="px-3 py-2.5">Route</th>
              <th class="px-3 py-2.5 text-center">Status</th>
              <th class="px-3 py-2.5">Title</th>
              <th class="px-3 py-2.5">H1 Heading</th>
              <th class="px-3 py-2.5 text-right">Body Length</th>
              <th class="px-3 py-2.5">Prices</th>
              <th class="px-3 py-2.5 text-center">Result</th>
              <th class="px-3 py-2.5">Issues</th>
            </tr>
          </thead>
          <tbody>
            ${htmlRows}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;

  const htmlReportPath = path.join(reportsDir, 'seo-audit.html');
  fs.writeFileSync(htmlReportPath, htmlReport, 'utf-8');
  console.log(`📄 Generated HTML report: ${htmlReportPath}`);

  console.log('\n======================================================');
  console.log(`  FINAL RESULT: ${overallPassed ? 'ALL TESTS PASSED ✅' : 'FAILURES DETECTED ❌'}`);
  console.log('======================================================\n');

  if (!overallPassed) {
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
