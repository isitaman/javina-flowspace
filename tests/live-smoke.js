/* Smoke terhadap situs LIVE (produksi).
 *
 * TIDAK dijalankan oleh `npm test` — hanya manual, dan hanya kalau
 * FLOWSPACE_LIVE_URL diset. Tujuannya: memastikan deploy terakhir benar-benar
 * menyajikan aset baru, CSP/COOP sesuai harapan, dan layar masuk tampil
 * tanpa error konsol.
 *
 * Contoh:
 *   Windows:  set FLOWSPACE_LIVE_URL=https://javina-project.web.app && node tests/live-smoke.js
 *   mac/Linux: FLOWSPACE_LIVE_URL=https://javina-project.web.app node tests/live-smoke.js
 */

const { launchBrowser } = require('./helpers/browser');

(async () => {
  const url = process.env.FLOWSPACE_LIVE_URL;
  if (!url) {
    console.log('SKIP: FLOWSPACE_LIVE_URL tidak diset (tes live hanya untuk manual).');
    process.exit(0);
  }

  const { browser } = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const warns = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
    if (m.type() === 'warning') warns.push('warn: ' + m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));

  const checks = [];
  const check = (name, ok, extra) => checks.push({ name, ok: !!ok, extra: extra || '' });

  const resp = await page.goto(url, { waitUntil: 'load' });
  const headers = resp.headers();
  const csp = headers['content-security-policy'] || '';
  check('status 200', resp.status() === 200, 'status=' + resp.status());
  check('CSP mengizinkan apis.google.com', /apis\.google\.com/.test(csp) && /connect-src[^;]*apis\.google\.com/.test(csp));
  // COOP sengaja dihapus: header ini tidak menghentikan peringatan COOP milik
  // Google sendiri, sementara default `unsafe-none` paling kompatibel dengan
  // alur popup signInWithPopup.
  check('COOP tidak dipaksakan', !headers['cross-origin-opener-policy']);

  await page.waitForTimeout(3500);
  check('layar masuk tampil', await page.locator('#auth-screen').count() === 1);
  check('tombol Google ada', await page.locator('[data-auth-google]').count() === 1);
  check('tidak ada teks "Buat workspace"', !(await page.locator('#auth-screen').innerText()).includes('Buat workspace baru'));

  const assetOk = await page.evaluate(async () => {
    const r = await fetch('js/firebase.js', { cache: 'no-store' });
    const t = await r.text();
    return { deniedWarned: t.includes('deniedWarned'), sessionChanged: t.includes('flowspace/session-changed') };
  });
  check('aset firebase.js terbaru', assetOk.deniedWarned && assetOk.sessionChanged, JSON.stringify(assetOk));

  const outDir = require('path').join(__dirname, 'out');
  const fs = require('fs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: require('path').join(outDir, 'live-login.png') });

  console.log(JSON.stringify({ checks, failed: checks.filter((c) => !c.ok), errors, warns }, null, 2));
  await browser.close();
  const bad = checks.filter((c) => !c.ok);
  process.exit(bad.length || errors.length ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
