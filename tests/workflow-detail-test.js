/* Workflow detail (modal) + tautan aplikasi workflow/node.
 *
 * Cakupan:
 * - tombol "Lihat detail" di daftar workflow membuka modal sendiri
 *   (bukan kanvas) dan menampilkan pratinjau diagram di bagian bawah
 * - menautkan aplikasi yang sudah ada ke workflow benar-benar tersimpan
 * - menautkan aplikasi ke node tertentu
 * - melepas tautan lewat dialog konfirmasi
 * - panel kanan kanvas menampilkan detail workflow saat tidak ada node
 *   terpilih, dan tombol "Lihat detail lengkap" membuka modal yang sama
 * - 0 error konsol
 */

const { launchBrowser, baseUrl, newPage } = require('./helpers/browser');

const UPPER = (text) => String(text || '').toUpperCase();

(async () => {
  const { browser } = await launchBrowser();
  const checks = [];
  const check = (name, ok, extra) => checks.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });

  const { page, errors } = await newPage(browser);

  try {
    await page.goto(baseUrl(), { waitUntil: 'load' });
    await page.waitForTimeout(1800);

    // Data demo: workflow + node + aplikasi.
    await page.click('[data-view="settings"]');
    await page.waitForTimeout(900);
    await page.click('#settings-seed');
    await page.waitForSelector('[data-confirm-ok]');
    await page.click('[data-confirm-ok]');
    await page.waitForTimeout(2600);

    await page.click('[data-view="workflows"]');
    await page.waitForTimeout(1500);

    // Pilih workflow yang punya node agar opsi target node tersedia.
    const wfId = await page.evaluate(() => {
      const nodes = Store.readAll('nodes') || [];
      const counts = {};
      nodes.forEach((n) => { counts[String(n.workflow_id)] = (counts[String(n.workflow_id)] || 0) + 1; });
      const wfs = Store.readAll('workflows') || [];
      return ((wfs.filter((w) => counts[String(w.workflow_id)] > 0)[0]) || wfs[0] || {}).workflow_id || '';
    });
    check('workflow demo ditemukan', !!wfId, wfId);

    const detailBtn = page.locator(`[data-wf-detail][data-wf-id="${wfId}"]`);
    check('tombol Lihat detail ada', (await detailBtn.count()) === 1);
    await detailBtn.click();
    await page.waitForTimeout(1400);

    check('modal detail terbuka', await page.locator('#wf-detail-title').isVisible());
    const bodyText = await page.locator('#wf-detail-body').innerText();
    check('bagian Aplikasi terkait ada', bodyText.includes('Aplikasi terkait'));
    check('pratinjau diagram ada',
      (await page.locator('svg[aria-label="Pratinjau diagram workflow"]').count()) > 0
      || bodyText.includes('Canvas masih kosong'));

    // Tautkan aplikasi yang sudah ada ke workflow.
    await page.locator('[data-wf-app-link-existing]').first().click();
    await page.waitForTimeout(1000);
    check('dialog tautkan aplikasi terbuka', await page.locator('#wf-app-pick').isVisible());
    const optCount = await page.locator('#wf-app-pick option').count();
    check('daftar aplikasi terisi', optCount > 1, 'options=' + optCount);

    await page.locator('#wf-app-pick').selectOption({ index: 1 });
    await page.locator('#wf-app-target').selectOption('workflow');
    await page.locator('#wf-app-submit').click();
    await page.waitForTimeout(1500);
    check('dialog tertutup setelah tautkan', (await page.locator('#wf-app-pick').count()) === 0);
    const afterWorkflowLink = UPPER(await page.locator('#wf-detail-body').innerText());
    check('grup tautan workflow muncul', afterWorkflowLink.includes('LANGSUNG KE WORKFLOW'));

    // Tautkan aplikasi lain ke node pertama.
    await page.locator('[data-wf-app-link-existing]').first().click();
    await page.waitForTimeout(1000);
    const targetOpts = await page.locator('#wf-app-target option').allTextContents();
    check('opsi node tersedia', targetOpts.length > 1, targetOpts.join(' | '));
    const pickCount = await page.locator('#wf-app-pick option').count();
    await page.locator('#wf-app-pick').selectOption({ index: pickCount > 2 ? 2 : 1 });
    const nodeValue = await page.locator('#wf-app-target option').nth(1).getAttribute('value');
    await page.locator('#wf-app-target').selectOption(nodeValue);
    await page.locator('#wf-app-submit').click();
    await page.waitForTimeout(1500);
    const afterNodeLink = UPPER(await page.locator('#wf-detail-body').innerText());
    check('grup tautan node muncul', afterNodeLink.includes('KE NODE'));

    // Lepas satu tautan.
    const unlinkCount = await page.locator('[data-wf-app-unlink]').count();
    check('tombol lepas tautan ada', unlinkCount > 0, 'buttons=' + unlinkCount);
    if (unlinkCount > 0) {
      const beforeUnlink = await page.locator('#wf-detail-body').innerText();
      await page.locator('[data-wf-app-unlink]').first().click();
      await page.waitForTimeout(600);
      check('konfirmasi lepas muncul', await page.locator('[data-confirm-ok]').isVisible());
      await page.locator('[data-confirm-ok]').click();
      await page.waitForTimeout(1600);
      const afterUnlink = await page.locator('#wf-detail-body').innerText();
      check('jumlah tautan berkurang', afterUnlink !== beforeUnlink);
    }

    // Panel kanan kanvas (tanpa node terpilih) juga menampilkan detail.
    await page.locator('[data-wf-detail-close]').first().click();
    await page.waitForTimeout(500);
    check('modal tertutup', (await page.locator('#wf-detail-title').count()) === 0);

    await page.locator(`[data-wf-open][data-wf-id="${wfId}"]`).last().click();
    await page.waitForTimeout(2200);
    const panelOpen = await page.locator('#node-detail-panel').evaluate((el) => el.classList.contains('is-open'));
    check('panel kanan workflow terbuka di kanvas', panelOpen);
    const panelText = await page.locator('#node-detail-body').innerText();
    check('panel berisi detail workflow', panelText.includes('Aplikasi terkait'));

    const panelDetailBtn = page.locator('[data-wf-detail-modal]');
    check('tombol detail lengkap di panel ada', (await panelDetailBtn.count()) > 0);
    if (await panelDetailBtn.count()) {
      await panelDetailBtn.click();
      await page.waitForTimeout(1200);
      check('modal dari panel terbuka', await page.locator('#wf-detail-title').isVisible());
      await page.locator('[data-wf-detail-close]').first().click();
      await page.waitForTimeout(300);
    }
  } catch (e) {
    check('skrip berjalan tanpa exception', false, (e && e.message) || String(e));
  }

  console.log(JSON.stringify({ checks, failed: checks.filter((c) => !c.ok), errors }, null, 2));

  await browser.close();
  const bad = checks.filter((c) => !c.ok);
  console.log(bad.length || errors.length ? `GAGAL ${bad.length}/${checks.length}` : `LULUS ${checks.length}/${checks.length}`);
  process.exit(bad.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
