# FlowSpace — Setup Firebase (login + multi-device)

Status: **aktif**. Aplikasi sudah tersambung ke project `javina-project`, dan
security rules sudah di-deploy (31 Okt 2026). Login, undangan, role, dan
sinkronisasi realtime sudah diuji dengan dua instance browser terpisah.

Bagian 1 di bawah hanya perlu diulang kalau rules diubah atau project-nya baru.

---

## 1. Deploy security rules (kalau rules berubah)

Prasyarat: Node.js terpasang, Firebase CLI sudah ter-install (`firebase --version`).

```bash
npm install -g firebase-tools     # sekali saja
firebase login                    # sekali saja, per mesin
cd web
firebase use javina-project
firebase deploy --only firestore:rules
```

Keluarannya kira-kira:

```
✔  cloud.firestore: rules file firestore.rules compiled successfully
✔  firestore: released rules firestore.rules to cloud.firestore
✔  Deploy complete!
```

> Alternatif tanpa CLI: Firebase Console → **Firestore Database → Rules** →
> tempel isi `web/firestore.rules` → **Publish**.

### Cek cepat di Console

- **Authentication → Sign-in method**: `Email/Password` dan `Google` harus aktif.
- **Authentication → Settings → Authorized domains**: `localhost` sudah otomatis.
  Tambahkan `127.0.0.1` bila membuka lewat alamat itu, dan domain Hosting nanti.
- **Firestore Database**: database sudah dibuat (mode production).

---

## 2. Menjalankan aplikasi

Firebase Auth tidak bekerja dari `file://`, jadi pakai server lokal:

```bash
cd web
python -m http.server 8766
# buka http://localhost:8766
```

Kembali ke mode lokal (tanpa login): ubah `mode: 'firebase'` → `'local'` di
`js/firebase-config.js`. Data lokal lama ada di key `flowspace.db.v1` dan tidak
disentuh oleh mode Firebase.

> Setelah mengubah `firebase-config.js`, lakukan **hard reload** (Ctrl+Shift+R)
> karena browser sering menyimpan versi lama file konfigurasi.

---

## 3. Alur pertama kali

1. **Daftar** (email/password atau Google). Akun baru belum punya workspace.
2. Layar **"Hubungkan akun"** muncul:
   - **Sudah diundang admin?** → tombol *Cek undangan* (memakai ulang undangan
     yang dikirim admin ke email ini).
   - **Buat workspace baru** → Anda menjadi `admin` workspace tersebut.
3. Admin mengundang rekan lewat **Team & Members → Undang Member**. Yang diundang
   tampil dengan status **Diundang** sampai mereka masuk dengan email yang sama.
4. Setelah masuk, undangan dipakai sekali lalu dihapus; akses mengikuti role.

Peran:

| Role | Boleh |
|---|---|
| `admin` | semua: anggota, undangan, workflow, hapus, reset data, **semua task** |
| `editor` | konten: workflow, canvas, aplikasi, **hanya task yang PIC-nya dirinya** |
| `viewer` | hanya membaca data task/workflow; **boleh menulis komentar & chat** |

Role ditegakkan **di server** oleh `firestore.rules`; UI hanya menyembunyikan
tombol sebagai kenyamanan. Komentar dan chat sengaja terbuka untuk semua anggota
aktif (`isActive`) agar viewer tetap bisa ikut berdiskusi tanpa bisa mengubah
task/workflow.

### Kepemilikan task (berlaku untuk editor)

- Task dengan PIC orang lain: drawer read-only, kartu Kanban terkunci, dan
  percobaan tulis ditolak (`permission-denied` di rules, pesan jelas di API).
- Task **tanpa PIC**: hanya admin yang bisa mengubah langsung. Editor memakai
  tombol **Ambil task**; update itu diizinkan rules karena PIC diisi dirinya.
- Editor tidak bisa memindahkan PIC ke anggota lain; hanya melepas menjadi
  *Tanpa PIC*. Pemindahan PIC adalah hak admin.
- Checklist dan tautan aplikasi mengikuti task induknya (termasuk saat
  task + checklist + aplikasi dibuat dalam satu batch).
- Editor tidak bisa menghapus node yang berisi task milik orang lain; guard ada
  di API karena rules tidak bisa membaca koleksi task lain dari dokumen node.
- Data lama tanpa `assignee_uid` tetap dikenali lewat `assignee_email`.

---

## 4. Model data Firestore

Nama field sengaja **sama persis** dengan penyimpanan lokal (tanpa pemetaan),
supaya cache dan logika bisnis bisa dipakai apa adanya.

