# FlowSpace - Google Apps Script Web App

Web app workflow visual canvas hybrid untuk tim/perusahaan. Dibangun dengan Google Apps Script + Google Sheets + vanilla JavaScript + Tailwind CSS (CDN) + Drawflow.

> **Versi aktif (live)** sekarang berbasis **Firebase Hosting + Firestore** dan
> berada di folder `web/` — lihat `web/README.md` dan `web/FIREBASE-SETUP.md`.
> File `.gs` + `Index.html` di root adalah versi legacy Apps Script yang
> disimpan sebagai referensi/arsip.

**Stack:**
- Backend: Google Apps Script (V8 runtime)
- Database: Google Sheets (10 tab, dengan header tetap)
- Frontend: HTML + Tailwind CSS via CDN + Drawflow (canvas editor) + native drag-and-drop (Kanban)
- Komunikasi: `google.script.run` (async, dengan success/failure handler)
- Otorisasi: server-side, per fungsi

## Fitur MVP

- **Dashboard**: statistik task, distribusi priority, task critical/high belum selesai, ringkasan per PIC & per workflow
- **Workflows**: CRUD (buat, edit, duplikasi, arsip, hapus permanen)
- **Workflow Canvas**: editor visual dengan 6 jenis node (start_end, process, task, decision, application, note), connect antar node, drag-drop, zoom, pan, autosave
- **Kanban Board**: 5 kolom (Backlog/To Do/In Progress/Review/Done), drag-and-drop antar kolom, filter (workflow/PIC/priority/search)
- **Application Hub**: katalog aplikasi per kategori (kategori dapat ditambah/ubah/hapus dari Settings), link aplikasi ke task (dengan custom URL)
- **Task Detail**: edit semua field, checklist interaktif, link/unlink aplikasi, riwayat aktivitas
- **Team & Members**: daftar anggota dengan role (admin/editor/viewer), log aktivitas terbaru
- **Settings**: info workspace, info spreadsheet, matriks hak akses, seed/reset data
- **Audit log**: otomatis dicatat untuk perubahan penting (status, priority, progress, dll.)
- **Version check**: deteksi konflik edit antar user
- **URL validation**: hanya http/https

## Struktur File

```
flowspace-gas/
├── appsscript.json          # Manifest (OAuth scopes, deployment config)
├── Code.gs                  # Entry point: doGet(), public API functions
├── Config.gs                # Konstanta & helper
├── DatabaseService.gs       # Baca/tulis Google Sheets (satu-satunya tempat kontak sheet langsung)
├── AuthService.gs           # Identitas pengguna & otorisasi
├── WorkspaceService.gs     # CRUD workspace & members
├── WorkflowService.gs       # CRUD workflow
├── CanvasService.gs         # Load/save canvas (nodes + edges)
├── TaskService.gs           # CRUD task, status, priority, progress
├── ApplicationService.gs    # Katalog aplikasi & relasi task-aplikasi
├── ChecklistService.gs      # Checklist per task
├── DashboardService.gs      # Agregasi statistik dashboard
├── AuditService.gs          # Activity log
├── SetupService.gs          # Setup spreadsheet + seed data demo
├── Index.html               # Shell HTML utama
├── Styles.html              # Custom CSS
└── Scripts.html             # Frontend JavaScript (vanilla)
```

## Cara Deploy (LANGKAH-DEMO-LANGKAH)

### 1. Buat Apps Script Project Baru

1. Buka https://script.google.com
2. Klik **New Project** (klik tombol "+ New project" di kiri atas)
3. Beri nama project: "FlowSpace"
4. Hapus isi `Code.gs` default (Ctrl+A → Delete)

### 2. Import semua file

Untuk setiap file `.gs` di folder `flowspace-gas/`:
1. Di Apps Script editor, klik tombol **+** di sebelah "Files"
2. Pilih **Script** untuk file `.gs`, atau **HTML** untuk file `.html`
3. Beri nama yang sama dengan file (tanpa ekstensi)
   - Contoh: file `Config.gs` → buat script bernama `Config`
   - File `Index.html` → buat HTML bernama `Index`
4. Buka file `.gs`/`.html` di folder `flowspace-gas/` di komputer Anda, copy seluruh isi, paste ke editor Apps Script
5. Save (Ctrl+S)

**Urutan penting**: Pastikan Anda membuat SEMUA file berikut:
- `Code.gs`, `Config.gs`, `DatabaseService.gs`, `AuthService.gs`, `WorkspaceService.gs`, `WorkflowService.gs`, `CanvasService.gs`, `TaskService.gs`, `ApplicationService.gs`, `ChecklistService.gs`, `DashboardService.gs`, `AuditService.gs`, `SetupService.gs`
- `Index.html`, `Styles.html`, `Scripts.html`

