# FlowSpace — Web

Versi web FlowSpace: canvas workflow, Kanban, Application Hub, dan Team & Members.
Ada dua mode data:

- **`firebase`** (default sekarang) — login + Firestore, tersinkron antar perangkat.
- **`local`** — tanpa login, data hanya di browser ini (untuk demo/offline).

## Sudah online

Buka dari HP maupun laptop, tanpa perlu server lokal:

**<https://javina-project.web.app>**

Login memakai email/kata sandi (atau Google). Data tersimpan di Firestore, jadi
semua anggota workspace melihat isi yang sama.

## Cara Menjalankan (lokal, untuk development)

> Firebase Auth **butuh http/https**, bukan `file://`. Jadi jalankan lewat server lokal:

### Windows — paling mudah

Double-click **`START-FLOWSPACE.bat`**. Server jalan di
<http://localhost:8766> dan browser terbuka otomatis. Tutup jendela hitam yang
muncul untuk menghentikan server.

### Manual (semua OS)

```bash
# dari folder web/
python -m http.server 8766
# lalu buka http://localhost:8766
```

atau pakai Node:

```bash
npx serve .
# lalu buka URL yang muncul (mis. http://localhost:3000)
```

> Tailwind, Drawflow, dan Lucide **di-host sendiri** di `vendor/` (versi dikunci),
> jadi hanya Firebase SDK dan Google Fonts yang masih diambil dari internet.

Untuk kembali ke mode lokal tanpa login, ubah `mode: 'firebase'` menjadi `mode: 'local'`
di `js/firebase-config.js`. Data lokal lama (`flowspace.db.v1`) tidak tersentuh.

## Struktur

```
web/
├── index.html          # Shell HTML + urutan load script
├── START-FLOWSPACE.bat # Klik-dua-kali: jalankan server + buka browser (Windows)
├── css/styles.css      # Custom CSS
├── vendor/             # Tailwind 3.4.16, Drawflow 0.0.59, Lucide 1.65.0 (dikunci)
├── firestore.rules     # Security rules Firestore (harus di-deploy)
├── firestore.indexes.json
├── firebase.json       # Konfigurasi Hosting + Firestore
├── FIREBASE-SETUP.md   # Panduan login & multi-device
└── js/
    ├── firebase-config.js # Project Firebase + saklar mode
    ├── store.js        # Cache lokal (localStorage) + event realtime antar tab
    ├── api.js          # Business logic (baca/tulis lewat Store)
    ├── app.js          # State, router, transport (callServer), boot
    ├── ui.js           # Semua view renderer + interaksi
    ├── firebase.js     # Auth + sink/snapshot Firestore
    ├── auth-ui.js      # Layar masuk, daftar, lupa sandi, onboarding
    ├── chat.js         # Chat tim: listener 50 pesan, status baca, toast
    └── notifications.js # Lonceng header: komentar, penugasan, task selesai
```

## Cara Kerja Data

Firestore adalah sumber kebenaran. Agar UI dan logika bisnis tidak perlu diubah,
alurnya:

1. Login → adapter menentukan workspace user (member aktif / undangan / onboarding).
2. Isi workspace di-stream dari Firestore ke cache `Store` (`hydrate`).
3. Setiap tulisan `Store` dikirim ke Firestore oleh *sink* (batch, maks. 400/commit).
4. Listener realtime memperbarui cache → UI menyegarkan diri sendiri.

Detail mode:

- Di mode Firebase, `Store` hanya hidup di memori (tanpa salinan penuh di
  localStorage). Firestore adalah sumber kebenaran dan seluruh koleksi dihidrasi
  ulang setiap sesi. Ini mengurangi tekanan kuota localStorage yang bisa
  mengganggu SDK Firestore.
- Data lokal mode `local` (`flowspace.db.v1`) tetap utuh dan tidak tersentuh.
- Mode lokal tanpa auth: user saat ini = admin `anda@flowspace.local`, setup otomatis.
- Untuk memulai cepat, buka **Settings → Seed Data Demo**.