```
users/{uid}
  workspaceId, email, updatedAt

invites/{email}                       # dokumen root: dipakai calon anggota
  email, workspace_id, display_name, role, invited_by, created_at

workspaces/{workspaceId}
  workspace_id, workspace_name, owner_email, status, created_at, updated_at

workspaces/{workspaceId}/members/{uid}
  member_id (= uid), workspace_id, email, display_name,
  role (admin|editor|viewer), member_status (active|inactive), created_at

workspaces/{workspaceId}/invites/{email}   # salinan untuk daftar admin
  (isi sama dengan invites/{email})

workspaces/{workspaceId}/workflows/{workflow_id}
workspaces/{workspaceId}/nodes/{node_id}
workspaces/{workspaceId}/edges/{edge_id}
workspaces/{workspaceId}/tasks/{task_id}
  task_id, workspace_id, workflow_id, node_id, title, description,
  assignee_email, assignee_uid, status, priority, progress, progress_mode,
  start_date, due_date, completed_at, created_by, created_at, updated_at,
  updated_by_uid, version
workspaces/{workspaceId}/applications/{app_id}
workspaces/{workspaceId}/taskApplications/{task_app_id}
workspaces/{workspaceId}/checklist/{checklist_id}
workspaces/{workspaceId}/comments/{comment_id}
  comment_id, workspace_id, entity_type (task|node|workflow), entity_id,
  body (1..2000), created_by_uid, created_by_email, created_by_name,
  created_at, updated_at, edited_at, deleted_at, deleted_by_uid
workspaces/{workspaceId}/chatMessages/{message_id}
  message_id, workspace_id, body (0..2000), attachments_json (<=1500),
  sender_uid, sender_email, sender_name,
  created_at, updated_at, edited_at, deleted_at, deleted_by_uid
workspaces/{workspaceId}/chatReads/{uid}
  member_id (=uid), workspace_id, last_read_at, last_read_message_id, updated_at
workspaces/{workspaceId}/activityLogs/{log_id}
workspaces/{workspaceId}/applicationCategories/{category_id}
```

Catatan desain:

- **ID dokumen = field ID** (`task_id`, `node_id`, dst). Tidak ada indeks
  tambahan yang dibutuhkan; `firestore.indexes.json` sengaja kosong.
- **Member doc ID = Firebase uid**, bukan email, agar tahan ganti email.
- **Undangan ada di dua tempat.** Dokumen root `invites/{email}` dibaca calon
  anggota (doc ID = email mereka), sedangkan salinan di subkoleksi workspace
  dibaca admin. Ini karena aturan Firestore tidak berperan sebagai filter:
  daftar harus bisa dibuktikan lewat *path*, bukan isi dokumen.
- **`members` menyimpan status**, sehingga admin bisa menonaktifkan akun tanpa
  menghapus riwayat task.
- `tasks.node_id` tetap sumber kebenaran relasi task–node (maksimal 5 task per
  node); `nodes.task_id` hanya cache task pertama.
- `assignee_uid` menyimpan uid PIC agar rules bisa membandingkan dengan
  `request.auth.uid`; `assignee_email` tetap disimpan untuk tampilan dan sebagai
  fallback data lama. `completed_at` diisi saat status menjadi `done` (dan
  dikosongkan bila dibuka lagi), `updated_by_uid` mencatat editor terakhir.
- **Komentar memakai soft delete** (`deleted_at`), jadi riwayat diskusi tidak
  hilang saat penulis/admin menghapusnya. `entity_type` divalidasi rules dan
  `entity_id` mengarah ke task/node/workflow di workspace yang sama.
- **Chat memakai satu dokumen per pesan** di `chatMessages` (satu ruang per
  workspace). Tidak ada indeks komposit: listener memakai
  `orderBy('created_at','desc').limit(50)`.
- **Lampiran chat** disimpan sebagai JSON string `attachments_json` berisi
  maksimal 3 referensi `{type, id, title, meta}`. Bentuk string dipilih agar
  sama dengan kolom `*_json` lain dan mudah divalidasi rules (batas 1500
  karakter). Lampiran tidak bisa diubah saat pesan diedit, dan pesan boleh
  berisi lampiran saja tanpa teks (`body` kosong).
- **Status baca chat per user** disimpan di `chatReads/{uid}` sebagai
  *high-water mark*: `last_read_at` + `last_read_message_id`. Satu dokumen per
  anggota, jadi tidak ada tulisan per pesan/per pembaca dan bukan read receipt.
  Rules hanya mengizinkan pemilik menulis (admin boleh menghapus saat reset).
  UI membaca dokumen sekali saat sesi dimulai, lalu menulis ter-debounce 500 ms
  ketika pesan benar-benar terlihat di layar (`IntersectionObserver`).
- **Notifikasi tidak punya koleksi sendiri.** Lonceng di header menurunkan item
  dari data yang sudah tersinkron (`comments`, `tasks`, `activityLogs`,
  `workflows`, `nodes`), jadi nol read tambahan dan **tidak perlu ubah rules**.
  Status "sudah dibaca" disimpan per perangkat di
  `localStorage` (`flowspace.notif.v1.<ws>.<uid>`), bukan di Firestore.
  Supaya "task baru untuk saya" bisa dikenali, log `create` task sekarang ikut
  menyimpan `assignee_email`/`assignee_uid`; log `assignee_change` dan
  `status_change` sudah menyimpan nilai lama & baru.

---

## 5. Cara sinkronisasi bekerja

```
Firestore  --onSnapshot-->  Store (memori)  -->  UI
    ^                                               |
    +----------  sink (batch write, 400/commit)  <---+
```

