# FlowSpace --- Spesifikasi dan Prompt Pembangunan Web App

**Versi dokumen:** 1.0\
**Tanggal:** 19 Oktober 2026\
**Status:** Spesifikasi MVP\
**Bahasa aplikasi:** Bahasa Indonesia\
**Nama kerja produk:** FlowSpace (dapat diganti)

------------------------------------------------------------------------

## 1. Tujuan Dokumen

Dokumen ini menjadi acuan utama untuk membangun aplikasi web **workflow
visual canvas hybrid** untuk tim dan perusahaan. Aplikasi menggabungkan:

1.  Editor canvas bebas untuk membuat diagram proses.
2.  Pengelolaan task yang terkait dengan node diagram.
3.  Kanban Board untuk mengelola status pekerjaan.
4.  Katalog aplikasi dan tautan yang digunakan dalam setiap proses.
5.  Dashboard untuk memantau progress, prioritas, deadline, dan
    aktivitas tim.

Gunakan dokumen ini sebagai spesifikasi produk, rancangan teknis, skema
database, alur sistem, serta checklist implementasi dan pengujian.

## 2. Ringkasan Produk

### 2.1 Masalah yang ingin diselesaikan

Tim sering memisahkan dokumentasi alur kerja, tautan aplikasi, dan
pengelolaan task ke berbagai tempat. Akibatnya, anggota tim sulit
memahami hubungan antara proses bisnis dan pekerjaan yang harus
diselesaikan.

FlowSpace menyatukan konteks tersebut dalam satu workspace.

### 2.2 Prinsip utama

**Satu sumber data, banyak tampilan.**

-   Canvas menunjukkan struktur proses secara visual.
-   Kanban menampilkan task yang sama berdasarkan status.
-   Dashboard merangkum data task yang sama.
-   Application Hub menyimpan katalog aplikasi yang dapat ditautkan ke
    banyak task.
-   Mengubah task di satu tampilan harus tercermin di tampilan lain
    setelah data berhasil disimpan dan dimuat ulang.

Jangan membuat salinan task yang terpisah hanya untuk Kanban.

### 2.3 Target pengguna

-   Admin workspace atau administrator perusahaan.
-   Project manager atau process owner.
-   Editor/anggota tim yang mengelola workflow dan task.
-   Viewer yang hanya perlu melihat proses dan progress.

### 2.4 Batasan MVP

MVP berfokus pada satu aplikasi workspace berbasis Google Apps Script
dan Google Sheets. Kolaborasi real-time tingkat lanjut, komentar
kompleks, notifikasi otomatis, integrasi API pihak ketiga, dan dukungan
multi-tenant berskala besar bukan bagian dari tahap awal.

------------------------------------------------------------------------

## 3. Teknologi dan Arsitektur

### 3.1 Stack yang digunakan

-   **Frontend:** HTML, CSS, JavaScript vanilla.
-   **Styling:** Tailwind CSS.
-   **Canvas:** library JavaScript node editor yang mendukung node,
    konektor, drag-and-drop, zoom, dan pan. Evaluasi Drawflow atau
    alternatif yang kompatibel dengan kebutuhan MVP.
-   **Backend:** Google Apps Script.
-   **Database MVP:** Google Sheets.
-   **Komunikasi frontend-backend:** `google.script.run` dengan success
    handler dan failure handler.
-   **Deployment:** Google Apps Script Web App.

Pilih versi library yang stabil dan kompatibel dengan cara deployment
yang dipilih. Jika dependensi eksternal tidak dapat dimuat secara andal
dalam deployment, bundel file library ke project sesuai lisensi dan
batas ukuran Apps Script.

### 3.2 Diagram arsitektur

``` text
Browser
  ├── HTML + Tailwind CSS
  ├── JavaScript UI
  ├── Canvas Editor
  ├── Kanban Board
  └── Dashboard
         │
         │ google.script.run
         ▼
Google Apps Script
  ├── AuthService
  ├── WorkspaceService
  ├── WorkflowService
  ├── NodeService
  ├── TaskService
  ├── ApplicationService
  ├── DashboardService
  └── AuditService
         │
         ▼
Google Sheets
  ├── Workspaces
  ├── Members
  ├── Workflows
  ├── Nodes
  ├── Edges
  ├── Tasks
  ├── Applications
  ├── TaskApplications
  ├── Checklist
  └── ActivityLogs
```

### 3.3 Prinsip arsitektur

1.  Pisahkan fungsi UI dari business logic dan operasi database.
2.  Semua validasi otorisasi harus dilakukan di server, bukan hanya
    menyembunyikan tombol di frontend.
3.  Semua entitas menggunakan ID unik, bukan nomor baris sebagai
    identitas.
4.  Gunakan operasi baca/tulis batch jika memungkinkan.
5.  Hindari membaca seluruh spreadsheet pada setiap interaksi canvas.
6.  Simpan hanya perubahan yang diperlukan.
7.  Gunakan `LockService` untuk operasi tulis yang berpotensi
    berbenturan.
