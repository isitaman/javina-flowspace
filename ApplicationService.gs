/**
 * FlowSpace - ApplicationService.gs
 * Katalog aplikasi dan relasi task-aplikasi.
 */

var ApplicationService = {
  /** List aplikasi di workspace */
  listApplications: function () {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiSuccess([]);
    var apps = DatabaseService.findBy(CONFIG.SHEETS.APPLICATIONS, 'workspace_id', ctx.workspace.workspace_id);
    var taskApps = DatabaseService.readAll(CONFIG.SHEETS.TASK_APPLICATIONS);
    var result = apps.map(function (a) {
      var count = taskApps.filter(function (ta) { return String(ta.app_id) === String(a.app_id); }).length;
      return {
        id: a.app_id,
        name: a.app_name,
        url: a.app_url,
        category: a.category,
        description: a.description,
        iconUrl: a.icon_url,
        createdBy: a.created_by,
        createdAt: String(a.created_at),
        updatedAt: String(a.updated_at),
        taskCount: count,
      };
    });
    // Sort by name
    result.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return apiSuccess(result);
  },

  /** Buat aplikasi baru */
  createApplication: function (payload) {
    var ctx = AuthService.requireEditor();
    if (!payload.name || !payload.url) {
      return apiError('Nama dan URL wajib diisi', 'VALIDATION');
    }
    if (!isValidUrl(payload.url)) {
      return apiError('URL tidak valid (hanya http/https)', 'VALIDATION');
    }
    var id = generateId('app');
    var now = nowIso();
    var data = {
      app_id: id,
      workspace_id: ctx.workspace.workspace_id,
      app_name: payload.name,
      app_url: payload.url,
      category: payload.category || 'Other',
      description: payload.description || '',
      icon_url: payload.icon_url || '',
      created_by: ctx.email,
      created_at: now,
      updated_at: now,
    };
    DatabaseService.insert(CONFIG.SHEETS.APPLICATIONS, data);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'application',
      entity_id: id,
      action: 'create',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ name: payload.name, url: payload.url }),
    });
    return apiSuccess({ id: id }, 'Aplikasi dibuat');
  },

  /** Update aplikasi */
  updateApplication: function (payload) {
    var ctx = AuthService.requireEditor();
    var a = DatabaseService.findById(CONFIG.SHEETS.APPLICATIONS, 'app_id', payload.id);
    if (!a) return apiError('Aplikasi tidak ditemukan', 'NOT_FOUND');
    var patch = { updated_at: nowIso() };
    if (typeof payload.name === 'string') patch.app_name = payload.name;
    if (typeof payload.url === 'string') {
      if (!isValidUrl(payload.url)) return apiError('URL tidak valid', 'VALIDATION');
      patch.app_url = payload.url;
    }
    if (typeof payload.category === 'string') patch.category = payload.category;
    if (typeof payload.description === 'string') patch.description = payload.description;
    if (payload.icon_url !== undefined) patch.icon_url = payload.icon_url;
    DatabaseService.update(CONFIG.SHEETS.APPLICATIONS, 'app_id', payload.id, patch);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'application',
      entity_id: payload.id,
      action: 'update',
      actor_email: ctx.email,
      old_value_json: JSON.stringify({ name: a.app_name, url: a.app_url }),
      new_value_json: JSON.stringify({ name: patch.app_name, url: patch.app_url }),
    });
    return apiSuccess({ id: payload.id }, 'Aplikasi diperbarui');
  },

  /** Hapus aplikasi */
  deleteApplication: function (appId) {
    var ctx = AuthService.requireAdmin();
    var a = DatabaseService.findById(CONFIG.SHEETS.APPLICATIONS, 'app_id', appId);
    if (!a) return apiError('Aplikasi tidak ditemukan', 'NOT_FOUND');
    DatabaseService.removeBy(CONFIG.SHEETS.TASK_APPLICATIONS, 'app_id', appId);
    DatabaseService.remove(CONFIG.SHEETS.APPLICATIONS, 'app_id', appId);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'application',
      entity_id: appId,
      action: 'delete',
      actor_email: ctx.email,
      old_value_json: JSON.stringify({ name: a.app_name }),
    });
    return apiSuccess(null, 'Aplikasi dihapus');
  },

  /** Tautkan aplikasi ke task */
  linkApplicationToTask: function (payload) {
    var ctx = AuthService.requireEditor();
    if (!payload.taskId || !payload.appId) {
      return apiError('taskId dan appId wajib diisi', 'VALIDATION');
    }
    if (payload.customUrl && !isValidUrl(payload.customUrl)) {
      return apiError('Custom URL tidak valid', 'VALIDATION');
    }
    var t = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', payload.taskId);
    if (!t) return apiError('Task tidak ditemukan', 'NOT_FOUND');
    if (String(t.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Task tidak ditemukan', 'NOT_FOUND');
    }
    var app = DatabaseService.findById(CONFIG.SHEETS.APPLICATIONS, 'app_id', payload.appId);
    if (!app) return apiError('Aplikasi tidak ditemukan', 'NOT_FOUND');
    if (String(app.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Aplikasi tidak ditemukan', 'NOT_FOUND');
    }
    // Cek duplicate
    var existing = DatabaseService.findBy(CONFIG.SHEETS.TASK_APPLICATIONS, 'task_id', payload.taskId)
      .filter(function (ta) { return String(ta.app_id) === String(payload.appId); });
    if (existing.length > 0) {
      return apiError('Aplikasi sudah ditautkan ke task ini', 'DUPLICATE');
    }
    var id = generateId('ta');
    DatabaseService.insert(CONFIG.SHEETS.TASK_APPLICATIONS, {
      task_app_id: id,
      task_id: payload.taskId,
      app_id: payload.appId,
      custom_url: payload.customUrl || '',
      link_label: payload.linkLabel || '',
      created_at: nowIso(),
    });
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'task',
      entity_id: payload.taskId,
      action: 'link_application',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ appId: app.app_id, name: app.app_name }),
    });
    return apiSuccess({ id: id }, 'Aplikasi ditautkan');
  },

  /** Lepas aplikasi dari task */
  unlinkApplicationFromTask: function (taskAppId) {
    var ctx = AuthService.requireEditor();
    var ta = DatabaseService.findById(CONFIG.SHEETS.TASK_APPLICATIONS, 'task_app_id', taskAppId);
    if (!ta) return apiError('Link tidak ditemukan', 'NOT_FOUND');
    var linkedTask = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', ta.task_id);
    if (!linkedTask || String(linkedTask.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Link tidak ditemukan', 'NOT_FOUND');
    }
    DatabaseService.remove(CONFIG.SHEETS.TASK_APPLICATIONS, 'task_app_id', taskAppId);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'task',
      entity_id: ta.task_id,
      action: 'unlink_application',
      actor_email: ctx.email,
      old_value_json: JSON.stringify({ appId: ta.app_id }),
    });
    return apiSuccess(null, 'Link dihapus');
  },

  /** List aplikasi yang ditautkan ke task */
  listTaskApplications: function (taskId) {
    var ctx = AuthService.getCurrentContext();
    var links = DatabaseService.findBy(CONFIG.SHEETS.TASK_APPLICATIONS, 'task_id', taskId);
    var result = links.map(function (ta) {
      var app = DatabaseService.findById(CONFIG.SHEETS.APPLICATIONS, 'app_id', ta.app_id) || {};
      return {
        taskAppId: ta.task_app_id,
        appId: app.app_id,
        name: app.app_name,
        category: app.category,
        url: ta.custom_url || app.app_url,
        linkLabel: ta.link_label,
        iconUrl: app.icon_url,
      };
    });
    return apiSuccess(result);
  },
};