- Saat login, adapter menentukan workspace (`users/{uid}` → `invites/{email}` →
  onboarding) lalu berlangganan seluruh koleksi workspace.
- Setiap perubahan `Store` diantrekan dan ditulis ke Firestore dalam batch.
- Perubahan yang berasal dari perangkat lain memicu event `fs:change` sehingga
  tampilan menyegarkan diri (dialog/drag yang sedang aktif tidak diganggu).
- Di mode Firebase, `Store` **tidak** menulis salinan penuh ke localStorage.
  Data dihidrasi ulang dari Firestore setiap sesi; ini menghindari kuota
  localStorage yang bisa mengganggu koordinasi internal SDK Firestore.
- Cache offline Firestore **nonaktif secara default** (memory cache). Set
  `offlineCache: true` di `firebase-config.js` jika offline cache dibutuhkan;
  mode itu memakai persistence single-tab dan otomatis fallback ke memori bila
  tab lain sudah memegang persistence.
- Login/sesi: event auth untuk uid yang sama dideduplikasi, `resolveMembership`
  yang berdekatan digabung, dan attach workspace punya generation token agar
  tidak ada listener ganda. Error jaringan sementara di-retry sebelum layar
  pemulihan ditampilkan.
- Ada jeda 4 detik untuk menekan *echo* tulisan sendiri agar fokus input tidak
  hilang.
- **Komentar** termasuk koleksi yang disinkronkan (`SYNC_COLLECTIONS`), jadi
  badge jumlah komentar ikut live.
- **`activityLogs` dibatasi 300 dokumen terbaru** (`orderBy('created_at','desc')
  .limit(300)` di `COLLECTION_LIMITS`, `js/firebase.js`). Sebelumnya seluruh
  riwayat dibaca ulang di setiap attach — termasuk setiap retry/re-attach —
  sehingga koleksi ini yang paling cepat menghabiskan kuota Spark. Index
  single-field `created_at` dibuat otomatis oleh Firestore, jadi
  `firestore.indexes.json` tidak perlu diubah. Kalau butuh log lebih tua,
  tambahkan pagination eksplisit; jangan naikkan limit tanpa mengukur ulang.
- **Chat tidak lewat `Store` di mode Firebase.** `js/chat.js` berlangganan
  langsung ke `chatMessages` dengan batas 50 pesan terakhir, sehingga cache
  localStorage tidak membengkak dan kuota baca tetap kecil. Di mode lokal chat
  memakai `Store`/`Api` seperti koleksi lain.

---

## 6. Hosting (sudah live)

Aplikasi **sudah ter-deploy** dan bisa dibuka dari HP/laptop mana pun:

- <https://javina-project.web.app>
- <https://javina-project.firebaseapp.com>

Deploy ulang setelah mengubah kode:

```bash
cd web
firebase deploy --only hosting
```

`firebase.json` memakai `public: "."` (folder `web/` itu sendiri) dengan rewrite
ke `index.html`, jadi tautan dalam aplikasi tetap bekerja saat dimuat ulang
(mis. `https://javina-project.web.app/` dengan path apa pun).

Header cache di `firebase.json`: HTML/JS/CSS = `no-cache` (selalu revalidasi,
jadi update kode langsung terpakai), gambar/font = `max-age=86400`, dan
`vendor/**` = `max-age=31536000, immutable` (nama file sudah memuat versi).
Tanpa ini, perubahan kode bisa tertahan di cache browser hingga satu jam.

Header keamanan juga dikirim dari `firebase.json`: **Content-Security-Policy**
(script/style/font/koneksi hanya ke domain yang dipakai), `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`, dan `Permissions-Policy`. Kalau menambah
integrasi eksternal baru, tambahkan domainnya ke CSP lebih dulu — kalau tidak,
browser akan memblokirnya dan muncul pesan *Content Security Policy* di console.

Domain `*.web.app` dan `*.firebaseapp.com` sudah otomatis diizinkan untuk login
(email/kata sandi maupun Google). Kalau nanti memakai domain sendiri, tambahkan
ke **Authentication → Authorized domains**.

> `firebase.json` menunjuk `firestore.rules` di folder yang sama. Jalankan
> perintah deploy dari dalam folder `web/`.

---

## 7. Pemecahan masalah