8.  Gunakan timestamp ISO atau format tanggal konsisten dan tentukan
    zona waktu workspace.
9.  Tampilkan keadaan loading, sukses, dan gagal secara jelas.
10. Jangan menyatakan data tersimpan sebelum server mengonfirmasi
    keberhasilan.

------------------------------------------------------------------------

## 4. Struktur Navigasi dan Halaman

Sidebar utama:

1.  Dashboard
2.  Workflows
3.  Kanban Board
4.  Application Hub
5.  Team & Members
6.  Settings

### 4.1 Dashboard

Menampilkan: - Total task. - Task selesai. - Task yang sedang
dikerjakan. - Task overdue. - Task berdasarkan priority. - Progress
workflow. - Task Critical/High yang belum selesai. - Ringkasan pekerjaan
berdasarkan PIC.

### 4.2 Workflows

Menampilkan daftar workflow dengan: - Nama workflow. - Deskripsi. -
Jumlah task. - Progress ringkasan. - Pemilik atau pembuat. - Terakhir
diperbarui. - Tombol buka, edit nama, duplikasi, dan arsipkan.

### 4.3 Workflow Canvas

Canvas memiliki empat area utama:

-   **Toolbar atas:** nama workflow, undo/redo jika didukung, zoom,
    fit-to-screen, pencarian, indikator status penyimpanan.
-   **Panel kiri:** katalog node dan alat membuat koneksi.
-   **Area canvas:** ruang bebas untuk menempatkan dan menghubungkan
    node.
-   **Panel kanan:** detail node yang dipilih.

Fitur canvas MVP: - Tambah node. - Pilih node. - Pindahkan node. - Ubah
judul dan deskripsi. - Hapus node dengan konfirmasi. - Hubungkan node. -
Hapus koneksi. - Zoom dan pan. - Simpan dan muat posisi, ukuran, jenis,
dan koneksi node. - Tampilkan status dan priority task pada node yang
memiliki task. - Buka detail task dari node. - Tampilkan indikator
perubahan belum tersimpan. - Mencegah koneksi yang tidak valid sesuai
kemampuan library.

Jenis node: - `start_end` - `process` - `task` - `decision` -
`application` - `note`

Node selain `task` tidak wajib terhubung dengan data task. Node
`application` dapat berisi referensi aplikasi, tetapi task juga boleh
memiliki beberapa aplikasi.

### 4.4 Kanban Board

Kolom status awal: - Backlog - To Do - In Progress - Review - Done

Fitur: - Drag-and-drop kartu antar kolom. - Perubahan status tersimpan
ke backend. - Filter workflow, PIC, priority, dan deadline. - Pencarian
judul task. - Indikator overdue. - Kartu menampilkan judul, PIC,
priority, progress, deadline, dan ikon/link aplikasi jika tersedia. -
Klik kartu membuka detail task. - Tampilkan feedback saat penyimpanan
gagal dan pulihkan tampilan jika perlu.

### 4.5 Application Hub

Katalog aplikasi memiliki: - Nama aplikasi. - URL utama. - Kategori. -
Deskripsi. - Ikon opsional. - Pembuat. - Workspace pemilik.

Kategori contoh: Spreadsheet, Form, Dashboard, CRM, Internal System,
Documentation, Communication, Other.

Kategori bersifat dinamis dan dikelola per workspace dari halaman Settings
(tambah, ubah nama, hapus). Mengubah nama kategori ikut memperbarui aplikasi
terkait, sedangkan menghapus kategori memindahkan aplikasinya ke kategori lain
yang tersedia.

Satu aplikasi dapat ditautkan ke banyak task. `custom_url` pada relasi
task-aplikasi dapat mengesampingkan URL utama aplikasi untuk konteks
task tertentu.

### 4.6 Task Detail

Field: - Judul. - Deskripsi. - Workflow. - Node terkait. - PIC. -
Status. - Priority. - Progress. - Start date. - Due date. - Aplikasi
terkait. - Checklist. - Activity history.

Validasi: - Progress integer 0--100. - Status harus salah satu status
yang didukung. - Priority harus salah satu nilai yang didukung. - Due
date tidak wajib. - Email PIC harus anggota workspace atau sesuai aturan
akses yang ditetapkan. - `Done` tidak boleh secara otomatis mengubah
progress tanpa aturan yang eksplisit. Untuk MVP, saat task dipindahkan
ke Done, tanyakan atau tetapkan progress 100% dengan perilaku yang
konsisten dan terdokumentasi.

------------------------------------------------------------------------

## 5. Aturan Bisnis Utama

### 5.1 Sumber data task

Tabel `Tasks` menjadi sumber utama status, priority, PIC, progress, dan
deadline. Canvas tidak menyimpan salinan terpisah dari properti task
tersebut. `Nodes` menyimpan data visual dan relasi ke `task_id`.

### 5.2 Relasi node-task

