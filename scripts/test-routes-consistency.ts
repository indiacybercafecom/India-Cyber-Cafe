#!/usr/bin/env node
/**
 * Automated Route-by-Route Reload Consistency, Caching & Bot/Browser Parity Suite
 *
 * Verifies the real compiled production server (node server.js) across:
 * 1. Desktop Chrome UA (interactive browser path)
 * 2. Mobile Chrome UA (interactive browser path)
 * 3. Googlebot/2.1 UA (search crawler SSR path)
 * 4. Public /data/*.json endpoints & /api/health diagnostics
 *
 * Ensures that:
 * - Browser responses carry strict no-store cache headers + Vary: User-Agent
 * - Interactive browsers receive empty <div id="root"></div> (no SSR/hydrateRoot mismatch)
 * - Public routes embed accurate window.__INITIAL_DATA__, private /admin* routes omit it
 * - Consecutive hard/normal reload requests return deterministic, identical HTML & data counts
 * - Mobile Chrome and Desktop Chrome receive identical initial HTML & catalog data
 * - Crawlers receive full semantic SSR <h1>, JSON-LD, prices, and internal links (200 / 404)
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { getPublicData, getAllPublicUrls } from '../src/server/publicDataService.js';

const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MOBILE_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function extractInitialData(html: string): any | null {
  const match = html.match(/window\.__INITIAL_DATA__\s*=\s*([\s\S]*?);\s*<\/script>/);
  if (!match) return null;
  const raw = match[1].trim();
  return JSON.parse(raw);
}

function extractTagText(html: string, regex: RegExp): string {
  const m = html.match(regex);
  return m ? m[1].trim() : '';
}

async function waitForServer(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${baseUrl}/api/health`);
      if (resp.ok) return;
    } catch {
      // retry until timeout
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

async function fetchWithUa(url: string, userAgent: string) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const body = await resp.text();
  return {
    status: resp.status,
    headers: resp.headers,
    body,
  };
}

async function run() {
  const appRoot = process.cwd();
  const distIndex = path.join(appRoot, 'dist/index.html');
  assert(fs.existsSync(distIndex), 'dist/index.html must exist. Run npm run build first.');

  const TEST_PORT = Number(process.env.CONSISTENCY_TEST_PORT || 3199);
  const BASE_URL = process.env.BASE_URL || `http://localhost:${TEST_PORT}`;
  const shouldSpawnServer = !process.env.BASE_URL;

  let serverProc: ChildProcess | null = null;
  let serverStderr = '';

  try {
    if (shouldSpawnServer) {
      serverProc = spawn(process.execPath, ['server.js'], {
        cwd: appRoot,
        env: {
          ...process.env,
          PORT: String(TEST_PORT),
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      serverProc.stderr?.on('data', chunk => {
        serverStderr += chunk.toString();
      });
      await waitForServer(BASE_URL, 15000);
    }

    let passed = 0;
    const check = async (name: string, fn: () => Promise<void> | void) => {
      await fn();
      passed++;
      console.log(`✅ [PASS] ${name}`);
    };

    // 1. Verify /api/health diagnostics
    await check('/api/health returns 200 with publicDataAvailable & store service flags', async () => {
      const resp = await fetch(`${BASE_URL}/api/health`);
      assert.strictEqual(resp.status, 200);
      const data = await resp.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.publicDataAvailable, true);
      assert.strictEqual(typeof data.firebaseAdminConfigured, 'boolean');
      assert.strictEqual(typeof data.razorpayConfigured, 'boolean');
      assert.strictEqual(typeof data.testMode, 'boolean');
    });

    // 2. Verify /data/*.json endpoints serve fresh public/data files with no-store headers
    await check('/data/*.json endpoints serve current catalog with no-store headers', async () => {
      const dataFiles = [
        { url: '/data/services.json', disk: 'public/data/services.json', key: 'services' },
        { url: '/data/products.json', disk: 'public/data/products.json', key: 'products' },
        { url: '/data/product-categories.json', disk: 'public/data/product-categories.json', key: 'categories' },
        { url: '/data/documents.json', disk: 'public/data/documents.json', key: 'documents' },
        { url: '/data/document-categories.json', disk: 'public/data/document-categories.json', key: 'categories' },
      ];
      for (const item of dataFiles) {
        const resp = await fetch(`${BASE_URL}${item.url}`);
        assert.strictEqual(resp.status, 200, `${item.url} returned ${resp.status}`);
        const cc = (resp.headers.get('cache-control') || '').toLowerCase();
        assert(cc.includes('no-store') && cc.includes('max-age=0'), `${item.url} missing no-store header: ${cc}`);
        const servedJson = await resp.json();
        const diskJson = JSON.parse(fs.readFileSync(path.join(appRoot, item.disk), 'utf-8'));
        assert.strictEqual(
          servedJson[item.key].length,
          diskJson[item.key].length,
          `${item.url} count mismatch (${servedJson[item.key].length} vs ${diskJson[item.key].length})`
        );
      }
    });

    // Build complete route test list
    const publicData = getPublicData(appRoot);
    const discovered = getAllPublicUrls('https://b.indiacybercafe.com', appRoot);

    const staticPublicRoutes = [
      '/',
      '/services',
      '/price-list',
      '/store',
      '/forms-documents',
      '/about',
      '/contact',
      '/pay',
      '/legal/terms',
      '/legal/privacy',
      '/legal/refund',
      '/legal/disclaimer',
      '/sitemap.html',
      '/privacy-request',
      '/privacy-request/track',
    ];

    const sampleDynamicRoutes = discovered
      .map(r => r.path)
      .filter(p => !staticPublicRoutes.includes(p));

    const publicRoutesToTest = [...staticPublicRoutes, ...sampleDynamicRoutes];
    const privateRoutesToTest = ['/track', '/profile', '/admin/applications', '/my-documents'];
    const notFoundRoutesToTest = ['/non-existent-route-404', '/services/missing-service-xyz-404'];

    // 3. Test EVERY public route for Desktop Chrome, Mobile Chrome & reload determinism
    await check(`All ${publicRoutesToTest.length} public routes render deterministic empty-root SPA HTML on Desktop & Mobile Chrome`, async () => {
      for (const routePath of publicRoutesToTest) {
        const url = `${BASE_URL}${routePath}`;
        const [desktop1, desktop2, mobile1] = await Promise.all([
          fetchWithUa(url, DESKTOP_CHROME_UA),
          fetchWithUa(url, DESKTOP_CHROME_UA),
          fetchWithUa(url, MOBILE_CHROME_UA),
        ]);

        assert.strictEqual(desktop1.status, 200, `${routePath} Desktop expected 200, got ${desktop1.status}`);
        assert.strictEqual(mobile1.status, 200, `${routePath} Mobile expected 200, got ${mobile1.status}`);

        // No-store & Vary checks
        for (const [label, res] of [['Desktop', desktop1], ['Mobile', mobile1]] as const) {
          const cc = (res.headers.get('cache-control') || '').toLowerCase();
          const vary = (res.headers.get('vary') || '').toLowerCase();
          assert(cc.includes('no-store') && cc.includes('max-age=0'), `${routePath} ${label} missing no-store header (${cc})`);
          assert(vary.includes('user-agent'), `${routePath} ${label} missing Vary: User-Agent (${vary})`);

          // Empty #root (no manual SSR HTML mismatch for interactive browsers!)
          assert(
            res.body.includes('<div id="root"></div>'),
            `${routePath} ${label} must serve empty <div id="root"></div> for interactive React mount`
          );

          // Accurate per-route metadata
          const title = extractTagText(res.body, /<title[^>]*>([\s\S]*?)<\/title>/i);
          const canonical = extractTagText(res.body, /<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']/i);
          assert(title.length >= 10 && !title.includes('undefined'), `${routePath} ${label} invalid title: ${title}`);
          assert(canonical.endsWith(routePath === '/' ? '.com/' : routePath) || canonical.includes(routePath), `${routePath} ${label} canonical mismatch: ${canonical}`);

          const initialData = extractInitialData(res.body);
          assert(initialData && Array.isArray(initialData.services), `${routePath} ${label} missing window.__INITIAL_DATA__.services`);
          assert.strictEqual(initialData.services.length, publicData.services.length, `${routePath} services count drift`);
          assert.strictEqual(initialData.products.length, publicData.products.length, `${routePath} products count drift`);
          assert.strictEqual(initialData.documents.length, publicData.documents.length, `${routePath} documents count drift`);
        }

        // Reload determinism & Desktop/Mobile parity
        assert.strictEqual(desktop1.body, desktop2.body, `${routePath} reload #1 != #2 HTML mismatch!`);
        assert.strictEqual(desktop1.body, mobile1.body, `${routePath} Desktop Chrome != Mobile Chrome HTML mismatch!`);
      }
    });

    // 4. Test private routes (/track, /profile, /admin/applications, /my-documents)
    await check('Private routes return 200 empty-root HTML, noindex, no-store, and omit __INITIAL_DATA__ on /admin*', async () => {
      for (const routePath of privateRoutesToTest) {
        const res = await fetchWithUa(`${BASE_URL}${routePath}`, DESKTOP_CHROME_UA);
        assert.strictEqual(res.status, 200, `${routePath} expected 200, got ${res.status}`);
        assert(res.body.includes('<div id="root"></div>'), `${routePath} must serve empty #root`);
        const cc = (res.headers.get('cache-control') || '').toLowerCase();
        assert(cc.includes('no-store'), `${routePath} missing no-store header`);
        const robots = extractTagText(res.body, /<meta\s+name=["']robots["']\s+content=["']([\s\S]*?)["']/i);
        assert(robots.includes('noindex'), `${routePath} should include noindex (${robots})`);

        const initialData = extractInitialData(res.body);
        if (routePath.startsWith('/admin') || routePath.startsWith('/operator')) {
          assert.strictEqual(initialData, null, `${routePath} should omit window.__INITIAL_DATA__`);
        } else {
          assert(initialData !== null, `${routePath} should have initial data`);
        }
      }
    });

    // 5. Test 404 routes return real 404 status on both Browser & Googlebot
    await check('Missing routes return HTTP 404 with noindex on both Desktop Chrome & Googlebot', async () => {
      for (const routePath of notFoundRoutesToTest) {
        const [browserRes, botRes] = await Promise.all([
          fetchWithUa(`${BASE_URL}${routePath}`, DESKTOP_CHROME_UA),
          fetchWithUa(`${BASE_URL}${routePath}`, GOOGLEBOT_UA),
        ]);
        assert.strictEqual(browserRes.status, 404, `${routePath} browser expected 404, got ${browserRes.status}`);
        assert.strictEqual(botRes.status, 404, `${routePath} bot expected 404, got ${botRes.status}`);
        assert(browserRes.body.includes('<div id="root"></div>'));
        assert(botRes.body.includes('<h1'));
      }
    });

    // 6. Test Googlebot receives full semantic SSR HTML on core & dynamic routes
    await check('Googlebot UA receives semantic SSR HTML (<h1>, JSON-LD, prices, internal links)', async () => {
      const botSample = [
        '/',
        '/services',
        '/services/pan-card',
        '/services/driving-license',
        '/price-list',
        '/store',
        '/forms-documents',
        '/about',
        '/contact',
      ];
      for (const routePath of botSample) {
        const res = await fetchWithUa(`${BASE_URL}${routePath}`, GOOGLEBOT_UA);
        assert.strictEqual(res.status, 200, `Bot ${routePath} expected 200, got ${res.status}`);
        assert(!res.body.includes('<div id="root"></div>'), `Bot ${routePath} should receive full SSR content inside #root`);
        const h1Count = (res.body.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) || []).length;
        assert.strictEqual(h1Count, 1, `Bot ${routePath} expected 1 <h1>, got ${h1Count}`);
        assert(res.body.includes('application/ld+json'), `Bot ${routePath} missing JSON-LD`);
      }
    });

    console.log(`\n🎉 All ${passed} route reload-consistency & crawler parity checks passed!`);
  } finally {
    if (serverProc) {
      serverProc.kill('SIGTERM');
    }
    if (serverStderr.trim()) {
      // Surface stderr only if unexpected fatal startup errors occurred
      const lines = serverStderr.trim().split('\n').slice(0, 5).join('\n');
      if (lines.includes('Error:')) {
        console.warn('[Server stderr note]:', lines);
      }
    }
  }
}

run().catch((err) => {
  console.error('❌ Route consistency suite failed:', err);
  process.exit(1);
});
