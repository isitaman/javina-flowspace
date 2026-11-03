/**
 * FlowSpace - ChecklistService.gs
 * Checklist per task.
 */

var ChecklistService = {
  /** List checklist untuk task */
  listChecklist: function (taskId) {
    var items = DatabaseService.findBy(CONFIG.SHEETS.CHECKLIST, 'task_id', taskId);
    var result = items.map(function (c) {
      return {
        id: c.checklist_id,
        title: c.item_title,
        isCompleted: String(c.is_completed) === 'true',
        sortOrder: Number(c.sort_order) || 0,
      };
    });
    result.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    return apiSuccess(result);
  },

  /** Tambah item checklist */
  createItem: function (payload) {
    var ctx = AuthService.requireEditor();
    if (!payload.taskId || !payload.title) {
      return apiError('taskId dan title wajib diisi', 'VALIDATION');
    }
    var t = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', payload.taskId);
    if (!t) return apiError('Task tidak ditemukan', 'NOT_FOUND');
    if (String(t.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Task tidak ditemukan', 'NOT_FOUND');
    }
    var existing = DatabaseService.findBy(CONFIG.SHEETS.CHECKLIST, 'task_id', payload.taskId);
    var id = generateId('cli');
    var data = {
      checklist_id: id,
      task_id: payload.taskId,
      item_title: payload.title,
      is_completed: 'false',
      sort_order: payload.sortOrder !== undefined ? Number(payload.sortOrder) : existing.length,
      created_by: ctx.email,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    DatabaseService.insert(CONFIG.SHEETS.CHECKLIST, data);
    // Jika progress_mode=checklist, recompute progress
    if (String(t.progress_mode) === 'checklist') {
      _recomputeChecklistProgress(payload.taskId);
    }
    return apiSuccess({ id: id }, 'Item ditambahkan');
  },

  /** Update item checklist */
  updateItem: function (payload) {
    var ctx = AuthService.requireEditor();
    var c = DatabaseService.findById(CONFIG.SHEETS.CHECKLIST, 'checklist_id', payload.id);
    if (!c) return apiError('Item tidak ditemukan', 'NOT_FOUND');
    var owningTask = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', c.task_id);
    if (!owningTask || String(owningTask.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Item tidak ditemukan', 'NOT_FOUND');
    }
    var patch = { updated_at: nowIso() };
    if (typeof payload.title === 'string') patch.item_title = payload.title;
    if (typeof payload.isCompleted === 'boolean') patch.is_completed = payload.isCompleted ? 'true' : 'false';
    if (typeof payload.sortOrder === 'number') patch.sort_order = payload.sortOrder;
    DatabaseService.update(CONFIG.SHEETS.CHECKLIST, 'checklist_id', payload.id, patch);
    var t = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', c.task_id);
    if (t && String(t.progress_mode) === 'checklist') {
      _recomputeChecklistProgress(c.task_id);
    }
    return apiSuccess({ id: payload.id }, 'Item diperbarui');
  },

  /** Hapus item checklist */
  deleteItem: function (itemId) {
    var ctx = AuthService.requireEditor();
    var c = DatabaseService.findById(CONFIG.SHEETS.CHECKLIST, 'checklist_id', itemId);
    if (!c) return apiError('Item tidak ditemukan', 'NOT_FOUND');
    var owningTask = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', c.task_id);
    if (!owningTask || String(owningTask.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Item tidak ditemukan', 'NOT_FOUND');
    }
    DatabaseService.remove(CONFIG.SHEETS.CHECKLIST, 'checklist_id', itemId);
    var t = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', c.task_id);
    if (t && String(t.progress_mode) === 'checklist') {
      _recomputeChecklistProgress(c.task_id);
    }
    return apiSuccess(null, 'Item dihapus');
  },
};

/** Helper: recompute task progress dari checklist */
function _recomputeChecklistProgress(taskId) {
  var items = DatabaseService.findBy(CONFIG.SHEETS.CHECKLIST, 'task_id', taskId);
  if (items.length === 0) {
    DatabaseService.update(CONFIG.SHEETS.TASKS, 'task_id', taskId, { progress: 0, updated_at: nowIso() });
    return;
  }
  var done = 0;
  for (var i = 0; i < items.length; i++) {
    if (String(items[i].is_completed) === 'true') done++;
  }
  var progress = Math.round((done / items.length) * 100);
  DatabaseService.update(CONFIG.SHEETS.TASKS, 'task_id', taskId, { progress: progress, updated_at: nowIso() });
}