-   Node informatif tidak perlu memiliki task.
-   Node bertipe `task` dapat memiliki satu task.
-   Untuk MVP, satu task terkait dengan satu node utama.
-   Jika task dihapus, node dapat dipertahankan sebagai node kosong atau
    ikut dihapus setelah konfirmasi. Tentukan perilaku secara konsisten;
    rekomendasi: hapus task tidak otomatis menghapus node.
-   Jika node dihapus, minta konfirmasi dan tawarkan untuk menghapus
    task terkait atau mempertahankan task tanpa node. Rekomendasi MVP:
    task tetap ada dan relasi node dihapus, kecuali pengguna secara
    eksplisit memilih menghapus task juga.

### 5.3 Progress

-   Progress disimpan sebagai integer 0--100.
-   MVP menggunakan input manual.
-   Checklist dapat ditambahkan, tetapi progress otomatis dari checklist
    hanya diaktifkan jika pengguna memilih mode otomatis.
-   Jangan menggabungkan progress manual dan otomatis secara diam-diam.
-   Progress workflow dapat dihitung dari rata-rata progress task yang
    aktif dalam workflow, dengan setiap task berbobot sama untuk MVP.
-   Task tanpa progress dianggap 0, bukan diabaikan.

### 5.4 Priority

Nilai yang diizinkan: - `Critical` - `High` - `Medium` - `Low`

### 5.5 Status

Nilai internal yang disarankan: - `backlog` - `todo` - `in_progress` -
`review` - `done`

Label UI: - Backlog - To Do - In Progress - Review - Done

### 5.6 Audit

Catat perubahan penting: - Task dibuat atau dihapus. - Status, priority,
PIC, progress, atau deadline berubah. - Workflow dibuat atau diubah. -
Node dan koneksi ditambah atau dihapus. - Link aplikasi berubah. -
Perubahan anggota dan role.

Tidak perlu mencatat setiap pergerakan mouse atau setiap frame drag.

------------------------------------------------------------------------

## 6. Skema Database Google Sheets

Buat satu spreadsheet database dengan tab berikut. Baris pertama setiap
tab adalah header tetap. Jangan mengganti urutan atau nama header tanpa
memperbarui kode yang bergantung padanya.

### 6.1 `Workspaces`

  Kolom            Tipe           Keterangan
  ---------------- -------------- ------------------
  workspace_id     string         ID unik
  workspace_name   string         Nama workspace
  owner_email      string         Email pemilik
  status           string         active/archived
  created_at       ISO datetime   Waktu dibuat
  updated_at       ISO datetime   Waktu diperbarui

### 6.2 `Members`

  Kolom           Tipe           Keterangan
  --------------- -------------- ----------------------
  member_id       string         ID unik
  workspace_id    string         Relasi ke Workspaces
  email           string         Email anggota
  display_name    string         Nama tampilan
  role            string         admin/editor/viewer
  member_status   string         active/inactive
  created_at      ISO datetime   Waktu dibuat

Buat indeks logis berdasarkan `workspace_id` dan `email`. Validasi
keunikan anggota per workspace.

### 6.3 `Workflows`

  Kolom                  Tipe           Keterangan
  ---------------------- -------------- ----------------------------------
  workflow_id            string         ID unik
  workspace_id           string         Relasi ke Workspaces
  workflow_name          string         Nama workflow
  description            string         Deskripsi
  canvas_settings_json   string         Pengaturan viewport/grid
  created_by             string         Email pembuat
  created_at             ISO datetime   Waktu dibuat
  updated_at             ISO datetime   Waktu diperbarui
  status                 string         active/archived
  version                number         Versi data untuk deteksi konflik

### 6.4 `Nodes`

  Kolom            Tipe           Keterangan
  ---------------- -------------- ------------------------------------
  node_id          string         ID unik
  workflow_id      string         Relasi ke Workflows
  node_type        string         Jenis node
  title            string         Judul node
  description      string         Deskripsi
  position_x       number         Koordinat X
  position_y       number         Koordinat Y
  width            number         Lebar
  height           number         Tinggi
  style_json       string         Gaya visual tambahan
  task_id          string         Relasi opsional ke Tasks
  application_id   string         Referensi opsional ke Applications
  created_at       ISO datetime   Waktu dibuat
  updated_at       ISO datetime   Waktu diperbarui
  version          number         Versi data

### 6.5 `Edges`

  Kolom            Tipe           Keterangan
  ---------------- -------------- -------------------------
  edge_id          string         ID unik
  workflow_id      string         Relasi ke Workflows
  source_node_id   string         Node asal
  target_node_id   string         Node tujuan
  label            string         Label koneksi
  condition        string         Kondisi cabang opsional
  created_at       ISO datetime   Waktu dibuat
  updated_at       ISO datetime   Waktu diperbarui

Validasi bahwa kedua node ada dan berasal dari workflow yang sama.

