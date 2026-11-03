/* Helper bersama untuk suite Playwright.
 *
 * - launchBrowser(): pakai MS Edge bila ada di mesin ini (cepat, tidak perlu
 *   unduh browser), fallback ke Chromium bawaan Playwright.
 * - baseUrl(): URL server statis `web/` yang disiapkan `run.js`.
 * - newPage(): konteks + halaman baru dengan pengumpul console error dan
 *   rute `js/firebase-config.js` ke mode lokal (tanpa Firebase).
 */

const { chromium } = require('playwright');

async function launchBrowser() {
  const wanted = process.env.PW_BROWSER || '';
  const attempts = [];
  if (wanted && wanted !== 'msedge' && wanted !== 'chromium') {
    attempts.push({ channel: wanted, name: wanted });
  }
  if (wanted === 'chromium') {
    attempts.push({ channel: undefined, name: 'chromium' });
  } else {
    attempts.push({ channel: 'msedge', name: 'msedge' });
    attempts.push({ channel: undefined, name: 'chromium' });
  }
  const failures = [];
  for (const a of attempts) {
    try {
      const browser = await chromium.launch({ channel: a.channel, headless: true });
      return { browser, name: a.name };
    } catch (e) {
      failures.push(`${a.name}: ${String(e).split('\n')[0]}`);
    }
  }
  throw new Error(
    'Tidak ada browser yang bisa diluncurkan.\n' +
    failures.join('\n') +
    '\nSolusi: npx playwright install chromium'
  );
}

function baseUrl() {
  const url = process.env.FLOWSPACE_BASE_URL;
  if (!url) {
    throw new Error('FLOWSPACE_BASE_URL tidak diset — jalankan suite lewat `node tests/run.js`');
  }
  return url;
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));

  // Mode lokal: interceptor menggantikan file konfigurasi Firebase asli
  // supaya tes tidak pernah menyentuh proyek Firestore produksi.
  await page.route('**/js/firebase-config.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: "window.FLOWSPACE_CONFIG={mode:'local'};",
  }));

  return { ctx, page, errors };
}

module.exports = { launchBrowser, baseUrl, newPage };