## Login & multi-device

Panduan langkah demi langkah (termasuk deploy rules) ada di
[`FIREBASE-SETUP.md`](./FIREBASE-SETUP.md), security rules di
[`firestore.rules`](./firestore.rules). Ringkasnya:

- Firebase Auth (email/password + Google) untuk identitas. Sesi memakai
  persistence **local**: sekali masuk, sesi tersimpan permanen di perangkat itu
  dan bertahan setelah reload/tutup browser. Logout hanya terjadi lewat tombol
  **Keluar**, sesi dicabut di Google/Firebase, atau data situs dibersihkan.
- Sesi tidak langsung dianggap berakhir: `null` dari Auth diverifikasi ulang
  (0 / 0,7 / 1,8 / 3,6 dtk kalau sesi sedang live; 0 / 0,5 / 1,5 dtk saat boot)
  sebelum disimpulkan. Aplikasi **tidak** memanggil `setPersistence()` saat boot
  dan tidak membaca `currentUser` sebelum pemulihan sesi selesai — keduanya dulu
  bisa mengganggu atau menghapus sesi yang sebenarnya masih sah.
- Kalau setelah verifikasi sesi tetap tidak ada, aplikasi memuat ulang otomatis
  **maksimal sekali per menit** (bukan sekali per tab, supaya flapping dua tab
  tidak menjadi loop). Bila masih gagal, yang tampil adalah layar masuk biasa
  dengan keterangan singkat — **bukan** layar "Sesi tidak terbaca" yang buntu.
  Penanda sesi lama dibersihkan supaya kunjungan berikutnya juga normal.
  Penyebab realistisnya: mode Incognito, data situs dibersihkan, atau browser
  berbeda.
- Firestore per workspace untuk data bersama + listener realtime.
- Cache offline Firestore **nonaktif secara default** (memory cache). Persistence
  IndexedDB/multi-tab adalah pemicu utama error
  `FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state` yang membuat klien data
  mati sampai reload. Bisa diaktifkan lewat `offlineCache: true` di
  `firebase-config.js` (single-tab) jika benar-benar perlu.
- Login tahan gangguan singkat: `resolveMembership` dicoba ulang otomatis, lalu
  menampilkan layar **Coba lagi / Muat ulang** alih-alih melempar user ke
  onboarding. Assertion fatal Firestore menampilkan layar pemulihan khusus.
- `permission-denied` yang muncul sesaat setelah login/popup (token belum siap)
  juga dicoba ulang. Kalau menetap, layar **Akses workspace ditolak** tampil —
  bukan onboarding "buat workspace" yang pasti gagal.
- Pemasangan listener workspace juga punya retry sendiri: bila listener langsung
  ditolak padahal keanggotaan sudah terverifikasi, ID token di-refresh lalu
  attach diulang (0 / 0,8 / 2 dtk). Listener yang ditolak **setelah** aplikasi
  berjalan memicu penyegaran token + attach ulang (maks. sekali per 30 dtk),
  jadi data tidak diam-diam berhenti update.
- Kalau akun berganti dari tab lain, listener workspace lama dilepas lebih dulu
  sebelum membaca keanggotaan akun baru. Attach yang gagal membaca workspace
  tidak melanjutkan pemasangan listener, jadi console tidak dibanjiri
  `permission-denied`.
- Chat punya retry terpisah (2x dengan refresh token) sebelum menampilkan toast,
  karena watch chat bisa ditolak sekali saat kredensial Firestore berganti.
- Role `admin` / `editor` / `viewer` ditegakkan di server oleh rules.
- Undangan: admin memasukkan email (status **Diundang**); akses aktif otomatis
  saat orang tersebut masuk dengan email yang sama.
- Kuota gratis Spark diperkirakan cukup untuk tim kecil (50.000 reads/hari).
- Debug login: buka `?debug=1` untuk log auth event, hasil persistence, jumlah
  listener, dan detail error di console.