### 6.6 `Tasks`

  Kolom            Tipe           Keterangan
  ---------------- -------------- ----------------------------
  task_id          string         ID unik
  workspace_id     string         Relasi ke Workspaces
  workflow_id      string         Workflow terkait
  node_id          string         Node terkait, boleh kosong
  title            string         Judul task
  description      string         Deskripsi
  assignee_email   string         PIC, boleh kosong
  status           string         Status task
  priority         string         Priority task
  progress         number         Integer 0--100
  progress_mode    string         manual/checklist
  start_date       string         Tanggal mulai opsional
  due_date         string         Deadline opsional
  created_by       string         Email pembuat
  created_at       ISO datetime   Waktu dibuat
  updated_at       ISO datetime   Waktu diperbarui
  version          number         Versi data

### 6.7 `Applications`

  Kolom          Tipe           Keterangan
  -------------- -------------- ----------------------
  app_id         string         ID unik
  workspace_id   string         Relasi ke Workspaces
  app_name       string         Nama aplikasi
  app_url        string         URL utama
  category       string         Kategori
  description    string         Deskripsi
  icon_url       string         Opsional
  created_by     string         Email pembuat
  created_at     ISO datetime   Waktu dibuat
  updated_at     ISO datetime   Waktu diperbarui

Validasi URL dan izinkan protokol `https:` serta `http:` saja. Jangan
mengeksekusi URL sebagai kode.

### 6.8 `TaskApplications`

  Kolom         Tipe           Keterangan
  ------------- -------------- ------------------------
  task_app_id   string         ID unik
  task_id       string         Relasi ke Tasks
  app_id        string         Relasi ke Applications
  custom_url    string         URL khusus opsional
  link_label    string         Label link opsional
  created_at    ISO datetime   Waktu dibuat

Cegah relasi duplikat yang tidak disengaja.

### 6.9 `Checklist`

  Kolom          Tipe           Keterangan
  -------------- -------------- ------------------
  checklist_id   string         ID unik
  task_id        string         Relasi ke Tasks
  item_title     string         Nama item
  is_completed   boolean        Status selesai
  sort_order     number         Urutan item
  created_by     string         Email pembuat
  created_at     ISO datetime   Waktu dibuat
  updated_at     ISO datetime   Waktu diperbarui

### 6.10 `ActivityLogs`

  Kolom            Tipe           Keterangan
  ---------------- -------------- --------------------------------------------
  log_id           string         ID unik
  workspace_id     string         Relasi ke Workspaces
  entity_type      string         task/workflow/node/edge/application/member
  entity_id        string         ID entitas
  action           string         Jenis perubahan
  actor_email      string         Pelaku
  old_value_json   string         Nilai sebelumnya, jika relevan
  new_value_json   string         Nilai baru, jika relevan
  created_at       ISO datetime   Waktu perubahan

### 6.11 Strategi ID dan konsistensi

-   Buat ID UUID atau ID unik lain yang tidak bergantung pada nomor
    baris.
-   Semua operasi update/delete mencari baris berdasarkan ID.
-   Gunakan `LockService` untuk operasi tulis penting.
-   Gunakan kolom `version` untuk mendeteksi perubahan yang terjadi
    setelah data terakhir dibaca.
-   Jika versi data berbeda, jangan menimpa perubahan secara diam-diam.
    Berikan pesan konflik dan minta pengguna memuat ulang atau
    menggabungkan perubahan.
-   Jangan mengandalkan formula spreadsheet sebagai satu-satunya tempat
    business logic berada.
-   Gunakan `PropertiesService` hanya untuk konfigurasi kecil, bukan
    untuk menggantikan database utama.

------------------------------------------------------------------------

## 7. Struktur File Apps Script

Struktur file yang disarankan:

``` text
Code.gs
Config.gs
AuthService.gs
WorkspaceService.gs
WorkflowService.gs
NodeService.gs
EdgeService.gs
TaskService.gs
ApplicationService.gs
ChecklistService.gs
DashboardService.gs
AuditService.gs
DatabaseService.gs
Index.html
Styles.html
Scripts.html
Canvas.html
Kanban.html
Dashboard.html
Components.html
```

### Tanggung jawab file

-   `Code.gs`: `doGet()`, routing halaman jika dibutuhkan, dan fungsi
    entry point.
-   `Config.gs`: nama tab, konstanta status, priority, dan konfigurasi
    aplikasi.
-   `AuthService.gs`: identitas pengguna dan otorisasi workspace.
-   `DatabaseService.gs`: membaca header, mencari ID, batch read/write,
    dan utilitas database.
-   `WorkspaceService.gs`: workspace dan anggota.
-   `WorkflowService.gs`: CRUD workflow dan pengaturan canvas.
-   `NodeService.gs`: CRUD node dan posisi node.
-   `EdgeService.gs`: CRUD koneksi.
-   `TaskService.gs`: CRUD task, status, priority, progress, dan filter.
-   `ApplicationService.gs`: katalog aplikasi dan relasi task-aplikasi.
-   `ChecklistService.gs`: checklist.
-   `DashboardService.gs`: agregasi statistik.
-   `AuditService.gs`: activity logs.
-   File HTML: markup, styling, dan UI per modul.

Gunakan satu fungsi publik server untuk setiap operasi bisnis yang
diperlukan. Hindari membuat fungsi generik yang menerima nama sheet
bebas dari browser.

