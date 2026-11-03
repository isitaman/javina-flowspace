/**
 * FlowSpace - WorkflowService.gs
 * CRUD workflow.
 */

var WorkflowService = {
  /** List semua workflow di workspace saat ini */
  listWorkflows: function () {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiSuccess([]);
    var workflows = DatabaseService.findBy(CONFIG.SHEETS.WORKFLOWS, 'workspace_id', ctx.workspace.workspace_id)
      .filter(function (w) { return String(w.status) === 'active'; });

    // Tambah info task count dan progress
    var tasks = DatabaseService.findBy(CONFIG.SHEETS.TASKS, 'workspace_id', ctx.workspace.workspace_id);
    var result = workflows.map(function (w) {
      var wfTasks = tasks.filter(function (t) { return String(t.workflow_id) === String(w.workflow_id); });
      var avg = 0;
      if (wfTasks.length > 0) {
        var sum = 0;
        for (var i = 0; i < wfTasks.length; i++) sum += Number(wfTasks[i].progress) || 0;
        avg = Math.round(sum / wfTasks.length);
      }
      return {
        id: w.workflow_id,
        name: w.workflow_name,
        description: w.description,
        createdBy: w.created_by,
        status: w.status,
        version: Number(w.version) || 1,
        createdAt: String(w.created_at),
        updatedAt: String(w.updated_at),
        taskCount: wfTasks.length,
        progress: avg,
      };
    });
    // Sort by updatedAt desc
    result.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
    return apiSuccess(result);
  },

  /** Buat workflow baru */
  createWorkflow: function (payload) {
    var ctx = AuthService.requireEditor();
    if (!payload.name || !payload.name.trim()) {
      return apiError('Nama workflow wajib diisi', 'VALIDATION');
    }
    var id = generateId('wf');
    var now = nowIso();
    var data = {
      workflow_id: id,
      workspace_id: ctx.workspace.workspace_id,
      workflow_name: payload.name.trim(),
      description: payload.description || '',
      canvas_settings_json: payload.canvas_settings_json || JSON.stringify({ zoom: 0.85, x: 0, y: 0 }),
      created_by: ctx.email,
      created_at: now,
      updated_at: now,
      status: 'active',
      version: 1,
    };
    DatabaseService.insert(CONFIG.SHEETS.WORKFLOWS, data);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'workflow',
      entity_id: id,
      action: 'create',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ name: payload.name }),
    });
    return apiSuccess({ id: id }, 'Workflow dibuat');
  },

  /** Update workflow (name/description/archive) */
  updateWorkflow: function (payload) {
    var ctx = AuthService.requireEditor();
    var w = DatabaseService.findById(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', payload.id);
    if (!w) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');

    // Version check
    if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(w.version)) {
      return apiError('Data berubah sejak terakhir dimuat. Muat ulang sebelum menyimpan.', 'VERSION_CONFLICT');
    }

    var patch = {
      updated_at: nowIso(),
      version: Number(w.version) + 1,
    };
    if (typeof payload.name === 'string') patch.workflow_name = payload.name;
    if (typeof payload.description === 'string') patch.description = payload.description;
    if (payload.canvas_settings_json) patch.canvas_settings_json = payload.canvas_settings_json;
    if (payload.status === 'archived') patch.status = 'archived';

    DatabaseService.update(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', payload.id, patch);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'workflow',
      entity_id: payload.id,
      action: payload.status === 'archived' ? 'archive' : 'update',
      actor_email: ctx.email,
      old_value_json: JSON.stringify({ name: w.workflow_name, description: w.description }),
      new_value_json: JSON.stringify({ name: patch.workflow_name, description: patch.description }),
    });
    return apiSuccess({ id: payload.id, version: patch.version }, 'Workflow diperbarui');
  },

  /** Hapus workflow permanen (cascade ke nodes, edges, tasks) */
  deleteWorkflow: function (workflowId) {
    var ctx = AuthService.requireAdmin();
    var w = DatabaseService.findById(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', workflowId);
    if (!w) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
    // Hapus edges, nodes, tasks, task-applications, checklist terkait
    DatabaseService.removeBy(CONFIG.SHEETS.EDGES, 'workflow_id', workflowId);
    var wfTasks = DatabaseService.findBy(CONFIG.SHEETS.TASKS, 'workflow_id', workflowId);
    wfTasks.forEach(function (t) {
      DatabaseService.removeBy(CONFIG.SHEETS.TASK_APPLICATIONS, 'task_id', t.task_id);
      DatabaseService.removeBy(CONFIG.SHEETS.CHECKLIST, 'task_id', t.task_id);
    });
    DatabaseService.removeBy(CONFIG.SHEETS.NODES, 'workflow_id', workflowId);
    DatabaseService.removeBy(CONFIG.SHEETS.TASKS, 'workflow_id', workflowId);
    DatabaseService.remove(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', workflowId);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'workflow',
      entity_id: workflowId,
      action: 'delete',
      actor_email: ctx.email,
      old_value_json: JSON.stringify({ name: w.workflow_name }),
    });
    return apiSuccess(null, 'Workflow dihapus');
  },

  /** Duplikasi workflow (nodes + edges, tanpa tasks) */
  duplicateWorkflow: function (workflowId) {
    var ctx = AuthService.requireEditor();
    var w = DatabaseService.findById(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', workflowId);
    if (!w) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');

    var newId = generateId('wf');
    var now = nowIso();
    var newWf = {
      workflow_id: newId,
      workspace_id: ctx.workspace.workspace_id,
      workflow_name: w.workflow_name + ' (Salinan)',
      description: w.description,
      canvas_settings_json: w.canvas_settings_json,
      created_by: ctx.email,
      created_at: now,
      updated_at: now,
      status: 'active',
      version: 1,
    };
    DatabaseService.insert(CONFIG.SHEETS.WORKFLOWS, newWf);

    // Duplicate nodes
    var nodes = DatabaseService.findBy(CONFIG.SHEETS.NODES, 'workflow_id', workflowId);
    var nodeMap = {};
    nodes.forEach(function (n) {
      var newNodeId = generateId('node');
      var newNode = {
        node_id: newNodeId,
        workflow_id: newId,
        node_type: n.node_type,
        title: n.title,
        description: n.description,
        position_x: n.position_x,
        position_y: n.position_y,
        width: n.width,
        height: n.height,
        style_json: n.style_json,
        application_id: n.application_id || '',
        task_id: '', // tidak duplikasi task
        created_at: now,
        updated_at: now,
        version: 1,
      };
      DatabaseService.insert(CONFIG.SHEETS.NODES, newNode);
      nodeMap[n.node_id] = newNodeId;
    });

    // Duplicate edges
    var edges = DatabaseService.findBy(CONFIG.SHEETS.EDGES, 'workflow_id', workflowId);
    edges.forEach(function (e) {
      var newSource = nodeMap[e.source_node_id];
      var newTarget = nodeMap[e.target_node_id];
      if (newSource && newTarget) {
        var newEdge = {
          edge_id: generateId('edge'),
          workflow_id: newId,
          source_node_id: newSource,
          target_node_id: newTarget,
          label: e.label || '',
          condition: e.condition || '',
          source_output: e.source_output || 'output_1',
          target_input: e.target_input || 'input_1',
          created_at: now,
          updated_at: now,
        };
        DatabaseService.insert(CONFIG.SHEETS.EDGES, newEdge);
      }
    });

    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'workflow',
      entity_id: newId,
      action: 'duplicate',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ name: newWf.workflow_name, sourceId: workflowId }),
    });
    return apiSuccess({ id: newId }, 'Workflow diduplikasi');
  },
};
