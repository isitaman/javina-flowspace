/* Fase 1 — Backup & Export + Diagnostik di Settings.
 *
 * Cakupan:
 * - panel diagnostik terisi 10 baris (mode lokal)
 * - unduh backup: nama file, JSON valid, format flowspace-backup,
 *   counts konsisten dengan isi koleksi, data demo ikut terekspor
 * - tombol Salin diagnostik menghasilkan JSON
 * - regresi: modal kategori Application Hub tetap jalan
 * - 0 error konsol
 */

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

  await page.click('[data-view="settings"]');
  await page.waitForTimeout(900);

  // --- Diagnostik ---
  const diagRows = await page.locator('#settings-diag > div').count();
  check('panel diagnostik terisi', diagRows >= 10, 'rows=' + diagRows);

  const diagText = await page.locator('#settings-diag').innerText();
  check('diagnostik memuat listener aktif', /Listener aktif/.test(diagText));
  check('diagnostik memuat mode', /Lokal/.test(diagText));

  // --- Export (isi dulu dengan data demo supaya terbukti membawa baris) ---
  await page.click('#settings-seed');
  await page.waitForSelector('[data-confirm-ok]');
  await page.click('[data-confirm-ok]');
  await page.waitForTimeout(2500);
  if (!(await page.locator('#settings-backup').count())) {
    await page.click('[data-view="settings"]');
    await page.waitForTimeout(900);
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#settings-backup');
  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  check('nama file backup benar', /^flowspace-.+-\d{8}-\d{6}\.json$/.test(suggested), suggested);

  const target = path.join(outDir, 'backup-out.json');
  await download.saveAs(target);
  const raw = fs.readFileSync(target, 'utf8');
  let payload = null;
  try { payload = JSON.parse(raw); } catch (e) {}
  check('backup adalah JSON valid', !!payload);
  check('format = flowspace-backup', payload && payload.format === 'flowspace-backup');
  check('ada collections', !!(payload && payload.collections));
  check('collections berisi tasks', !!(payload && Array.isArray(payload.collections.tasks)));
  check('counts konsisten', !!(payload && payload.counts && payload.counts.tasks === payload.collections.tasks.length),
    payload ? `counts=${payload.counts && payload.counts.tasks} rows=${payload.collections.tasks.length}` : '');
  const totalDocs = payload ? payload.counts.tasks + payload.counts.workflows + payload.counts.applications : 0;
  check('backup berisi data demo', totalDocs > 0, 'docs=' + totalDocs);
  fs.unlinkSync(target);

  // --- Salin diagnostik ---
  await page.evaluate(() => {
    window.__copied = null;
    navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); };
  });
  await page.click('#settings-diag-copy');
  await page.waitForTimeout(500);
  const copied = await page.evaluate(() => window.__copied);
  let copiedJson = null;
  try { copiedJson = JSON.parse(copied || ''); } catch (e) {}
  check('salin diagnostik menghasilkan JSON', !!copiedJson);
  check('diagnostik punya listeners & collections', !!(copiedJson && typeof copiedJson.listeners === 'number' && copiedJson.collections));

  // --- Regresi: modal kategori tetap jalan ---
  await page.click('[data-view="applications"]');
  await page.waitForTimeout(600);
  await page.click('#manage-cat-btn');
  await page.waitForTimeout(500);
  check('modal kategori masih terbuka', await page.locator('#cat-manage-list').isVisible());

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(JSON.stringify({ checks, failed, errors }, null, 2));
  console.log(failed.length || errors.length ? `GAGAL ${failed.length}/${checks.length}` : `LULUS ${checks.length}/${checks.length}`);
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