## Dashboard & kepemilikan task

Menu **Dashboard** punya dua tab (pilihan terakhir diingat di browser):

- **Dashboard Tim** — angka seluruh workspace: status, priority, overdue,
  tenggat ≤7 hari, task tanpa PIC, task critical/high, ringkasan per PIC dan per
  workflow, plus aktivitas terbaru. Task dari workflow yang sudah diarsip tetap
  tampil dengan badge **Arsip**; task tanpa workflow masuk baris **Tanpa workflow**
  (tidak bisa dibuka sebagai kanvas).
- **Dashboard Saya** — hanya task yang PIC-nya akun yang sedang login: tugas
  aktif, selesai, overdue, tenggat ≤7 hari, daftar **Fokus Saya**, distribusi
  status, workflow yang dikerjakan, dan aktivitas sendiri.

Kepemilikan task ditegakkan berlapis:

| Lapisan | Fungsi |
|---|---|
| `firestore.rules` | Sumber kebenaran. Editor hanya bisa mengubah/menghapus task dengan PIC dirinya; task tanpa PIC hanya bisa *diambil*, bukan diubah langsung. |
| `js/api.js` | Guard sebelum `Store` menulis, supaya pesan errornya jelas dan UI tidak sempat berubah optimistis. |
| `js/ui.js` | Drawer read-only, tombol simpan/hapus disembunyikan, kartu Kanban terkunci, PIC form task baru terkunci ke diri sendiri. |

Aturan praktis:

- **Admin** boleh mengubah semua task, memindahkan PIC, dan menghapus node apa pun.
- **Editor** hanya mengubah task miliknya; tidak bisa memindahkan PIC ke orang
  lain (hanya melepasnya menjadi *Tanpa PIC*).
- Task **tanpa PIC** bisa diambil editor lewat tombol **Ambil task** di drawer;
  setelah diambil, hanya dia (dan admin) yang bisa mengubahnya.
- Editor tidak bisa menghapus node yang berisi task milik orang lain (termasuk
  lewat simpan layout kanvas).
- Checklist dan aplikasi terkait mengikuti kepemilikan task induknya.
- Data lama tanpa `assignee_uid` tetap dikenali lewat `assignee_email`.

Rules sudah di-deploy ke project. Setelah mengubah `firestore.rules`, jalankan
`firebase deploy --only firestore:rules` dari folder `web/`.

## Komentar & Chat Tim

Komentar tersedia di **task** (drawer task), **node** (panel detail node), dan
**workflow** (tombol **Diskusi** di toolbar kanvas atau menu workflow). Chat tim
ada di menu **Chat Tim** — satu ruang obrolan untuk seluruh workspace.

- **Semua anggota aktif** boleh menulis komentar dan chat, termasuk `viewer`.
  Viewer tetap tidak bisa mengubah task/workflow.
- Komentar berupa thread datar kronologis. Penulis boleh edit/hapus komentarnya
  sendiri; admin boleh menghapus komentar siapa pun (soft delete agar konteks
  diskusi tidak hilang).
- **Lampiran chat**: tombol paperclip di composer membuka pencarian task/workflow
  (maksimal 3 per pesan). Kartu lampiran menampilkan judul + status/PIC terbaru;
  klik kartu membuka drawer task atau kanvas workflow. Kalau task/workflow sudah
  dihapus, kartu tetap tampil dengan label **Tidak tersedia** dan tidak bisa
  diklik. Lampiran disimpan sebagai snapshot `{type, id, title, meta}` di
  `attachments_json`, jadi tidak menambah koleksi maupun biaya baca.
- Pesan chat boleh diedit/dihapus pengirimnya; admin boleh menghapus pesan
  siapa pun. Pesan yang dihapus tampil sebagai placeholder.
