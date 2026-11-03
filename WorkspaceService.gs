/**
 * FlowSpace - WorkspaceService.gs
 * CRUD workspace dan members.
 */

var WorkspaceService = {
  /** Buat workspace baru */
  createWorkspace: function (payload) {
    var ctx = AuthService.requireAdmin();
    if (!payload.name || !payload.name.trim()) {
      return apiError('Nama workspace wajib diisi', 'VALIDATION');
    }
    var id = generateId('ws');
    var now = nowIso();
    var data = {
      workspace_id: id,
      workspace_name: payload.name.trim(),
      owner_email: ctx.email,
      status: 'active',
      created_at: now,
      updated_at: now,
    };
    DatabaseService.insert(CONFIG.SHEETS.WORKSPACES, data);
    AuditService.log({
      workspace_id: id,
      entity_type: 'workspace',
      entity_id: id,
      action: 'create',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ name: payload.name }),
    });
    return apiSuccess({ id: id }, 'Workspace dibuat');
  },

  /** List semua workspace */
  listWorkspaces: function () {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiSuccess([]);
    var list = DatabaseService.readAll(CONFIG.SHEETS.WORKSPACES).filter(function (w) {
      return String(w.status) === 'active';
    });
    return apiSuccess(list);
  },

  /** List members workspace saat ini */
  listMembers: function () {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiSuccess([]);
    var members = DatabaseService.findBy(CONFIG.SHEETS.MEMBERS, 'workspace_id', ctx.workspace.workspace_id);
    return apiSuccess(members.map(function (m) {
      return {
        id: m.member_id,
        email: m.email,
        displayName: m.display_name,
        role: m.role,
        status: m.member_status,
        createdAt: String(m.created_at),
      };
    }));
  },

  /** Tambah member baru */
  addMember: function (payload) {
    var ctx = AuthService.requireAdmin();
    var displayName = payload.displayName || payload.display_name;
    if (!payload.email || !displayName) {
      return apiError('Email dan nama wajib diisi', 'VALIDATION');
    }
    if (payload.role && !isValidRole(payload.role)) {
      return apiError('Role tidak valid', 'VALIDATION');
    }
    // Cek unik email per workspace
    var existing = DatabaseService.findBy(CONFIG.SHEETS.MEMBERS, 'email', payload.email)
      .filter(function (m) { return String(m.workspace_id) === String(ctx.workspace.workspace_id); });
    if (existing.length > 0) {
      return apiError('Email sudah terdaftar di workspace', 'DUPLICATE');
    }
    var id = generateId('mem');
    var data = {
      member_id: id,
      workspace_id: ctx.workspace.workspace_id,
      email: payload.email,
      display_name: displayName,
      role: payload.role || 'editor',
      member_status: 'active',
      created_at: nowIso(),
    };
    DatabaseService.insert(CONFIG.SHEETS.MEMBERS, data);
    AuditService.log({
      workspace_id: ctx.workspace.workspace_id,
      entity_type: 'member',
      entity_id: id,
      action: 'create',
      actor_email: ctx.email,
      new_value_json: JSON.stringify({ email: payload.email, role: data.role }),
    });
    return apiSuccess({ id: id }, 'Member ditambahkan');
  },
};
