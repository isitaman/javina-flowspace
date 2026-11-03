/* Screenshot & cek layout Settings (desktop + HP) — opsional.
 * Jalankan dengan: set FLOWSPACE_SHOTS=1 && npm test   (Windows)
 *                  FLOWSPACE_SHOTS=1 npm test          (mac/Linux)
 * Screenshot disimpan ke tests/out/. */

const path = require('path');
const { launchBrowser, baseUrl, newPage } = require('./helpers/browser');

(async () => {
  const { browser } = await launchBrowser();
  const results = [];
  for (const [label, w, h] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    const { ctx, page, errors } = await newPage(browser, { viewport: { width: w, height: h } });
    await page.goto(baseUrl(), { waitUntil: 'load' });
    await page.waitForTimeout(1600);

    if (w < 768) {
      await page.click('#hamburger-btn');
      await page.waitForTimeout(400);
    }
    await page.click('[data-view="settings"]');
    await page.waitForTimeout(1000);

    if (w < 768) {
      const open = await page.evaluate(() => {
        const s = document.getElementById('sidebar');
        return s ? s.getBoundingClientRect().left > -10 : false;
      });
      if (open) {
        await page.click('#sidebar-backdrop', { force: true });
        await page.waitForTimeout(400);
      }
    }

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflowBy = doc.scrollWidth - doc.clientWidth;
      const view = document.querySelector('#view-container');
      const viewW = view ? view.clientWidth : doc.clientWidth;
      const wide = [];
      document.querySelectorAll('#view-container *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > viewW + 1 && r.height > 0) {
          wide.push({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 60), width: Math.round(r.width) });
        }
      });
      const diag = document.querySelector('#settings-diag');
      const backup = document.querySelector('#settings-backup');
      return {
        overflowBy,
        scrolling: overflowBy > 1,
        viewOverflowBy: view ? view.scrollWidth - view.clientWidth : 0,
        wide: wide.slice(0, 8),
        diagRows: diag ? diag.children.length : 0,
        diagVisible: !!(diag && diag.offsetParent !== null),
        backupVisible: !!(backup && backup.offsetParent !== null),
      };
    });

    const outDir = path.join(__dirname, 'out');
    const fs = require('fs');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, `settings-${label}.png`), fullPage: true });
    await page.evaluate(() => {
      const v = document.querySelector('#view-container');
      if (v) v.scrollTop = v.scrollHeight;
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, `settings-${label}-bottom.png`) });

    results.push({ label, viewport: `${w}x${h}`, ...metrics, errors });
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));

  const problems = [];
  results.forEach((r) => {
    if (r.scrolling) problems.push(`${r.label}: halaman bisa scroll horizontal (${r.overflowBy}px)`);
    if (r.diagRows < 10) problems.push(`${r.label}: panel diagnostik hanya ${r.diagRows} baris`);
    if (!r.backupVisible) problems.push(`${r.label}: tombol backup tidak terlihat`);
    r.errors.forEach((e) => problems.push(`${r.label}: ${e}`));
  });
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'OK: tidak ada masalah layout/konsol');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