| Gejala | Penyebab & solusi |
|---|---|
| "Firestore menolak akses…" saat daftar/buat workspace | Rules belum di-deploy → jalankan Langkah 1. |
| "Domain ini belum diizinkan" (Google) | Tambahkan `localhost` / domain Hosting di **Authentication → Authorized domains**. |
| "Metode login ini belum diaktifkan" | Aktifkan Email/Password & Google di **Sign-in method**. |
| Data tidak muncul di perangkat lain | Pastikan kedua perangkat login dengan akun anggota workspace yang sama; cek `#sync-label` di header ("Live · Firebase"). |
| Undangan tidak terlihat admin | Pastikan login sebagai `admin` (role di `members/{uid}`). |
| `FIRESTORE … INTERNAL ASSERTION FAILED: Unexpected state` | Error internal SDK, bukan rules. Versi ini sudah memakai memory cache + SDK 13.1.0 dan menampilkan layar **Koneksi data terputus → Muat ulang**. Jika masih muncul, buka `?debug=1`, kirim log console, dan pastikan hanya satu tab aplikasi terbuka. |
| Login berhasil lalu kembali ke layar masuk | Sesi Auth tersimpan di **IndexedDB/localStorage origin** dan tidak kedaluwarsa. Aplikasi memverifikasi ulang `null` (0 / 0,7 / 1,8 / 3,6 dtk bila sesi baru saja live) sebelum disimpulkan. Sejak perbaikan 2 Nov 2026 aplikasi tidak memanggil `setPersistence()` saat boot, tidak membaca `currentUser` sebelum restore selesai, dan **tidak lagi menampilkan layar "Sesi tidak terbaca"**: kalau sesi benar-benar berakhir, yang tampil adalah layar masuk biasa dengan keterangan singkat. Auto-reload dibatasi maksimal 1x per menit. Penyebab nyata yang tersisa: data situs dibersihkan (setelan browser / "clear on exit"), mode Incognito, berganti browser/profil, atau membuka `web.app` vs `firebaseapp.com` (origin berbeda = sesi berbeda). |
| Console: `Connecting to …firebase-firestore-compat.js.map violates … Content-Security-Policy` | DevTools meminta sourcemap SDK. Sejak 2 Nov 2026 `connect-src` mengizinkan `https://www.gstatic.com`; kalau masih muncul, hard reload setelah deploy. Tidak memengaruhi aplikasi. |
| Console: `AbortError: signal is aborted without reason` (firestore-compat) | SDK membatalkan request WebChannel saat kredensial Firestore berganti (`disableNetwork`/`enableNetwork`), listener dilepas, atau halaman ditinggal. Bukan kegagalan aplikasi. Sejak 2 Nov 2026: filter `unhandledrejection` dipasang **sebelum** SDK Firebase dimuat, user yang sama tidak di-emit ulang setelah `null` sementara, dan attach dibatalkan lebih awal saat akun berganti — sehingga abort beruntun tidak lagi membanjiri console. |
| Console: `A listener indicated an asynchronous response by returning true, but the message channel closed…` | Pesan dari iframe relayer Google / ekstensi browser, bukan kode aplikasi. Handler global mengabaikannya. Kalau masih terlihat, uji di jendela Incognito tanpa ekstensi. |
| Console: `Connecting to 'https://apis.google.com/js/gen_204…' violates … connect-src` | Beacon Google Identity saat popup login. Sejak 2 Nov 2026 `connect-src` mengizinkan `https://apis.google.com`; perlu deploy hosting lalu hard reload. |
| Console: `Cross-Origin-Opener-Policy policy would block the window.closed call` | Pesan ini berasal dari kode Google sendiri (popup memutus opener), bukan dari header kita. Header COOP FlowSpace sudah **dihapus** pada 2 Nov 2026 karena tidak menghentikan pesan itu dan justru bisa mengganggu alur popup. Login tetap berjalan normal. |
| Console: belasan `snapshot gagal: … permission-denied` setelah login | Listener workspace lama sempat hidup dengan kredensial akun baru (login/logout di tab lain) atau token belum siap. Sejak 2 Nov 2026 listener dilepas lebih dulu saat uid berganti, workspace yang gagal dibaca tidak dilanjutkan ke listener, `permission-denied` saat transisi token di-retry, dan attach memakai retry khusus dengan refresh ID token. Listener yang ditolak setelah aplikasi berjalan dipasang ulang otomatis (maks. sekali per 30 dtk). Kalau menetap: akun memang bukan anggota → layar **Akses workspace ditolak**. |
| Layar "Coba lagi" muncul saat jaringan buruk | Klik **Coba lagi**; data/ sesi tetap tersimpan. Tidak perlu logout. |
| Ingin mulai bersih | Settings → **Reset Data** (menghapus konten workspace, akun anggota tetap). |

---

## 8. Status pengujian (31 Okt 2026)

Diuji dengan dua instance browser terpisah (profil berbeda, mensimulasikan dua
perangkat) pada project `javina-project`:

| Skenario | Hasil |
|---|---|
| Daftar akun baru → layar "Hubungkan akun" | OK |
| Buat workspace → masuk sebagai `admin` | OK |
| Seed demo → 5 task, 3 workflow, 8 aplikasi, 8 node | Tersimpan di Firestore |
| Undang member (role `editor`) | Muncul sebagai **Diundang** |
| Member masuk di perangkat lain | Otomatis gabung, undangan habis di kedua lokasi dokumen |
| Admin membuat task | Kanban perangkat lain bertambah tanpa reload |
| Editor mengubah progress | Tersimpan (version 2) |
| Dialog `confirm()` bawaan / error console | 0 / 0 |

### Uji versi Hosting (31 Okt 2026)

Diuji langsung di `https://javina-project.web.app` (bukan localhost):

