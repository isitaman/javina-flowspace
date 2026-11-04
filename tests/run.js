/* Runner E2E FlowSpace.
 *
 * 1. syntax check semua JS (web/js + tests)
 * 2. menyalakan server statis `web/` di port acak di localhost
 * 3. menjalankan tiap suite sebagai proses terpisah (browser/konteks bersih)
 * 4. melaporkan ringkasan & exit code
 *
 * Pakai: npm test
 *
 * Lingkungan:
 *   FLOWSPACE_SHOTS=1  sertakan tes screenshot/layout Settings
 *   PW_BROWSER=chromium|msedge  pilih browser (default: msedge bila ada)
 *   FLOWSPACE_BASE_URL  diset otomatis oleh runner ini
 *
 * Catatan implementasi: suite dijalankan dengan spawn (async), BUKAN
 * spawnSync — server statis hidup di proses ini, dan spawnSync akan
 * membekukan event loop-nya sehingga request browser hang.
 */

const path = require('path');
const { spawn } = require('child_process');
const { start } = require('./helpers/static-server');

const SUITES = [
  ['attach-guard (harness Firestore mock)', 'attach-guard-test.js'],
  ['smoke (app shell + modal kategori)', 'smoke.js'],
  ['phase1 (backup & diagnostik)', 'phase1-test.js'],
  ['phase2 (global search / Ctrl+K)', 'phase2-test.js'],
  ['workflow-detail (modal detail + tautan aplikasi)', 'workflow-detail-test.js'],
];

if (process.env.FLOWSPACE_SHOTS === '1') {
  SUITES.push(['settings-shot (layout desktop + HP)', 'settings-shot.js']);
}

function runSuite(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('error', (e) => resolve({ code: 1, err: e }));
    child.on('close', (code) => resolve({ code: code === null ? 1 : code }));
  });
}

(async () => {
  const t0 = Date.now();

  console.log('— Syntax check —');
  const chk = await runSuite('check-syntax.js', {});
  if (chk.code !== 0) {
    console.error('\nSyntax check gagal — suite E2E tidak dijalankan.');
    process.exit(1);
  }

  let server;
  let url;
  try {
    const s = await start();
    server = s.server;
    url = s.url;
  } catch (e) {
    console.error('Server statis gagal start:', e);
    process.exit(1);
  }
  console.log(`\n— Server statis: ${url} —`);

  let failed = 0;
  for (const [name, file] of SUITES) {
    console.log(`\n=== ${name} ===`);
    const r = await runSuite(file, { FLOWSPACE_BASE_URL: url });
    if (r.code !== 0) {
      failed++;
      console.error(`✗ ${name} gagal (exit ${r.code})`);
    } else {
      console.log(`✓ ${name} lulus`);
    }
  }

  server.close();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n——————————————');
  console.log(failed ? `${failed} suite GAGAL (${secs}s)` : `Semua ${SUITES.length} suite LULUS (${secs}s)`);
  process.exit(failed ? 1 : 0);
})();