------------------------------------------------------------------------

## 8. Kontrak Fungsi Frontend--Backend

Gunakan `google.script.run` secara asynchronous dengan success handler
dan failure handler.

Contoh nama fungsi server:

``` text
getInitialAppData()
listWorkflows(workspaceId)
createWorkflow(payload)
updateWorkflow(payload)
archiveWorkflow(workflowId, workspaceId)

getWorkflowCanvas(workflowId)
createNode(payload)
updateNode(payload)
deleteNode(payload)
saveCanvasLayout(payload)

createEdge(payload)
deleteEdge(edgeId, workflowId)

listTasks(filters)
getTask(taskId)
createTask(payload)
updateTask(payload)
updateTaskStatus(taskId, status, expectedVersion)
updateTaskProgress(taskId, progress, expectedVersion)
deleteTask(taskId)

listApplications(workspaceId)
createApplication(payload)
updateApplication(payload)
deleteApplication(appId)

linkApplicationToTask(payload)
unlinkApplicationFromTask(taskAppId)

listChecklist(taskId)
createChecklistItem(payload)
updateChecklistItem(payload)
deleteChecklistItem(checklistId)

getDashboardData(filters)
listActivityLogs(filters)
```

### Format respons

Gunakan format respons konsisten, misalnya:

``` json
{
  "success": true,
  "data": {},
  "message": "Data berhasil disimpan",
  "errorCode": null
}
```

Untuk error:

``` json
{
  "success": false,
  "data": null,
  "message": "Data berubah sejak terakhir dimuat. Muat ulang sebelum menyimpan.",
  "errorCode": "VERSION_CONFLICT"
}
```

Jangan mengirim stack trace internal, token, atau informasi sensitif ke
browser.

### Aturan komunikasi

-   Setiap fungsi server memvalidasi input.
-   Fungsi server memverifikasi pengguna dan workspace.
-   Frontend menonaktifkan tombol ketika request penting sedang
    diproses.
-   Tampilkan error yang dapat dipahami pengguna.
-   Setelah operasi sukses, perbarui state lokal atau muat ulang data
    terkait.
-   Jangan mengirim seluruh canvas pada setiap perubahan posisi jika
    bisa mengirim perubahan node secara batch.
-   Saat menyimpan seluruh layout, sertakan workflow ID dan versi yang
    diharapkan.

------------------------------------------------------------------------

## 9. Alur Penggunaan

### 9.1 Membuat workflow

1.  Pengguna membuka Workflows.
2.  Pengguna memilih Buat Workflow.
3.  Frontend mengirim nama dan deskripsi ke backend.
4.  Backend memverifikasi akses, membuat ID, menyimpan record, dan
    mengembalikan hasil.
5.  Pengguna diarahkan ke canvas workflow baru.

### 9.2 Membuat node dan koneksi

1.  Pengguna memilih jenis node dari panel kiri.
2.  Node muncul di canvas.
3.  Pengguna mengedit judul dan deskripsi.
4.  Perubahan disimpan melalui backend.
5.  Pengguna menghubungkan node satu dengan lainnya.
6.  Backend memvalidasi bahwa node berasal dari workflow yang sama.
7.  Canvas menampilkan indikator tersimpan setelah server mengonfirmasi.

### 9.3 Mengubah node menjadi task

1.  Pengguna memilih node Task atau memilih opsi Buat Task.
2.  Pengguna mengisi judul, PIC, priority, status, progress, dan
    deadline.
3.  Backend membuat task serta mengaitkannya dengan node.
4.  Task tampil di Kanban.
5.  Dashboard menghitung ulang statistik saat data diperbarui.

### 9.4 Mengelola Kanban

1.  Pengguna membuka Kanban Board.
2.  Frontend meminta task berdasarkan filter.
3.  Pengguna memindahkan kartu.
4.  Frontend memperlihatkan perubahan sementara.
5.  Backend memvalidasi status, akses, dan versi data.
6.  Jika berhasil, status dikonfirmasi dan aktivitas dicatat.
7.  Jika gagal, UI mengembalikan kartu ke status sebelumnya serta
    menampilkan pesan error.

### 9.5 Menambahkan aplikasi ke task

1.  Admin atau editor mendaftarkan aplikasi di Application Hub.
2.  Pengguna memilih task.
3.  Pengguna memilih satu atau beberapa aplikasi.
4.  Pengguna dapat memasukkan custom URL.
5.  Backend menyimpan relasi TaskApplications.
6.  Link ditampilkan di panel detail task dan node terkait.

------------------------------------------------------------------------

## 10. Keamanan dan Hak Akses

### 10.1 Role MVP

  Aksi                         Admin             Editor   Viewer
  -------------------------- ------- ------------------ --------
  Melihat workflow                Ya                 Ya       Ya
  Membuat workflow                Ya                 Ya    Tidak
  Mengubah canvas                 Ya                 Ya    Tidak
  Membuat/mengubah task           Ya                 Ya    Tidak
  Mengubah Application Hub        Ya   Sesuai kebijakan    Tidak
  Mengelola anggota               Ya              Tidak    Tidak
  Mengarsipkan workflow           Ya   Sesuai kebijakan    Tidak

