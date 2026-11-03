/* Fase 2 — Global search / command palette (Ctrl/Cmd+K).
 *
 * Cakupan:
 * - Ctrl+K membuka palette, fokus ke input, ARIA dialog/listbox
 * - query kosong menampilkan semua pintasan navigasi
 * - hasil task → drawer task; workflow → kanvas; aplikasi → Application Hub
 *   (kartu disorot); anggota → Team
 * - keyboard nav (↑/↓/Enter/Esc), empty state, input header sebagai pemicu
 * - pencarian tidak menambah fetch jaringan (hanya baca Store)
 * - viewport HP: tombol cari + palette tanpa scroll horizontal
 * - 0 error konsol
 */

const { launchBrowser, baseUrl, newPage } = require('./helpers/browser');

(async () => {
  const { browser } = await launchBrowser();
  const checks = [];
  const check = (name, ok, extra) => checks.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });

  const { page, errors } = await newPage(browser);
  const base = baseUrl();

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  // --- Siapkan data demo supaya pencarian punya isi ---
  await page.click('[data-view="settings"]');
  await page.waitForTimeout(900);
  await page.click('#settings-seed');
  await page.waitForSelector('[data-confirm-ok]');
  await page.click('[data-confirm-ok]');
  await page.waitForTimeout(2600);

  const data = await page.evaluate(() => {
    const first = (list) => (Store.readAll(list) || [])[0] || null;
    const members = Store.readAll('members') || [];
    return {
      task: first('tasks'),
      workflow: first('workflows'),
      app: first('applications'),
      node: (Store.readAll('nodes') || [])[0] || null,
      member: members.find((m) => m.display_name) || members[0] || null,
    };
  });
  check('data demo tersedia', !!(data.task && data.workflow && data.app),
    `task=${data.task && data.task.title} wf=${data.workflow && data.workflow.workflow_name}`);

  // --- Ctrl+K membuka palette ---
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(400);
  check('Ctrl+K membuka palette', await page.locator('#search-palette').isVisible());
  check('fokus pindah ke input palette', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'search-palette-input');
  check('palette punya role dialog', await page.locator('#search-palette [role="dialog"]').count() === 1);
  check('hasil punya role listbox', await page.locator('#search-results[role="listbox"]').count() === 1);

  const emptyLabels = await page.locator('.search-group-label').allInnerTexts();
  check('query kosong menampilkan "Lompat ke"', emptyLabels.join('|').toLowerCase().includes('lompat ke'), emptyLabels.join('|'));
  const navCount = await page.locator('.search-group').first().locator('.search-item').count();
  check('semua menu navigasi muncul (7)', navCount === 7, 'items=' + navCount);

  // --- Pilih navigasi lewat keyboard ---
  await page.fill('#search-palette-input', 'dashboard');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check('Enter pada navigasi membuka Dashboard',
    (await page.evaluate(() => State.view && State.view.kind)) === 'dashboard');
  check('palette tertutup setelah memilih', await page.locator('#search-palette').count() === 0);

  // --- Cari task → buka drawer ---
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(300);
  await page.fill('#search-palette-input', String(data.task.title).slice(0, 10));
  await page.waitForTimeout(300);
  const taskResults = await page.locator('#search-results [data-search-index]').count();
  check('hasil task muncul', taskResults > 0, 'items=' + taskResults);
  const firstTaskItem = page.locator('.search-item', { has: page.locator('.search-item-badge', { hasText: 'Task' }) }).first();
  check('hasil berbadge Task ada', await firstTaskItem.count() > 0);
  await firstTaskItem.click();
  await page.waitForTimeout(1500);
  check('klik hasil task membuka drawer', await page.locator('#task-drawer:not(.hidden)').count() === 1);
  await page.waitForTimeout(1200);
  check('drawer berisi task yang dipilih', await page.locator('#task-drawer').innerText().then((t) => t.toLowerCase().includes(String(data.task.title).split(/\s+/)[0].toLowerCase())));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('Esc menutup drawer task', await page.locator('#task-drawer.hidden').count() === 1);

  // --- Cari workflow → kanvas ---
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(300);
  await page.fill('#search-palette-input', String(data.workflow.workflow_name).slice(0, 12));
  await page.waitForTimeout(300);
  const wfItem = page.locator('.search-item', { has: page.locator('.search-item-badge', { hasText: 'Workflow' }) }).first();
  check('hasil workflow muncul', await wfItem.count() > 0);
  await wfItem.click();
  await page.waitForTimeout(1200);
  const canvasState = await page.evaluate(() => ({ kind: State.view.kind, wf: State.currentWorkflowId }));
  check('klik hasil workflow membuka kanvas', canvasState.kind === 'canvas', JSON.stringify(canvasState));
  check('kanvas membuka workflow yang benar', String(canvasState.wf) === String(data.workflow.workflow_id));

  // --- Cari aplikasi → Application Hub + highlight ---
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(300);
  await page.fill('#search-palette-input', String(data.app.app_name).slice(0, 10));
  await page.waitForTimeout(300);
  const appItem = page.locator('.search-item', { has: page.locator('.search-item-badge', { hasText: 'Aplikasi' }) }).first();
  check('hasil aplikasi muncul', await appItem.count() > 0);
  await appItem.click();
  await page.waitForTimeout(1600);
  const appState = await page.evaluate(() => ({
    kind: State.view.kind,
    flashed: !!document.querySelector('.search-flash'),
    card: document.querySelectorAll('[data-app-card]').length,
  }));
  check('klik hasil aplikasi membuka Application Hub', appState.kind === 'applications', JSON.stringify(appState));
  check('kartu aplikasi ikut disorot', appState.flashed, 'cards=' + appState.card);

  // --- Cari anggota → Team ---
  if (data.member) {
    await page.keyboard.press('Control+K');
    await page.waitForTimeout(300);
    await page.fill('#search-palette-input', String(data.member.email || data.member.display_name).slice(0, 12));
    await page.waitForTimeout(300);
    const memberItem = page.locator('.search-item', { has: page.locator('.search-item-badge', { hasText: 'Anggota' }) }).first();
    check('hasil anggota muncul', await memberItem.count() > 0);
    await memberItem.click();
    await page.waitForTimeout(1400);
    check('klik hasil anggota membuka Team',
      (await page.evaluate(() => State.view.kind)) === 'team');
  }

  // --- Esc menutup & mengembalikan fokus ---
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc menutup palette', await page.locator('#search-palette').count() === 0);

  // --- Klik kotak pencarian header ---
  await page.click('#search-input');
  await page.waitForTimeout(400);
  check('klik kotak header membuka palette', await page.locator('#search-palette').isVisible());
  check('input header readonly (tidak mengetik liar)',
    await page.locator('#search-input').getAttribute('readonly') !== null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- Panah bawah/atas mengubah pilihan aktif ---
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(300);
  await page.fill('#search-palette-input', 'a');
  await page.waitForTimeout(300);
  const before = await page.locator('.search-item.is-active').getAttribute('data-search-index');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  const after = await page.locator('.search-item.is-active').getAttribute('data-search-index');
  check('ArrowDown memindahkan pilihan', before !== after, `${before} -> ${after}`);
  const selectedCount = await page.locator('#search-results [aria-selected="true"]').count();
  check('hanya satu item aria-selected', selectedCount === 1, 'count=' + selectedCount);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --- Query tanpa hasil ---
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(300);
  await page.fill('#search-palette-input', 'zzzqqq-tidak-ada');
  await page.waitForTimeout(300);
  check('menampilkan empty state', (await page.locator('.search-empty').innerText()).includes('Tidak ada hasil'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --- Tanpa read Firestore tambahan (hanya Store) ---
  const noFetch = await page.evaluate((seed) => {
    let calls = 0;
    const original = window.fetch;
    window.fetch = function () { calls++; return original.apply(this, arguments); };
    const res = window.FlowSearch.resultsFor(String(seed).slice(0, 4));
    window.fetch = original;
    return { calls, groups: res.length };
  }, data.task.title);
  check('pencarian tidak memanggil jaringan', noFetch.calls === 0, 'fetch=' + noFetch.calls + ' groups=' + noFetch.groups);
  check('hasil pencarian langsung dari memori', noFetch.groups > 0, 'groups=' + noFetch.groups);

  await page.context().close();

  // --- Mobile: tombol pencarian di header ---
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mctx.newPage();
  const mErrors = [];
  mpage.on('console', (m) => { if (m.type() === 'error') mErrors.push('console: ' + m.text()); });
  mpage.on('pageerror', (e) => mErrors.push('pageerror: ' + String(e)));
  await mpage.route('**/js/firebase-config.js', (r) => r.fulfill({
    contentType: 'application/javascript',
    body: "window.FLOWSPACE_CONFIG={mode:'local'};",
  }));
  await mpage.goto(base, { waitUntil: 'load' });
  await mpage.waitForTimeout(1600);
  check('tombol cari tampil di HP', await mpage.locator('#search-mobile-btn').isVisible());
  await mpage.click('#search-mobile-btn');
  await mpage.waitForTimeout(500);
  check('palette terbuka dari tombol HP', await mpage.locator('#search-palette').isVisible());
  const mobileOverflow = await mpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('palette tidak menyebabkan scroll horizontal', mobileOverflow <= 1, 'overflow=' + mobileOverflow);
  await mpage.keyboard.press('Escape');
  await mpage.waitForTimeout(300);
  await mctx.close();

  await browser.close();

  errors.push(...mErrors);
  const failed = checks.filter((c) => !c.ok);
  console.log(JSON.stringify({ checks, failed, errors }, null, 2));
  console.log(failed.length ? `GAGAL ${failed.length}/${checks.length}` : `LULUS ${checks.length}/${checks.length}`);
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
