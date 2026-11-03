/* `node --check` untuk semua JS aplikasi (web/js, web root, tests).
 * Vendor sengaja dilewati: file minifikasi pihak ketiga bukan tanggung jawab kita. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [path.join(ROOT, 'web', 'js'), path.join(ROOT, 'tests')];
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'out']);

const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p);
    } else if (name.endsWith('.js')) {
      files.push(p);
    }
  }
})(SCAN_DIRS[0]);
fs.readdirSync(SCAN_DIRS[1]).forEach((name) => {
  if (name.endsWith('.js')) files.push(path.join(SCAN_DIRS[1], name));
});

let fail = 0;
files.forEach((f) => {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log('ok   ' + path.relative(ROOT, f));
  } catch (e) {
    fail++;
    console.log('FAIL ' + path.relative(ROOT, f));
    console.log(String(e.stderr || e.message).slice(0, 2000));
  }
});

console.log(fail ? `\n${fail} file gagal syntax check` : `\nSemua ${files.length} file JS valid`);
process.exit(fail ? 1 : 0);
