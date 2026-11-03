/**
 * FlowSpace - CategoryService.gs
 * Pengelolaan kategori aplikasi (Application Hub) per workspace.
 * Kategori disimpan di sheet AppCategories agar bisa diatur dari Settings.
 */

var CategoryService = {
  /**
   * Pastikan workspace punya daftar kategori.
   * Jika belum ada (mis. workspace lama sebelum fitur ini), seed dari
   * kategori bawaan + kategori yang sudah dipakai aplikasi yang ada.
   */
  _ensureCategories: function (workspaceId) {
    var existing = DatabaseService.findBy(CONFIG.SHEETS.APP_CATEGORIES, 'workspace_id', workspaceId);
    if (existing.length > 0) return existing;

    // Pastikan sheet AppCategories ada (untuk deployment lama yang belum re-run setup)
    DatabaseService.ensureSheets();

    existing = DatabaseService.findBy(CONFIG.SHEETS.APP_CATEGORIES, 'workspace_id', workspaceId);
    if (existing.length > 0) return existing;

    // Susun nama: default + kategori yang sudah dipakai aplikasi + pastikan "Other"
    var names = CONFIG.DEFAULT_APP_CATEGORIES.slice();
    var apps = DatabaseService.findBy(CONFIG.SHEETS.APPLICATIONS, 'workspace_id', workspaceId);
    apps.forEach(function (a) {
      if (a.category && names.indexOf(a.category) === -1) names.push(a.category);
    });
    if (names.indexOf('Other') === -1) names.push('Other');

    var now = nowIso();
    var rows = names.map(function (name, i) {
      return {
        category_id: generateId('cat'),
        workspace_id: workspaceId,
        category_name: name,
        sort_order: i,
        created_at: now,
        updated_at: now,
      };
    });
    DatabaseService.batchInsert(CONFIG.SHEETS.APP_CATEGORIES, rows);
    return DatabaseService.findBy(CONFIG.SHEETS.APP_CATEGORIES, 'workspace_id', workspaceId);
  },

  /** List kategori aplikasi workspace (urut sort_order lalu nama) */
  listCategories: function () {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiSuccess([]);
    var cats = this._ensureCategories(ctx.workspace.workspace_id);
    var result = cats.map(function (c) {
      return {
        id: c.category_id,
        name: c.category_name,
        sortOrder: Number(c.sort_order) || 0,
      };
    });
    result.sort(function (a, b) {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return apiSuccess(result);
  },

  /** Buat kategori baru */
  createCategory: function (payload) {
    var ctx = AuthService.requireEditor();
    var name = String(payload && payload.name ? payload.name : '').trim();
    if (!name) return apiError('Nama kategori wajib diisi', 'VALIDATION');

    var existing = this._ensureCategories(ctx.workspace.workspace_id);
    var duplicate = existing.some(function (c) {
      return String(c.category_name).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return apiError('Nama kategori sudah ada', 'DUPLICATE');

    var maxSort = -1;
    existing.forEach(function (c) {
      var n = Number(c.sort_order);
      if (!isNaN(n) && n > maxSort) maxSort = n;
    });

    var id = generateId('cat');
    var now = nowIso();
    DatabaseService.insert(CONFIG.SHEETS.APP_CATEGORIES, {
      category_id: id,
      workspace_id: ctx.workspace.workspace_id,
      category_name: name,
      sort_order: maxSort + 1,
      created_at: now,
      updated_at: now,
    });
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'app_category',
      entity_id: id,
      action: 'create',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ name: name }),
    });
    return apiSuccess({ id: id, name: name }, 'Kategori dibuat');
  },

  /** Ubah nama kategori (sekaligus rename kategori pada aplikasi terkait) */
  updateCategory: function (payload) {
    var ctx = AuthService.requireEditor();
    var id = payload && payload.id;
    if (!id) return apiError('ID kategori wajib diisi', 'VALIDATION');

    var cat = DatabaseService.findById(CONFIG.SHEETS.APP_CATEGORIES, 'category_id', id);
    if (!cat || String(cat.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Kategori tidak ditemukan', 'NOT_FOUND');
    }

    var newName = String(payload.name !== undefined ? payload.name : cat.category_name).trim();
    if (!newName) return apiError('Nama kategori wajib diisi', 'VALIDATION');

    var all = this._ensureCategories(ctx.workspace.workspace_id);
    var duplicate = all.some(function (c) {
      return String(c.category_id) !== String(id) &&
        String(c.category_name).toLowerCase() === newName.toLowerCase();
    });
    if (duplicate) return apiError('Nama kategori sudah ada', 'DUPLICATE');

    var oldName = cat.category_name;
    var patch = { category_name: newName, updated_at: nowIso() };
    if (payload.sortOrder !== undefined && !isNaN(Number(payload.sortOrder))) {
      patch.sort_order = Number(payload.sortOrder);
    }
    DatabaseService.update(CONFIG.SHEETS.APP_CATEGORIES, 'category_id', id, patch);

    // Cascade rename ke aplikasi yang memakai nama lama
    var updatedApps = 0;
    if (String(oldName) !== String(newName)) {
      var apps = DatabaseService.findBy(CONFIG.SHEETS.APPLICATIONS, 'workspace_id', ctx.workspace.workspace_id);
      apps.forEach(function (a) {
        if (String(a.category) === String(oldName)) {
          DatabaseService.update(CONFIG.SHEETS.APPLICATIONS, 'app_id', a.app_id, {
            category: newName,
            updated_at: nowIso(),
          });
          updatedApps++;
        }
      });
    }

    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'app_category',
      entity_id: id,
      action: 'update',
      actor_email: ctx.email,
      old_value_json: JSON.stringify({ name: oldName }),
      new_value_json: JSON.stringify({ name: newName, updatedApps: updatedApps }),
    });
    return apiSuccess({ id: id, name: newName }, 'Kategori diperbarui');
  },

  /** Hapus kategori; aplikasi terkait dipindah ke "Other" */
  deleteCategory: function (categoryId) {
    var ctx = AuthService.requireEditor();
    var cat = DatabaseService.findById(CONFIG.SHEETS.APP_CATEGORIES, 'category_id', categoryId);
    if (!cat || String(cat.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Kategori tidak ditemukan', 'NOT_FOUND');
    }

    var all = this._ensureCategories(ctx.workspace.workspace_id);
    if (all.length <= 1) {
      return apiError('Minimal harus ada satu kategori', 'VALIDATION');
    }

    var remaining = all.filter(function (c) {
      return String(c.category_id) !== String(categoryId);
    });

    // Tentukan kategori fallback
    var fallback = 'Other';
    var hasOther = remaining.some(function (c) { return String(c.category_name) === 'Other'; });
    if (!hasOther) {
      if (String(cat.category_name) === 'Other') {
        // Jika yang dihapus "Other", pakai kategori lain yang tersisa
        fallback = remaining[0].category_name;
      } else {
        // Buat "Other" agar tetap ada fallback
        var maxSort = -1;
        all.forEach(function (c) {
          var n = Number(c.sort_order);
          if (!isNaN(n) && n > maxSort) maxSort = n;
        });
        var now = nowIso();
        DatabaseService.insert(CONFIG.SHEETS.APP_CATEGORIES, {
          category_id: generateId('cat'),
          workspace_id: ctx.workspace.workspace_id,
          category_name: 'Other',
          sort_order: maxSort + 1,
          created_at: now,
          updated_at: now,
        });
        fallback = 'Other';
      }
    }

    // Pindahkan aplikasi yang memakai kategori ini
    var movedApps = 0;
    var apps = DatabaseService.findBy(CONFIG.SHEETS.APPLICATIONS, 'workspace_id', ctx.workspace.workspace_id);
    apps.forEach(function (a) {
      if (String(a.category) === String(cat.category_name)) {
        DatabaseService.update(CONFIG.SHEETS.APPLICATIONS, 'app_id', a.app_id, {
          category: fallback,
          updated_at: nowIso(),
        });
        movedApps++;
      }
    });

    DatabaseService.remove(CONFIG.SHEETS.APP_CATEGORIES, 'category_id', categoryId);

    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'app_category',
      entity_id: categoryId,
      action: 'delete',
      actor_email: ctx.email,
      old_value_json: JSON.stringify({ name: cat.category_name, movedApps: movedApps, fallback: fallback }),
    });
    return apiSuccess({ movedApps: movedApps, fallback: fallback }, 'Kategori dihapus');
  },
};