### 10.2 Persyaratan keamanan

-   Pilih model deployment Apps Script dengan memahami identitas
    eksekusi dan siapa yang boleh mengakses web app.
-   Verifikasi identitas dan role pada setiap fungsi server yang membaca
    atau mengubah data.
-   Jangan menganggap email pengguna selalu tersedia; konfigurasi
    deployment dan jenis akun dapat memengaruhi identitas yang dapat
    diperoleh.
-   Jangan mengandalkan email yang dikirim frontend sebagai bukti
    identitas.
-   Batasi semua query berdasarkan workspace.
-   Validasi URL aplikasi.
-   Escape konten pengguna ketika ditampilkan sebagai HTML.
-   Jangan memasukkan data sensitif ke log.
-   Lindungi operasi tulis dengan validasi dan lock.
-   Uji akses menggunakan akun Admin, Editor, Viewer, dan pengguna yang
    tidak terdaftar.
-   Jangan deploy untuk penggunaan perusahaan sebelum model otorisasi
    diuji secara nyata.

### 10.3 Catatan skala

Google Sheets cocok untuk MVP dan volume moderat, tetapi tidak ideal
untuk banyak penulis bersamaan, kebutuhan real-time, atau volume data
besar. Gunakan batch operations dan minimalkan request. Siapkan lapisan
service agar database dapat diganti di masa depan tanpa merombak seluruh
UI.

------------------------------------------------------------------------

## 11. Desain UI dan UX

### 11.1 Gaya visual

-   Bersih, modern, profesional, dan berorientasi produktivitas.
-   Sidebar tetap di desktop dan dapat diringkas di layar kecil.
-   Gunakan hierarchy tipografi yang jelas.
-   Gunakan warna netral untuk permukaan utama.
-   Gunakan warna status dan priority secara konsisten.
-   Hindari membuat canvas terlalu ramai.
-   Berikan ruang yang cukup untuk node dan konektor.
-   Gunakan panel detail di sisi kanan agar pengguna tidak kehilangan
    konteks.

### 11.2 Responsif

-   Desktop menjadi target utama karena canvas memerlukan ruang luas.
-   Tablet dapat menggunakan sidebar yang dapat diringkas.
-   Mobile harus mendukung melihat workflow, membuka detail node,
    memperbarui task, dan menggunakan Kanban sederhana.
-   Editing canvas penuh pada layar kecil boleh dibatasi jika
    interaksinya tidak nyaman, tetapi berikan pesan yang jelas.

### 11.3 States yang harus tersedia

-   Loading.
-   Empty state.
-   Saving.
-   Saved.
-   Save failed.
-   Permission denied.
-   Not found.
-   Version conflict.
-   Network/Apps Script request failed.
-   Confirmation sebelum operasi destruktif.

### 11.4 Aksesibilitas

-   Semua tombol mempunyai label.
-   Kontras teks memadai.
-   Status tidak hanya dibedakan dengan warna; sertakan label teks.
-   Kontrol utama dapat diakses dengan keyboard jika didukung komponen.
-   Berikan konfirmasi sebelum menghapus node, task, workflow, atau
    aplikasi yang masih digunakan.

------------------------------------------------------------------------

## 12. Rencana Implementasi MVP

### Tahap 1 --- Fondasi

Hasil yang diharapkan: - Project Apps Script berjalan. - Spreadsheet dan
tab database dapat dibuat. - Layout aplikasi, sidebar, header, dan
routing halaman tersedia. - Fungsi dasar workspace dan workflow
tersedia. - Error handling awal diterapkan.

Checklist: - \[ \] Konfigurasi dan konstanta. - \[ \] Inisialisasi tab
dan header. - \[ \] DatabaseService. - \[ \] AuthService dan aturan
akses. - \[ \] Layout Tailwind. - \[ \] CRUD workflow. - \[ \] Loading,
error, dan empty state.

### Tahap 2 --- Canvas

Hasil yang diharapkan: - Pengguna dapat membuat diagram dan memuatnya
kembali. - Node dan koneksi tersimpan dengan stabil.

Checklist: - \[ \] Integrasi library canvas. - \[ \] Tambah, pilih,
edit, pindah, dan hapus node. - \[ \] Jenis node dasar. - \[ \] Tambah
dan hapus edge. - \[ \] Simpan posisi dan ukuran. - \[ \] Simpan
viewport/zoom jika didukung. - \[ \] Panel detail node. - \[ \]
Indikator save. - \[ \] Deteksi konflik versi.

### Tahap 3 --- Task dan Kanban

Hasil yang diharapkan: - Task dapat dikelola dan disinkronkan dengan
node. - Kanban menjadi tampilan alternatif dari task yang sama.

