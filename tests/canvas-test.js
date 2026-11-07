/* Canvas: penempatan node (klik & drag-and-drop) + persistensi titik tekuk.
 *
 * Cakupan:
 * - klik palette menempatkan node baru di tengah viewport (bukan menumpuk
 *   di koordinat tetap yang sama)
 * - drag-and-drop dari palette menempatkan node di titik lepas
 * - titik tekuk (reroute) tersimpan ke edges.points_json dan dipulihkan saat
 *   canvas dibuka ulang
 * - 0 error konsol
 */

const { launchBrowser, baseUrl, newPage } = require('./helpers/browser');

(async () => {
  const { browser } = await launchBrowser();
  const checks = [];
  const check = (name, ok, extra) => checks.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });

  const { page, errors } = await newPage(browser, { viewport: { width: 1400, height: 900 } });

  try {
    await page.goto(baseUrl(), { waitUntil: 'load' });
    await page.waitForTimeout(1600);

    // Seed data demo (workflow + node + edge).
    await page.click('[data-view="settings"]');
    await page.waitForTimeout(900);
    await page.click('#settings-seed');
    await page.waitForSelector('[data-confirm-ok]');
    await page.click('[data-confirm-ok]');
    await page.waitForTimeout(2600);

    const wfId = await page.evaluate(() => {
      const nodes = Store.readAll('nodes') || [];
      const counts = {};
      nodes.forEach((n) => { counts[String(n.workflow_id)] = (counts[String(n.workflow_id)] || 0) + 1; });
      const wfs = Store.readAll('workflows') || [];
      const best = wfs.filter((w) => (counts[String(w.workflow_id)] || 0) >= 4)[0] || wfs[0] || {};
      return best.workflow_id || '';
    });
    check('workflow demo ditemukan', !!wfId, wfId);

    await page.click('[data-view="workflows"]');
    await page.waitForTimeout(1300);
    await page.locator(`[data-wf-open][data-wf-id="${wfId}"]`).last().click();
    await page.waitForTimeout(2400);

    const snapshotNodes = () => page.evaluate(() => Object.keys(State.editor.drawflow.drawflow.Home.data).map((id) => {
      const d = State.editor.drawflow.drawflow.Home.data[id];
      const el = document.getElementById('node-' + id);
      return { id, x: d.pos_x, y: d.pos_y, w: el ? el.offsetWidth : 160, h: el ? el.offsetHeight : 64 };
    }));

    const before = await snapshotNodes();
    check('canvas berisi node demo', before.length >= 4, 'nodes=' + before.length);

    // --- 1. Klik palette: node baru di tengah viewport -------------------
    await page.locator('.palette-btn-process').first().click();
    await page.waitForTimeout(600);
    const afterClick = await snapshotNodes();
    const clickNew = afterClick.filter((n) => !before.some((b) => b.id === n.id));
    check('klik palette menambah node', clickNew.length === 1, 'baru=' + clickNew.length);

    if (clickNew.length) {
      const geo = await page.evaluate(() => {
        const ed = State.editor;
        const crect = ed.container.getBoundingClientRect();
        const prect = ed.precanvas.getBoundingClientRect();
        const z = ed.zoom || 1;
        return {
          vx: (crect.left + crect.width / 2 - prect.left) / z,
          vy: (crect.top + crect.height / 2 - prect.top) / z,
        };
      });
      const n = clickNew[0];
      check('node klik muncul dekat tengah viewport',
        Math.abs((n.x + n.w / 2) - geo.vx) < 90 && Math.abs((n.y + n.h / 2) - geo.vy) < 90,
        JSON.stringify({ node: n, center: geo }));
    }

    // --- 2. Drag and drop dari palette ---------------------------------
    const dropTarget = { x: 520, y: 360 };
    await page.locator('.palette-btn-task').first().dragTo(page.locator('#drawflow-container'), { targetPosition: dropTarget });
    await page.waitForTimeout(800);
    const afterDrop = await snapshotNodes();
    const dropNew = afterDrop.filter((n) => !afterClick.some((b) => b.id === n.id));
    check('drag-and-drop menambah node', dropNew.length >= 1, 'baru=' + dropNew.length);

    const dropGeo = await page.evaluate((target) => {
      const ed = State.editor;
      const srect = document.getElementById('drawflow-container').getBoundingClientRect();
      const prect = ed.precanvas.getBoundingClientRect();
      const z = ed.zoom || 1;
      return {
        x: (srect.left + target.x - prect.left) / z,
        y: (srect.top + target.y - prect.top) / z,
      };
    }, dropTarget);

    const droppedNear = dropNew.some((n) =>
      Math.abs((n.x + n.w / 2) - dropGeo.x) < 36 && Math.abs((n.y + n.h / 2) - dropGeo.y) < 36);
    check('node drop muncul dekat titik lepas', droppedNear,
      JSON.stringify({ dropGeo, dropNew }));

    // --- 2b. Tautkan aplikasi langsung ke node (tanpa lewat task) --------
    await page.locator('#drawflow .drawflow-node').first().click();
    await page.waitForTimeout(900);
    const nodeAppId = await page.evaluate(() => State.selectedNode && State.selectedNode.customId);
    check('panel node menampilkan bagian aplikasi',
      (await page.locator('#node-apps-section [data-node-app-link-existing]').count()) === 1,
      'node=' + nodeAppId);

    await page.click('#node-apps-section [data-node-app-link-existing]');
    await page.waitForSelector('#wf-app-pick');
    await page.waitForFunction(() => {
      const sel = document.querySelector('#wf-app-pick');
      return !!sel && sel.options.length > 1;
    });
    const targetSelValue = await page.locator('#wf-app-target').inputValue();
    check('dialog aplikasi langsung memilih node yang aktif',
      targetSelValue === 'node:' + nodeAppId, targetSelValue);

    const appValue = await page.locator('#wf-app-pick option').nth(1).getAttribute('value');
    await page.selectOption('#wf-app-pick', appValue);
    await page.click('#wf-app-submit');
    await page.waitForTimeout(900);

    const countNodeLinks = () => page.evaluate((args) => {
      const w = Store.findById('workflows', 'workflow_id', args.wfId);
      let links = [];
      try { links = JSON.parse((w && w.app_links_json) || '[]'); } catch (e) {}
      return links.filter((l) => l.target_type === 'node'
        && String(l.target_node_id) === String(args.nodeId)).length;
    }, { wfId, nodeId: nodeAppId });

    check('aplikasi tersimpan dengan target node', (await countNodeLinks()) === 1, '');
    await page.waitForTimeout(500);
    check('tautan aplikasi node tampil di panel',
      (await page.locator('#node-apps-section [data-node-app-unlink]').count()) === 1, '');

    await page.click('#node-apps-section [data-node-app-unlink]');
    await page.waitForSelector('[data-confirm-ok]');
    await page.click('[data-confirm-ok]');
    await page.waitForTimeout(800);
    check('tautan aplikasi node bisa dilepas', (await countNodeLinks()) === 0, '');

    // --- 3. Lepas drag di luar canvas tidak boleh menyisakan state pan ----
    const panBefore = await page.evaluate(() => ({ x: State.editor.canvas_x, y: State.editor.canvas_y }));
    const panGeo = await page.evaluate(() => {
      const r = State.editor.container.getBoundingClientRect();
      return {
        startX: r.left + 70,
        startY: r.bottom - 90,
        outX: r.right + 160,
        outY: r.top + r.height / 2,
        homeX: r.left + 160,
        homeY: r.top + r.height / 2,
      };
    });
    await page.mouse.move(panGeo.startX, panGeo.startY);
    await page.mouse.down();
    await page.mouse.move(panGeo.outX, panGeo.outY, { steps: 6 });
    await page.mouse.up();
    const panAfterUp = await page.evaluate(() => ({ x: State.editor.canvas_x, y: State.editor.canvas_y, selected: !!State.editor.editor_selected }));
    await page.mouse.move(panGeo.homeX, panGeo.homeY, { steps: 4 });
    await page.waitForTimeout(250);
    const panAfterMove = await page.evaluate(() => ({ x: State.editor.canvas_x, y: State.editor.canvas_y, drag: !!State.editor.drag, selected: !!State.editor.editor_selected }));
    check('drag dilepas di luar canvas tidak menyisakan state pan',
      Math.abs(panAfterMove.x - panAfterUp.x) < 2 && Math.abs(panAfterMove.y - panAfterUp.y) < 2
      && !panAfterMove.selected && !panAfterMove.drag,
      JSON.stringify({ panAfterUp, panAfterMove }));

    // Kembalikan posisi canvas agar tes berikutnya stabil.
    await page.evaluate((p) => {
      State.editor.canvas_x = p.x;
      State.editor.canvas_y = p.y;
      State.editor.precanvas.style.transform = 'translate(' + p.x + 'px, ' + p.y + 'px) scale(' + (State.editor.zoom || 1) + ')';
    }, panBefore);
    await page.waitForTimeout(250);

    // --- 3b. Pan dari area kosong di luar precanvas ----------------------
    // Precanvas yang di-scale/translate tidak menutupi seluruh container.
    // Drawflow memilih mode drag dari class PERTAMA elemen target, jadi
    // `parent-drawflow` harus berada di urutan pertama — kalau tidak, klik
    // pada area kosong itu tidak memulai pan dan canvas terasa "mati"
    // setelah digeser beberapa kali.
    const emptyPanGeo = await page.evaluate(() => {
      const ed = State.editor;
      const cr = ed.container.getBoundingClientRect();
      const pr = ed.precanvas.getBoundingClientRect();
      return {
        firstClass: ed.container.classList[0],
        x: cr.left + 8,
        y: cr.top + 8,
        insidePrecanvas: (cr.left + 8) >= pr.left && (cr.left + 8) <= pr.right
          && (cr.top + 8) >= pr.top && (cr.top + 8) <= pr.bottom,
        startX: ed.canvas_x,
        startY: ed.canvas_y,
      };
    });
    check('container drawflow memakai parent-drawflow sebagai class pertama',
      emptyPanGeo.firstClass === 'parent-drawflow', emptyPanGeo.firstClass);
    check('titik uji pan berada di luar precanvas', !emptyPanGeo.insidePrecanvas,
      JSON.stringify(emptyPanGeo));

    const panOnce = async () => {
      const before = await page.evaluate(() => ({ x: State.editor.canvas_x, y: State.editor.canvas_y }));
      await page.mouse.move(emptyPanGeo.x, emptyPanGeo.y);
      await page.mouse.down();
      await page.mouse.move(emptyPanGeo.x + 60, emptyPanGeo.y + 40, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => ({ x: State.editor.canvas_x, y: State.editor.canvas_y, selected: !!State.editor.editor_selected }));
      return { before, after };
    };

    const pan1 = await panOnce();
    check('pan dari area kosong di luar precanvas menggeser canvas',
      Math.abs(pan1.after.x - pan1.before.x) > 30 && Math.abs(pan1.after.y - pan1.before.y) > 20 && !pan1.after.selected,
      JSON.stringify(pan1));

    const pan2 = await panOnce();
    check('pan berikutnya dari titik yang sama tetap berfungsi',
      Math.abs(pan2.after.x - pan2.before.x) > 30 && Math.abs(pan2.after.y - pan2.before.y) > 20 && !pan2.after.selected,
      JSON.stringify(pan2));

    await page.evaluate((p) => {
      State.editor.canvas_x = p.x;
      State.editor.canvas_y = p.y;
      State.editor.precanvas.style.transform = 'translate(' + p.x + 'px, ' + p.y + 'px) scale(' + (State.editor.zoom || 1) + ')';
    }, panBefore);
    await page.waitForTimeout(250);

    // --- 4. Titik tekuk: tambah, simpan, buka ulang ---------------------
    const connCount = await page.locator('.connection').count();
    check('ada garis koneksi untuk diuji', connCount > 0, 'connections=' + connCount);

    // Pilih garis tanpa label dengan bentang terlebar agar dblclick tidak
    // mengenai titik port node.
    const pathPick = await page.evaluate(() => {
      const paths = Array.from(State.editor.container.querySelectorAll('.connection:not([data-label]) .main-path'));
      let pick = null;
      paths.forEach((p, i) => {
        try {
          const len = p.getTotalLength();
          const q = p.getPointAtLength(len / 2);
          const m = p.getScreenCTM();
          const x = m.a * q.x + m.c * q.y + m.e;
          const y = m.b * q.x + m.d * q.y + m.f;
          const hit = document.elementFromPoint(x, y);
          const b = p.getBoundingClientRect();
          if (hit && hit.classList && hit.classList.contains('main-path')) {
            if (!pick || b.width > pick.w) pick = { i, x, y, w: b.width };
          }
        } catch (err) {}
      });
      return { pick, count: paths.length };
    });
    check('garis uji ditemukan', !!pathPick.pick, JSON.stringify(pathPick));

    // Klik tepat di tengah path (bukan tengah bounding box) supaya kena stroke.
    await page.mouse.dblclick(pathPick.pick.x, pathPick.pick.y);
    await page.waitForTimeout(900);

    const added = await page.evaluate(() => {
      let dom = 0;
      State.editor.container.querySelectorAll('.connection .point').forEach(() => { dom += 1; });
      let stored = 0;
      Object.values(State.editor.drawflow.drawflow.Home.data).forEach((node) => {
        Object.values(node.outputs || {}).forEach((out) => {
          (out.connections || []).forEach((c) => { if (Array.isArray(c.points)) stored += c.points.length; });
        });
      });
      return { dom, stored };
    });
    check('titik tekuk ditambahkan', added.dom > 0 && added.stored > 0, JSON.stringify(added));

    // Tunggu autosave (debounce 3 detik).
    await page.waitForTimeout(4200);
    const saved = await page.evaluate(() => {
      const edges = Store.readAll('edges') || [];
      let points = 0;
      edges.forEach((e) => {
        try {
          const arr = JSON.parse(e.points_json || '[]');
          if (Array.isArray(arr)) points += arr.length;
        } catch (err) {}
      });
      return { points, dirty: !!State.canvasDirty };
    });
    check('titik tekuk tersimpan ke edges.points_json', saved.points > 0, JSON.stringify(saved));

    // Buka ulang canvas.
    await page.click('[data-view="workflows"]');
    await page.waitForTimeout(1300);
    await page.locator(`[data-wf-open][data-wf-id="${wfId}"]`).last().click();
    await page.waitForTimeout(2600);

    const restored = await page.evaluate(() => {
      const dom = State.editor.container.querySelectorAll('.connection .point').length;
      let stored = 0;
      Object.values(State.editor.drawflow.drawflow.Home.data).forEach((node) => {
        Object.values(node.outputs || {}).forEach((out) => {
          (out.connections || []).forEach((c) => { if (Array.isArray(c.points)) stored += c.points.length; });
        });
      });
      return { dom, stored };
    });
    check('titik tekuk pulih setelah canvas dibuka ulang',
      restored.dom > 0 && restored.stored > 0, JSON.stringify(restored));
  } catch (e) {
    check('skrip berjalan tanpa exception', false, (e && e.message) || String(e));
  }

  console.log(JSON.stringify({ checks, failed: checks.filter((c) => !c.ok), errors }, null, 2));

  await browser.close();
  const bad = checks.filter((c) => !c.ok);
  console.log(bad.length || errors.length ? `GAGAL ${bad.length}/${checks.length}` : `LULUS ${checks.length}/${checks.length}`);
  process.exit(bad.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