### 3. Update appsscript.json (Opsional tapi disarankan)

1. Di Apps Script editor, klik **Project Settings** (ikon gerigi di kiri)
2. Centang **"Show 'appsscript.json' manifest file in editor"**
3. Klik **Save**
4. Buka file `appsscript.json` di editor
5. Ganti seluruh isi dengan isi file `appsscript.json` dari folder ini
6. Save

### 4. Setup Database (PENTING!)

Sebelum deploy, Anda perlu menjalankan setup database:

1. Di Apps Script editor, di toolbar atas, klik dropdown "Function" (default: `doGet`)
2. Pilih fungsi **`setupDatabase`**
3. Klik tombol **Run** (tombol play ▶️)
4. **Saat diminta**, klik **"Review permissions"** → pilih akun Google Anda → klik **"Advanced"** → **"Go to FlowSpace (unsafe)"** → **"Allow"**
5. Tunggu sampai muncul **"Execution completed"** di Execution Log
6. Cek **Project Settings** → ada spreadsheet baru di Drive Anda bernama "FlowSpace Database"
   - Atau buka folder Google Drive Anda, cari file "FlowSpace Database"
   - Atau jalankan fungsi `getSetupStatus` (Run) untuk melihat ID & URL spreadsheet

**Hasil setup:**
- Spreadsheet database otomatis dibuat
- Semua 10 tab + header dibuat
- Workspace default dibuat dengan Anda sebagai owner/admin

### 5. (Opsional) Seed Data Demo

Untuk testing dengan data contoh:
1. Pilih fungsi **`seedDemoData`** di dropdown
2. Klik **Run**
3. Tunggu sampai selesai

Ini akan menambahkan:
- 3 workflow contoh (Onboarding, Pengadaan, Konten Marketing)
- 5+ task terkait
- 8 aplikasi contoh (Slack, Notion, Jira, dll.)
- Checklist items
- Activity log

### 6. Deploy sebagai Web App

1. Klik **Deploy** (kanan atas) → **New deployment**
2. Klik **Select type** → pilih **Web app**
3. Konfigurasi:
   - **Description**: "FlowSpace MVP v1.0"
   - **Execute as**: **Me** (akun Anda - deploy sebagai user yang menjalankan)
   - **Who has access**: 
     - **Anyone with Google Account** (untuk tim dengan akun Google)
     - **Only myself** (untuk testing pribadi)
4. Klik **Deploy**
5. **Saat diminta**, klik **"Authorize access"** dan izinkan semua permission
6. Copy **Web app URL** yang muncul (format: `https://script.google.com/macros/s/.../exec`)
7. Buka URL tersebut di browser

### 7. Akses Web App

Buka Web app URL di browser. Anda akan langsung masuk ke Dashboard (atau layar setup jika belum jalan setup).

## Pengujian Otomatis (versi web/)

Sebelum deploy atau setelah mengubah kode di `web/`, jalankan tes E2E dari
folder root proyek:

```bash
npm install     # sekali
npm test        # syntax check + 4 suite E2E (~1 menit)
```

Tes berjalan di **mode lokal** (interceptor Playwright mengganti konfigurasi
Firebase), jadi **tidak menyentuh Firestore produksi** dan tidak butuh
kredential apa pun. Detail cakupan & cara menambah tes: lihat
[`tests/README.md`](tests/README.md).

CI (GitHub Actions) menjalankan hal yang sama pada setiap push/PR — lihat
`.github/workflows/ci.yml`.

## Catatan Penting

### Model Otorisasi
- **Execute as: Me** - semua operasi dieksekusi sebagai Anda (pemilik deploy). Cocok untuk MVP internal.
- **Execute as: User accessing the web app** - setiap pengguna dieksekusi sebagai dirinya sendiri. Lebih aman untuk produksi.

Untuk MVP, gunakan "Execute as: Me". Pastikan hanya orang yang Anda percaya yang memiliki akses URL.

### Backup Database
- Buka spreadsheet "FlowSpace Database" di Google Drive
- File → Make a copy (untuk backup manual berkala)
- Atau: File → Download as → CSV/Excel
- Disarankan: backup mingguan

### Quota Apps Script
- Apps Script punya quota harian (default: 90 menit compute/hari untuk akun gratis)
- Jangan simpan canvas terlalu sering (autosave sudah di-debounce 3 detik)
- Untuk volume besar, gunakan batch operations (sudah diimplementasi di `DatabaseService.batchInsert`)