Checklist: - \[ \] CRUD task. - \[ \] Status dan priority. - \[ \] PIC
dan deadline. - \[ \] Progress manual. - \[ \] Kanban drag-and-drop. -
\[ \] Sinkronisasi status Canvas/Kanban. - \[ \] Filter dan pencarian. -
\[ \] Penanganan kegagalan saat mengubah status.

### Tahap 4 --- Application Hub dan Dashboard

Hasil yang diharapkan: - Link aplikasi terhubung ke task. - Dashboard
menampilkan agregasi yang benar.

Checklist: - \[ \] CRUD aplikasi. - \[ \] Relasi task-aplikasi. - \[ \]
Custom URL. - \[ \] Checklist task. - \[ \] Statistik task dan
progress. - \[ \] Filter dashboard. - \[ \] ActivityLogs. - \[ \]
Overdue dan priority tinggi.

### Tahap 5 --- Stabilitas dan deployment

Checklist: - \[ \] Pengujian role. - \[ \] Pengujian akses lintas
workspace. - \[ \] Pengujian dua pengguna mengedit data bersamaan. - \[
\] Pengujian refresh/reopen. - \[ \] Pengujian error server. - \[ \]
Pengujian volume data moderat. - \[ \] Pemeriksaan kuota Apps Script. -
\[ \] Dokumentasi deployment dan backup spreadsheet. - \[ \] UAT dengan
pengguna perusahaan.

------------------------------------------------------------------------

## 13. Acceptance Criteria

MVP dapat dinyatakan siap untuk uji coba jika seluruh kriteria penting
berikut lulus:

1.  Pengguna yang berwenang dapat membuat workflow dan membukanya
    kembali setelah refresh.
2.  Node dapat ditambah, dipindah, diedit, dihapus, dan dihubungkan.
3.  Posisi dan koneksi tetap konsisten setelah data dimuat ulang.
4.  Task yang terhubung ke node muncul satu kali di Kanban.
5.  Perubahan status di Kanban terlihat saat Canvas memuat data terbaru.
6.  Perubahan priority dan progress konsisten di semua tampilan.
7.  Link aplikasi dapat dibuka dari detail task.
8.  Task dapat difilter berdasarkan PIC, status, priority, workflow, dan
    deadline.
9.  Viewer tidak dapat mengubah data dengan memanggil fungsi server
    secara langsung.
10. Pengguna dari workspace lain tidak dapat membaca atau mengubah data
    yang bukan haknya.
11. Konflik versi tidak menimpa data terbaru secara diam-diam.
12. Kegagalan penyimpanan menghasilkan pesan yang jelas.
13. Dashboard menghitung task dan progress secara konsisten.
14. Activity log mencatat perubahan penting.
15. Backup dan prosedur pemulihan data terdokumentasi.

------------------------------------------------------------------------

## 14. Risiko dan Mitigasi

  -----------------------------------------------------------------------
  Risiko                              Mitigasi
  ----------------------------------- -----------------------------------
  Kuota Apps Script                   Batch read/write, cache terkontrol,
                                      minimalkan request

  Bentrok edit                        LockService, version check, konflik
                                      eksplisit

  Data ganda                          ID unik, validasi relasi, satu
                                      sumber data task

  Salah akses data                    Server-side authorization dan
                                      pembatasan workspace

  Canvas terlalu sering menyimpan     Debounce/autosave terkontrol dan
                                      batch update

  Library canvas tidak cocok          Uji proof-of-concept sebelum
                                      membangun fitur lengkap

  URL tidak aman                      Validasi protokol dan tampilkan
                                      link sebagai link, bukan kode

  Spreadsheet rusak/terhapus          Backup berkala dan dokumentasi
                                      pemulihan

  Skala melebihi Sheets               Pisahkan repository/data layer agar
                                      mudah migrasi
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 15. Prompt Utama untuk AI Coding Assistant

Gunakan prompt berikut sebagai instruksi pembangunan aplikasi.
Implementasikan secara bertahap dan jangan melewati pengujian tahap
sebelumnya.