| Skenario | Hasil |
|---|---|
| Layar masuk di HP (390×844) | Tampil rapi, tanpa scroll horizontal |
| Daftar → onboarding → buat workspace | Admin aktif, label **Live · Firebase** |
| Seed demo di hosting | 5 task, 3 workflow, 8 aplikasi tersimpan di Firestore |
| Kanban / Workflows / Application Hub / Team / Settings di HP | Semua muat, 0 tombol terpotong |
| Kanvas workflow di HP | Kanvas penuh, strip node di bawah, panel detail jadi lembar penuh |
| Tambah node dari strip bawah + buka detail node | Berhasil, panel 390px pas |
| Tombol Google di layar masuk | Muncul (domain hosting sudah diizinkan) |
| Error console | 0 |

Akun dan data uji sudah dihapus setelah pengujian.

### Uji kepemilikan task & dashboard (31 Okt 2026, live)

Dua akun baru (admin + editor) di `https://javina-project.web.app`, dua profil
browser terpisah. Data uji dihapus setelah pengujian.

| Skenario | Hasil |
|---|---|
| Editor membuka task milik admin | Drawer read-only (tanpa Simpan/Hapus, input disabled, banner PIC) |
| Editor membuka task miliknya | Editable; PIC tetap terkunci |
| Kartu Kanban task orang lain | `draggable=false`, ikon kunci, drag ditolak |
| Editor mengubah / memindah PIC / menghapus task orang lain | Ditolak API dengan pesan jelas |
| Tulis langsung ke Firestore (tanpa API) pada task orang lain | `permission-denied` (rules) |
| Checklist / aplikasi pada task orang lain | Ditolak API **dan** rules |
| Editor mengambil task tanpa PIC | Berhasil (PIC = dirinya), langsung editable |
| Editor membuat task | PIC otomatis diri sendiri; pilihan PIC terkunci |
| Editor membuat task untuk admin | Ditolak (`FORBIDDEN`) |
| Editor menghapus node berisi task admin (delete & simpan layout) | Ditolak |
| Editor checklist/aplikasi pada task sendiri | Berhasil |
| Admin mengubah task editor & memindahkan PIC | Berhasil |
| Nama tampilan member baru | Tersimpan sebagai nama, bukan potongan email |
| Dashboard Tim: 8 KPI, aktivitas, baris "Tanpa workflow" | Tampil; baris tanpa workflow bukan tombol |
| Workflow diarsipkan | Nama tetap tampil + badge **Arsip** |
| Dashboard Saya: KPI, Fokus Saya, workflow, aktivitas | Tampil, hanya task milik akun |
| Tab dashboard setelah reload | Pilihan terakhir diingat |
| Error console / pelanggaran CSP | 0 / 0 |

### Uji komentar & chat (31 Okt 2026, live)

Tiga akun baru (admin, editor, viewer) di `https://javina-project.web.app`, tiga
profil browser terpisah. Data uji dan akun dihapus setelah pengujian.

| Skenario | Hasil |
|---|---|
| Admin komentar di task, node, workflow | Tersimpan; `commentCount` benar di `listTasks`, `getTask`, `listWorkflows`, `getWorkflowCanvas` |
| Editor melihat & membalas komentar admin | Berhasil; edit komentar sendiri tersimpan (`edited_at`) |
| Viewer menulis komentar & chat | Berhasil; edit/hapus milik sendiri berhasil |
| Viewer mengubah task | Ditolak API (`viewer` hanya baca) |
| Viewer mengubah/menghapus komentar admin (raw Firestore) | `permission-denied` |
| Viewer memalsukan `created_by_uid` / body >2000 karakter | `permission-denied` |
| Viewer menghapus pesan chat admin (raw Firestore) | `permission-denied` |
| Admin menghapus komentar editor | Berhasil (soft delete, hilang dari daftar) |
| Drawer task menampilkan thread komentar | 2 komentar tampil, input tersedia |
| Admin melampirkan task + workflow lewat picker chat | Kartu tampil; `attachments_json` berisi 2 referensi |
| Viewer membalas hanya dengan lampiran (tanpa teks) | Berhasil; `body` kosong, lampiran tersimpan |
| Viewer mengedit pesan | Teks berubah, lampiran tetap sama |
| Viewer mengubah `attachments_json` lewat raw Firestore | `permission-denied` |
| `attachments_json` > 1500 karakter / pesan kosong tanpa lampiran | `permission-denied` |
| Task dihapus → kartu lampiran | Label "Tidak tersedia", tidak bisa diklik |
| Klik kartu workflow dari chat (viewer) | Kanvas terbuka, tetap read-only |
| Badge unread + toast saat admin mengirim chat | Badge merah `1`, toast muncul; hilang setelah pesan terlihat |
| Chat: kirim, edit, hapus pesan sendiri | Berhasil; placeholder "Pesan ini telah dihapus" |
| Error runtime / pelanggaran CSP | 0 / 0 |

### Uji status baca chat (31 Okt 2026, live)

Dua akun (admin, viewer) plus sesi kedua akun viewer di profil browser lain.

