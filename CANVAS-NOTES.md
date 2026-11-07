# Catatan Canvas (backup sebelum perbaikan 2026-11-06)

Dibuat sebelum pengerjaan:
1. Titik tekuk (reroute) harus tersimpan dengan baik.
2. Node baru bisa ditempatkan lewat drag-and-drop (bukan selalu di titik yang sama).
3. Perbaikan bug drag/pan canvas.
4. Backup + catatan commit sebelum edit & deploy.

## Titik balik (backup)

- Git tag: `backup-canvas-pre-improve-20261106`
- Git branch: `backup/canvas-pre-improve-20261106`
- Commit saat backup: `2cba5e6`

Untuk kembali ke kondisi sebelum perubahan:

```powershell
git checkout backup/canvas-pre-improve-20261106
# atau
git reset --hard backup-canvas-pre-improve-20261106
```

## Commit terkait canvas (riwayat terakhir)

| Commit | Isi |
| --- | --- |
| `2cba5e6` | Tandai dirty saat edit reroute point (Drawflow tidak emit event) |
| `b402537` | Klik luar node -> panel workflow; simpan & restore titik tekuk |
| `0fb0525` | Fix klik node tidak membuka detail (race nodeUnselected/panel workflow) |
| `c2126aa` | Empty states, panel kosong, tooltip ikon |
| `d6aaab3` | Modal detail workflow + tautan aplikasi ke workflow/node |
| `50ed248`, `361801e` | Eksperimen performa — **sudah di-revert**, jangan dipakai lagi tanpa persetujuan |

## Catatan teknis

- Titik tekuk Drawflow 0.0.59 disimpan di
  `node.outputs[outKey].connections[].points` (array `{pos_x, pos_y}`), lalu
  dipetakan ke kolom `edges.points_json`.
- Drawflow 0.0.59 **tidak punya** `clearModule()`; dipakai fallback
  `clearCanvasModule(editor)`.
- Drawflow tidak memancarkan event saat reroute dibuat/digeser, jadi dirty
  marking dilakukan manual pada interaksi `.point` / `.main-path`.
- Posisi node baru sebelumnya memakai `100 + Math.random()*200` sehingga
  selalu menumpuk di area kiri-atas.
- Deploy hosting dijalankan dari folder `web/`:
  `firebase deploy --only hosting --project javina-project`.

## Perubahan setelah backup (2026-11-06)

1. **Titik tekuk (reroute) disimpan & dipulihkan**
   - `saveCanvasLayout` menulis `edges.points_json`; `getWorkflowCanvas`
     mengembalikannya sebagai `points`.
   - Saat canvas dimuat, path tambahan + circle titik tekuk dibuat ulang
     dengan urutan yang sama seperti `addRerouteImport` Drawflow, lalu
     `updateConnectionNodes` menggambar ulang kurva.
   - Event `addReroute` / `removeReroute` / `rerouteMoved` menandai canvas
     dirty; snapshot undo diambil sebelum perubahan.
2. **Penempatan node**
   - Klik palette: node muncul di tengah viewport (dengan pergeseran
     bertahap), bukan di koordinat acak area kiri-atas.
   - Drag-and-drop: tarik tombol palette ke canvas, node diletakkan di
     titik lepas (koordinat dikonversi memakai zoom & posisi precanvas).
3. **Bug drag/pan**
   - `mouseup`/`pointerup`/`touchend` di level window memanggil `dragEnd`
     bila state drag Drawflow masih aktif, sehingga melepas mouse di luar
     canvas tidak membuat canvas ikut bergeser.
   - Klik hasil pan (gerakan > 4px) tidak dianggap klik kosong, jadi panel
     kanan tidak ter-reset saat menggeser canvas.
4. **Tes**: `tests/canvas-test.js` (klik palette, drag-and-drop, pan lepas
   di luar canvas, simpan & pulihkan titik tekuk).
5. **Pan berhenti setelah canvas digeser** (perbaikan lanjutan)
   - Penyebab: Drawflow memilih mode drag dari **class pertama** elemen yang
     di-mousedown. Container `#drawflow` memakai `class="h-full w-full"`,
     sehingga `parent-drawflow` (ditambahkan Drawflow) berada di urutan
     terakhir dan klik pada area container yang tidak tertutup precanvas
     tidak memulai pan.
   - Precanvas yang di-translate/scale tidak menutupi seluruh container;
     area kosong itu makin lebar setiap kali canvas digeser, jadi pan terasa
     "mati" setelah beberapa kali drag. `AbortError` WebChannel di console
     tidak berhubungan (kebetulan muncul bersamaan).
   - Perbaikan: `parent-drawflow` dijadikan class pertama pada markup
     `#drawflow` + guard urutan class setelah `editor.start()`.
   - Tes tambahan: pan dari titik di luar precanvas, dan pan berulang dari
     titik yang sama.
6. **Aplikasi langsung pada node (tanpa lewat task)**
   - Panel detail node punya bagian "Aplikasi terkait" yang menampilkan
     tautan langsung node → Application Hub (badge `Node`) dan aplikasi yang
     menempel lewat task (badge `Task`).
   - Tombol "Tautkan aplikasi ke node ini" / "Tambah aplikasi baru &
     tautkan" membuka dialog yang sudah ada dengan target node terpilih.
   - Data tetap di `workflows.app_links_json` (`target_type = 'node'`,
     `target_node_id`), jadi tidak ada koleksi/kuota baru dan tautan yang
     sama juga tampil di modal detail workflow.
   - Tautan bisa dilepas dari panel node; node yang baru dibuat disimpan
     dulu (autosave) sebelum aplikasi bisa ditautkan.