- **Status baca per anggota**: unread dihitung dari penanda "terakhir dibaca"
  (bukan read receipt per pesan). Penanda disimpan di `chatReads/{uid}` sehingga
  ikut antar perangkat. Tampil sebagai **badge merah + jumlah** di menu Chat Tim,
  garis **Pesan baru** di daftar pesan, dan nama/isi pesan yang belum dibaca
  ditebalkan. Pesan dianggap terbaca saat benar-benar terlihat di layar; membuka
  Chat yang punya unread akan menggulir ke garis "Pesan baru" (bukan ke pesan
  terbaru), lalu penanda naik saat pesan berikutnya terlihat.
- Badge **belum dibaca** + toast saat pesan baru masuk ketika aplikasi terbuka
  dan tidak sedang di halaman Chat.
- Komentar ikut disinkronkan lewat `Store`/Firestore (`comments`). Chat **tidak**
  masuk cache localStorage: mode Firebase memakai listener langsung ke
  `chatMessages` dengan `limit(50)`, sehingga cache dan kuota baca tetap kecil.
  Status baca juga tidak ikut `Store`; UI membacanya sekali saat sesi dimulai dan
  menulis maksimal satu kali per jeda 500 ms saat pesan terlihat.
  Mode lokal menyimpan chat dan status baca di `Store` seperti koleksi lain.
- Batas panjang komentar/pesan 2000 karakter, divalidasi di API **dan** rules.
- Belum ada lampiran file/gambar dan DM; keduanya bisa ditambahkan setelah ini.

Tabel akses:

| Aksi | admin | editor | viewer |
|---|---|---|---|
| Baca komentar/chat | ✅ | ✅ | ✅ |
| Tulis komentar/chat | ✅ | ✅ | ✅ |
| Edit/hapus milik sendiri | ✅ | ✅ | ✅ |
| Lampirkan task/workflow di chat | ✅ | ✅ | ✅ |
| Hapus milik orang lain | ✅ | ❌ | ❌ |

## Notifikasi

Ikon **lonceng** di pojok kanan atas header menampilkan aktivitas yang
melibatkan Anda. Badge merah berisi jumlah yang belum dibaca.

| Sumber | Siapa yang menerima |
|---|---|
| Komentar baru dari orang lain pada **task** yang PIC-nya Anda | PIC task |
| Komentar baru pada **workflow** — atau **node** di dalamnya — yang berisi task Anda | Semua PIC yang punya task di workflow itu |
| Task baru, atau task yang dipindahkan, kepada Anda | Penerima task |
| Task berubah menjadi **Done** oleh orang lain | Admin |

- Notifikasi **tidak** dibuat untuk aksi Anda sendiri (komentar sendiri,
  menyelesaikan task sendiri, dll).
- Panel menampilkan item terbaru (maks. 80) dikelompokkan per hari.
- **Baca / belum dibaca ditentukan oleh klik:**
  - Membuka panel **tidak** menandai apa pun; badge tetap sampai Anda
    menindaklanjuti.
  - Klik baris item → item itu ditandai dibaca, panel ditutup, lalu drawer task
    atau kanvas workflow terbuka.
  - Tombol titik di kanan item berfungsi sebagai toggle: titik hijau = belum
    dibaca, lingkaran kosong = sudah dibaca. Klik untuk membalik statusnya
    tanpa menutup panel.
  - Tombol **Tandai semua dibaca** di footer membersihkan semua badge sekaligus.
- Item diambil dari data yang sudah tersinkron (`comments`, `tasks`,
  `activityLogs`, `workflows`, `nodes`), jadi **tidak ada koleksi baru dan tidak
  ada read tambahan** ke Firestore.
- `activityLogs` hanya memuat 300 entri terbaru (lihat *Batas data & kuota*),
  jadi notifikasi penugasan yang lebih lama dari itu tidak muncul lagi.
- Status "sudah dibaca" disimpan **per perangkat** di localStorage
  (`flowspace.notif.v1.<workspace>.<uid>`), bukan di Firestore. Karena per
  perangkat, membuka notifikasi di HP tidak otomatis membersihkan badge di
  laptop.