| Skenario | Hasil |
|---|---|
| Admin mengirim 3 pesan setelah viewer bergabung | Viewer: badge merah `3`, `aria-label` "3 pesan belum dibaca" |
| Viewer membuka Chat (3 pesan muat dalam satu layar) | Semua pesan terlihat → langsung terbaca; `chatReads/{uid}` berisi `last_read_message_id` pesan terakhir |
| Viewer reload | Badge tetap kosong (marker dibaca dari Firestore) |
| Admin mengirim pesan saat viewer di dashboard | Badge muncul live di kedua perangkat viewer (`1`, lalu `2`) |
| Perangkat 1 membaca semua, perangkat 2 reload | Badge perangkat 2 kosong — status ikut antar perangkat |
| Viewer menulis `chatReads` milik admin / workspace salah / `member_id` salah | `permission-denied` |
| `last_read_at` > 40 karakter / `last_read_message_id` > 120 karakter | `permission-denied` |
| Viewer menulis dokumen status bacanya sendiri (valid) | Berhasil |
| Admin membaca `chatReads` milik viewer | Berhasil (untuk moderasi/reset) |

Uji lokal (mode `local`, 30 pesan) juga dijalankan untuk alur yang sama: badge
merah + jumlah, garis **Pesan baru** di posisi awal, nama/isi pesan unread
ditebalkan, gulir otomatis ke garis (bukan ke dasar), unread berkurang saat
pesan terlihat, habis setelah scroll ke dasar, dan tetap tersimpan setelah
reload — tanpa error console.

Uji lokal (mode `local`) juga dijalankan untuk alur yang sama: komentar
task/node/workflow, edit/hapus, chat, badge, dan toast — semua lulus tanpa error
console.

### Uji perbaikan login Google akun lama (2 Nov 2026)

| Skenario | Hasil |
|---|---|
| Boot dengan SDK 13.1.0 + memory cache | Layar masuk tampil, `FlowFirebase.info().persistence = "memory"` |
| localStorage setelah boot mode Firebase | Kosong (tidak ada salinan dataset) |
| Deduplikasi event auth uid sama | Tidak ada `resolveMembership`/attach ganda |
| `resolveMembership` untuk uid sama bersamaan | Memakai promise yang sama (satu rangkaian read) |
| Attach workspace lama saat logout | Generation token membatalkan listener; tidak ada data workspace lama masuk Store |
| Error `unavailable`/`internal` | Retry 3× (0/500/1500 ms) sebelum layar pemulihan |
| Error `permission-denied` saat transisi token | Di-retry 3× (0/500/1500 ms) selama user masih masuk |
| Error `permission-denied` menetap | Layar **Akses workspace ditolak** (bukan onboarding "buat workspace") |
| Attach workspace ditolak rules | Listener tidak dipasang sama sekali; satu peringatan console |
| Akun berganti dari tab lain | Listener workspace lama dilepas sebelum membaca keanggotaan akun baru |
| Assertion Firestore | Layar **Koneksi data terputus** dengan tombol Muat ulang (tanpa retry) |
| Logout eksplisit | Layar masuk normal tanpa pesan "sesi terputus" |
| Auth `null` tak terduga setelah pernah masuk | Diverifikasi ulang ~3,2 dtk; jika tetap null → layar **Sesi tidak terbaca** (bukan klaim "koneksi terputus") |
| Sesi tersimpan gagal dibaca saat boot | Reload otomatis sekali, lalu layar **Sesi tidak terbaca**; penanda lama dihapus |
| Mode `local` | Tetap memakai localStorage seperti sebelumnya |

Smoke test browser (Edge headless) memastikan tidak ada error runtime saat boot.
Perubahan sudah di-deploy ke `https://javina-project.web.app` (2 Nov 2026,
hosting saja — rules tidak berubah). Verifikasi live: SDK `13.1.0`,
`persistence: "memory"`, localStorage kosong, 0 error console.

Uji login Google langsung dengan akun lama/baru masih perlu dilakukan manual
(membutuhkan sesi Google pemilik akun).

### Uji race token & permission-denied (2 Nov 2026)

| Skenario (harness Node + Edge headless) | Hasil |
|---|---|
| Attach workspace → `get()` dibalas `permission-denied` | Attach ditolak dengan `flowspace/membership-denied`, 0 listener dipasang |
| Attach dengan `member.member_id` ≠ uid Auth | Dibatalkan sebelum membaca Firestore, 0 listener |
| Attach normal | 12 listener terpasang, `workspaceId` diset |
| Mode `local`: boot + Application Hub + modal kategori | 5/5 checklist lolos, 0 error console |
| `permission-denied` pada listener | Satu baris `console.warn` per attach (tidak lagi 12 baris) |

Perbaikan ini perlu deploy hosting (`firebase deploy --only hosting`) karena
menyentuh `firebase.json` (CSP `connect-src` + header COOP) dan aset JS.

### Uji notifikasi lonceng (2 Nov 2026)

