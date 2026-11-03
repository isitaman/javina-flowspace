# Pengujian otomatis FlowSpace

Semua tes berjalan **tanpa menyentuh Firestore produksi**: aplikasi dipaksa
ke mode lokal (`FLOWSPACE_CONFIG={mode:'local'}` lewat interceptor rute
Playwright) dan disajikan dari server statis di `localhost`.

## Menjalankan

```bash
# instal sekali (di folder root proyek)
npm install

# jalankan semua suite (~1 menit)
npm test

# hanya syntax check
npm run test:check

# smoke ke situs LIVE (produksi) — manual, wajib set URL
set FLOWSPACE_LIVE_URL=https://javina-project.web.app   # Windows
node tests/live-smoke.js
```

Di Windows PowerShell, perintahnya sama. Kalau ingin
screenshot/layout Settings ikut diperiksa:

```powershell
$env:FLOWSPACE_SHOTS='1'; npm test
```

## Yang diperiksa

| Suite | Cakupan |
|---|---|
| `attach-guard-test.js` | Harness Node + mock Firestore: `permission-denied` tidak memasang listener, uid tidak cocok membatalkan attach tanpa baca Firestore, attach normal memasang 12 listener, `activityLogs` dibatasi 300/desc sementara `tasks` tanpa limit |
| `smoke.js` | App shell termuat, label sync = Local, modal kategori Application Hub terbuka/isinya ada/bisa ditutup |
| `phase1-test.js` | Settings: panel diagnostik 10 baris, unduh backup (nama file, JSON valid, `counts` konsisten, data demo ikut terekspor), tombol Salin, regresi modal kategori |
| `phase2-test.js` | `Ctrl+K` membuka palette, pintasan navigasi lengkap, hasil task/workflow/aplikasi/anggota membuka halaman yang benar, keyboard nav, empty state, **tanpa fetch jaringan**, viewport HP |
| `settings-shot.js` | *(opsional, `FLOWSPACE_SHOTS=1`)* Screenshot Settings desktop + HP, tanpa scroll horizontal |
| `live-smoke.js` | *(manual)* Situs produksi: status 200, CSP mengizinkan `apis.google.com`, tanpa header COOP, layar masuk tampil, aset `firebase.js` versi baru |

## Struktur

```
tests/
├── run.js                 # runner: syntax check → server statis → suite suite
├── check-syntax.js        # node --check semua JS (web/js + tests)
├── helpers/
│   ├── browser.js         # launch browser (msedge bila ada, fallback chromium)
│   └── static-server.js   # server statis web/ di port acak (tanpa python)
├── attach-guard-test.js   # harness Node, tanpa browser
├── smoke.js
├── phase1-test.js
├── phase2-test.js
├── settings-shot.js
├── live-smoke.js          # hanya manual, butuh FLOWSPACE_LIVE_URL
└── out/                   # screenshot & unduhan (di-ignore git)
```

## Menambah tes baru

1. Buat `tests/<nama>-test.js`. Pakai helper:
   ```js
   const { launchBrowser, baseUrl, newPage } = require('./helpers/browser');
   const { browser } = await launchBrowser();
   const { page, errors } = await newPage(browser);
   await page.goto(baseUrl(), { waitUntil: 'load' });
   ```
2. Kumpulkan assertion dengan pola `check(nama, kondisi, info)`, cetak JSON
   `{ checks, failed, errors }`, dan `process.exit(1)` bila ada yang gagal.
3. Daftarkan di array `SUITES` dalam `run.js`.
4. Jangan pernah menyentuh proyek Firebase asli — mode lokal sudah
   diintersep otomatis oleh `newPage()`.

## CI (GitHub Actions)

`.github/workflows/ci.yml` menjalankan syntax check + `npm test` pada setiap
push/PR ke `main`/`master`. Deploy hosting masih manual (atau nanti dengan
secret `FIREBASE_TOKEN`) supaya rilis tetap dikontrol manusia.
