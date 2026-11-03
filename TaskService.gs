/**
 * FlowSpace - TaskService.gs
 * CRUD task, status, priority, progress, filter.
 */

var TaskService = {
  /** List task dengan filter */
  listTasks: function (filters) {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiSuccess([]);
    var tasks = DatabaseService.findBy(CONFIG.SHEETS.TASKS, 'workspace_id', ctx.workspace.workspace_id);
    var workflows = DatabaseService.findBy(CONFIG.SHEETS.WORKFLOWS, 'workspace_id', ctx.workspace.workspace_id);
    var workflowMap = {};
    workflows.forEach(function (w) { workflowMap[w.workflow_id] = w; });

    var allTaskApps = DatabaseService.readAll(CONFIG.SHEETS.TASK_APPLICATIONS);
    var allApps = DatabaseService.findBy(CONFIG.SHEETS.APPLICATIONS, 'workspace_id', ctx.workspace.workspace_id);
    var appMap = {};
    allApps.forEach(function (a) { appMap[a.app_id] = a; });

    // Apply filters
    if (filters) {
      if (filters.workflowId) {
        tasks = tasks.filter(function (t) { return String(t.workflow_id) === String(filters.workflowId); });
      }
      if (filters.status) {
        tasks = tasks.filter(function (t) { return String(t.status) === String(filters.status); });
      }
      if (filters.assigneeEmail) {
        tasks = tasks.filter(function (t) { return String(t.assignee_email) === String(filters.assigneeEmail); });
      }
      if (filters.priority) {
        tasks = tasks.filter(function (t) { return String(t.priority) === String(filters.priority); });
      }
      if (filters.q) {
        var q = String(filters.q).toLowerCase();
        tasks = tasks.filter(function (t) { return String(t.title).toLowerCase().indexOf(q) !== -1; });
      }
    }

    var result = tasks.map(function (t) {
      var wf = workflowMap[t.workflow_id] || {};
      var taskApps = allTaskApps.filter(function (ta) { return String(ta.task_id) === String(t.task_id); });
      var apps = taskApps.map(function (ta) {
        var app = appMap[ta.app_id] || {};
        return {
          id: app.app_id,
          taskAppId: ta.task_app_id,
          name: app.app_name,
          url: ta.custom_url || app.app_url,
          category: app.category,
          iconUrl: app.icon_url,
          linkLabel: ta.link_label,
        };
      });
      return {
        id: t.task_id,
        title: t.title,
        description: t.description,
        workflowId: t.workflow_id,
        workflowName: wf.workflow_name || '',
        nodeId: t.node_id || null,
        assigneeEmail: t.assignee_email || null,
        status: t.status,
        priority: t.priority,
        progress: Number(t.progress) || 0,
        progressMode: t.progress_mode,
        startDate: t.start_date || null,
        dueDate: t.due_date || null,
        version: Number(t.version) || 1,
        createdAt: String(t.created_at),
        updatedAt: String(t.updated_at),
        applications: apps,
      };
    });
    return apiSuccess(result);
  },

  /** Dapatkan 1 task by id */
  getTask: function (taskId) {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiError('Workspace belum siap', 'NOT_FOUND');
    var t = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', taskId);
    if (!t) return apiError('Task tidak ditemukan', 'NOT_FOUND');
    if (String(t.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Task tidak ditemukan', 'NOT_FOUND');
    }
    var wf = DatabaseService.findById(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', t.workflow_id) || {};
    var node = null;
    if (t.node_id) {
      var n = DatabaseService.findById(CONFIG.SHEETS.NODES, 'node_id', t.node_id);
      if (n) node = { id: n.node_id, title: n.title };
    }
    var taskApps = DatabaseService.findBy(CONFIG.SHEETS.TASK_APPLICATIONS, 'task_id', taskId);
    var apps = taskApps.map(function (ta) {
      var app = DatabaseService.findById(CONFIG.SHEETS.APPLICATIONS, 'app_id', ta.app_id) || {};
      return {
        id: app.app_id,
        taskAppId: ta.task_app_id,
        name: app.app_name,
        url: ta.custom_url || app.app_url,
        category: app.category,
        iconUrl: app.icon_url,
        linkLabel: ta.link_label,
      };
    });
    var checklist = DatabaseService.findBy(CONFIG.SHEETS.CHECKLIST, 'task_id', taskId).map(function (c) {
      return {
        id: c.checklist_id,
        title: c.item_title,
        isCompleted: String(c.is_completed) === 'true',
        sortOrder: Number(c.sort_order) || 0,
      };
    });
    checklist.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    return apiSuccess({
      id: t.task_id,
      title: t.title,
      description: t.description,
      workflowId: t.workflow_id,
      workflowName: wf.workflow_name || '',
      nodeId: t.node_id || null,
      nodeTitle: node ? node.title : '',
      assigneeEmail: t.assignee_email || null,
      status: t.status,
      priority: t.priority,
      progress: Number(t.progress) || 0,
      progressMode: t.progress_mode,
      startDate: t.start_date || null,
      dueDate: t.due_date || null,
      version: Number(t.version) || 1,
      createdAt: String(t.created_at),
      updatedAt: String(t.updated_at),
      applications: apps,
      checklist: checklist,
    });
  },

  /** Buat task baru */
  createTask: function (payload) {
    var ctx = AuthService.requireEditor();
    if (!payload.title || !payload.workflow_id) {
      return apiError('Title dan workflow wajib diisi', 'VALIDATION');
    }
    if (payload.status && !isValidStatus(payload.status)) {
      return apiError('Status tidak valid', 'VALIDATION');
    }
    if (payload.priority && !isValidPriority(payload.priority)) {
      return apiError('Priority tidak valid', 'VALIDATION');
    }
    var wf = DatabaseService.findById(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', payload.workflow_id);
    if (!wf) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');

    var id = generateId('task');
    var now = nowIso();
    var progress = Number(payload.progress) || 0;
    if (progress < 0) progress = 0;
    if (progress > 100) progress = 100;
    // Jika status=done dan progress tidak eksplisit diset, set ke 100
    if (payload.status === 'done' && payload.progress === undefined) progress = 100;

    var data = {
      task_id: id,
      workspace_id: ctx.workspace.workspace_id,
      workflow_id: payload.workflow_id,
      node_id: payload.node_id || '',
      title: payload.title,
      description: payload.description || '',
      assignee_email: payload.assignee_email || '',
      status: payload.status || 'backlog',
      priority: payload.priority || 'medium',
      progress: progress,
      progress_mode: payload.progress_mode || 'manual',
      start_date: payload.start_date || '',
      due_date: payload.due_date || '',
      created_by: ctx.email,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    DatabaseService.insert(CONFIG.SHEETS.TASKS, data);

    // Jika ada node_id, link task ke node
    if (payload.node_id) {
      DatabaseService.update(CONFIG.SHEETS.NODES, 'node_id', payload.node_id, { task_id: id, updated_at: now });
    }

    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'task',
      entity_id: id,
      action: 'create',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ title: payload.title, status: data.status, priority: data.priority }),
    });
    return apiSuccess({ id: id, version: 1 }, 'Task dibuat');
  },

  /** Update task */
  updateTask: function (payload) {
    var ctx = AuthService.requireEditor();
    var t = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', payload.id);
    if (!t) return apiError('Task tidak ditemukan', 'NOT_FOUND');
    if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(t.version)) {
      return apiError('Data berubah sejak terakhir dimuat. Muat ulang sebelum menyimpan.', 'VERSION_CONFLICT');
    }
    if (payload.status && !isValidStatus(payload.status)) {
      return apiError('Status tidak valid', 'VALIDATION');
    }
    if (payload.priority && !isValidPriority(payload.priority)) {
      return apiError('Priority tidak valid', 'VALIDATION');
    }
    var patch = { updated_at: nowIso(), version: Number(t.version) + 1 };
    var oldValue = {};
    var fields = ['title', 'description', 'assignee_email', 'status', 'priority', 'progress', 'progress_mode', 'start_date', 'due_date', 'node_id'];
    var fieldMap = {
      title: 'title',
      description: 'description',
      assignee_email: 'assigneeEmail',
      status: 'status',
      priority: 'priority',
      progress: 'progress',
      progress_mode: 'progressMode',
      start_date: 'startDate',
      due_date: 'dueDate',
      node_id: 'nodeId',
    };
    fields.forEach(function (f) {
      var camelKey = fieldMap[f];
      if (payload[camelKey] !== undefined) {
        patch[f] = payload[camelKey];
        oldValue[f] = t[f];
      }
    });
    // Sanitasi progress
    if (patch.progress !== undefined) {
      var p = Number(patch.progress);
      if (isNaN(p)) p = 0;
      if (p < 0) p = 0;
      if (p > 100) p = 100;
      patch.progress = p;
    }
    // Jika status=done, set progress=100 jika tidak eksplisit
    if (patch.status === 'done' && patch.progress === undefined && Number(t.progress) < 100) {
      patch.progress = 100;
      oldValue.progress = t.progress;
    }

    DatabaseService.update(CONFIG.SHEETS.TASKS, 'task_id', payload.id, patch);

    // Jika node_id berubah, update relasi node
    if (patch.node_id !== undefined) {
      if (t.node_id) {
        DatabaseService.update(CONFIG.SHEETS.NODES, 'node_id', t.node_id, { task_id: '', updated_at: nowIso() });
      }
      if (patch.node_id) {
        DatabaseService.update(CONFIG.SHEETS.NODES, 'node_id', patch.node_id, { task_id: payload.id, updated_at: nowIso() });
      }
    }

    // Audit log perubahan
    var actionMap = {
      status: 'status_change',
      priority: 'priority_change',
      assignee_email: 'assignee_change',
      progress: 'progress_update',
      due_date: 'due_date_change',
    };
    Object.keys(oldValue).forEach(function (f) {
      AuditService.log({
        workspace_id: ctx.workspace.workspace_id,
        entity_type: 'task',
        entity_id: payload.id,
        action: actionMap[f] || 'update',
        actor_email: ctx.email,
        old_value_json: JSON.stringify(_buildObj(f, oldValue[f])),
        new_value_json: JSON.stringify(_buildObj(f, patch[f])),
      });
    });

    return apiSuccess({ id: payload.id, version: patch.version }, 'Task diperbarui');
  },

  /** Hapus task */
  deleteTask: function (taskId) {
    var ctx = AuthService.requireEditor();
    var t = DatabaseService.findById(CONFIG.SHEETS.TASKS, 'task_id', taskId);
    if (!t) return apiError('Task tidak ditemukan', 'NOT_FOUND');
    // Unlink dari node (preserve node)
    if (t.node_id) {
      DatabaseService.update(CONFIG.SHEETS.NODES, 'node_id', t.node_id, { task_id: '', updated_at: nowIso() });
    }
    DatabaseService.removeBy(CONFIG.SHEETS.TASK_APPLICATIONS, 'task_id', taskId);
    DatabaseService.removeBy(CONFIG.SHEETS.CHECKLIST, 'task_id', taskId);
    DatabaseService.remove(CONFIG.SHEETS.TASKS, 'task_id', taskId);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'task',
      entity_id: taskId,
      action: 'delete',
      actor_email: ctx.email,
      old_value_json: JSON.stringify({ title: t.title }),
    });
    return apiSuccess(null, 'Task dihapus');
  },
};

/** Helper untuk build object key:value */
function _buildObj(key, value) {
  var o = {};
  o[key] = value;
  return o;
}