- Task yang dibuat **sebelum** fitur ini tidak memunculkan notifikasi
  "task baru" (log lamanya belum menyimpan PIC). Aktivitas komentar dan
  penyelesaian tetap terdeteksi.

## Backup, export & diagnosa

**Settings → Backup & Export** membuat snapshot JSON dari semua koleksi yang
sedang tersinkron di perangkat, plus metadata (nama workspace, waktu ekspor,
jumlah dokumen per koleksi).

- Hanya **admin** yang bisa mengunduh; anggota lain melihat tombol nonaktif.
- Isinya adalah data **di memori perangkat saat itu** — bukan dump Firestore
  penuh. Pastikan halaman sudah selesai sinkron (label sync hijau) sebelum
  mengunduh.
- Nama file: `flowspace-<nama-workspace>-YYYYMMDD-HHMMSS.json`.
- Simpan file di tempat aman. Untuk memulihkan data, gunakan file ini sebagai
  referensi/manual restore; belum ada tombol import otomatis.
- Backup **terjadwal** (mis. GitHub Actions + Admin SDK) belum aktif karena
  folder `web/` belum di-track git. Lihat catatan di `FIREBASE-SETUP.md`.

**Settings → Diagnostik** menampilkan kondisi runtime: mode (Firebase/lokal),
versi SDK, project, auth persistence, cache Firestore, jumlah listener aktif,
penanda sesi, status koneksi, workspace, dan jumlah dokumen lokal. Tombol
**Salin** menyalin semuanya sebagai JSON — tempelkan saat melaporkan bug supaya
tidak perlu membuka console dengan `?debug=1`.

## Batas data & kuota

Listener realtime dibatasi supaya kuota Spark tidak habis oleh data historis:

| Koleksi | Batas | Alasan |
|---|---|---|
| `activityLogs` | 300 dokumen terbaru (`orderBy created_at desc`) | Tumbuh tanpa batas; dashboard hanya butuh 8, drawer task maks. 50 |
| `comments` | belum dibatasi | Menunggu sinkronisasi per-entity (lihat roadmap) |

Konsekuensi yang perlu diketahui: log lebih tua dari 300 entri terakhir tidak
ada di perangkat, jadi notifikasi penugasan lama bisa tidak muncul di lonceng.
Untuk riwayat lebih panjang, tambahkan pagination eksplisit — jangan menaikkan
angka batas tanpa mengukur ulang pemakaian reads.

## Deploy ke Firebase Hosting

```bash
cd web
firebase deploy --only hosting     # hasil: https://javina-project.web.app
```

**Sebelum deploy**, jalankan tes dari root proyek sebagai checklist:

```bash
npm test        # syntax check + E2E (mode lokal, tanpa menyentuh Firestore)
```

Untuk memverifikasi deploy yang sudah live:

```bash
set FLOWSPACE_LIVE_URL=https://javina-project.web.app   # Windows
node tests/live-smoke.js
```

Aset HTML/JS/CSS dikirim dengan `Cache-Control: no-cache`, jadi setelah deploy
pengguna langsung mendapat versi terbaru tanpa perlu hard reload. Folder
`vendor/` memakai cache `immutable` selama 1 tahun karena namanya sudah memuat
versi.

`firebase.json` juga mengirim header keamanan: CSP (hanya script/style/font/
koneksi yang dipakai), `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options`, dan `Permissions-Policy`. Kalau menambah domain eksternal
(mis. analytics baru), tambahkan dulu ke CSP `script-src`/`connect-src`.

## Arsitektur (siap ganti backend)

`callServer(fnName, ...args)` di `app.js` memetakan panggilan frontend ke `Api`
(`api.js`) dengan bentuk respons yang sama seperti backend lama:
`{ success, data, message, errorCode }`.

