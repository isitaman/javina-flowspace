/* Smoke test: app shell termuat, mode lokal aktif, modal kategori
 * Application Hub bisa dibuka & ditutup, 0 error konsol. */

const fs = require('fs');
const path = require('path');
const { launchBrowser, baseUrl, newPage } = require('./helpers/browser');

(async () => {
  const { browser } = await launchBrowser();
  const { page, errors } = await newPage(browser);

  const checks = [];
  const check = (name, ok, extra) => checks.push({ name, ok: !!ok, extra: extra || '' });

  const outDir = path.join(__dirname, 'out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  await page.goto(baseUrl(), { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  check('app shell tampil', await page.locator('#sidebar').count() === 1);
  check('label sync = local', (await page.locator('#sync-label').textContent()).includes('Local'));

  await page.click('[data-view="applications"]');
  await page.waitForTimeout(700);
  check('tombol Kelola Kategori ada', await page.locator('#manage-cat-btn').count() === 1);

  await page.click('#manage-cat-btn');
  await page.waitForTimeout(600);
  check('modal kategori terbuka', await page.locator('#cat-manage-list').isVisible());

  const before = await page.locator('#cat-manage-list > *').count();
  check('daftar kategori terisi', before > 0, 'items=' + before);

  // Tutup modal lewat tombol tutup
  const closeBtn = page.locator('[data-close-modal], #close-cat-modal, button:has-text("Tutup")').first();
  if (await closeBtn.count()) {
    await closeBtn.click();
    await page.waitForTimeout(300);
    check('modal bisa ditutup', !(await page.locator('#cat-manage-list').isVisible()));
  }

  await page.screenshot({ path: path.join(outDir, 'smoke-categories.png') });

  console.log(JSON.stringify({ checks, failed: checks.filter((c) => !c.ok), errors }, null, 2));

  await browser.close();
  const bad = checks.filter((c) => !c.ok);
  console.log(bad.length || errors.length ? `GAGAL ${bad.length}/${checks.length}` : `LULUS ${checks.length}/${checks.length}`);
  process.exit(bad.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
