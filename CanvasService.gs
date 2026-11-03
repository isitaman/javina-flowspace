/**
 * FlowSpace - CanvasService.gs
 * Operasi terkait canvas: load/save nodes & edges untuk workflow.
 */

var CanvasService = {
  /** Load full canvas (nodes + edges + viewport) untuk workflow */
  getCanvas: function (workflowId) {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiError('Workspace belum siap', 'NOT_FOUND');
    var w = DatabaseService.findById(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', workflowId);
    if (!w || String(w.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
    }

    var nodes = DatabaseService.findBy(CONFIG.SHEETS.NODES, 'workflow_id', workflowId);
    var edges = DatabaseService.findBy(CONFIG.SHEETS.EDGES, 'workflow_id', workflowId);

    // Ambil info task untuk node yang punya task_id
    var allTasks = DatabaseService.findBy(CONFIG.SHEETS.TASKS, 'workflow_id', workflowId);
    var taskMap = {};
    allTasks.forEach(function (t) { taskMap[t.task_id] = t; });

    var nodesPayload = nodes.map(function (n) {
      var t = n.task_id ? taskMap[n.task_id] : null;
      return {
        id: n.node_id,
        nodeType: n.node_type,
        title: n.title,
        description: n.description,
        positionX: Number(n.position_x) || 0,
        positionY: Number(n.position_y) || 0,
        width: Number(n.width) || 180,
        height: Number(n.height) || 80,
        styleJson: n.style_json || '{}',
        applicationId: n.application_id || null,
        taskId: n.task_id || null,
        task: t ? {
          id: t.task_id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          progress: Number(t.progress) || 0,
          assigneeEmail: t.assignee_email,
          dueDate: t.due_date,
        } : null,
      };
    });

    var edgesPayload = edges.map(function (e) {
      return {
        id: e.edge_id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: e.label || '',
        condition: e.condition || '',
        sourceOutput: e.source_output || 'output_1',
        targetInput: e.target_input || 'input_1',
      };
    });

    return apiSuccess({
      workflowId: w.workflow_id,
      workflowName: w.workflow_name,
      description: w.description,
      version: Number(w.version) || 1,
      canvasSettings: w.canvas_settings_json,
      nodes: nodesPayload,
      edges: edgesPayload,
    });
  },

  /**
   * Save full canvas layout.
   * Strategi: replace all - hapus edges lama, hapus nodes yang hilang,
   * upsert nodes baru, recreate edges. Tasks yang terhubung ke node tetap dipertahankan.
   */
  saveCanvas: function (payload) {
    var ctx = AuthService.requireEditor();
    var w = DatabaseService.findById(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', payload.workflowId);
    if (!w || String(w.workspace_id) !== String(ctx.workspace.workspace_id)) {
      return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
    }

    // Version conflict check
    if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(w.version)) {
      return apiError('Data berubah sejak terakhir dimuat. Muat ulang sebelum menyimpan.', 'VERSION_CONFLICT');
    }

    var now = nowIso();
    var nodes = payload.nodes || [];
    var edges = payload.edges || [];
    var canvasSettings = typeof payload.canvasSettings === 'string' ? payload.canvasSettings : JSON.stringify(payload.canvasSettings || {});

    // 1. Hapus semua edge lama untuk workflow ini
    DatabaseService.removeBy(CONFIG.SHEETS.EDGES, 'workflow_id', payload.workflowId);

    // 2. Ambil node lama, bandingkan dengan yang baru
    var existingNodes = DatabaseService.findBy(CONFIG.SHEETS.NODES, 'workflow_id', payload.workflowId);
    var existingIdsMap = {};
    existingNodes.forEach(function (n) { existingIdsMap[n.node_id] = n; });
    var incomingIdsMap = {};
    nodes.forEach(function (n) { incomingIdsMap[n.id] = true; });

    // 3. Hapus node yang tidak ada di incoming (preserve task: lepas relasi dulu)
    existingNodes.forEach(function (n) {
      if (!incomingIdsMap[n.node_id]) {
        if (n.task_id) {
          DatabaseService.update(CONFIG.SHEETS.TASKS, 'task_id', n.task_id, { node_id: '', updated_at: now });
        }
        DatabaseService.remove(CONFIG.SHEETS.NODES, 'node_id', n.node_id);
      }
    });

    // 4. Upsert node incoming
    nodes.forEach(function (n) {
      var existing = existingIdsMap[n.id];
      var nodeData = {
        workflow_id: payload.workflowId,
        node_type: n.nodeType || 'process',
        title: n.title || 'Untitled',
        description: n.description || '',
        position_x: Number(n.positionX) || 0,
        position_y: Number(n.positionY) || 0,
        width: Number(n.width) || 180,
        height: Number(n.height) || 80,
        style_json: typeof n.styleJson === 'string' ? n.styleJson : JSON.stringify(n.styleJson || {}),
        application_id: n.applicationId || '',
        task_id: n.taskId || (existing ? existing.task_id : ''),
        updated_at: now,
        version: existing ? (Number(existing.version) || 1) + 1 : 1,
      };
      if (existing) {
        DatabaseService.update(CONFIG.SHEETS.NODES, 'node_id', n.id, nodeData);
      } else {
        nodeData.node_id = n.id;
        nodeData.created_at = now;
        DatabaseService.insert(CONFIG.SHEETS.NODES, nodeData);
      }
    });

    // 5. Recreate edges
    var newEdges = edges.map(function (e) {
      return {
        edge_id: e.id || generateId('edge'),
        workflow_id: payload.workflowId,
        source_node_id: e.source,
        target_node_id: e.target,
        label: e.label || '',
        condition: e.condition || '',
        source_output: e.sourceOutput || 'output_1',
        target_input: e.targetInput || 'input_1',
        created_at: now,
        updated_at: now,
      };
    });
    if (newEdges.length > 0) {
      DatabaseService.batchInsert(CONFIG.SHEETS.EDGES, newEdges);
    }

    // 6. Update workflow version + canvas settings
    var newVersion = Number(w.version) + 1;
    DatabaseService.update(CONFIG.SHEETS.WORKFLOWS, 'workflow_id', payload.workflowId, {
      canvas_settings_json: canvasSettings,
      version: newVersion,
      updated_at: now,
    });

    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'workflow',
      entity_id: payload.workflowId,
      action: 'canvas_save',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ nodesCount: nodes.length, edgesCount: edges.length }),
    });

    return apiSuccess({ version: newVersion }, 'Canvas tersimpan');
  },

  /** Buat node baru */
  createNode: function (payload) {
    var ctx = AuthService.requireEditor();
    var id = payload.id || generateId('node');
    var now = nowIso();
    var data = {
      node_id: id,
      workflow_id: payload.workflow_id,
      node_type: isValidNodeType(payload.node_type) ? payload.node_type : 'process',
      title: payload.title || 'Node Baru',
      description: payload.description || '',
      position_x: Number(payload.position_x) || 0,
      position_y: Number(payload.position_y) || 0,
      width: Number(payload.width) || 180,
      height: Number(payload.height) || 80,
      style_json: payload.style_json || '{}',
      application_id: payload.application_id || '',
      task_id: payload.task_id || '',
      created_at: now,
      updated_at: now,
      version: 1,
    };
    DatabaseService.insert(CONFIG.SHEETS.NODES, data);
    return apiSuccess({ id: id }, 'Node dibuat');
  },

  /** Update node */
  updateNode: function (payload) {
    var ctx = AuthService.requireEditor();
    var n = DatabaseService.findById(CONFIG.SHEETS.NODES, 'node_id', payload.id);
    if (!n) return apiError('Node tidak ditemukan', 'NOT_FOUND');
    var patch = { updated_at: nowIso(), version: (Number(n.version) || 1) + 1 };
    if (typeof payload.title === 'string') patch.title = payload.title;
    if (typeof payload.description === 'string') patch.description = payload.description;
    if (payload.node_type && isValidNodeType(payload.node_type)) patch.node_type = payload.node_type;
    if (typeof payload.position_x === 'number') patch.position_x = payload.position_x;
    if (typeof payload.position_y === 'number') patch.position_y = payload.position_y;
    if (typeof payload.width === 'number') patch.width = payload.width;
    if (typeof payload.height === 'number') patch.height = payload.height;
    if (payload.task_id !== undefined) patch.task_id = payload.task_id;
    if (payload.application_id !== undefined) patch.application_id = payload.application_id;
    DatabaseService.update(CONFIG.SHEETS.NODES, 'node_id', payload.id, patch);
    return apiSuccess({ id: payload.id }, 'Node diperbarui');
  },

  /** Hapus node */
  deleteNode: function (nodeId) {
    var ctx = AuthService.requireEditor();
    var n = DatabaseService.findById(CONFIG.SHEETS.NODES, 'node_id', nodeId);
    if (!n) return apiError('Node tidak ditemukan', 'NOT_FOUND');
    // Lepas relasi task (preserve task)
    if (n.task_id) {
      DatabaseService.update(CONFIG.SHEETS.TASKS, 'task_id', n.task_id, { node_id: '', updated_at: nowIso() });
    }
    // Hapus edges terkait
    DatabaseService.removeBy(CONFIG.SHEETS.EDGES, 'source_node_id', nodeId);
    DatabaseService.removeBy(CONFIG.SHEETS.EDGES, 'target_node_id', nodeId);
    DatabaseService.remove(CONFIG.SHEETS.NODES, 'node_id', nodeId);
    return apiSuccess(null, 'Node dihapus');
  },

  /** Buat edge baru */
  createEdge: function (payload) {
    var ctx = AuthService.requireEditor();
    // Validasi node asal dan tujuan ada di workflow yang sama
    var sourceNode = DatabaseService.findById(CONFIG.SHEETS.NODES, 'node_id', payload.source_node_id);
    var targetNode = DatabaseService.findById(CONFIG.SHEETS.NODES, 'node_id', payload.target_node_id);
    if (!sourceNode || !targetNode) return apiError('Node tidak ditemukan', 'NOT_FOUND');
    if (String(sourceNode.workflow_id) !== String(targetNode.workflow_id)) {
      return apiError('Node asal dan tujuan harus dari workflow yang sama', 'VALIDATION');
    }
    if (String(payload.source_node_id) === String(payload.target_node_id)) {
      return apiError('Node tidak bisa terhubung ke dirinya sendiri', 'VALIDATION');
    }
    var id = payload.id || generateId('edge');
    var now = nowIso();
    DatabaseService.insert(CONFIG.SHEETS.EDGES, {
      edge_id: id,
      workflow_id: sourceNode.workflow_id,
      source_node_id: payload.source_node_id,
      target_node_id: payload.target_node_id,
      label: payload.label || '',
      condition: payload.condition || '',
      source_output: payload.source_output || 'output_1',
      target_input: payload.target_input || 'input_1',
      created_at: now,
      updated_at: now,
    });
    return apiSuccess({ id: id }, 'Koneksi dibuat');
  },

  /** Hapus edge */
  deleteEdge: function (edgeId) {
    var ctx = AuthService.requireEditor();
    DatabaseService.remove(CONFIG.SHEETS.EDGES, 'edge_id', edgeId);
    return apiSuccess(null, 'Koneksi dihapus');
  },
};