`Api` hanya berbicara dengan `Store`. Adapter `firebase.js` mengisi `Store` dari
Firestore dan mengirim balik perubahannya, sehingga menambah/mengganti backend
cukup di lapisan itu — UI tidak berubah.

## Fitur MVP yang sudah berfungsi

- **Dashboard Tim & Dashboard Saya** (dua tab): statistik, distribusi priority/status,
  task critical/high, fokus pribadi, tenggat ≤7 hari, task tanpa PIC, ringkasan PIC
  & workflow, aktivitas terbaru
- Workflows (buat, edit, duplikasi, arsip, hapus dengan konfirmasi)
- **Data workflow lengkap**: ID, nama, deskripsi, **departemen terkait** (multi-pilih: Breeder, Laboratorium, Plasma, Budidaya, Marketing, Keuangan, Data, EDP) dan **kategori** (ketik baru atau pilih yang sudah ada)
- **Daftar workflow padat** (satu baris per workflow, badge departemen & kategori, ±11 baris terlihat dalam satu layar) dengan **search** dan **filter departemen/kategori**
- Canvas editor (7 tipe node, connect, drag, zoom/pan, autosave)
- **4 titik koneksi bebas arah** (kiri/atas/kanan/bawah; semua titik bisa jadi awal maupun tujuan, mouse & sentuh)
- **Panel detail node** (edit judul/deskripsi, hapus node dengan konfirmasi)
- **Satu node bisa menampung hingga 5 task** (semua setara; progress node = rata-rata progress task, daftar task bisa dibuka/dilepas dari panel)
- **Buat task dari node** (berulang, sampai batas 5) dan dari Kanban
- **Task mandiri (tanpa workflow)** dari Kanban; tetap bisa dihubungkan ke node/workflow kapan saja
- **Form task baru lengkap** (checklist/todolist + aplikasi terkait langsung saat membuat)
- **Aplikasi terkait fleksibel**: pilih dari Application Hub **atau** tautkan link aplikasi baru (otomatis masuk Application Hub)
- Kanban board (drag & drop native, filter, tambah task)
- Application Hub (katalog + link/unlink aplikasi ke task)
- **Kategori aplikasi dinamis** (kelola lewat modal **Kelola Kategori** di Application Hub)
- **Workflow Lanjutan** (tipe node khusus untuk menautkan ke workflow lain; klik node untuk membuka)
- Task detail (edit, checklist, aplikasi terkait, riwayat aktivitas) dengan
  **kepemilikan per PIC**: editor hanya bisa mengubah task miliknya; task tanpa
  PIC bisa diambil lewat tombol **Ambil task**
- **Komentar** di task, node, dan workflow + badge jumlah komentar
- **Chat Tim** satu ruang per workspace, 50 pesan terakhir, status baca per
  anggota (badge merah, garis "Pesan baru", teks tebal), toast pesan baru,
  edit/hapus pesan sendiri, moderasi admin, dan **lampiran referensi
  task/workflow** (maksimal 3 per pesan)
- **Team & Members**: daftar dengan pencarian + filter peran/status, badge "Anda",
  status **Diundang** untuk undangan yang belum diterima, ubah nama & peran,
  nonaktifkan/aktifkan, batalkan undangan/hapus dengan modal konfirmasi custom,
  proteksi akun sendiri & admin terakhir, PIC task hanya dari anggota aktif
- Log aktivitas anggota (tambah, ubah, status, hapus)
- Settings (info workspace, seed demo, reset database, **Backup & Export** JSON
  untuk admin, panel **Diagnostik** dengan tombol salin)
- **Global search** `Ctrl/Cmd+K` (atau klik kotak pencarian / tombol cari HP): cari task, workflow, node, aplikasi, anggota & lompat cepat ke view yang relevan.
- **Tata letak HP**: sidebar geser + backdrop, toolbar kanvas ringkas, strip tipe node di bawah, panel detail node jadi lembar penuh, tabel lebar bisa digeser sendiri