| Skenario | Hasil |
|---|---|
| Komentar orang lain pada task yang PIC-nya saya | Muncul (`task_comment`) |
| Komentar saya sendiri pada task saya | Tidak muncul |
| Komentar orang lain pada workflow yang berisi task saya | Muncul (`workflow_comment`) |
| Komentar pada node di workflow yang berisi task saya | Muncul (`node_comment`, ada nama node) |
| Komentar pada workflow tanpa task saya | Tidak muncul |
| Komentar task/node yang sudah dihapus (soft delete) | Tidak muncul |
| Admin membuat task untuk saya | Muncul (`task_assigned`) |
| Task lama dipindahkan admin ke saya | Muncul (`task_assigned`) |
| Form task disimpan tanpa mengubah PIC | Tidak muncul (nilai lama = baru) |
| Admin: task berubah `review → done` | Muncul (`task_done`) |
| Admin: task `done` disimpan ulang tanpa ubah status | Tidak muncul |
| Editor / viewer | Tidak menerima notifikasi `task_done` |
| Badge angka | 4 item = badge "4" |
| Buka panel | Badge **tetap 4** (tidak auto-dibaca) |
| Klik titik satu item | Item jadi dibaca, badge turun ke 3, panel tetap terbuka |
| Klik titik item yang sudah dibaca | Kembali belum dibaca, badge naik |
| Tombol **Tandai semua dibaca** | Badge hilang, semua titik kosong, tombol disembunyikan |
| Buka panel lalu reload | Status baca bertahan; item tetap tampil |
| Item baru masuk saat panel tertutup | Badge bertambah 1 |
| Klik baris item | Item itu dibaca, drawer task terbuka, panel tertutup |
| Klik item komentar workflow | Pindah ke kanvas workflow terkait |
| Escape / klik backdrop / scroll | Panel tertutup |
| Tampilan HP 390 px | Panel muat (374 px), lonceng tetap terlihat |
| Error console saat uji | 0 |

Uji dijalankan di mode `local` (Edge headless). Di mode Firebase sumber datanya
sama (`comments`, `tasks`, `activityLogs` yang disinkronkan), jadi tidak ada
perubahan rules atau koleksi baru.

### Uji sesi & console (2 Nov 2026)

| Skenario | Hasil |
|---|---|
| Boot tanpa sesi | Layar masuk; `FlowFirebase.info().authPersistence = "local-default"` |
| Login sekali, tutup browser, buka lagi profil yang sama | `currentUser` pulih otomatis; tanpa auto-reload dan tanpa layar **Sesi tidak terbaca** |
| Sesi tersimpan gagal dibaca saat boot | Halaman dimuat ulang otomatis **sekali** setelah verifikasi, lalu layar **Sesi tidak terbaca** |
| Kunjungan berikutnya setelah sesi hilang | Penanda lama sudah dihapus → layar masuk biasa, tanpa reload/pesan berulang |
| Boot tanpa penanda sesi | Tidak ada auto-reload; layar masuk biasa |
| `null` sementara dari Auth | Diverifikasi ulang 0/700/1800/3600 ms (live) atau 0/500/1500 ms (boot); sesi pulih tanpa event auth berulang |
| Logout lewat tombol Keluar | Langsung, penanda sesi dihapus |
| `AbortError` dari Firestore saat reload | Diabaikan (`preventDefault`), tidak memicu layar pemulihan |
| CSP sourcemap `.map` | `connect-src` mengizinkan `https://www.gstatic.com` (butuh deploy hosting) |

### Uji noise console & pemulihan listener (2 Nov 2026, lanjutan)

| Skenario | Hasil |
|---|---|
| Filter `unhandledrejection` dipasang sebelum SDK Firebase | `AbortError` / `signal is aborted` / `message channel closed` tidak muncul sebagai `Uncaught (in promise)` |
| `null` palsu setelah sesi live | Tidak lagi di-emit ulang sebagai event user; tidak memicu resolveMembership/attach baru |
| Sesi benar-benar hilang setelah verifikasi | Layar masuk biasa + keterangan singkat (bukan **Sesi tidak terbaca**) |
| Boot dengan sesi tersimpan yang gagal dibaca | Reload otomatis maks. 1x per 60 dtk (`flowspace.authRecoveredAt`) |
| Listener workspace ditolak saat attach | `flowspace/workspace-denied` → refresh token → attach diulang (0/800/2000 ms) |
| Listener ditolak setelah aplikasi berjalan | Event `fs:workspace-denied` → detach + `getIdToken(true)` + attach ulang, maks. 1x per 30 dtk |
| Chat listener `permission-denied` saat transisi token | 2x retry dengan refresh token, lalu toast informatif |
| Peringatan Tailwind Play CDN di production | Hilang (salinan `vendor/tailwind-3.4.16.js` tidak lagi memanggil `console.warn`) |
| Header `Cross-Origin-Opener-Policy` | Dihapus dari `firebase.json` (default `unsafe-none` paling kompatibel dengan popup) |
| Console saat smoke lokal & live | 0 error, 0 warning |

### Uji kategori Application Hub (2 Nov 2026)