> **Peran:** Anda adalah senior full-stack developer yang ahli Google
> Apps Script, Google Sheets, JavaScript, Tailwind CSS, dan visual
> workflow editors.
>
> **Tugas:** Bangun aplikasi web bernama FlowSpace berdasarkan
> spesifikasi dalam dokumen ini. Aplikasi adalah hybrid workflow canvas
> dan Kanban untuk tim/perusahaan.
>
> **Stack wajib:** Google Apps Script sebagai backend, Google Sheets
> sebagai database MVP, HTML, Tailwind CSS, JavaScript vanilla, dan
> library canvas JavaScript yang mendukung node serta konektor.
>
> **Fitur wajib MVP:** 1. Workspace dan role dasar. 2. CRUD workflow. 3.
> Canvas bebas dengan node, konektor, drag-and-drop, zoom, dan pan. 4.
> Penyimpanan dan pemuatan diagram dari Google Sheets. 5. Task yang
> terhubung ke node. 6. Status, priority, PIC, deadline, dan progress.
> 7. Kanban drag-and-drop yang memakai sumber data task yang sama. 8.
> Application Hub dan relasi aplikasi dengan task. 9. Dashboard progress
> dasar. 10. Activity log perubahan penting.
>
> **Aturan arsitektur:** - Pisahkan UI, service, dan database layer. -
> Gunakan ID unik dan relasi berdasarkan ID. - Jadikan tabel Tasks
> sebagai sumber utama status dan progress. - Jangan menggandakan task
> untuk tampilan Kanban. - Validasi input dan otorisasi pada setiap
> fungsi server. - Batasi akses berdasarkan workspace. - Gunakan operasi
> batch, LockService, dan version check sesuai kebutuhan. - Gunakan
> `google.script.run` secara asynchronous dengan success dan failure
> handlers. - Tampilkan loading, saved, failed, permission denied, dan
> version conflict states. - Jangan mengklaim data berhasil disimpan
> sebelum server mengonfirmasi. - Jangan menaruh rahasia atau token di
> frontend.
>
> **Cara kerja pembangunan:** 1. Baca dan rangkum kebutuhan. 2. Ajukan
> pertanyaan hanya jika ada keputusan penting yang benar-benar
> menghalangi implementasi. 3. Buat struktur database dan inisialisasi
> spreadsheet. 4. Implementasikan fondasi aplikasi. 5. Uji CRUD
> workflow. 6. Implementasikan canvas dan uji save/load. 7.
> Implementasikan task dan Kanban. 8. Implementasikan Application Hub,
> dashboard, dan activity log. 9. Uji otorisasi, konflik edit, dan error
> handling. 10. Dokumentasikan cara setup, konfigurasi ID spreadsheet,
> deployment, pengujian, dan backup.
>
> Kerjakan per tahap. Pada setiap tahap, berikan daftar file yang
> dibuat/diubah, kode lengkap yang dapat dipasang, langkah deployment,
> dan checklist uji. Jangan hanya memberikan mockup atau pseudocode
> untuk fitur yang diminta berfungsi. Jika terdapat batasan Apps Script
> atau library, jelaskan dan berikan alternatif yang sesuai sebelum
> membuat asumsi yang berdampak besar.

------------------------------------------------------------------------

## 16. Keputusan yang Perlu Dikonfirmasi Sebelum Coding

Untuk mengurangi perubahan arsitektur di tengah pengerjaan, tentukan
keputusan ini sebelum tahap implementasi penuh:

1.  **Akses pengguna:** apakah semua pengguna memakai akun Google
    Workspace perusahaan, atau ada pengguna Gmail pribadi juga?
2.  **Model workspace:** apakah MVP hanya untuk satu
    perusahaan/workspace, atau perlu banyak perusahaan sejak awal?
3.  **Penyimpanan:** apakah satu spreadsheet database akan dikelola oleh
    admin/pemilik aplikasi?
4.  **Progress:** apakah progress selalu manual pada MVP, atau otomatis
    dari checklist?
5.  **Canvas:** apakah perlu undo/redo dan minimap pada MVP, atau dapat
    ditunda setelah fungsi dasar stabil?

Rekomendasi awal: satu perusahaan/workspace, akun Google yang dapat
diverifikasi, satu spreadsheet database milik admin, progress manual,
dan canvas dasar terlebih dahulu. Pastikan model akses Apps Script diuji
sebelum digunakan dengan data perusahaan yang sensitif.

------------------------------------------------------------------------

## 17. Referensi Teknis

Periksa dokumentasi resmi terbaru saat implementasi karena batas kuota
dan perilaku deployment dapat berubah:

-   Google Apps Script Web Apps:
    https://developers.google.com/apps-script/guides/web
-   Komunikasi HTML Service dengan server:
    https://developers.google.com/apps-script/guides/html/communication
-   Google Apps Script Quotas:
    https://developers.google.com/apps-script/guides/services/quotas
-   Google Apps Script Lock Service:
    https://developers.google.com/apps-script/reference/lock/lock-service
-   Google Apps Script Properties Service:
    https://developers.google.com/apps-script/reference/properties/properties-service
-   Tailwind CSS: https://tailwindcss.com/docs
-   Drawflow: https://github.com/jerosoler/Drawflow

------------------------------------------------------------------------

## 18. Definisi Selesai

MVP FlowSpace dianggap selesai untuk uji coba internal ketika:

-   Canvas dapat menyimpan dan memuat diagram secara konsisten.
-   Task yang terkait node dapat dikelola dari Canvas maupun Kanban.
-   Link aplikasi dapat dibuka dari task.
-   Dashboard menampilkan ringkasan yang sesuai dengan data.
-   Akses workspace dan role telah diuji.
-   Kesalahan penyimpanan dan konflik edit ditangani secara jelas.
-   Ada panduan setup, deployment, backup, dan pemulihan.

**Prioritas produk:** bangun alur inti yang stabil terlebih dahulu ---
*Workflow → Node/Task → Kanban → Application Link → Dashboard* ---
sebelum menambahkan fitur kolaborasi tingkat lanjut.