### Edit Header Sheet
**JANGAN** mengubah nama/urutan kolom header di sheet. Jika ingin menambah kolom, tambahkan di paling kanan dan update `CONFIG.HEADERS` di `Config.gs`.

### Akses untuk Member Baru
Member baru harus ditambahkan via menu **Team & Members** → **Tambah Member**. Member hanya bisa diakses oleh admin.

## Troubleshooting

### Error: "Spreadsheet belum di-setup"
Jalankan fungsi `setupDatabase` lagi di editor (Run > setupDatabase). Lihat log eksekusi.

### Error: "Akses ditolak: Anda bukan member aktif"
Anda login dengan akun yang belum terdaftar sebagai member. Mintalah admin untuk menambahkan Anda di menu Team & Members. Atau, jika Anda adalah pemilik spreadsheet, otomatis dianggap admin.

### Web app blank page / error "google.script.run is not defined"
- Pastikan Anda membuka URL versi deployed (`/exec`), bukan `/dev`
- Coba hard refresh (Ctrl+Shift+R)
- Cek Executable log di Apps Script editor

### Canvas tidak menyimpan
- Cek koneksi internet
- Buka DevTools browser → Console → lihat error
- Pastikan workflow version cocok (jika ada konflik, reload)

### Reset Database
1. Buka Settings → Reset Database
2. Atau jalankan fungsi `resetDatabase` di editor

### Re-deploy setelah edit kode
1. Edit file di editor
2. Klik **Deploy** → **Manage deployments**
3. Pilih deployment yang ada → klik **Edit** (ikon pensil)
4. Pilih **Version: New version**
5. Klik **Deploy**
6. URL tetap sama, tapi versi baru aktif

## Skema Database (11 Sheets)

| Sheet | Kolom Utama | Catatan |
|-------|-------------|---------|
| Workspaces | workspace_id, workspace_name, owner_email, status, created_at, updated_at | Satu workspace aktif per database MVP |
| Members | member_id, workspace_id, email, display_name, role, member_status, created_at | Unique email per workspace |
| Workflows | workflow_id, workspace_id, workflow_name, description, canvas_settings_json, created_by, created_at, updated_at, status, version | version untuk deteksi konflik |
| Nodes | node_id, workflow_id, node_type, title, description, position_x, position_y, width, height, style_json, application_id, task_id, created_at, updated_at, version | task_id opsional (relasi ke Tasks) |
| Edges | edge_id, workflow_id, source_node_id, target_node_id, label, condition, created_at, updated_at, source_output, target_input | source_output/target_input merekam port koneksi (output_1/2, input_1/2) |
| Tasks | task_id, workspace_id, workflow_id, node_id, title, description, assignee_email, status, priority, progress, progress_mode, start_date, due_date, created_by, created_at, updated_at, version | Sumber utama status & progress |
| Applications | app_id, workspace_id, app_name, app_url, category, description, icon_url, created_by, created_at, updated_at | URL divalidasi http/https |
| AppCategories | category_id, workspace_id, category_name, sort_order, created_at, updated_at | Kategori Application Hub, dikelola dari Settings |
| TaskApplications | task_app_id, task_id, app_id, custom_url, link_label, created_at | Relasi many-to-many task↔app |
| Checklist | checklist_id, task_id, item_title, is_completed, sort_order, created_by, created_at, updated_at | is_completed sebagai string 'true'/'false' |
| ActivityLogs | log_id, workspace_id, entity_type, entity_id, action, actor_email, old_value_json, new_value_json, created_at | Audit trail |

## Role & Hak Akses

| Aksi | Admin | Editor | Viewer |
|------|-------|--------|--------|
| Lihat workflow & task | Ya | Ya | Ya |
| Membuat workflow | Ya | Ya | Tidak |
| Mengubah canvas | Ya | Ya | Tidak |
| Membuat/mengubah task | Ya | Ya | Tidak |
| Mengelola Application Hub | Ya | Ya | Tidak |
| Mengelola anggota | Ya | Tidak | Tidak |
| Mengarsipkan/hapus workflow | Ya | Tidak | Tidak |

## Lisensi & Pustaka Pihak Ketiga

- **Tailwind CSS**: MIT License - https://tailwindcss.com
- **Drawflow**: MIT License - https://github.com/jerosoler/Drawflow
- **Lucide Icons**: ISC License - https://lucide.dev

## Kontak

FlowSpace MVP v1.0 - Satu sumber data, banyak tampilan.

Untuk pertanyaan, laporkan bug, atau permintaan fitur, hubungi tim pengembang internal.