| Skenario | Hasil |
|---|---|
| Tombol **Kelola Kategori** di Application Hub | Tepat 1 tombol, di samping **Tambah Aplikasi** |
| Modal kategori (desktop + HP 390×844) | Muat, daftar bisa di-scroll, tanpa scroll horizontal |
| Tambah kategori dari modal | Langsung muncul di daftar modal |
| Edit kategori | Nama baru tersimpan dan tampil di modal |
| Hapus kategori | Memakai modal konfirmasi custom (`showConfirmDialog`), bukan `confirm()` |
| Select kategori di form Tambah/Edit Aplikasi | Otomatis memuat kategori terbaru |
| Kartu **Kategori Aplikasi** di Settings | Sudah dihapus |
| Error console | 0 |

### Uji global search / command palette (3 Nov 2026)

| Skenario | Hasil |
|---|---|
| `Ctrl/Cmd+K` | Membuka palette, fokus ke input, ARIA dialog/listbox |
| Query kosong | Menampilkan 7 pintasan navigasi ("Lompat ke") |
| Cari task | Klik hasil → drawer task terbuka; `Esc` menutup drawer |
| Cari workflow | Klik hasil → kanvas terbuka dengan workflow yang benar |
| Cari node | Membuka kanvas workflow + menyorot node (animasi) |
| Cari aplikasi | Membuka Application Hub + kartu disorot |
| Cari anggota | Membuka Team & Members + kartu disorot |
| Keyboard `↑`/`↓`/`Enter`/`Esc` | Navigasi & pilih berfungsi, tepat 1 `aria-selected` |
| Query tanpa hasil | Menampilkan empty state |
| Jaringan | 0 fetch — pencarian hanya membaca `Store` (memori) |
| Kotak pencarian header | Menjadi pemicu palette (readonly); tombol terpisah untuk HP |
| Viewport HP 390×844 | Palette muat tanpa scroll horizontal |
| Error console | 0 |

Catatan: kotak pencarian header sengaja dibuat readonly — semua pencarian
melalui palette supaya perilaku konsisten di desktop & HP.

Regresi & verifikasi di atas kini dijaga otomatis: suite E2E
`tests/phase2-test.js` (33 assertion) menjalankan ulang skenario yang sama
di setiap `npm test` / push ke CI.

### Uji backup, export & diagnostik (3 Nov 2026)

| Skenario | Hasil |
|---|---|
| Kartu **Backup & Export** di Settings | Tampil untuk admin, tombol nonaktif + tooltip untuk role lain |
| Unduh backup | File `flowspace-<slug>-YYYYMMDD-HHMMSS.json`, JSON valid, `format: flowspace-backup` |
| Isi backup | `collections` berisi 14 koleksi; `counts` selalu = panjang array masing-masing |
| Backup setelah **Seed Data Demo** | 16 dokumen ikut terekspor (5 task, 3 workflow, dll) |
| Kartu **Diagnostik** | 10 baris terisi: mode, SDK, project, auth persistence, cache, listener, penanda sesi, koneksi, workspace, jumlah dokumen |
| Mode lokal | Baris khusus Firebase ditampilkan `-` agar tidak menyesatkan |
| Tombol **Salin** | Menghasilkan JSON yang bisa ditempel di laporan bug |
| Layout desktop 1280×900 & HP 390×844 | Tanpa scroll horizontal; kartu backup & diagnostik terlihat |
| `activityLogs` saat attach | Query `orderBy('created_at','desc').limit(300)`; koleksi lain tanpa limit |
| Console saat uji | 0 error |

Catatan: backup **terjadwal** (GitHub Actions + Admin SDK tanpa Blaze) belum
bisa dibuat karena folder `web/` belum di-track git. Setelah repo punya remote
dan secret `FIREBASE_SERVICE_ACCOUNT`, job harian bisa memanggil
`firestore export`/REST export dan mengunggah hasilnya sebagai artifact.

---

## 9. Kuota & biaya

Paket **Spark** (gratis): Firestore 1 GiB, 50.000 reads/hari, 20.000 writes/hari,
20.000 deletes/hari; Auth 50.000 MAU; Hosting 10 GB.

Untuk tim 10–20 orang, pemakaian normal masih di dalam kuota. Bila suatu saat
perlu naik ke **Blaze**: pasang **budget alert** (mis. US$5) dan **App Check**
(reCAPTCHA v3).

Chat dibatasi 50 pesan terakhir per listener, dan komentar hanya disinkronkan
saat workspace dibuka, sehingga penambahan fitur ini tidak mengubah pola kuota
secara berarti. Lampiran file/gambar sengaja belum ada karena membutuhkan
Firebase Storage dan kuota tambahan.

`activityLogs` kini dibatasi **300 dokumen terbaru** per attach. Ini penting
karena jumlah attach bisa bertambah dalam satu sesi (retry jaringan, refresh
token, buka tab baru): dengan riwayat penuh, setiap attach membaca ulang
seluruh log. Untuk mengukur dampaknya, buka **Settings → Diagnostik** sebelum
dan sesudah perubahan, lalu bandingkan pemakaian di Firebase Console →
Firestore → Usage.

Pengamanan wajib:

- Jangan commit `serviceAccount.json` / Admin SDK key. `apiKey` di
  `firebase-config.js` memang publik dan aman.
- Uji perubahan rules di **Firebase Emulator** sebelum produksi:
  `firebase emulators:start --only firestore`.
- App Check diaktifkan sebelum trafik publik.
